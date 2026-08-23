/**
 * Mock upstream — an OpenAI-compatible endpoint that misbehaves on demand.
 *
 * Point the proxy at this route (`--upstream http://127.0.0.1:3000/api/mock/v1`)
 * and the whole stack becomes testable with no model, no GPU and no Python:
 *
 *     browser → /api/run → toolcall-sre → here → back through the proxy
 *
 * The scenario is selected by the `model` field, which is how a request can pick
 * its own failure mode without a side channel.
 */

import { NextRequest } from "next/server";

type Msg = { role: string; content: unknown };

function toolCall(args: unknown, name = "get_weather", finish = "tool_calls") {
  return {
    id: "cmpl-mock",
    object: "chat.completion",
    created: 1,
    model: "mock",
    choices: [
      {
        index: 0,
        finish_reason: finish,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: args } }],
        },
      },
    ],
  };
}

function textReply(content: string, finish = "stop") {
  return {
    id: "cmpl-mock",
    object: "chat.completion",
    created: 1,
    model: "mock",
    choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content } }],
  };
}

const NON_STREAM: Record<string, () => unknown> = {
  clean: () => toolCall('{"location":"Seoul","unit":"celsius"}'),
  prose: () => toolCall('Sure! {"location": "Seoul", "unit": "celsius",}'),
  fenced: () => toolCall('```json\n{"location":"Seoul","unit":"celsius"}\n```'),
  "wrong-type": () => toolCall('{"location": 123, "unit": "celsius"}'),
  "bad-enum": () => toolCall('{"location":"Seoul","unit":"C"}'),
  missing: () => toolCall('{"location":"Seoul"}'),
  garbage: () => toolCall("I cannot do that"),
  // arguments as an OBJECT, not a string — Ollama's native shape.
  "object-args": () => toolCall({ location: "Seoul", unit: "celsius" }),
  // a no-parameter tool, called the way most backends call one
  "empty-args": () => toolCall("", "get_time"),
  final: () => textReply("It is 21 degrees in Seoul."),
  truncated: () => textReply("It is 21 deg", "length"),
  "empty-final": () => textReply("", "stop"),
};

const STREAM_ARGS: Record<string, string> = {
  "stream-clean": '{"location":"Seoul","unit":"celsius"}',
  "stream-prose": 'Sure! {"location": "Seoul", "unit": "celsius",}',
  "stream-missing": '{"location":"Seoul"}',
};

/** Split arguments across deltas mid-token, the way a real backend does. */
function streamBody(args: string, name = "get_weather"): string {
  const chunks: unknown[] = [
    {
      id: "c1",
      created: 1,
      model: "mock",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
  ];
  const parts = args.match(/[\s\S]{1,7}/g) ?? [""];
  parts.forEach((part, i) => {
    const fn: Record<string, string> = { arguments: part };
    if (i === 0) fn.name = name;
    const tc: Record<string, unknown> = { index: 0, function: fn };
    if (i === 0) {
      tc.id = "call_1";
      tc.type = "function";
    }
    chunks.push({
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { tool_calls: [tc] }, finish_reason: null }],
    });
  });
  chunks.push({
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
  });
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const messages: Msg[] = body.messages ?? [];
  const scenario: string = body.model ?? "clean";

  // The proxy's repair request is identifiable by its system prompt.
  const isRepair = messages.some(
    (m) => m.role === "system" && String(m.content ?? "").toLowerCase().includes("repair"),
  );

  if (isRepair) {
    // A model that plays by the rules declines when the prompt offered it the
    // chance and the value genuinely is not in the context.
    const wasOfferedAnOut = messages.some((m) =>
      String(m.content ?? "").includes("__unrecoverable__"),
    );
    if (wasOfferedAnOut && scenario.startsWith("DECLINE")) {
      return Response.json(textReply('{"__unrecoverable__": true}'));
    }
    return Response.json(textReply('{"location": "Seoul", "unit": "celsius"}'));
  }

  if (body.stream) {
    const args = STREAM_ARGS[scenario] ?? STREAM_ARGS["stream-clean"];
    return new Response(streamBody(args), {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  }

  const key = scenario.replace(/^DECLINE-/, "");
  const make = NON_STREAM[key] ?? NON_STREAM.clean;
  return Response.json(make());
}
