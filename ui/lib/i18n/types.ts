export const LOCALES = ["ko", "en", "ja", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
  zh: "中文",
};

/** Short label for the switcher chips. */
export const LOCALE_SHORT: Record<Locale, string> = {
  ko: "KO",
  en: "EN",
  ja: "JA",
  zh: "ZH",
};

export const DEFAULT_LOCALE: Locale = "ko";
export const LOCALE_COOKIE = "tcs-locale";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/**
 * Pick the best locale from an `Accept-Language` header.
 * Used only for the very first visit, before a choice is stored.
 */
export function negotiate(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
