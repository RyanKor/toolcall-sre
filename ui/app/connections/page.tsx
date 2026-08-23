"use client";

import { useCallback, useEffect, useState } from "react";
import { Banner, Chip, Code, Tile, errorText } from "@/components/ui";
import { useT } from "@/components/I18nProvider";

interface ProxyConn {
  id: string;
  label: string;
  url: string;
}
interface Config {
  proxies: ProxyConn[];
  activeProxyId: string;
  models: unknown[];
  configPath?: string;
}

interface Health {
  status?: string;
  upstream?: string;
  repair_policy?: string;
  measure_streaming?: boolean;
  repair_streaming?: boolean;
  normalize?: boolean;
  error?: string;
  hint?: string;
}

interface UpstreamList {
  upstreams: { alias: string; label: string; base_url: string; source: string; is_default: boolean }[];
  admin_enabled: boolean;
  header: string;
  error?: string;
}

const POLICY_TONE: Record<string, "ok" | "warn" | "invent"> = {
  Off: "ok",
  SyntacticOnly: "ok",
  Contextual: "warn",
  Full: "invent",
};

function policyCopy(t: ReturnType<typeof useT>, policy: string | undefined) {
  if (!policy) return undefined;
  const label = (t.policy as Record<string, string>)[`${policy}Label`];
  const note = (t.policy as Record<string, string>)[`${policy}Note`];
  if (!label) return undefined;
  return { label, note, tone: POLICY_TONE[policy] ?? ("neutral" as const) };
}

