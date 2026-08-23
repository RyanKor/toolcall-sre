"use client";

import { useT } from "@/components/I18nProvider";
import { ACTION_TONE } from "@/lib/scenarios";
import type { Dict } from "@/lib/i18n";

export type Tone = "ok" | "warn" | "bad" | "invent" | "info" | "neutral";

export function Tile({
  k,
  v,
  d,
  tone = "neutral",
}: {
  k: string;
  v: React.ReactNode;
  d?: React.ReactNode;
  tone?: Tone;
}) {
  const t = useT();
  const unset = v === null || v === undefined || v === "";
  return (
    <div className="tile" data-tone={tone}>
      <span className="k">{k}</span>
      <span className={`v${unset ? " unset" : ""}`}>{unset ? t.common.unobserved : v}</span>
      {d && <span className="d">{d}</span>}
    </div>
  );
}

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className="chip" data-tone={tone}>
      {children}
    </span>
  );
}

/** The proxy's own action name, rendered with the weight it deserves. */
export function ActionChip({ action }: { action?: string }) {
  const t = useT();
  if (!action) return null;
  const label = (t.actions as Record<string, string>)[action] ?? action;
  return <Chip tone={ACTION_TONE[action] ?? "neutral"}>{label}</Chip>;
}

/**
 * A rate rendered as null when nothing has been observed.
 *
 * The proxy deliberately reports `null` instead of 1.0 for an empty
 * denominator; the UI must not undo that by printing "100%".
 */
export function pct(v: number | null | undefined, digits = 1): string | null {
  if (v === null || v === undefined) return null;
  return `${(v * 100).toFixed(digits)}%`;
}

export function ms(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return `${Math.round(v)}ms`;
}

/** Proportional bar showing how a total splits across outcomes. */
export function Split({
  parts,
}: {
  parts: { value: number; tone: Tone; label: string }[];
}) {
  const total = parts.reduce((a, b) => a + b.value, 0);
  if (total === 0) return null;
  const color: Record<Tone, string> = {
    ok: "var(--ok)",
    warn: "var(--warn)",
    bad: "var(--bad)",
    invent: "var(--invent)",
    info: "var(--accent)",
    neutral: "var(--ink-faint)",
  };
  return (
    <>
      <div className="meter" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span
              key={p.label}
              style={{ width: `${(p.value / total) * 100}%`, background: color[p.tone] }}
              title={`${p.label}: ${p.value}`}
            />
          ))}
      </div>
      <div className="row" style={{ gap: ".4rem", marginTop: ".45rem" }}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <Chip key={p.label} tone={p.tone}>
              {p.label} {p.value}
            </Chip>
          ))}
      </div>
    </>
  );
}

export function Banner({ error, hint }: { error: string; hint?: string }) {
  return (
    <div className="banner">
      <strong>{error}</strong>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Code({ children, tone }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <pre className="code" data-tone={tone}>
      {children}
    </pre>
  );
}

export function json(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

/**
 * Translate an error a server route reported by code, falling back to whatever
 * text came back. Routes send codes precisely so the wording can be localised
 * here instead of being frozen in one language on the server.
 */
export function errorText(t: Dict, code: string | undefined, detail?: string): string {
  const known = (t.errors as Record<string, string>)[code ?? ""];
  return known ?? detail ?? t.errors.unknown;
}
