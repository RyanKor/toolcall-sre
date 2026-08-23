"use client";

import { useEffect, useState } from "react";
import { Banner, Chip, Split, Tile, errorText, ms, pct } from "@/components/ui";
import { useT } from "@/components/I18nProvider";

interface Metrics {
  requests: number;
  passthrough_stream: number;
  stream_measured: number;
  stream_repaired: number;
  tool_calls: number;
  well_formed: number;
  recovered: number;
  malformed: number;
  malformed_fabricating: number;
  repair_attempted: number;
  repaired: number;
  repair_exhausted: number;
  repair_skipped_no_schema: number;
  repair_skipped_by_policy: number;
  repair_fabricated: number;
  repair_declined: number;
  upstream_errors: number;
  unauthorized: number;
  well_formed_rate: number | null;
  repair_success_rate: number | null;
  fabrication_rate: number | null;
  request_latency: { count: number; mean_ms: number | null; p50_ms: number | null; p95_ms: number | null };
  repair_latency: { count: number; mean_ms: number | null; p50_ms: number | null; p95_ms: number | null };
  in_harness: {
    sessions: number;
    live_sessions: number;
    retired_sessions: number;
    multi_turn_sessions: number;
    avg_turns: number | null;
    tool_using_sessions: number;
    end_to_end_clean_sessions: number;
    end_to_end_clean_rate: number | null;
    tool_result_errors_observed: number;
    sessions_with_recovery: number;
  };
  code?: string;
  detail?: string;
}

interface Session {
  session: string;
  turns: number;
  tool_calls: number;
  recovered_calls: number;
  malformed: number;
  malformed_fabricating: number;
  repaired: number;
  fabricated: number;
  tool_result_errors: number;
  tool_result_errors_heuristic: number;
  reached_final: boolean;
  recovered: boolean;
  end_to_end_clean: boolean | null;
  sequence: string[];
  sequence_dropped: number;
}

