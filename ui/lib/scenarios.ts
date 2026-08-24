/**
 * The failure catalogue.
 *
 * Every entry is one way a local model actually breaks a tool call, paired with
 * what the patched proxy is supposed to do about it. The mock upstream replays
 * these on demand, so the whole system is exercisable with no model, no GPU and
 * no network — and each scenario doubles as the expectation the lab checks.
 *
 * Prose lives in the dictionaries, not here: an entry carries *keys* so the same
 * catalogue reads in any of the four languages. Sample payloads stay literal —
 * they are data the proxy parses, not copy — except the few that contain a
 * sentence, which get an `emitsKey` instead.
 */

import type { Dict } from "@/lib/i18n";

type ScenarioText = keyof Dict["scenario"];

export type Expectation =
  | "passthrough"   // valid; must survive byte-for-byte
  | "recovered"     // parser alone fixes it; no model round-trip
  | "repaired"      // schema repair, information was present
  | "fabricated"    // repaired, but the value came from nowhere — must be flagged
  | "refused"       // policy declines to invent; reported, not guessed
  | "failed"        // unrepairable
  | "final"         // no tool call at all
  | "observed";     // no scripted answer — a real model decides, so the card
                     // states that rather than predicting a verdict it cannot know

export type GroupKey = keyof Dict["group"];

export interface Scenario {
  /** Sent as the `model` field; the scenario mock uses it to pick a failure. */
  id: string;
  /** Stable React key — several entries share an id. */
  key: string;
  group: GroupKey;
  titleKey: ScenarioText;
  noteKey: ScenarioText;
  /** Literal sample payload. */
  emits?: string;
  /** …or a key, when the sample contains a sentence. */
  emitsKey?: ScenarioText;
  expect: Expectation;
  stream?: boolean;
  /** Task text sent as the user message — decides whether values are recoverable. */
  task?: string;
  tool?: string;
  /**
   * Overrides the default `TOOLS` sent with the request. A scenario that needs
   * a schema the mock cannot replay — nested objects, arrays, several required
   * fields at once — carries its own tool list so it does not also change what
   * the other 16 scenarios expose to the model.
   */
  tools?: unknown[];
}

export const DEFAULT_TASK = "Weather in Seoul in celsius";
/** A task that deliberately does NOT contain the values the schema requires. */
export const BLIND_TASK = "Tell me the temperature";

/**
 * A schema deliberately heavier than get_weather's two flat strings: a required
 * nested object, a required array of objects with its own nested `required`,
 * and an enum two levels down. This is the shape real tool-calling work
 * actually looks like — the flat weather tool tests parsing and repair, this
 * one tests whether a model can hold a non-trivial structure together at all.
 */
export const MEETING_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Meeting title" },
    start_time: {
      type: "string",
      description: "ISO 8601 date-time, e.g. 2026-08-25T15:00:00+09:00",
    },
    duration_minutes: { type: "integer", minimum: 15, maximum: 480 },
    location: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["video_call", "in_person"] },
        value: { type: "string", description: "URL for video_call, address for in_person" },
      },
      required: ["kind", "value"],
      additionalProperties: false,
    },
    attendees: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          role: { type: "string", enum: ["required", "optional"] },
        },
        required: ["name", "email", "role"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "start_time", "duration_minutes", "location", "attendees"],
  additionalProperties: false,
} as const;

export const COMPLEX_TOOLS = [
  {
    type: "function",
    function: {
      name: "schedule_meeting",
      description: "Schedule a meeting and invite attendees",
      parameters: MEETING_SCHEMA,
    },
  },
];

/** Every field the schema requires is spelled out — nothing for a model to guess. */
const MEETING_TASK_FULL =
  "Schedule a 30-minute video call titled 'Design Review' at 2026-08-25T15:00:00+09:00. " +
  "Link: https://meet.example.com/design-review. Attendees: Alice Kim (alice@example.com, " +
  "required), Bob Lee (bob@example.com, optional).";

/**
 * The exact time, the call link and both attendees' emails and roles are all
 * missing. A model with nothing to go on either asks, or fills four separate
 * gaps at once — the nested-nested version of the blind weather task above.
 */
const MEETING_TASK_BLIND =
  "Schedule a meeting titled 'Design Review' next Tuesday at 3pm for 30 minutes " +
  "with Alice and Bob over video call.";

