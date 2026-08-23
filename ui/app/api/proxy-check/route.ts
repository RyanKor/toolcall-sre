/**
 * Test a candidate proxy address before adding it.
 *
 * Resolved from the console server, not the browser — that is the perspective
 * that actually matters, and the one people get wrong when they open the console
 * from another machine.
 */

import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  const base = String(url ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) {
    return Response.json({ ok: false, code: "bad_scheme" });
  }
  const started = Date.now();
  try {
    const res = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const elapsedMs = Date.now() - started;
    if (!res.ok) {
      return Response.json({
        ok: false,
        elapsedMs,
        code: "proxy_status",
        detail: `${base}/health → ${res.status}`,
      });
    }
    const health = await res.json();
    if (health?.status !== "ok") {
      return Response.json({ ok: false, elapsedMs, code: "not_toolcall_sre" });
    }
    return Response.json({ ok: true, elapsedMs, health });
  } catch (e) {
    const timedOut = (e as Error).name === "TimeoutError";
    return Response.json({
      ok: false,
      elapsedMs: Date.now() - started,
      code: timedOut ? "timeout" : "proxy_unreachable",
      detail: `${base} — ${(e as Error).message}`,
    });
  }
}
