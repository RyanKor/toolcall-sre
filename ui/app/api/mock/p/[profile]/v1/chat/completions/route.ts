/**
 * Simulated backends with different reliability characters.
 *
 * The scenario mock (`/api/mock/v1`) is deterministic — one request, one chosen
 * failure. These are the opposite: each profile is a *distribution* of failures,
 * so running a burst against several of them produces the thing a comparison
 * table is actually for — different models being wrong in different proportions,
 * measured under one policy by one proxy.
 *
 * Unlike the scenario mock, `model` here is a real model id and is echoed back,
 * because the per-model rollup keys on it.
 */

import { NextRequest } from "next/server";

type Emit = "clean" | "prose" | "fenced" | "bad-enum" | "wrong-type" | "missing" | "garbage" | "final";

/** Cumulative weights per profile — how this "model" tends to fail. */
const PROFILES: Record<string, [Emit, number][]> = {
  // Behaves close to a frontier API.
  solid: [
    ["clean", 0.9],
    ["prose", 0.95],
    ["bad-enum", 1.0],
  ],
  // The typical small local model: syntax noise plus real information gaps.
  flaky: [
    ["clean", 0.5],
    ["prose", 0.68],
    ["fenced", 0.76],
    ["bad-enum", 0.84],
    ["missing", 0.94],
    ["wrong-type", 1.0],
  ],
  // Not tool-tuned at all.
  rough: [
    ["clean", 0.22],
    ["prose", 0.42],
    ["fenced", 0.5],
    ["bad-enum", 0.6],
    ["missing", 0.84],
    ["wrong-type", 0.94],
    ["garbage", 1.0],
  ],
};

const ARGS: Record<Emit, unknown> = {
  clean: '{"location":"Seoul","unit":"celsius"}',
  prose: 'Sure! {"location": "Seoul", "unit": "celsius",}',
  fenced: '```json\n{"location":"Seoul","unit":"celsius"}\n```',
  "bad-enum": '{"location":"Seoul","unit":"C"}',
  "wrong-type": '{"location": 123, "unit": "celsius"}',
  missing: '{"location":"Seoul"}',
  garbage: "I cannot do that",
  final: "",
};

function pick(profile: string): Emit {
  const table = PROFILES[profile] ?? PROFILES.flaky;
  const r = Math.random();
  for (const [emit, upto] of table) {
    if (r <= upto) return emit;
  }
  return "clean";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ profile: string }> }) {
  const { profile } = await ctx.params;
  const body = await req.json();
  const model: string = body.model ?? profile;
  const messages: { role: string; content: unknown }[] = body.messages ?? [];

  const isRepair = messages.some(
    (m) => m.role === "system" && String(m.content ?? "").toLowerCase().includes("repair"),
  );

  // These profiles model *emission* quality, not repair quality: the repair pass
  // always succeeds so the comparison isolates how often each model needed one.
  if (isRepair) {
    return Response.json({
      id: "cmpl-sim",
      object: "chat.completion",
      created: 1,
      model,
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: '{"location": "Seoul", "unit": "celsius"}' },
        },
      ],
    });
  }

  const emit = pick(profile);

  if (emit === "final") {
    return Response.json({
      id: "cmpl-sim",
      object: "chat.completion",
      created: 1,
      model,
      choices: [
        { index: 0, finish_reason: "stop", message: { role: "assistant", content: "It is 21 degrees in Seoul." } },
      ],
    });
  }

  return Response.json({
    id: "cmpl-sim",
    object: "chat.completion",
    created: 1,
    model,
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "get_weather", arguments: ARGS[emit] },
            },
          ],
        },
      },
    ],
  });
}
