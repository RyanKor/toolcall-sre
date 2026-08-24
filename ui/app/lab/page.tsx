"use client";

import { useEffect, useState } from "react";
import {
  ActionChip,
  Banner,
  Chip,
  Code,
  Tile,
  errorText,
  json,
  type Tone,
} from "@/components/ui";
import { useT } from "@/components/I18nProvider";
import {
  BLIND_TASK,
  DEFAULT_TASK,
  GROUP_ORDER,
  SCENARIOS,
  emitsOf,
  type Scenario,
} from "@/lib/scenarios";

interface ToolCallRecord {
  function: string;
  parse_ok: boolean;
  recovered: boolean;
  schema_valid: boolean;
  violation?: "syntactic" | "fabricating";
  missing?: string[];
  repaired: boolean;
  fabricated?: string[];
  action: string;
  error?: string;
}

interface RunResult {
  sessionId: string;
  upstream?: string;
  status: number;
  elapsedMs: number;
  sent: unknown;
  received: unknown;
  rawStream?: string;
  event: {
    tool_calls: ToolCallRecord[];
    finish_reason?: string;
    reached_final: boolean;
    stream: boolean;
    duration_ms: number;
    repair_ms: number;
  } | null;
  session: { malformed: number; repaired: number; fabricated: number } | null;
  code?: string;
  error?: string;
  detail?: string;
}

function violationCopy(t: ReturnType<typeof useT>) {
  return {
    syntactic: { label: t.violation.syntacticLabel, tone: "warn" as Tone, why: t.violation.syntacticWhy },
    fabricating: { label: t.violation.fabricatingLabel, tone: "invent" as Tone, why: t.violation.fabricatingWhy },
  } as const;
}

