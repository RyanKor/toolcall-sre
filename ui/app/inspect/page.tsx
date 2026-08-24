"use client";

import { useState } from "react";
import { Banner, Chip, Code, Tile, json, type Tone } from "@/components/ui";
import { useT } from "@/components/I18nProvider";
import { WEATHER_SCHEMA } from "@/lib/scenarios";

interface Inspection {
  tool: string;
  raw: string;
  arguments_were_object: boolean;
  policy: string;
  parse_ok: boolean;
  parsed?: unknown;
  recovered_by_tolerant_parse?: boolean;
  schema_valid?: boolean | null;
  violation?: "syntactic" | "fabricating";
  missing?: string[];
  error?: string;
  decision?: { action: string; reason: string; with_context?: boolean };
  hint?: string;
}

type PresetKey =
  | "clean" | "prose" | "fenced" | "comma" | "type" | "enum" | "missing" | "empty" | "garbage";

const PRESET_ARGS: Record<PresetKey, string> = {
  clean: `{"location":"Seoul","unit":"celsius"}`,
  prose: `Sure! here you go: {"location":"Seoul","unit":"celsius"}`,
  fenced: "```json\n{\"location\":\"Seoul\",\"unit\":\"celsius\"}\n```",
  comma: `{"location":"Seoul","unit":"celsius",}`,
  type: `{"location":123,"unit":"celsius"}`,
  enum: `{"location":"Seoul","unit":"C"}`,
  missing: `{"location":"Seoul"}`,
  empty: ``,
  garbage: `I cannot do that`,
};

const PRESET_ORDER: PresetKey[] = [
  "clean", "prose", "fenced", "comma", "type", "enum", "missing", "empty", "garbage",
];

