/**
 * Drive one scenario end-to-end and report what happened at every layer.
 *
 * The point is not "did it return 200" — it is showing, side by side, what the
 * model emitted, what the client received, and *which decision the proxy made
 * and why*. That last part comes from the proxy's own event record, not from
 * this route's guesswork.
 */

import { NextRequest } from "next/server";
import { proxyBase } from "@/lib/proxy";
import { DEFAULT_TASK, TOOLS } from "@/lib/scenarios";

interface RunRequest {
  /** Sent as `model`. For the scenario mock this also picks the failure mode. */
  scenario: string;
  task?: string;
  stream?: boolean;
  /** Registry alias naming which backend serves this run. */
  upstream?: string;
  /** Prefix for the session id, so a burst can be grouped and found later. */
  sessionPrefix?: string;
}

/** Reassemble tool-call arguments out of an SSE body, like a real client would. */
function reassembleStream(body: string) {
  const calls: Record<number, { name: string; arguments: string }> = {};
  let finish: string | null = null;
  let content = "";
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") break;
    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    for (const ch of (chunk.choices as Record<string, unknown>[]) ?? []) {
      if (typeof ch.finish_reason === "string") finish = ch.finish_reason;
      const delta = (ch.delta ?? {}) as Record<string, unknown>;
      if (typeof delta.content === "string") content += delta.content;
      for (const tc of (delta.tool_calls as Record<string, unknown>[]) ?? []) {
        const i = Number(tc.index ?? 0);
        calls[i] ??= { name: "", arguments: "" };
        const fn = (tc.function ?? {}) as Record<string, string>;
        if (fn.name) calls[i].name += fn.name;
        if (fn.arguments) calls[i].arguments += fn.arguments;
      }
    }
  }
  return { calls: Object.values(calls), finish, content };
}

export async function POST(req: NextRequest) {
  const { scenario, task, stream = false, upstream, sessionPrefix }: RunRequest = await req.json();
  const sessionId = `${sessionPrefix ?? "lab"}-${scenario}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const PROXY_BASE = await proxyBase();

  const body = {
    model: scenario,
    messages: [
      { role: "system", content: "You are a helpful assistant that uses tools." },
      { role: "user", content: task || DEFAULT_TASK },
    ],
    tools: TOOLS,
    ...(stream ? { stream: true } : {}),
  };

  const startedAt = Date.now();
  let received: unknown;
  let raw = "";
  let status = 0;

  try {
    const res = await fetch(`${PROXY_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-session-id": sessionId,
        ...(upstream ? { "x-tcs-upstream": upstream } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    status = res.status;
    raw = await res.text();
    if (stream) {
      received = reassembleStream(raw);
    } else {
      try {
        received = JSON.parse(raw);
      } catch {
        received = raw;
      }
    }
  } catch (e) {
    return Response.json(
      {
        code: "proxy_unreachable",
        detail: `${PROXY_BASE} — ${(e as Error).message}`,
      },
      { status: 502 },
    );
  }

  const elapsedMs = Date.now() - startedAt;

  // The proxy's own verdict for this exact request: which action it took per
  // tool call, how it classified the violation, what a repair invented.
  let event: unknown = null;
  let session: unknown = null;
  try {
    const ev = await fetch(
      `${PROXY_BASE}/events?session=${encodeURIComponent(sessionId)}&limit=1`,
      { cache: "no-store" },
    );
    const parsed = await ev.json();
    event = parsed?.events?.[0] ?? null;

    const ss = await fetch(`${PROXY_BASE}/sessions?limit=1000`, { cache: "no-store" });
    const sessions = (await ss.json())?.sessions ?? [];
    session = sessions.find((s: { session: string }) => s.session === sessionId) ?? null;
  } catch {
    // The run itself still succeeded; the verdict is just unavailable.
  }

  return Response.json({
    sessionId,
    upstream: upstream ?? "default",
    status,
    elapsedMs,
    sent: body,
    received,
    rawStream: stream ? raw : undefined,
    event,
    session,
  });
}
