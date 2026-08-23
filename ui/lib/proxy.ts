/** Resolving the proxy the console talks to. Server-side only. */

import { activeProxy } from "@/lib/store";

/** Server routes report failures by code; the browser supplies the wording. */
export interface ProxyError {
  code: "proxy_unreachable" | "proxy_status";
  detail: string;
}

export async function proxyBase(): Promise<string> {
  return (await activeProxy()).url.replace(/\/+$/, "");
}

/** GET a JSON endpoint on the active proxy, turning a dead proxy into a message. */
export async function proxyGet(path: string): Promise<unknown> {
  const base = await proxyBase();
  try {
    const res = await fetch(`${base}${path}`, { cache: "no-store" });
    if (!res.ok) {
      return { code: "proxy_status", detail: `${base} → ${res.status}` } satisfies ProxyError;
    }
    return await res.json();
  } catch (e) {
    return {
      code: "proxy_unreachable",
      detail: `${base} — ${(e as Error).message}`,
    } satisfies ProxyError;
  }
}

export function isProxyError(v: unknown): v is ProxyError {
  return typeof v === "object" && v !== null && "code" in v && "detail" in v;
}
