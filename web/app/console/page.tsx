import Link from "next/link";
import { ConsoleShell } from "../components/ConsoleShell";
import { formatUsdc } from "@/lib/config";
import { fmtGen } from "@/lib/fmt";
import {
  COURT_CONFIGURED, getStats, getPaymentsFor,
  type CourtStats, type CourtPaymentRow,
} from "@/lib/server/court";

/**
 * Overview: the shape of the court at a glance — headline figures, the
 * latest activity, and doors into each feature. Detail lives behind the
 * doors, not here.
 */
export const revalidate = 60;

const DEMO_SELLER = process.env.NOTCH_DEMO_SELLER ?? "";

export default async function Console() {
  if (!COURT_CONFIGURED) {
    return (
      <ConsoleShell active="overview">
        <section className="wrap section">
          <h1 className="t-heading-lg">The court is not configured.</h1>
          <p className="t-body t-body-dim" style={{ marginTop: 18 }}>
            NEXT_PUBLIC_CONTRACT_ADDRESS is empty, so there is nothing to read.
          </p>
        </section>
      </ConsoleShell>
    );
  }

  let stats: CourtStats | null = null;
  let latest: CourtPaymentRow[] = [];
  let readError: string | null = null;
  try {
    stats = await getStats();
    if (DEMO_SELLER) {
      latest = (await getPaymentsFor(DEMO_SELLER, "seller")).slice(0, 3);
    }
  } catch (e) {
    readError = e instanceof Error ? e.message : "read failed";
  }

  return (
    <ConsoleShell active="overview">
      <header className="wrap section" style={{ paddingTop: 60 }}>
        <p className="t-label t-label-spark">Overview</p>
        <h1 className="t-heading-lg" style={{ marginTop: 18 }}>
          The court, read live.
        </h1>
        <p className="t-caption" style={{ marginTop: 14, maxWidth: "52ch" }}>
          Every figure on this page is a contract read — there is no database
          behind it, so there is nothing Notch could quietly edit.
        </p>
      </header>

      {readError ? <ReadError msg={readError} /> : null}

      {stats ? (
        <section className="wrap section">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 36,
            }}
          >
            <Figure n={stats.payments} label="Payments" />
            <Figure n={stats.disputes} label="Disputes" />
            <Figure n={stats.refunds} label="Refunds ruled" />
            <Figure n={stats.upheld} label="Receipts upheld" />
            <Figure n={fmtGen(stats.bonds_held_atto)} label="GEN bonded" />
          </div>
        </section>
      ) : null}

      {latest.length > 0 ? (
        <section className="wrap section">
          <div className="row-b" style={{ alignItems: "baseline" }}>
            <p className="t-label" style={{ margin: 0 }}>Latest activity</p>
            <Link href="/console/payments" className="ghost ghost-lit" style={{ fontSize: 13 }}>
              All payments →
            </Link>
          </div>
          <div style={{ marginTop: 6 }}>
            {latest.map((r) => (
              <Link key={r.payment_id} href={`/console/p/${r.payment_id}`} className="book-row">
                <span className="t-mono-lg breakable">{r.payment_id}</span>
                <span className={`state st-${r.state}`}>{r.state}</span>
                <span className="t-mono">{formatUsdc(r.amount_atto)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="wrap section section-tail">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 48,
          }}
        >
          <Feature
            href="/console/payments"
            title="Payments"
            line="Every hold on the book, newest first, with its state."
          />
          <Feature
            href="/console/sellers"
            title="Sellers"
            line="The public record that follows a bonded key."
          />
          <Feature
            href="/console/verify"
            title="Verify"
            line="Resolve any payment id to its full on-chain record."
          />
        </div>
      </section>
    </ConsoleShell>
  );
}

function Figure({ n, label }: { n: number | string; label: string }) {
  return (
    <div>
      <p className="t-figure" style={{ margin: 0 }}>{n}</p>
      <p className="t-label" style={{ marginTop: 10 }}>{label}</p>
    </div>
  );
}

function Feature({ href, title, line }: { href: string; title: string; line: string }) {
  return (
    <Link href={href} className="feature-link">
      <h3 className="t-heading-xs">{title} →</h3>
      <p className="t-caption" style={{ marginTop: 8, marginBottom: 0 }}>{line}</p>
    </Link>
  );
}

function ReadError({ msg }: { msg: string }) {
  return (
    <section className="wrap section">
      <p className="t-label t-label-iris">Read failed</p>
      <p className="t-body t-body-dim" style={{ marginTop: 14 }}>
        StudioNet did not answer: <span className="t-mono breakable">{msg.slice(0, 160)}</span>.
        The chain state is unchanged — reload in a moment.
      </p>
    </section>
  );
}