export default function Connections() {
  const t = useT();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [ups, setUps] = useState<UpstreamList | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState({ label: "", url: "http://127.0.0.1:8091" });
  const [draftProbe, setDraftProbe] = useState<{ ok: boolean; detail: string } | null>(null);

  const loadStatus = useCallback(async () => {
    const [h, u] = await Promise.all([
      fetch("/api/proxy/health", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ error: "unreachable" })),
      fetch("/api/proxy/upstreams", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ error: "unreachable" })),
    ]);
    setHealth(h);
    setUps(u);
  }, []);

  const loadConfig = useCallback(async () => {
    const c = await fetch("/api/config", { cache: "no-store" }).then((r) => r.json());
    setCfg(c);
  }, []);

  useEffect(() => {
    loadConfig().then(loadStatus);
  }, [loadConfig, loadStatus]);

  const save = async (next: Config) => {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      }).then((r) => r.json());
      setCfg(saved);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const activate = (id: string) => cfg && save({ ...cfg, activeProxyId: id });

  const norm = (u: string) => u.trim().replace(/\/+$/, "");

  /** Check a candidate before committing to it, from the console server's side. */
  const testDraft = async () => {
    const url = norm(draft.url);
    if (!url) return;
    setDraftProbe(null);
    setBusy(true);
    try {
      const r = await fetch("/api/proxy-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      }).then((x) => x.json());
      setDraftProbe(
        r.ok
          ? { ok: true, detail: t.connections.probeOk(r.health?.repair_policy ?? "?", r.elapsedMs) }
          : { ok: false, detail: errorText(t, r.code, r.detail) },
      );
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (!cfg) return;
    const url = norm(draft.url);
    if (!url) return;

    // The seed already ships a local proxy, so "add" on the same address would
    // silently make a duplicate row. Switch to the existing one instead.
    const existing = cfg.proxies.find((p) => norm(p.url) === url);
    if (existing) {
      setMsg(t.connections.duplicate(existing.label));
      activate(existing.id);
      return;
    }

    const id = `p-${Date.now().toString(36)}`;
    save({
      ...cfg,
      proxies: [...cfg.proxies, { id, label: draft.label.trim() || url, url }],
      activeProxyId: id,
    });
    setMsg(null);
    setDraftProbe(null);
    setDraft({ label: "", url: "http://127.0.0.1:8091" });
  };

  const remove = (id: string) => {
    if (!cfg || cfg.proxies.length <= 1) return;
    const proxies = cfg.proxies.filter((p) => p.id !== id);
    save({
      ...cfg,
      proxies,
      activeProxyId: cfg.activeProxyId === id ? proxies[0].id : cfg.activeProxyId,
    });
  };

  const sync = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/models/sync", { method: "POST" }).then((x) => x.json());
      setMsg(
        r.adminDisabled
          ? t.connections.syncFailed(errorText(t, r.code) + " — " + t.errors.admin_disabled_hint)
          : t.connections.synced(r.synced, r.total),
      );
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const ok = health?.status === "ok";
  const policy = policyCopy(t, health?.repair_policy);

  return (
    <>
      <div className="pagehead">
        <span className="eyebrow">{t.connections.eyebrow}</span>
        <h1>{t.connections.title}</h1>
        <p>
          {t.connections.lead1}
          <strong>{t.connections.leadEmph}</strong>
          {t.connections.lead2}
        </p>
      </div>

      {msg && (
        <div className="section">
          <div className="panel">
            <div className="body" style={{ fontSize: ".88rem" }}>{msg}</div>
          </div>
        </div>
      )}

      <section className="section">
        <header>
          <h2>{t.connections.status}</h2>
          <button className="btn" onClick={loadStatus} disabled={busy}>
            {t.common.refresh}
          </button>
        </header>

        {!ok ? (
          <Banner
            error={t.common.proxyUnreachable}
            hint={health?.hint ?? t.connections.connectHint}
          />
        ) : (
          <div className="tiles">
            <Tile
              k={t.connections.stateLabel}
              v={t.connections.connected}
              tone="ok"
              d={cfg?.proxies.find((p) => p.id === cfg.activeProxyId)?.url}
            />
            <Tile
              k={t.connections.policyLabel}
              v={policy?.label ?? health?.repair_policy}
              tone={policy?.tone ?? "neutral"}
              d={policy?.note}
            />
            <Tile
              k={t.connections.streamingLabel}
              v={
                health?.repair_streaming
                  ? t.connections.streamingBoth
                  : health?.measure_streaming
                  ? t.connections.streamingMeasure
                  : t.connections.streamingPass
              }
              tone={health?.measure_streaming ? "ok" : "warn"}
              d={health?.measure_streaming ? undefined : t.connections.streamingPassNote}
            />
            <Tile
              k={t.connections.adminLabel}
              v={ups?.admin_enabled ? t.connections.adminOn : t.connections.adminOff}
              tone={ups?.admin_enabled ? "ok" : "warn"}
              d={ups?.admin_enabled ? t.connections.adminOnNote : t.connections.adminOffNote}
            />
          </div>
        )}
      </section>

      <section className="section">
        <header>
          <h2>{t.connections.registered}</h2>
          <span className="hint">
            {cfg?.configPath ? <span className="mono">{cfg.configPath}</span> : ""}
          </span>
        </header>
        <div className="panel">
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>{t.connections.colName}</th>
                  <th>{t.connections.colUrl}</th>
                  <th>{t.connections.colState}</th>
                  <th style={{ width: "1%" }} />
                </tr>
              </thead>
              <tbody>
                {cfg?.proxies.map((p) => (
                  <tr key={p.id}>
                    <td>{p.label}</td>
                    <td className="mono" style={{ wordBreak: "break-all" }}>{p.url}</td>
                    <td>
                      {p.id === cfg.activeProxyId ? (
                        <Chip tone={ok ? "ok" : "bad"}>
                          {ok ? t.connections.inUseConnected : t.connections.inUseDisconnected}
                        </Chip>
                      ) : (
                        <Chip>{t.common.waiting}</Chip>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: ".3rem", justifyContent: "flex-end" }}>
                        {p.id !== cfg.activeProxyId && (
                          <button className="btn" onClick={() => activate(p.id)} disabled={busy}>
                            {t.common.use}
                          </button>
                        )}
                        {cfg.proxies.length > 1 && (
                          <button className="btn" onClick={() => remove(p.id)} disabled={busy}>
                            {t.common.remove}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="body" style={{ borderTop: "1px solid var(--rule)" }}>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ flex: "1 1 12rem" }}>
                <label>{t.connections.labelOptional}</label>
                <input
                  className="input"
                  placeholder={t.connections.namePlaceholder}
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                />
              </div>
              <div className="field" style={{ flex: "2 1 20rem" }}>
                <label>{t.connections.urlLabel}</label>
                <input
                  className="input"
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </div>
              <button className="btn" onClick={testDraft} disabled={busy}>
                {t.connections.testConnection}
              </button>
              <button className="btn" data-variant="primary" onClick={add} disabled={busy}>
                {t.common.add}
              </button>
            </div>
            {draftProbe && (
              <div style={{ marginTop: ".6rem" }}>
                <Chip tone={draftProbe.ok ? "ok" : "bad"}>{draftProbe.detail}</Chip>
              </div>
            )}
            <p style={{ marginTop: ".7rem", fontSize: ".82rem", color: "var(--ink-soft)" }}>
              {t.connections.serverSideNote1}
              <strong>{t.connections.serverSideNoteEmph}</strong>
              {t.connections.serverSideNote2}
              <span className="mono">http://127.0.0.1:8091</span>
              {t.connections.serverSideNote3}
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <header>
          <h2>{t.connections.registryTitle}</h2>
          <button className="btn" data-variant="primary" onClick={sync} disabled={busy || !ok}>
            {t.connections.pushModels}
          </button>
        </header>
        <p className="hint" style={{ fontSize: ".86rem", color: "var(--ink-soft)" }}>
          {t.connections.registryNote1}
          <strong>{t.connections.registryNoteEmph}</strong>
          {t.connections.registryNote2}
        </p>
        <div className="panel">
          <div className="scroll">
            {!ups?.upstreams?.length ? (
              <div className="empty">{t.connections.registryUnreadable}</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t.models.colAlias}</th>
                    <th>{t.connections.colName}</th>
                    <th>{t.connections.colUrl}</th>
                    <th>{t.connections.colSource}</th>
                  </tr>
                </thead>
                <tbody>
                  {ups.upstreams.map((u) => (
                    <tr key={u.alias}>
                      <td className="mono">
                        {u.alias} {u.is_default && <Chip tone="info">{t.connections.isDefault}</Chip>}
                      </td>
                      <td>{u.label}</td>
                      <td className="mono" style={{ wordBreak: "break-all" }}>{u.base_url}</td>
                      <td>
                        <Chip tone={u.source === "admin" ? "warn" : "neutral"}>
                          {u.source === "admin" ? t.connections.sourceAdmin : t.connections.sourceFlag}
                        </Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <header>
          <h2>{t.connections.runCommand}</h2>
          <span className="hint">{t.connections.runCommandHint}</span>
        </header>
        <Code>{t.connections.runCommandBody}</Code>
        <p style={{ fontSize: ".86rem", color: "var(--ink-soft)" }}>
          <strong>--allow-admin</strong>
          {t.connections.adminWarn1}
          <strong>{t.connections.adminWarnEmph}</strong>
          {t.connections.adminWarn2}
          <span className="mono">--upstream-alias</span>
          {t.connections.adminWarn3}
        </p>
      </section>
    </>
  );
}
