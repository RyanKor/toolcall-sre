"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { getDict, type Dict } from "@/lib/i18n";
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALE_SHORT, LOCALES, type Locale } from "@/lib/i18n/types";

interface Ctx {
  locale: Locale;
  t: Dict;
  setLocale: (l: Locale) => void;
}

const I18nContext = createContext<Ctx | null>(null);

/**
 * The chosen locale is stored in a cookie rather than localStorage so the server
 * renders the same language the client will — reading it after hydration would
 * flash Korean at every visitor who picked something else.
 */
export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
  }, []);

  const value = useMemo(() => ({ locale, t: getDict(locale), setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

/** Shorthand for the common case of only needing the strings. */
export function useT(): Dict {
  return useI18n().t;
}

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="navgroup">
      <span className="label">{t.common.language}</span>
      <div className="row" style={{ gap: ".3rem", padding: "0 .55rem" }}>
        {LOCALES.map((l) => (
          <button
            key={l}
            className="btn"
            data-variant={l === locale ? "primary" : undefined}
            onClick={() => setLocale(l)}
            title={LOCALE_NAMES[l]}
            aria-current={l === locale}
            style={{ padding: ".18rem .45rem", fontSize: ".7rem" }}
          >
            {LOCALE_SHORT[l]}
          </button>
        ))}
      </div>
    </div>
  );
}
