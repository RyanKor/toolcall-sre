import ko, { type Dict } from "./ko";
import en from "./en";
import ja from "./ja";
import zh from "./zh";
import { DEFAULT_LOCALE, type Locale } from "./types";

export const DICTS: Record<Locale, Dict> = { ko, en, ja, zh };

export function getDict(locale: Locale): Dict {
  return DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
}

export type { Dict };
export * from "./types";
