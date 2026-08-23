/**
 * Server-side passthrough to the active proxy's endpoints.
 *
 * Going through the Next server rather than fetching from the browser keeps the
 * proxy free of any CORS requirement, lets the console point at a proxy on
 * another host, and keeps stored API keys off the client.
 */

import { NextRequest } from "next/server";
import { proxyBase } from "@/lib/proxy";

const ALLOWED = new Set(["health", "metrics", "sessions", "events", "models", "upstreams", "debug", "admin"]);

async function forward(req: NextRequest, path: string[], method: "GET" | "POST" | "DELETE") {
  if (!ALLOWED.has(path[0] ?? "")) {
    return Response.json({ error: `not proxied: /${path.join("/")}` }, { status: 404 });
  }
  const base = await proxyBase();
  const url = `${base}/${path.join("/")}${req.nextUrl.search}`;
  try {
    const res = await fetch(url, {
      method,
      cache: "no-store",
      headers: method === "GET" ? undefined : { "content-type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : await req.text(),
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    return Response.json(
      { code: "proxy_unreachable", detail: `${base} — ${(e as Error).message}` },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path, "GET");
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path, "POST");
}
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path, "DELETE");
}
