"use client";

import { useEffect, useState } from "react";
import { ActionChip, Banner, Chip, Code, json } from "@/components/ui";
import { useT } from "@/components/I18nProvider";

interface ToolCallRecord {
  function: string;
  parse_ok: boolean;
  recovered: boolean;
  schema_valid: boolean;
  violation?: string;
  missing?: string[];
  repaired: boolean;
  fabricated?: string[];
  action: string;
  error?: string;
}

interface Event {
  ts_ms: number;
  session: string;
  turn: number;
  declared_turn: number;
  model: string;
  dialect: string;
  stream: boolean;
  tool_results_in: { count: number; errors: number; errors_heuristic: number };
  tool_calls: ToolCallRecord[];
  finish_reason?: string;
  reached_final: boolean;
  duration_ms: number;
  repair_ms: number;
}

export default function Trace() {
  const t = useT();
  const [events, setEvents] = useState<Event[]>([]);
  const [meta, setMeta] = useState<{ kept: number; capacity: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [only, setOnly] = useState<"all" | "problem" | "invent">("all");

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/proxy/events?limit=200", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (j.code || j.error) {
          setErr(j.detail ?? j.error ?? "");
        } else {
          setErr(null);
          setEvents(j.events ?? []);
          setMeta({ kept: j.kept, capacity: j.capacity });
        }
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const shown = events.filter((e) => {
    if (filter && !e.session.includes(filter)) return false;
    if (only === "problem") return e.tool_calls.some((c) => !c.schema_valid || c.recovered);
    if (only === "invent") return e.tool_calls.some((c) => (c.fabricated?.length ?? 0) > 0);
    return true;
  });

  return (
    <>
      <div className="pagehead">
        <span className="eyebrow">{t.trace.eyebrow}</span>
        <h1>{t.trace.title}</h1>
        <p>
          {t.trace.lead1}
          <span className="mono">--trace-file</span>
          {t.trace.lead2}
        </p>
      </div>

      {err && <Banner error={t.trace.loadFailed} hint={err} />}

      <section className="section">
        <header>
          <div className="row">
            <input
              className="input"
              style={{ maxWidth: "18rem" }}
              placeholder={t.trace.filterPlaceholder}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button className="btn" data-variant={only === "all" ? "primary" : undefined} onClick={() => setOnly("all")}>
              {t.trace.filterAll}
            </button>
            <button
              className="btn"
              data-variant={only === "problem" ? "primary" : undefined}
              onClick={() => setOnly("problem")}
            >
              {t.trace.filterProblem}
            </button>
            <button
              className="btn"
              data-variant={only === "invent" ? "primary" : undefined}
              onClick={() => setOnly("invent")}
            >
              {t.trace.filterInvent}
            </button>
          </div>
          <span className="hint mono">
            {meta ? t.trace.kept(meta.kept, meta.capacity, shown.length) : ""}
          </span>
        </header>

        {shown.length === 0 ? (
          <div className="panel">
            <div className="empty">
              {t.trace.emptyA}
              <strong>{t.trace.emptyB}</strong>
              {t.trace.emptyC}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: ".7rem" }}>
            {shown.map((e, i) => (
              <details className="panel" key={`${e.session}-${e.ts_ms}-${i}`}>
                <summary
                  className="head"
                  style={{ cursor: "pointer", listStyle: "none", flexWrap: "wrap" }}
                >
                  <div className="row" style={{ gap: ".4rem", minWidth: 0 }}>
                    <span className="mono" style={{ fontSize: ".76rem", color: "var(--ink-faint)" }}>
                      {new Date(e.ts_ms).toLocaleTimeString()}
                    </span>
                    <span className="t mono" style={{ fontSize: ".8rem", wordBreak: "break-all" }}>
                      {e.session}
                    </span>
                    <Chip>{t.trace.turn(e.turn + 1)}</Chip>
                    {e.stream && <Chip tone="info">{t.trace.stream}</Chip>}
                  </div>
                  <div className="row" style={{ gap: ".3rem" }}>
                    {e.tool_calls.length === 0 && (
                      <Chip tone={e.reached_final ? "ok" : "warn"}>
                        {e.reached_final ? t.trace.done : t.trace.finishedWith(e.finish_reason ?? "?")}
                      </Chip>
                    )}
                    {e.tool_calls.map((c, j) => (
                      <ActionChip key={j} action={c.action} />
                    ))}
                    {e.tool_calls.some((c) => (c.fabricated?.length ?? 0) > 0) && (
                      <Chip tone="invent">{t.trace.invented}</Chip>
                    )}
                    <span className="mono" style={{ fontSize: ".72rem", color: "var(--ink-faint)" }}>
                      {t.common.ms(e.duration_ms)}
                      {e.repair_ms > 0 && t.trace.repairTook(e.repair_ms)}
                    </span>
                  </div>
                </summary>
                <div className="body" style={{ display: "flex", flexDirection: "column", gap: ".7rem" }}>
                  <div className="row" style={{ gap: ".4rem" }}>
                    <Chip>{e.model}</Chip>
                    <Chip>{e.dialect}</Chip>
                    {e.declared_turn !== e.turn && (
                      <Chip tone="warn" >
                        {t.trace.turnMismatch(e.declared_turn + 1, e.turn + 1)}
                      </Chip>
                    )}
                    {e.tool_results_in.count > 0 && (
                      <Chip tone={e.tool_results_in.errors ? "bad" : "neutral"}>
                        {t.trace.toolResults(
                          e.tool_results_in.count,
                          e.tool_results_in.errors,
                          e.tool_results_in.errors_heuristic,
                        )}
                      </Chip>
                    )}
                  </div>

                  {e.tool_calls.map((c, j) => (
                    <div key={j} className="field">
                      <label>
                        {c.function} — {c.action}
                      </label>
                      <div className="row" style={{ gap: ".3rem", marginBottom: ".3rem" }}>
                        <Chip tone={c.parse_ok ? "ok" : "bad"}>{t.trace.parseChip(c.parse_ok)}</Chip>
                        {c.recovered && <Chip tone="info">{t.trace.parserRecovered}</Chip>}
                        <Chip tone={c.schema_valid ? "ok" : "bad"}>{t.trace.schemaChip(c.schema_valid)}</Chip>
                        {c.violation && (
                          <Chip tone={c.violation === "fabricating" ? "invent" : "warn"}>
                            {c.violation === "fabricating"
                              ? t.inspect.violationMissing
                              : t.inspect.violationSyntactic}
                          </Chip>
                        )}
                        {c.missing?.map((m) => (
                          <Chip key={m} tone="invent">
                            {t.trace.missingChip(m)}
                          </Chip>
                        ))}
                        {c.fabricated?.map((f) => (
                          <Chip key={f} tone="invent">
                            {t.trace.inventedChip(f)}
                          </Chip>
                        ))}
                      </div>
                      {c.error && <Code tone="bad">{c.error}</Code>}
                    </div>
                  ))}

                  <details>
                    <summary style={{ cursor: "pointer", fontSize: ".8rem", color: "var(--ink-faint)" }}>
                      {t.trace.rawRecord}
                    </summary>
                    <Code>{json(e)}</Code>
                  </details>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
