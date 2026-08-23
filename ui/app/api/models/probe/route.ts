/**
 * Check a backend before committing to it.
 *
 * Probing runs through the proxy's `/admin/probe` rather than from here, so the
 * answer reflects what the *proxy* can reach — the console and the proxy may sit
 * on different machines, and only the proxy's view matters.
 */

import { NextRequest } from "next/server";
import { proxyBase } from "@/lib/proxy";
import { readConfig } from "@/lib/store";

export async function POST(req: NextRequest) {
  const { baseUrl, modelId } = await req.json();
  const base = await proxyBase();

  // A stored key is never sent to the browser, so resolve it here by URL.
  const cfg = await readConfig();
  const apiKey = cfg.models.find((m) => m.baseUrl === baseUrl)?.apiKey;

  try {
    const res = await fetch(`${base}/admin/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base_url: baseUrl, api_key: apiKey }),
      cache: "no-store",
    });
    const body = await res.json();
    if (res.status === 403) {
      return Response.json(
        { ok: false, code: "admin_disabled" },
        { status: 200 },
      );
    }
    if (body?.ok && modelId && Array.isArray(body.models) && body.models.length > 0) {
      body.model_found = body.models.includes(modelId);
    }
    return Response.json(body);
  } catch (e) {
    return Response.json({
      ok: false,
      code: "proxy_unreachable",
      detail: `${base} — ${(e as Error).message}`,
    });
  }
}