export default function Dashboard() {
  const t = useT();
  const [m, setM] = useState<Metrics | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [live, setLive] = useState(true);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const [a, b] = await Promise.all([
          fetch("/api/proxy/metrics?format=json", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/proxy/sessions?limit=50", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (!alive) return;
        setM(a);
        setSessions(b?.sessions ?? []);
      } catch {
        if (alive) setM({ code: "proxy_unreachable" } as Metrics);
      }
    };
    poll();
    if (!live) return;
    const timer = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [live, t]);

  if (m?.code) {
    return (
      <>
        <Head t={t} />
        <Banner error={errorText(t, m.code)} hint={m.detail ?? t.common.proxyCheckHint} />
      </>
    );
  }
  if (!m) return <Empty t={t} />;

  const h = m.in_harness;
  const fabricating = m.repair_fabricated > 0;

  return (
    <>
      <Head t={t} live={live} onToggle={() => setLive((v) => !v)} />

      {/* The one number that must never be buried. */}
      {fabricating && (
        <div className="section">
          <div
            className="panel"
            style={{ borderColor: "color-mix(in srgb, var(--invent) 45%, transparent)" }}
          >
            <div className="head" style={{ background: "var(--invent-bg)" }}>
              <span className="t" style={{ color: "var(--invent)" }}>
                {t.dashboard.fabricatedHeadline(m.repair_fabricated)}
              </span>
              <Chip tone="invent">
                {t.dashboard.fabricationRate(pct(m.fabrication_rate) ?? t.common.none)}
              </Chip>
            </div>
            <div className="body" style={{ fontSize: ".88rem", color: "var(--ink-soft)" }}>
              {t.dashboard.fabricatedBody1(m.repaired, m.repair_fabricated)}
              <strong>{t.dashboard.fabricatedBodyEmph}</strong>
              {t.dashboard.fabricatedBody2}
              <span className="mono">--no-fabricate-for</span>
              {t.dashboard.fabricatedBody3}
            </div>
          </div>
        </div>
      )}

      <section className="section">
        <header>
          <h2>{t.dashboard.reliability}</h2>
          <span className="hint">{t.dashboard.observedCalls(m.tool_calls)}</span>
        </header>
        <div className="tiles">
          <Tile
            k={t.dashboard.wellFormedRate}
            v={pct(m.well_formed_rate) ?? null}
            tone="ok"
            d={t.dashboard.wellFormedRateNote}
          />
          <Tile
            k={t.dashboard.recovered}
            v={m.recovered || null}
            tone="info"
            d={t.dashboard.recoveredNote}
          />
          <Tile
            k={t.dashboard.repairSuccess}
            v={pct(m.repair_success_rate) ?? null}
            tone="warn"
            d={t.dashboard.repairSuccessNote(m.repair_attempted)}
          />
          <Tile
            k={t.dashboard.fabricated}
            v={m.repair_fabricated || null}
            tone="invent"
            d={t.dashboard.fabricatedNote}
          />
          <Tile
            k={t.dashboard.skipped}
            v={m.repair_skipped_by_policy || null}
            d={t.dashboard.skippedNote}
          />
          <Tile
            k={t.dashboard.exhausted}
            v={m.repair_exhausted || null}
            tone="bad"
            d={t.dashboard.exhaustedNote}
          />
        </div>
        <div className="panel">
          <div className="body">
            <Split
              parts={[
                { value: m.well_formed - m.recovered, tone: "ok", label: t.dashboard.splitClean },
                { value: m.recovered, tone: "info", label: t.dashboard.splitRecovered },
                { value: m.repaired - m.repair_fabricated, tone: "warn", label: t.dashboard.splitRepaired },
                { value: m.repair_fabricated, tone: "invent", label: t.dashboard.splitFabricated },
                { value: m.repair_skipped_by_policy, tone: "neutral", label: t.dashboard.splitSkipped },
                { value: m.repair_exhausted, tone: "bad", label: t.dashboard.splitFailed },
              ]}
            />
          </div>
        </div>
      </section>

      <section className="section">
        <header>
          <h2>{t.dashboard.inHarness}</h2>
          <span className="hint">
            {t.dashboard.inHarnessHintA}
            <strong>{t.dashboard.inHarnessHintB}</strong>
            {t.dashboard.inHarnessHintC}
          </span>
        </header>
        <div className="tiles">
          <Tile
            k={t.dashboard.cleanRate}
            v={pct(h.end_to_end_clean_rate) ?? null}
            tone="ok"
            d={t.dashboard.cleanRateNote(h.tool_using_sessions)}
          />
          <Tile
            k={t.dashboard.sessions}
            v={h.sessions}
            d={t.dashboard.sessionsNote(h.live_sessions, h.retired_sessions)}
          />
          <Tile
            k={t.dashboard.avgTurns}
            v={h.avg_turns?.toFixed(1) ?? null}
            d={t.dashboard.avgTurnsNote}
          />
          <Tile
            k={t.dashboard.recovery}
            v={h.sessions_with_recovery || null}
            tone="ok"
            d={t.dashboard.recoveryNote(h.tool_result_errors_observed)}
          />
        </div>
      </section>

      <section className="section">
        <header>
          <h2>{t.dashboard.latency}</h2>
          <span className="hint">{t.dashboard.latencyHint}</span>
        </header>
        <div className="tiles">
          <Tile
            k={t.dashboard.p50}
            v={ms(m.request_latency.p50_ms) ?? null}
            d={t.dashboard.p50Note(m.request_latency.count)}
          />
          <Tile k={t.dashboard.p95} v={ms(m.request_latency.p95_ms) ?? null} />
          <Tile
            k={t.dashboard.repairAdded}
            v={ms(m.repair_latency.p95_ms) ?? null}
            tone="warn"
            d={t.dashboard.repairAddedNote(m.repair_latency.count)}
          />
          <Tile
            k={t.dashboard.streamMeasured}
            v={m.stream_measured || null}
            tone="ok"
            d={t.dashboard.streamMeasuredNote(m.passthrough_stream)}
          />
          <Tile
            k={t.dashboard.streamRepaired}
            v={m.stream_repaired || null}
            tone="warn"
            d={t.dashboard.streamRepairedNote}
          />
          <Tile
            k={t.dashboard.upstreamErrors}
            v={m.upstream_errors || null}
            tone={m.upstream_errors ? "bad" : "neutral"}
          />
        </div>
      </section>

      <section className="section">
        <header>
          <h2>{t.dashboard.sessionsTable}</h2>
          <span className="hint">{t.dashboard.sessionsTableHint}</span>
        </header>
        <div className="panel">
          <div className="scroll">
            {sessions.length === 0 ? (
              <div className="empty">
                {t.dashboard.emptySessionsA}
                <strong>{t.dashboard.emptySessionsB}</strong>
                {t.dashboard.emptySessionsC}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t.dashboard.colSession}</th>
                    <th>{t.dashboard.colTurns}</th>
                    <th>{t.dashboard.colCalls}</th>
                    <th>{t.dashboard.colRecovered}</th>
                    <th>{t.dashboard.colRepaired}</th>
                    <th>{t.dashboard.colFabricated}</th>
                    <th>{t.dashboard.colToolErrors}</th>
                    <th>{t.dashboard.colVerdict}</th>
                    <th>{t.dashboard.colSequence}</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.session}>
                      <td className="mono" style={{ maxWidth: "13rem", wordBreak: "break-all" }}>
                        {s.session}
                      </td>
                      <td className="num">{s.turns}</td>
                      <td className="num">{s.tool_calls}</td>
                      <td className="num">{s.recovered_calls || ""}</td>
                      <td className="num">{s.repaired || ""}</td>
                      <td className="num">
                        {s.fabricated ? <Chip tone="invent">{s.fabricated}</Chip> : ""}
                      </td>
                      <td className="num">
                        {s.tool_result_errors || ""}
                        {s.tool_result_errors_heuristic > 0 && (
                          <span title={t.dashboard.heuristicTitle}> ~</span>
                        )}
                      </td>
                      <td>
                        {s.end_to_end_clean === null ? (
                          <Chip>{t.dashboard.noToolCalls}</Chip>
                        ) : s.end_to_end_clean ? (
                          <Chip tone="ok">{t.dashboard.clean}</Chip>
                        ) : (
                          <Chip tone="bad">{t.dashboard.dirty}</Chip>
                        )}
                        {s.recovered && <Chip tone="ok">{t.dashboard.recoveredChip}</Chip>}
                      </td>
                      <td>
                        <div className="row" style={{ gap: ".25rem" }}>
                          {s.sequence_dropped > 0 && <Chip>…{s.sequence_dropped}</Chip>}
                          {s.sequence.slice(-6).map((t, i) => (
                            <Chip key={i}>{t}</Chip>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function Head({
  t,
  live,
  onToggle,
}: {
  t: ReturnType<typeof useT>;
  live?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="pagehead">
      <span className="eyebrow">{t.dashboard.eyebrow}</span>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{t.dashboard.title}</h1>
        {onToggle && (
          <button className="btn" onClick={onToggle}>
            {live ? t.dashboard.autoOn : t.dashboard.autoOff}
          </button>
        )}
      </div>
      <p>
        {t.dashboard.lead1} <span className="mono">100%</span> {t.dashboard.lead2}{" "}
        <strong>&ldquo;{t.dashboard.lead3}&rdquo;</strong>
        {t.dashboard.lead4}
      </p>
    </div>
  );
}

function Empty({ t }: { t: ReturnType<typeof useT> }) {
  return (
    <>
      <Head t={t} />
      <div className="empty">{t.common.loading}</div>
    </>
  );
}
