"use client";

import { LocaleSwitcher, useT } from "@/components/I18nProvider";

export function Brand() {
  const t = useT();
  return (
    <>
      <div className="brand">
        <span className="name">toolcall-sre</span>
        <span className="tag">{t.common.brandTag}</span>
      </div>
      <LocaleSwitcher />
    </>
  );
}
