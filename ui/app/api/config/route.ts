/** Read and write the console's durable configuration. */

import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { CONFIG_PATH, ConsoleConfig, mergeSecrets, readConfig, redact, writeConfig } from "@/lib/store";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "@/lib/i18n/types";

/** Seed labels are written in the visitor's language on first run. */
async function locale() {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

export async function GET() {
  const cfg = await readConfig(await locale());
  return Response.json({ ...redact(cfg), configPath: CONFIG_PATH });
}

export async function PUT(req: NextRequest) {
  const incoming = (await req.json()) as ConsoleConfig;
  if (!Array.isArray(incoming.proxies) || !Array.isArray(incoming.models)) {
    return Response.json({ code: "bad_config", detail: "proxies and models must be arrays" }, { status: 400 });
  }
  // Keys the browser only ever saw redacted must survive an unrelated save.
  const merged = mergeSecrets(incoming, await readConfig(await locale()));
  await writeConfig(merged);
  return Response.json({ ...redact(merged), configPath: CONFIG_PATH });
}
