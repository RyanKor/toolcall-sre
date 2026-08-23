import { cookies, headers } from "next/headers";
import "./globals.css";
import { I18nProvider } from "@/components/I18nProvider";
import { Nav } from "@/components/Nav";
import { ProxyBadge } from "@/components/ProxyBadge";
import { Brand } from "@/components/Brand";
import { getDict } from "@/lib/i18n";
import { LOCALE_COOKIE, isLocale, negotiate, type Locale } from "@/lib/i18n/types";

async function resolveLocale(): Promise<Locale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(stored)) return stored;
  return negotiate((await headers()).get("accept-language"));
}

export async function generateMetadata() {
  const t = getDict(await resolveLocale());
  return { title: t.meta.title, description: t.meta.description };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await resolveLocale();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider initialLocale={locale}>
          <div className="shell">
            <aside className="rail">
              <Brand />
              <Nav />
              <ProxyBadge />
            </aside>
            <main className="main">{children}</main>
          </div>
        </I18nProvider>
      </body>
    </html>
  );
}
