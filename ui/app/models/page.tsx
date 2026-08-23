"use client";

import { useCallback, useEffect, useState } from "react";
import { Banner, Chip, Code, Split, Tile, errorText, pct, type Tone } from "@/components/ui";
import { useT } from "@/components/I18nProvider";
import { BLIND_TASK, DEFAULT_TASK } from "@/lib/scenarios";

interface ModelConn {
  id: string;
  alias: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  apiKey?: string;
  notes?: string;
}
interface Config {
  proxies: unknown[];
  activeProxyId: string;
  models: ModelConn[];
  configPath?: string;
}

interface ModelRow {
  model: string;
  upstream: string;
  requests: number;
  tool_calls: number;
  well_formed: number;
  recovered_calls: number;
  malformed: number;
  malformed_fabricating: number;
  repaired: number;
  fabricated: number;
  sessions: number;
  tool_using_sessions: number;
  end_to_end_clean_sessions: number;
  well_formed_rate: number | null;
  fabrication_rate: number | null;
  end_to_end_clean_rate: number | null;
  mean_ms: number | null;
  mean_repair_ms: number | null;
}

interface ProbeResult {
  ok: boolean;
  elapsed_ms?: number;
  models?: string[];
  model_found?: boolean;
  /** Reported by code so the wording can be localised here. */
  code?: string;
  error?: string;
  detail?: string;
}

const BLANK: ModelConn = {
  id: "",
  alias: "",
  label: "",
  baseUrl: "http://127.0.0.1:8000/v1",
  defaultModel: "",
  apiKey: "",
  notes: "",
};

