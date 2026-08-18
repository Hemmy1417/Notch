import type { Metadata } from "next";
import Link from "next/link";
import { ConsoleShell } from "../../components/ConsoleShell";
import { formatUsdc } from "@/lib/config";
import { fmtGen } from "@/lib/fmt";
import {
  COURT_CONFIGURED, getConfig, getPaymentsFor,
  type CourtConfig, type CourtPaymentRow,
} from "@/lib/server/court";

export const metadata: Metadata = { title: "Payments — Notch" };
export const revalidate = 60;

const DEMO_SELLER = process.env.NOTCH_DEMO_SELLER ?? "";

/** The book: every hold, newest first. One concern, one page. */
export default async function Payments() {
  let book: CourtPaymentRow[] = [];
  let config: CourtConfig | null = null;
  let readError: string | null = null;

  if (COURT_CONFIGURED && DEMO_SELLER) {
    try {
      [book, config] = await Promise.all([
        getPaymentsFor(DEMO_SELLER, "seller"),
        getConfig(),
      ]);
    } catch (e) {
      readError = e instanceof Error ? e.message : "read failed";
    }
  }

  return (
    <ConsoleShell active="payments">
      <header className="wrap section" style={{ paddingTop: 60 }}>
        <p className="t-label t-label-spark">The book</p>
        <h1 className="t-heading-lg" style={{ marginTop: 18 }}>Payments</h1>
        <p className="t-caption" style={{ marginTop: 14, maxWidth: "52ch" }}>
          Every hold recorded on the court, newest first. A row is the
          payment&rsquo;s id, its current state, and its size — the full
          record is one click deeper.
        </p>
      </header>

      {readError ? (
        <section className="wrap section">
          <p className="t-body t-body-dim">
            StudioNet did not answer:{" "}
            <span className="t-mono breakable">{readError.slice(0, 160)}</span>.
            Reload in a moment.
          </p>
        </section>
      ) : null}

      <section className="wrap section section-tail">
        {book.length > 0 ? (
          <div>
            {book.map((r) => (
              <Link key={r.payment_id} href={`/console/p/${r.payment_id}`} className="book-row">
                <span className="t-mono-lg breakable">{r.payment_id}</span>
                <span className={`state st-${r.state}`}>{r.state}</span>
                <span className="t-mono">{formatUsdc(r.amount_atto)}</span>
              </Link>
            ))}
          </div>
        ) : !readError ? (
          <p className="t-body t-body-dim">The book is empty.</p>
        ) : null}

        {config ? (
          <p className="t-caption" style={{ marginTop: 60, maxWidth: "68ch" }}>
            Rules of this court: seller bond floor {fmtGen(config.min_bond_atto)} GEN ·
            challenge bond max({config.challenge_bond_bps / 100}%, {fmtGen(config.min_challenge_bond_atto)} GEN) ·
            a false receipt slashes {config.slash_bps / 100}% of the payment ·
            windows {config.window_seconds[0]}–{config.window_seconds[1]}s ·
            a stuck dispute exits permissionlessly after {Math.round(config.dispute_terminal_seconds / 86400)}d.
          </p>
        ) : null}
      </section>
    </ConsoleShell>
  );
}