export default function Inspect() {
  const t = useT();
  const [args, setArgs] = useState(PRESET_ARGS.prose);
  const [schema, setSchema] = useState(json(WEATHER_SCHEMA));
  const [tool, setTool] = useState("get_weather");
  const [out, setOut] = useState<Inspection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inspect = async () => {
    setBusy(true);
    setErr(null);
    try {
      let parsedSchema: unknown = null;
      try {
        parsedSchema = schema.trim() ? JSON.parse(schema) : null;
      } catch {
        setErr(t.inspect.badSchema);
        setBusy(false);
        return;
      }
      const r = await fetch("/api/proxy/debug/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool, arguments: args, schema: parsedSchema }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error ?? t.inspect.inspectFailed);
        setOut(null);
      } else {
        setOut(j);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="pagehead">
        <span className="eyebrow">{t.inspect.eyebrow}</span>
        <h1>{t.inspect.title}</h1>
        <p>
          {t.inspect.lead1}
          <span className="mono">/debug/inspect</span>
          {t.inspect.lead2}
          <strong>{t.inspect.leadEmph}</strong>
          {t.inspect.lead3}
        </p>
      </div>

      {/* This is the one screen that calls no model. It states that in the same
          bar the lab uses, so the difference between the two reads in one place. */}
      <div className="usingbar">
        <Chip tone="info">{t.inspect.noModel}</Chip>
        <span className="f" style={{ flex: "1 1 24rem" }}>
          {t.inspect.noModelNote}
        </span>
        {out?.policy && (
          <span className="f">
            <em>{t.inspect.policyLabel}</em>
            <span className="mono">{out.policy}</span>
          </span>
        )}
      </div>

      <section className="section">
        <header>
          <h2>{t.inspect.inputs}</h2>
          <span className="hint">{t.inspect.presetHint}</span>
        </header>

        <div className="row">
          {PRESET_ORDER.map((k) => (
            <button
              key={k}
              className="btn"
              title={t.inspect.presets[`${k}Note` as keyof typeof t.inspect.presets]}
              onClick={() => setArgs(PRESET_ARGS[k])}
              data-variant={args === PRESET_ARGS[k] ? "primary" : undefined}
            >
              {t.inspect.presets[k]}
            </button>
          ))}
        </div>

        <div className="split">
          <div className="field">
            <label>{t.inspect.argsLabel}</label>
            <textarea
              className="input"
              rows={6}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>{t.inspect.schemaLabel}</label>
            <textarea
              className="input"
              rows={6}
              value={schema}
              onChange={(e) => setSchema(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>

        <div className="row">
          <div className="field" style={{ maxWidth: "16rem", flex: 1 }}>
            <label>{t.inspect.toolLabel}</label>
            <input className="input" value={tool} onChange={(e) => setTool(e.target.value)} />
          </div>
          <button className="btn" data-variant="primary" onClick={inspect} disabled={busy}>
            {busy ? t.common.checking : t.common.check}
          </button>
        </div>

        {err && <Banner error={err} hint={t.common.proxyCheckHint} />}
      </section>

      {out && (
        <section className="section">
          <header>
            <h2>{t.inspect.verdict}</h2>
            <span className="hint mono">{t.inspect.policyIs(out.policy)}</span>
          </header>

          <div className="tiles">
            <Tile
              k={t.inspect.parsing}
              v={out.parse_ok ? t.inspect.parseOk : t.inspect.parseFail}
              tone={out.parse_ok ? "ok" : "bad"}
              d={out.recovered_by_tolerant_parse ? t.inspect.parseRecovered : t.inspect.parsePlain}
            />
            <Tile
              k={t.inspect.schemaCheck}
              v={
                out.schema_valid === null
                  ? t.common.notApplicable
                  : out.schema_valid
                  ? t.inspect.schemaPass
                  : t.inspect.schemaFail
              }
              tone={out.schema_valid === null ? "neutral" : out.schema_valid ? "ok" : "bad"}
              d={out.schema_valid === null ? t.inspect.schemaNone : undefined}
            />
            <Tile
              k={t.inspect.violationType}
              v={
                out.violation
                  ? out.violation === "fabricating"
                    ? t.inspect.violationMissing
                    : t.inspect.violationSyntactic
                  : t.common.none
              }
              tone={out.violation === "fabricating" ? "invent" : out.violation ? "warn" : "neutral"}
              d={
                out.violation === "fabricating"
                  ? t.inspect.violationMissingNote
                  : out.violation
                  ? t.inspect.violationSyntacticNote
                  : undefined
              }
            />
            <Tile
              k={t.inspect.argShape}
              v={out.arguments_were_object ? t.inspect.argObject : t.inspect.argString}
              d={out.arguments_were_object ? t.inspect.argObjectNote : t.inspect.argStringNote}
            />
          </div>

          {out.decision && (
            <div className="panel">
              <div className="head">
                <span className="t">{t.inspect.whatProxyDoes}</span>
                <Chip tone={decisionTone(out.decision.action)}>{out.decision.action}</Chip>
              </div>
              <div className="body" style={{ display: "flex", flexDirection: "column", gap: ".6rem" }}>
                <p style={{ fontSize: ".9rem" }}>{out.decision.reason}</p>
                {out.decision.with_context && (
                  <p style={{ fontSize: ".84rem", color: "var(--ink-soft)" }}>
                    {t.inspect.withContextNote}
                  </p>
                )}
                {out.missing && out.missing.length > 0 && (
                  <div className="row">
                    <span style={{ fontSize: ".84rem", color: "var(--ink-soft)" }}>{t.inspect.missingLabel}</span>
                    {out.missing.map((m) => (
                      <Chip key={m} tone="invent">
                        {m}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="split">
            {out.parsed !== undefined && (
              <div className="field">
                <label>{t.inspect.parsedResult}</label>
                <Code tone="ok">{json(out.parsed)}</Code>
              </div>
            )}
            {out.error && (
              <div className="field">
                <label>{t.inspect.errorLabel}</label>
                <Code tone="bad">{out.error}</Code>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function decisionTone(action: string): Tone {
  if (action === "repair") return "warn";
  if (action === "left_by_policy") return "invent";
  if (action === "passthrough" || action === "normalized") return "ok";
  return "neutral";
}
