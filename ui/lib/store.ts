/**
 * Durable console configuration.
 *
 * The proxy's upstream registry lives in memory and dies with the process, so
 * the console keeps the authoritative list on disk and pushes it into whichever
 * proxy it is connected to. That split is deliberate: the proxy stays a single
 * self-contained binary with no config file to manage, and the console can point
 * the same set of backends at a different proxy without retyping anything.
 *
 * Server-side only — the file is never exposed to the browser verbatim; API
 * keys are redacted on read (see `redact`).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { getDict } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/types";

export interface ProxyConn {
  id: string;
  label: string;
  url: string;
}

export interface ModelConn {
  id: string;
  /** Registry alias — what the `X-TCS-Upstream` header carries. */
  alias: string;
  label: string;
  baseUrl: string;
  /** Model id sent as `model` when running this backend. */
  defaultModel: string;
  apiKey?: string;
  notes?: string;
}

export interface ConsoleConfig {
  proxies: ProxyConn[];
  activeProxyId: string;
  models: ModelConn[];
}

const FILE = process.env.TCS_CONSOLE_CONFIG
  ? path.resolve(process.env.TCS_CONSOLE_CONFIG)
  : path.join(process.cwd(), ".tcs-console.json");

const DEFAULT_PROXY_URL = process.env.TCS_PROXY_URL ?? "http://127.0.0.1:8091";
const MOCK_ORIGIN = process.env.TCS_MOCK_ORIGIN ?? "http://127.0.0.1:3100";

/**
 * Ships with the built-in simulated backends so the console is useful on first
 * run. Written in the visitor's language: these become editable user data the
 * moment they are saved, so they are seeded once rather than translated live.
 */
function seed(locale: Locale = DEFAULT_LOCALE): ConsoleConfig {
  const s = getDict(locale).seed;
  return {
    proxies: [{ id: "local", label: s.localProxy, url: DEFAULT_PROXY_URL }],
    activeProxyId: "local",
    models: [
      {
        id: "sim-solid",
        alias: "sim-solid",
        label: s.solidLabel,
        baseUrl: `${MOCK_ORIGIN}/api/mock/p/solid/v1`,
        defaultModel: "sim-solid-8b",
        notes: s.solidNote,
      },
      {
        id: "sim-flaky",
        alias: "sim-flaky",
        label: s.flakyLabel,
        baseUrl: `${MOCK_ORIGIN}/api/mock/p/flaky/v1`,
        defaultModel: "sim-flaky-7b",
        notes: s.flakyNote,
      },
      {
        id: "sim-rough",
        alias: "sim-rough",
        label: s.roughLabel,
        baseUrl: `${MOCK_ORIGIN}/api/mock/p/rough/v1`,
        defaultModel: "sim-rough-3b",
        notes: s.roughNote,
      },
      {
        id: "sim-scenario",
        alias: "sim-scenario",
        label: s.scenarioLabel,
        baseUrl: `${MOCK_ORIGIN}/api/mock/v1`,
        defaultModel: "clean",
        notes: s.scenarioNote,
      },
    ],
  };
}

export async function readConfig(locale: Locale = DEFAULT_LOCALE): Promise<ConsoleConfig> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<ConsoleConfig>;
    const base = seed(locale);
    return {
      proxies: parsed.proxies?.length ? parsed.proxies : base.proxies,
      activeProxyId: parsed.activeProxyId ?? base.activeProxyId,
      models: parsed.models ?? base.models,
    };
  } catch {
    return seed(locale);
  }
}

export async function writeConfig(cfg: ConsoleConfig): Promise<void> {
  await fs.writeFile(FILE, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

/** The proxy the console is currently pointed at. */
export async function activeProxy(): Promise<ProxyConn> {
  const cfg = await readConfig();
  return (
    cfg.proxies.find((p) => p.id === cfg.activeProxyId) ??
    cfg.proxies[0] ?? { id: "local", label: "local", url: DEFAULT_PROXY_URL }
  );
}

/** Never send stored credentials back to the browser. */
export function redact(cfg: ConsoleConfig): ConsoleConfig {
  return {
    ...cfg,
    models: cfg.models.map((m) => ({
      ...m,
      apiKey: m.apiKey ? "••••••••" : undefined,
    })),
  };
}

const REDACTED = "••••••••";

/**
 * Merge an incoming config from the browser, keeping any key the UI only ever
 * saw redacted. Without this, saving an unrelated field would wipe the key.
 */
export function mergeSecrets(incoming: ConsoleConfig, existing: ConsoleConfig): ConsoleConfig {
  return {
    ...incoming,
    models: incoming.models.map((m) => {
      if (m.apiKey && m.apiKey !== REDACTED) return m;
      const prev = existing.models.find((e) => e.id === m.id);
      return { ...m, apiKey: m.apiKey === REDACTED ? prev?.apiKey : m.apiKey };
    }),
  };
}

export const CONFIG_PATH = FILE;