export default function Models() {
  const t = useT();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [adminEnabled, setAdminEnabled] = useState<boolean | null>(null);
  const [probe, setProbe] = useState<Record<string, ProbeResult | "running">>({});
  const [editing, setEditing] = useState<ModelConn | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Burst runner state
  const [selected, setSelected] = useState<string[]>([]);
  const [runs, setRuns] = useState(12);
  const [blind, setBlind] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const loadConfig = useCallback(async () => {
    const c: Config = await fetch("/api/config", { cache: "no-store" }).then((r) => r.json());
    setCfg(c);
    setSelected((s) => (s.length ? s : c.models.slice(0, 3).map((m) => m.alias)));
  }, []);

  const loadRollup = useCallback(async () => {
    const [m, u] = await Promise.all([
      fetch("/api/proxy/models", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      fetch("/api/proxy/upstreams", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
    ]);
    setRows(m?.models ?? []);
    setAdminEnabled(typeof u?.admin_enabled === "boolean" ? u.admin_enabled : null);
  }, []);

  useEffect(() => {
    loadConfig();
    loadRollup();
    const t = setInterval(loadRollup, 3000);
    return () => clearInterval(t);
  }, [loadConfig, loadRollup]);

  const save = async (models: ModelConn[]) => {
    if (!cfg) return;
    setBusy(true);
    try {
      const saved = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...cfg, models }),
      }).then((r) => r.json());
      setCfg(saved);
      // Registering is idempotent, so pushing after every edit keeps the proxy
      // in step without the user having to think about a separate sync step.
      const sync = await fetch("/api/models/sync", { method: "POST" }).then((r) => r.json());
      setMsg(
        sync.adminDisabled
          ? t.models.savedButBlocked(t.errors.admin_disabled_hint)
          : t.models.savedAndSynced(sync.synced, sync.total),
      );
      await loadRollup();
    } finally {
      setBusy(false);
    }
  };

  const commit = () => {
    if (!cfg || !editing) return;
    const alias = editing.alias.trim();
    if (!alias || !/^[A-Za-z0-9._-]{1,64}$/.test(alias)) {
      setMsg(t.models.badAlias);
      return;
    }
    const next = editing.id
      ? cfg.models.map((m) => (m.id === editing.id ? { ...editing, alias } : m))
      : [...cfg.models, { ...editing, alias, id: `m-${Date.now().toString(36)}` }];
    setEditing(null);
    save(next);
  };

  const runProbe = async (m: ModelConn) => {
    setProbe((p) => ({ ...p, [m.id]: "running" }));
    const r = await fetch("/api/models/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: m.baseUrl, modelId: m.defaultModel }),
    }).then((x) => x.json());
    setProbe((p) => ({ ...p, [m.id]: r }));
  };

  /** Fire a burst at each selected backend so the table has something to compare. */
  const runBurst = async () => {
    if (!cfg || selected.length === 0) return;
    setBusy(true);
    const jobs = selected.flatMap((alias) => {
      const m = cfg.models.find((x) => x.alias === alias);
      return Array.from({ length: runs }, () => ({
        alias,
        model: m?.defaultModel || alias,
      }));
    });
    setProgress({ done: 0, total: jobs.length });

    let done = 0;
    const CONCURRENCY = 4;
    const queue = [...jobs];
    const worker = async () => {
      for (;;) {
        const job = queue.shift();
        if (!job) return;
        await fetch("/api/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scenario: job.model,
            upstream: job.alias,
            task: blind ? BLIND_TASK : DEFAULT_TASK,
            sessionPrefix: `bench-${job.alias}`,
          }),
        }).catch(() => null);
        done += 1;
        setProgress({ done, total: jobs.length });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setProgress(null);
    setBusy(false);
    await loadRollup();
  };

  const known = new Set(cfg?.models.map((m) => m.alias) ?? []);
  const measured = rows.filter((r) => r.tool_calls > 0);
  const best = measured.reduce<ModelRow | null>(
    (a, b) => (a === null || (b.well_formed_rate ?? 0) > (a.well_formed_rate ?? 0) ? b : a),
    null,
  );

  return (
    <>
      <div className="pagehead">
        <span className="eyebrow">{t.models.eyebrow}</span>
        <h1>{t.models.title}</h1>
        <p>
          {t.models.lead1}
          <strong>{t.models.leadAlias}</strong>
          {t.models.lead2}
          <span className="mono">X-TCS-Upstream</span>
          {t.models.lead3}
          <strong>{t.models.leadEmph}</strong>
          {t.models.lead4}
        </p>
      </div>

      {adminEnabled === false && (
        <div className="section">
          <Banner
            error={t.models.adminBlocked}
            hint={t.models.adminBlockedHint}
          />
        </div>
      )}
      {msg && (
        <div className="section">
          <div className="panel">
            <div className="body" style={{ fontSize: ".88rem" }}>{msg}</div>
          </div>
        </div>
      )}

      {/* ---------------- registry ---------------- */}
      <section className="section">
        <header>
          <h2>{t.models.registry}</h2>
          <button
            className="btn"
            data-variant="primary"
            onClick={() => setEditing({ ...BLANK })}
            disabled={busy}
          >
            {t.models.addBackend}
          </button>
        </header>

        <div className="panel">
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>{t.models.colAlias}</th>
                  <th>{t.models.colLabel}</th>
                  <th>{t.models.colUrl}</th>
                  <th>{t.models.colModelId}</th>
                  <th>{t.models.colProbe}</th>
                  <th style={{ width: "1%" }} />
                </tr>
              </thead>
              <tbody>
                {cfg?.models.map((m) => {
                  const p = probe[m.id];
                  return (
                    <tr key={m.id}>
                      <td className="mono">{m.alias}</td>
                      <td>
                        {m.label}
                        {m.notes && (
                          <div style={{ fontSize: ".78rem", color: "var(--ink-faint)" }}>{m.notes}</div>
                        )}
                      </td>
                      <td className="mono" style={{ wordBreak: "break-all", maxWidth: "18rem" }}>
                        {m.baseUrl}
                        {m.apiKey && <Chip>{t.models.keyStored}</Chip>}
                      </td>
                      <td className="mono">{m.defaultModel || t.common.none}</td>
                      <td>
                        {p === "running" ? (
                          <Chip>{t.common.checking}</Chip>
                        ) : p ? (
                          p.ok ? (
                            <div className="row" style={{ gap: ".3rem" }}>
                              <Chip tone="ok">{t.models.probeReached(p.elapsed_ms ?? 0)}</Chip>
                              {p.models?.length ? (
                                <Chip tone={p.model_found === false ? "warn" : "info"}>
                                  {t.models.probeModels(p.models.length, p.model_found === false)}
                                </Chip>
                              ) : null}
                            </div>
                          ) : (
                            <Chip tone="bad">{t.models.probeFailed}</Chip>
                          )
                        ) : (
                          <Chip>{t.models.probeUnknown}</Chip>
                        )}
                        {p && p !== "running" && !p.ok && (
                          <div style={{ fontSize: ".75rem", color: "var(--bad)", marginTop: ".25rem" }}>
                            {errorText(t, p.code, p.error ?? p.detail)}
                            {p.code === "admin_disabled" ? ` — ${t.errors.admin_disabled_hint}` : ""}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: ".3rem", justifyContent: "flex-end" }}>
                          <button className="btn" onClick={() => runProbe(m)} disabled={busy}>
                            {t.common.check}
                          </button>
                          <button className="btn" onClick={() => setEditing({ ...m, apiKey: "" })} disabled={busy}>
                            {t.common.edit}
                          </button>
                          <button
                            className="btn"
                            onClick={() => cfg && save(cfg.models.filter((x) => x.id !== m.id))}
                            disabled={busy}
                          >
                            {t.common.remove}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {editing && (
          <div className="panel" style={{ borderColor: "var(--accent)" }}>
            <div className="head">
              <span className="t">{editing.id ? t.models.editTitle : t.models.addTitle}</span>
              <button className="btn" onClick={() => setEditing(null)}>
                {t.common.cancel}
              </button>
            </div>
            <div className="body" style={{ display: "flex", flexDirection: "column", gap: ".8rem" }}>
              <div className="split">
                <div className="field">
                  <label>{t.models.aliasField}</label>
                  <input
                    className="input"
                    placeholder="vllm-qwen"
                    value={editing.alias}
                    onChange={(e) => setEditing({ ...editing, alias: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>{t.models.labelField}</label>
                  <input
                    className="input"
                    placeholder="vLLM · Qwen3.6 35B AWQ"
                    value={editing.label}
                    onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  />
                </div>
              </div>
              <div className="split">
                <div className="field">
                  <label>{t.models.urlField}</label>
                  <input
                    className="input"
                    value={editing.baseUrl}
                    onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>{t.models.modelIdField}</label>
                  <input
                    className="input"
                    placeholder="qwen3.6-35b"
                    value={editing.defaultModel}
                    onChange={(e) => setEditing({ ...editing, defaultModel: e.target.value })}
                  />
                </div>
              </div>
              <div className="split">
                <div className="field">
                  <label>{t.models.apiKeyField}</label>
                  <input
                    className="input"
                    type="password"
                    placeholder={editing.id ? t.models.apiKeyPlaceholderEdit : "sk-…"}
                    value={editing.apiKey ?? ""}
                    onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>{t.models.notesField}</label>
                  <input
                    className="input"
                    value={editing.notes ?? ""}
                    onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  />
                </div>
              </div>
              <div className="row">
                <button className="btn" data-variant="primary" onClick={commit} disabled={busy}>
                  {t.models.saveAndRegister}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ---------------- burst ---------------- */}
      <section className="section">
        <header>
          <h2>{t.models.burst}</h2>
          <span className="hint">{t.models.burstHint}</span>
        </header>
        <div className="panel">
          <div className="body" style={{ display: "flex", flexDirection: "column", gap: ".8rem" }}>
            <div className="row">
              {cfg?.models.map((m) => (
                <button
                  key={m.id}
                  className="btn"
                  data-variant={selected.includes(m.alias) ? "primary" : undefined}
                  onClick={() =>
                    setSelected((s) =>
                      s.includes(m.alias) ? s.filter((a) => a !== m.alias) : [...s, m.alias],
                    )
                  }
                  disabled={busy}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ maxWidth: "9rem" }}>
                <label>{t.models.runsPerBackend}</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={100}
                  value={runs}
                  onChange={(e) => setRuns(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                />
              </div>
              <button
                className="btn"
                data-variant={blind ? "primary" : undefined}
                onClick={() => setBlind((b) => !b)}
                disabled={busy}
                title={t.models.blindTitle}
              >
                {blind ? t.models.blindOn : t.models.blindOff}
              </button>
              <button
                className="btn"
                data-variant="primary"
                onClick={runBurst}
                disabled={busy || selected.length === 0}
              >
                {progress ? t.models.burstProgress(progress.done, progress.total) : t.common.run}
              </button>
            </div>
            <p style={{ fontSize: ".85rem", color: "var(--ink-soft)" }}>
              <strong>{t.models.burstNote1}</strong>
              {t.models.burstNote2}
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- comparison ---------------- */}
      <section className="section">
        <header>
          <h2>{t.models.comparison}</h2>
          <span className="hint">{t.models.comparisonHint}</span>
        </header>

        {measured.length === 0 ? (
          <div className="panel">
            <div className="empty">
              {t.models.emptyA}
              <strong>{t.models.emptyB}</strong>
              {t.models.emptyC}
            </div>
          </div>
        ) : (
          <>
            {best && measured.length > 1 && (
              <div className="tiles">
                <Tile
                  k={t.models.bestModel}
                  v={best.model}
                  tone="ok"
                  d={`${pct(best.well_formed_rate) ?? t.common.none} · ${best.upstream}`}
                />
                <Tile
                  k={t.models.compared}
                  v={measured.length}
                  d={t.models.comparedNote}
                />
                <Tile
                  k={t.models.totalCalls}
                  v={measured.reduce((a, b) => a + b.tool_calls, 0)}
                />
                <Tile
                  k={t.models.totalFabricated}
                  v={measured.reduce((a, b) => a + b.fabricated, 0) || null}
                  tone="invent"
                  d={t.models.totalFabricatedNote}
                />
              </div>
            )}

            <div className="panel">
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t.models.thModel}</th>
                      <th>{t.models.thBackend}</th>
                      <th>{t.models.thCalls}</th>
                      <th>{t.models.thWellFormed}</th>
                      <th>{t.models.thComposition}</th>
                      <th>{t.models.thFabRate}</th>
                      <th>{t.models.thClean}</th>
                      <th>{t.models.thLatency}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {measured.map((r) => (
                      <tr key={`${r.model}@${r.upstream}`}>
                        <td className="mono">{r.model}</td>
                        <td>
                          <Chip tone={known.has(r.upstream) ? "info" : "neutral"}>{r.upstream}</Chip>
                        </td>
                        <td className="num">{r.tool_calls}</td>
                        <td className="num" style={{ color: rateTone(r.well_formed_rate) }}>
                          {pct(r.well_formed_rate) ?? t.common.none}
                        </td>
                        <td style={{ minWidth: "13rem" }}>
                          <Split
                            parts={[
                              { value: r.well_formed - r.recovered_calls, tone: "ok", label: t.models.partClean },
                              { value: r.recovered_calls, tone: "info", label: t.models.partRecovered },
                              { value: r.repaired - r.fabricated, tone: "warn", label: t.models.partRepaired },
                              { value: r.fabricated, tone: "invent", label: t.models.partFabricated },
                              {
                                value: Math.max(0, r.malformed - r.repaired),
                                tone: "bad",
                                label: t.models.partUnrepaired,
                              },
                            ]}
                          />
                        </td>
                        <td className="num">
                          {r.fabrication_rate === null ? (
                            t.common.none
                          ) : r.fabricated > 0 ? (
                            <Chip tone="invent">{pct(r.fabrication_rate)}</Chip>
                          ) : (
                            pct(r.fabrication_rate)
                          )}
                        </td>
                        <td className="num">
                          {pct(r.end_to_end_clean_rate) ?? t.common.none}
                          <div style={{ fontSize: ".72rem", color: "var(--ink-faint)" }}>
                            {t.models.sessionsOf(r.end_to_end_clean_sessions, r.tool_using_sessions)}
                          </div>
                        </td>
                        <td className="num">
                          {r.mean_ms === null ? t.common.none : t.common.ms(Math.round(r.mean_ms))}
                          {r.mean_repair_ms ? (
                            <div style={{ fontSize: ".72rem", color: "var(--warn)" }}>
                              {t.models.repairAdds(Math.round(r.mean_repair_ms))}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p style={{ fontSize: ".86rem", color: "var(--ink-soft)" }}>
              <strong>{t.models.footnote1}</strong>
              {t.models.footnote2}
              <strong>{t.models.footnote3}</strong>
              {t.models.footnote4}
            </p>
          </>
        )}
      </section>

      <section className="section">
        <header>
          <h2>{t.models.curlTitle}</h2>
        </header>
        <Code>{`${t.models.curlComment1}
curl localhost:8091/v1/chat/completions \\
  -H 'content-type: application/json' \\
  -H 'x-tcs-upstream: ${cfg?.models[0]?.alias ?? "vllm-qwen"}' \\
  -d '{"model":"${cfg?.models[0]?.defaultModel ?? "qwen3.6-35b"}","messages":[…],"tools":[…]}'

${t.models.curlComment2}`}</Code>
      </section>
    </>
  );
}

function rateTone(v: number | null): string {
  if (v === null) return "inherit";
  if (v >= 0.9) return "var(--ok)";
  if (v >= 0.7) return "var(--warn)";
  return "var(--bad)";
}
