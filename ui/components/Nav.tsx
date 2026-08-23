"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/I18nProvider";

export function Nav() {
  const path = usePathname();
  const t = useT();

  const observe = [
    { href: "/", label: t.nav.dashboard, sub: t.nav.dashboardSub },
    { href: "/lab", label: t.nav.lab, sub: t.nav.labSub },
    { href: "/inspect", label: t.nav.inspect, sub: t.nav.inspectSub },
    { href: "/trace", label: t.nav.trace, sub: t.nav.traceSub },
  ];
  const setup = [
    { href: "/models", label: t.nav.models, sub: t.nav.modelsSub },
    { href: "/connections", label: t.nav.connections, sub: t.nav.connectionsSub },
  ];

  const group = (label: string, links: typeof observe) => (
    <nav className="navgroup" key={label}>
      <span className="label">{label}</span>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="navlink" data-active={path === l.href}>
          <span>{l.label}</span>
          <span className="sub">{l.sub}</span>
        </Link>
      ))}
    </nav>
  );

  return (
    <>
      {group(t.nav.observe, observe)}
      {group(t.nav.setup, setup)}
    </>
  );
}
