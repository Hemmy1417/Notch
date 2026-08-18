import Link from "next/link";
import { Nav } from "./Nav";

const TABS = [
  { key: "overview", label: "Overview", href: "/console" },
  { key: "payments", label: "Payments", href: "/console/payments" },
  { key: "sellers", label: "Sellers", href: "/console/sellers" },
  { key: "verify", label: "Verify", href: "/console/verify" },
] as const;

export type ConsoleTab = (typeof TABS)[number]["key"];

/**
 * The console's shell: main nav plus a feature sub-nav. Each tab is one
 * concern — no page carries another page's data.
 */
export function ConsoleShell({
  active,
  children,
}: {
  active?: ConsoleTab;
  children: React.ReactNode;
}) {
  return (
    <main>
      <Nav active="console" />
      <div className="wrap" style={{ paddingTop: 12 }}>
        <div className="subnav">
          {TABS.map((t) =>
            t.key === active ? (
              <span key={t.key} className="is-active">{t.label}</span>
            ) : (
              <Link key={t.key} href={t.href}>{t.label}</Link>
            ),
          )}
        </div>
      </div>
      {children}
    </main>
  );
}