export default function Lab() {
  const t = useT();
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [picked, setPicked] = useState<Scenario | null>(null);
  const [task, setTask] = useState(DEFAULT_TASK);
  const [upstreams, setUpstreams] = useState<
    { alias: string; label: string; is_default: boolean; base_url?: string; default_model?: string | null }[]
  >([]);
  const [upstream, setUpstream] = useState<string>("");

  // The scenarios below only mean anything against a backend that replays them,
  // so default to the scenario mock rather than whatever `--upstream` points at.
  useEffect(() => {
    fetch("/api/proxy/upstreams", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const list = j?.upstreams ?? [];
        setUpstreams(list);
        setUpstream((cur) => {
          if (cur) return cur;
          const scenarioBackend = list.find((u: { alias: string }) => u.alias === "sim-scenario");
          return scenarioBackend ? scenarioBackend.alias : "";
        });
      })
      .catch(() => {});
  }, []);

  // Which backend this run goes to. With no selection that is the default one
  // named by --upstream.
  const activeUpstream =
    upstreams.find((u) => u.alias === upstream) ?? upstreams.find((u) => u.is_default);
  // The mock reads the scenario name out of `model` to pick which failure to
  // replay. Sending that same name to a real backend asks for a model it has
  // never heard of and comes back 404 — so the two cases split here.
  const isMock = (activeUpstream?.base_url ?? "").includes("/api/mock/");
  const backendModel = activeUpstream?.default_model ?? null;
  const modelFor = (s: Scenario) => (isMock || !backendModel ? s.id : backendModel);

  const run = async (s: Scenario) => {
    const key = s.key;
    setRunning(key);
    setPicked(s);
    const useTask = s.task ?? task;
    setTask(useTask);
    try {
      const r = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenario: s.id,
          model: modelFor(s),
          task: useTask,
          stream: s.stream ?? false,
          upstream: upstream || undefined,
        }),
      });
      setResult(await r.json());
    } catch (e) {
      setResult({ error: t.lab.requestFailed, detail: (e as Error).message } as RunResult);
    } finally {
      setRunning(null);
    }
  };

  const groups = GROUP_ORDER.filter((g) => SCENARIOS.some((s) => s.group === g));

  return (
    <>
      <div className="pagehead">
        <span className="eyebrow">{t.lab.eyebrow}</span>
        <h1>{t.lab.title}</h1>
        <p>
          {t.lab.lead1}
          <strong>{t.lab.leadEmph}</strong>
          {t.lab.lead2}
        </p>
      </div>

      <section className="section">
        <div className="panel">
          <div className="body">
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field" style={{ flex: "1 1 16rem", maxWidth: "24rem" }}>
                <label>{t.lab.backendLabel}</label>
                <select
                  className="input"
                  value={upstream}
                  onChange={(e) => setUpstream(e.target.value)}
                  disabled={running !== null}
                >
                  <option value="">{t.lab.backendDefault}</option>
                  {upstreams
                    .filter((u) => !u.is_default)
                    .map((u) => (
                      <option key={u.alias} value={u.alias}>
                        {u.label} ({u.alias})
                      </option>
                    ))}
                </select>
              </div>
              <p style={{ flex: "2 1 20rem", fontSize: ".83rem", color: "var(--ink-soft)" }}>
                {t.lab.backendNote1}
                <strong>{t.lab.backendNoteEmph}</strong>
                {t.lab.backendNote2}
                <span className="mono">model</span>
                {t.lab.backendNote3}
                <a href="/models">{t.nav.models}</a>
                {t.lab.backendNote4}
              </p>
            </div>

          </div>
        </div>
      </section>

      {groups.map((g) => (
        <section className="section" key={g}>
          <header>
            <h2>{t.group[g]}</h2>
          </header>
          <div className="split">
            {SCENARIOS.filter((s) => s.group === g).map((s) => {
              const key = s.key;
              const active = picked?.key === key;
              return (
                <div
                  className="panel"
                  key={key}
                  style={active ? { borderColor: "var(--accent)" } : undefined}
                >
                  <div className="head">
                    <span className="t">{t.scenario[s.titleKey]}</span>
                    <Chip tone={toneFor(s.expect)}>{t.expect[s.expect]}</Chip>
                  </div>
                  <div className="body" style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
                    <Code>{emitsOf(s, t)}</Code>
                    <p style={{ fontSize: ".84rem", color: "var(--ink-soft)" }}>{t.scenario[s.noteKey]}</p>
                    <div className="row">
                      <button
                        className="btn"
                        data-variant={active ? "primary" : undefined}
                        disabled={running !== null}
                        onClick={() => run(s)}
                      >
                        {running === key ? t.common.running : t.common.run}
                      </button>
                      {s.stream && <Chip tone="info">{t.lab.streaming}</Chip>}
                      {s.task === BLIND_TASK && <Chip>{t.lab.blindContext}</Chip>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {result && (
        <section className="section" id="result">
          <header>
            <h2>{t.lab.resultTitle(picked ? t.scenario[picked.titleKey] : "")}</h2>
            <span className="hint mono">
              {result.upstream && result.upstream !== "default" ? `${result.upstream} · ` : ""}
              {result.sessionId}
            </span>
          </header>
          {result.code || result.error ? (
            <Banner
              error={errorText(t, result.code, result.error)}
              hint={result.detail ?? t.common.proxyCheckHint}
            />
          ) : (
            <Result result={result} scenario={picked} t={t} />
          )}
        </section>
      )}
    </>
  );
}

function Result({
  result,
  scenario,
  t,
}: {
  result: RunResult;
  scenario: Scenario | null;
  t: ReturnType<typeof useT>;
}) {
  const VIOLATION_COPY = violationCopy(t);
  const calls = result.event?.tool_calls ?? [];
  const received = result.received as Record<string, unknown>;

  // What the client ends up with, streaming or not.
  const clientArgs = result.event?.stream
    ? (received?.calls as { name: string; arguments: string }[] | undefined)?.map((c) => c.arguments)
    : (
        (received?.choices as Record<string, unknown>[] | undefined)?.[0]
          ?.message as Record<string, unknown> | undefined
      )?.tool_calls
    ? (
        (
          (received.choices as Record<string, unknown>[])[0].message as Record<string, unknown>
        ).tool_calls as Record<string, unknown>[]
      ).map((tc) => {
        const a = (tc.function as Record<string, unknown>).arguments;
        return typeof a === "string" ? a : json(a);
      })
    : undefined;

  return (
    <>
      <div className="tiles">
        <Tile
          k={t.lab.elapsed}
          v={t.common.ms(result.elapsedMs)}
          d={t.lab.elapsedNote(result.event?.repair_ms ?? 0)}
        />
        <Tile k={t.lab.response} v={result.status} tone={result.status === 200 ? "ok" : "bad"} />
        <Tile
          k={t.lab.finishReason}
          v={result.event?.finish_reason ?? t.common.none}
          d={result.event?.reached_final ? t.lab.countedFinal : t.lab.notFinal}
          tone={result.event?.reached_final ? "ok" : "neutral"}
        />
        <Tile
          k={t.lab.toolCallCount}
          v={calls.length}
          d={result.event?.stream ? t.lab.streamMode : t.lab.nonStreamMode}
        />
      </div>

      {calls.map((c, i) => (
        <div className="panel" key={i}>
          <div className="head">
            <span className="t mono">{c.function}</span>
            <div className="row" style={{ gap: ".35rem" }}>
              {c.violation && (
                <Chip tone={VIOLATION_COPY[c.violation].tone}>{VIOLATION_COPY[c.violation].label}</Chip>
              )}
              <ActionChip action={c.action} />
            </div>
          </div>
          <div className="body" style={{ display: "flex", flexDirection: "column", gap: ".8rem" }}>
            {c.violation && (
              <p style={{ fontSize: ".86rem", color: "var(--ink-soft)" }}>
                {VIOLATION_COPY[c.violation].why}
              </p>
            )}

            <div className="split">
              <div className="field">
                <label>{t.lab.modelSent}</label>
                <Code tone={c.parse_ok && c.schema_valid ? "ok" : "bad"}>
                  {scenario ? emitsOf(scenario, t) : ""}
                </Code>
              </div>
              <div className="field">
                <label>{t.lab.clientGot}</label>
                <Code tone={c.fabricated?.length ? "invent" : c.repaired || c.recovered ? undefined : "ok"}>
                  {clientArgs?.[i] ?? t.common.none}
                </Code>
              </div>
            </div>

            {c.missing && c.missing.length > 0 && (
              <div className="row">
                <span style={{ fontSize: ".84rem", color: "var(--ink-soft)" }}>{t.lab.missingRequired}</span>
                {c.missing.map((f) => (
                  <Chip key={f} tone="invent">
                    {f}
                  </Chip>
                ))}
              </div>
            )}

            {c.fabricated && c.fabricated.length > 0 && (
              <div
                className="panel"
                style={{ borderColor: "color-mix(in srgb, var(--invent) 45%, transparent)" }}
              >
                <div className="head" style={{ background: "var(--invent-bg)" }}>
                  <span className="t" style={{ color: "var(--invent)" }}>
                    {t.lab.fabricatedHeadline}
                  </span>
                </div>
                <div className="body">
                  <div className="row" style={{ marginBottom: ".5rem" }}>
                    {c.fabricated.map((f) => (
                      <Chip key={f} tone="invent">
                        {f}
                      </Chip>
                    ))}
                  </div>
                  <p style={{ fontSize: ".85rem", color: "var(--ink-soft)" }}>
                    {t.lab.fabricatedBody1}
                    <strong>{t.lab.fabricatedBodyEmph}</strong>
                    {t.lab.fabricatedBody2}
                  </p>
                </div>
              </div>
            )}

            {c.error && (
              <div className="field">
                <label>{t.lab.validationError}</label>
                <Code tone="bad">{c.error}</Code>
              </div>
            )}
          </div>
        </div>
      ))}

      {calls.length === 0 && (
        <div className="panel">
          <div className="head">
            <span className="t">{t.lab.noToolCall}</span>
            <Chip tone={result.event?.reached_final ? "ok" : "warn"}>
              {result.event?.reached_final ? t.lab.countedFinal : t.lab.notCountedFinal}
            </Chip>
          </div>
          <div className="body" style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
            <p style={{ fontSize: ".86rem", color: "var(--ink-soft)" }}>
              {result.event?.finish_reason === "length" ? t.lab.truncatedNote : t.lab.finalNote}
            </p>
            <Code>{json(result.received)}</Code>
          </div>
        </div>
      )}

      {result.rawStream && (
        <details className="panel">
          <summary className="head" style={{ cursor: "pointer" }}>
            <span className="t">{t.lab.rawSse}</span>
          </summary>
          <div className="body">
            <Code>{result.rawStream}</Code>
          </div>
        </details>
      )}
    </>
  );
}

function toneFor(e: string): Tone {
  if (e === "fabricated") return "invent";
  if (e === "failed") return "bad";
  if (e === "repaired" || e === "refused") return "warn";
  if (e === "recovered") return "info";
  return "ok";
}
