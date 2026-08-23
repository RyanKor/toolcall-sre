"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";

interface Health {
  status?: string;
  upstream?: string;
  repair_policy?: string;
  repair_streaming?: boolean;
  normalize?: boolean;
  error?: string;
}

/** Live connection state — a dashboard that silently shows stale zeros is worse
 *  than one that says it cannot reach the thing it is measuring. */
export function ProxyBadge() {
  const t = useT();
  const [h, setH] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/proxy/health", { cache: "no-store" });
        const j = await r.json();
        if (alive) setH(j);
      } catch {
        if (alive) setH({ error: "unreachable" });
      }
    };
    poll();
    const timer = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const ok = h?.status === "ok";
  return (
    <div className="navgroup" style={{ marginTop: "auto" }}>
      <span className="label">{t.badge.proxy}</span>
      <div style={{ padding: "0 .55rem", display: "flex", flexDirection: "column", gap: ".35rem" }}>
        <span className="chip" data-tone={ok ? "ok" : "bad"}>
          {ok ? t.badge.connected : t.badge.disconnected}
        </span>
        {ok && (
          <>
            <span className="mono" style={{ fontSize: ".67rem", color: "var(--ink-faint)", wordBreak: "break-all" }}>
              → {h?.upstream}
            </span>
            <span className="mono" style={{ fontSize: ".67rem", color: "var(--ink-faint)" }}>
              {t.badge.policy(h?.repair_policy ?? "?")}
              {h?.repair_streaming ? ` · ${t.badge.streamRepair}` : ""}
              {h?.normalize ? ` · ${t.badge.normalize}` : ""}
            </span>
          </>
        )}
        {!ok && (
          <span style={{ fontSize: ".7rem", color: "var(--ink-faint)", lineHeight: 1.45 }}>
            <a href="/connections">{t.badge.goToConnections}</a>
            {t.badge.goToConnectionsTail}
          </span>
        )}
      </div>
    </div>
  );
}
