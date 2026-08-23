import os from "node:os";
import type { NextConfig } from "next";

/**
 * Hosts allowed to load dev-only assets.
 *
 * Next blocks cross-origin requests to `/_next/*` in development. The symptom is
 * confusing: the HTML renders fine (the server returns 200), but the JS chunks
 * and the HMR socket are refused — so the page looks right and every button is
 * dead, because React never hydrates.
 *
 * This console is meant to be opened from another machine (a GPU box, a Tailscale
 * address), so rather than making people find that out and hand-edit a config, we
 * allow this host's own addresses automatically. Set `TCS_DEV_ORIGINS` to add
 * more, e.g. a hostname or `*.example.ts.net`.
 */
function localAddresses(): string[] {
  const out = new Set<string>(["localhost", "127.0.0.1", "[::1]"]);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (!a.internal && a.address) out.add(a.address);
    }
  }
  return [...out];
}

const extra = (process.env.TCS_DEV_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: [...localAddresses(), ...extra],
};

export default nextConfig;
