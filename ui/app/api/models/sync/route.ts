/**
 * Push the console's model list into the connected proxy's registry.
 *
 * The proxy's registry is in memory and dies with the process; this is what
 * makes a restart a non-event. Sync is idempotent — registering an existing
 * alias replaces it — so it is safe to run whenever a connection is (re)made.
 */

import { proxyBase } from "@/lib/proxy";
import { readConfig } from "@/lib/store";

export async function POST() {
  const base = await proxyBase();
  const cfg = await readConfig();

  const results: { alias: string; ok: boolean; error?: string }[] = [];
  let adminDisabled = false;

  for (const m of cfg.models) {
    try {
      const res = await fetch(`${base}/admin/upstreams`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alias: m.alias,
          base_url: m.baseUrl,
          label: m.label,
          default_model: m.defaultModel || null,
          api_key: m.apiKey ?? null,
        }),
        cache: "no-store",
      });
      if (res.status === 403) {
        adminDisabled = true;
        results.push({ alias: m.alias, ok: false, error: "admin_disabled" });
        continue;
      }
      const body = await res.json();
      results.push(
        res.ok
          ? { alias: m.alias, ok: true }
          : { alias: m.alias, ok: false, error: body?.error?.message ?? `HTTP ${res.status}` },
      );
    } catch (e) {
      results.push({ alias: m.alias, ok: false, error: (e as Error).message });
    }
  }

  return Response.json({
    results,
    synced: results.filter((r) => r.ok).length,
    total: results.length,
    adminDisabled,
    code: adminDisabled ? "admin_disabled" : undefined,
  });
}