export const SCENARIOS: Scenario[] = [
  {
    id: "clean",
    key: "clean",
    group: "normal",
    titleKey: "cleanTitle",
    noteKey: "cleanNote",
    emits: `{"location":"Seoul","unit":"celsius"}`,
    expect: "passthrough",
  },
  {
    id: "prose",
    key: "prose",
    group: "syntax",
    titleKey: "proseTitle",
    noteKey: "proseNote",
    emits: `Sure! {"location": "Seoul", "unit": "celsius",}`,
    expect: "recovered",
  },
  {
    id: "fenced",
    key: "fenced",
    group: "syntax",
    titleKey: "fencedTitle",
    noteKey: "fencedNote",
    emitsKey: "emitsFenced",
    expect: "recovered",
  },
  {
    id: "bad-enum",
    key: "bad-enum",
    group: "syntax",
    titleKey: "badEnumTitle",
    noteKey: "badEnumNote",
    emits: `{"location":"Seoul","unit":"C"}`,
    expect: "repaired",
  },
  {
    id: "wrong-type",
    key: "wrong-type",
    group: "syntax",
    titleKey: "wrongTypeTitle",
    noteKey: "wrongTypeNote",
    emits: `{"location": 123, "unit": "celsius"}`,
    expect: "fabricated",
    task: BLIND_TASK,
  },
  {
    id: "missing",
    key: "missing-ctx",
    group: "missing",
    titleKey: "missingCtxTitle",
    noteKey: "missingCtxNote",
    emits: `{"location":"Seoul"}`,
    expect: "repaired",
    task: DEFAULT_TASK,
  },
  {
    id: "missing",
    key: "missing-blind",
    group: "missing",
    titleKey: "missingBlindTitle",
    noteKey: "missingBlindNote",
    emits: `{"location":"Seoul"}`,
    expect: "fabricated",
    task: BLIND_TASK,
  },
  {
    id: "garbage",
    key: "garbage-ctx",
    group: "syntax",
    titleKey: "garbageCtxTitle",
    noteKey: "garbageCtxNote",
    emits: `I cannot do that`,
    expect: "repaired",
    task: DEFAULT_TASK,
  },
  {
    id: "garbage",
    key: "garbage-blind",
    group: "syntax",
    titleKey: "garbageBlindTitle",
    noteKey: "garbageBlindNote",
    emits: `I cannot do that`,
    expect: "fabricated",
    task: BLIND_TASK,
  },
  {
    id: "object-args",
    key: "object-args",
    group: "argshape",
    titleKey: "objectArgsTitle",
    noteKey: "objectArgsNote",
    emitsKey: "emitsObjectArgs",
    expect: "passthrough",
  },
  {
    id: "empty-args",
    key: "empty-args",
    group: "argshape",
    titleKey: "emptyArgsTitle",
    noteKey: "emptyArgsNote",
    emitsKey: "emitsEmptyArgs",
    expect: "passthrough",
    tool: "get_time",
  },
  {
    id: "final",
    key: "final",
    group: "finish",
    titleKey: "finalTitle",
    noteKey: "finalNote",
    emitsKey: "emitsFinal",
    expect: "final",
  },
  {
    id: "truncated",
    key: "truncated",
    group: "finish",
    titleKey: "truncatedTitle",
    noteKey: "truncatedNote",
    emitsKey: "emitsTruncated",
    expect: "final",
  },
  {
    id: "stream-clean",
    key: "stream-clean",
    group: "streaming",
    titleKey: "streamCleanTitle",
    noteKey: "streamCleanNote",
    emitsKey: "emitsStreamClean",
    expect: "passthrough",
    stream: true,
  },
  {
    id: "stream-prose",
    key: "stream-prose",
    group: "streaming",
    titleKey: "streamProseTitle",
    noteKey: "streamProseNote",
    emitsKey: "emitsStreamProse",
    expect: "recovered",
    stream: true,
  },
  {
    id: "stream-missing",
    key: "stream-missing",
    group: "streaming",
    titleKey: "streamMissingTitle",
    noteKey: "streamMissingNote",
    emitsKey: "emitsStreamMissing",
    expect: "fabricated",
    stream: true,
    task: BLIND_TASK,
  },
  {
    id: "schedule-full",
    key: "schedule-full",
    group: "complex",
    titleKey: "scheduleFullTitle",
    noteKey: "scheduleFullNote",
    emits: MEETING_TASK_FULL,
    expect: "observed",
    task: MEETING_TASK_FULL,
    tool: "schedule_meeting",
    tools: COMPLEX_TOOLS,
  },
  {
    id: "schedule-blind",
    key: "schedule-blind",
    group: "complex",
    titleKey: "scheduleBlindTitle",
    noteKey: "scheduleBlindNote",
    emits: MEETING_TASK_BLIND,
    expect: "observed",
    task: MEETING_TASK_BLIND,
    tool: "schedule_meeting",
    tools: COMPLEX_TOOLS,
  },
];

/** Order the lab renders the groups in. */
export const GROUP_ORDER: GroupKey[] = [
  "normal",
  "syntax",
  "missing",
  "argshape",
  "finish",
  "streaming",
  "complex",
];

export const WEATHER_SCHEMA = {
  type: "object",
  properties: {
    location: { type: "string", description: "City name" },
    unit: { type: "string", enum: ["celsius", "fahrenheit"] },
  },
  required: ["location", "unit"],
  additionalProperties: false,
} as const;

export const NOARG_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export const TOOLS = [
  { type: "function", function: { name: "get_weather", description: "Current weather", parameters: WEATHER_SCHEMA } },
  { type: "function", function: { name: "get_time", description: "Current time", parameters: NOARG_SCHEMA } },
];

/** How each proxy action should read on screen. Labels come from the dictionary. */
export type ActionTone = "ok" | "info" | "warn" | "bad" | "invent";
export const ACTION_TONE: Record<string, ActionTone> = {
  passthrough: "ok",
  normalized: "ok",
  recovered: "info",
  repaired: "warn",
  left_by_policy: "warn",
  left_no_schema: "info",
  repair_failed: "bad",
  declined: "info",
};

/** Resolve a scenario's sample payload in the active language. */
export function emitsOf(s: Scenario, t: Dict): string {
  if (s.emitsKey) return t.scenario[s.emitsKey] as string;
  return s.emits ?? "";
}
