import Link from "next/link";
import { Nav } from "../components/Nav";
import { Lookup } from "./Lookup";
import { formatUsdc } from "@/lib/config";
import {
  COURT_CONFIGURED, getStats, getConfig, getSeller, getPaymentsFor,
  type CourtStats, type CourtConfig, type CourtSeller, type CourtPaymentRow,
} from "@/lib/server/court";

/**
 * The console: an observatory over the live court. Every number on this page
 * is a contract read — there is no database behind it, so there is nothing
 * Notch could quietly edit. Reads are cached briefly to stay polite to
 * StudioNet; a failed read is said out loud rather than rendered as zero.
 */
export const revalidate = 60;

const DEMO_SELLER = process.env.NOTCH_DEMO_SELLER ?? "";

function fmtGen(atto: string): string {
  // Floor, never round: a slashed bond must read as dented, and a display
  // that rounds 0.99999999999875 back up to 1.0000 is a small lie.
  const v = Number(BigInt(atto)) / 1e18;
  const floored = Math.floor(v * 10000) / 10000;
  return floored.toFixed(4);
}

export default async function Console() {
  if (!COURT_CONFIGURED) {
    return (
      <main>
        <Nav active="console" />
        <section className="wrap section">
          <h1 className="t-heading-lg">The court is not configured.</h1>
          <p className="t-body t-body-dim" style={{ marginTop: 18 }}>
            NEXT_PUBLIC_CONTRACT_ADDRESS is empty, so there is nothing to read.
          </p>
        </section>
      </main>
    );
  }

  let stats: CourtStats | null = null;
  let config: CourtConfig | null = null;
  let seller: CourtSeller | null = null;
  let book: CourtPaymentRow[] = [];
  let readError: string | null = null;

  try {
    [stats, config] = await Promise.all([getStats(), getConfig()]);
    if (DEMO_SELLER) {
      [seller, book] = await Promise.all([
        getSeller(DEMO_SELLER),
        getPaymentsFor(DEMO_SELLER, "seller"),
      ]);
    }
  } catch (e) {
    readError = e instanceof Error ? e.message : "read failed";
  }

  return (
    <main>
      <Nav active="console" />

      <header className="wrap section" style={{ paddingTop: 36 }}>
        <p className="t-label t-label-spark">The court, read live</p>
        <h1 className="t-heading-lg" style={{ marginTop: 18, maxWidth: "16ch" }}>
          Nothing here is stored anywhere Notch could edit.
        </h1>
      </header>

      {readError ? (
        <section className="wrap section">
          <p className="t-label t-label-iris">Read failed</p>
          <p className="t-body t-body-dim" style={{ marginTop: 14 }}>
            StudioNet did not answer: <span className="t-mono breakable">{readError.slice(0, 160)}</span>.
            The chain state is unchanged — reload in a moment.
          </p>
        </section>
      ) : null}

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

      <section className="wrap section">
        <div className="split">
          <div>
            <p className="t-label">Look up a payment</p>
            <div style={{ marginTop: 18 }}>
              <Lookup />
            </div>
            <p className="t-caption" style={{ marginTop: 14 }}>
              Any payment id from an X-Payment-Response header resolves to its
              full record: terms, receipt digests, dispute, ruling.
            </p>
          </div>
          {seller ? (
            <div>
              <p className="t-label">The demo seller&rsquo;s public record</p>
              <dl className="facts" style={{ marginTop: 18 }}>
                <dt className="t-label">Key</dt>
                <dd className="t-mono breakable">{seller.seller}</dd>
                <dt className="t-label">Bond</dt>
                <dd className="t-mono">{fmtGen(seller.bond_atto)} GEN · {fmtGen(seller.reserved_atto)} reserved behind open payments</dd>
                <dt className="t-label">Record</dt>
                <dd className="t-mono">
                  {seller.receipts_upheld} upheld · {seller.receipts_broken} broken ·{" "}
                  {seller.slashed_atto} atto slashed lifetime
                </dd>
              </dl>
              <p className="t-caption" style={{ marginTop: 14 }}>
                The record follows the key. A seller who signs a false receipt
                carries the broken count on every future quote.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {book.length > 0 ? (
        <section className="wrap section section-tail">
          <p className="t-label">The book — newest first</p>
          <div style={{ marginTop: 12 }}>
            {book.map((r) => (
              <Link key={r.payment_id} href={`/console/p/${r.payment_id}`} className="book-row">
                <span className="t-mono-lg breakable">{r.payment_id}</span>
                <span className={`state st-${r.state}`}>{r.state}</span>
                <span className="t-mono">{formatUsdc(r.amount_atto)}</span>
              </Link>
            ))}
          </div>
          {config ? (
            <p className="t-caption" style={{ marginTop: 48, maxWidth: "68ch" }}>
              Rules of this court: seller bond floor {fmtGen(config.min_bond_atto)} GEN ·
              challenge bond max({config.challenge_bond_bps / 100}%, {fmtGen(config.min_challenge_bond_atto)} GEN) ·
              a false receipt slashes {config.slash_bps / 100}% of the payment ·
              windows {config.window_seconds[0]}–{config.window_seconds[1]}s ·
              a stuck dispute has a permissionless exit after {Math.round(config.dispute_terminal_seconds / 86400)}d.
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
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
