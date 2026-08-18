import type { Metadata } from "next";
import Link from "next/link";
import { ConsoleShell } from "../../../components/ConsoleShell";
import { Hash } from "../../../components/Hash";
import { ChallengePanel } from "../../../components/ChallengePanel";
import { formatUsdc } from "@/lib/config";
import { ago, isoUtc, fmtGen } from "@/lib/fmt";
import {
  getPaymentCached, getQuote,
  type CourtPayment, type CourtQuote,
} from "@/lib/server/court";

/**
 * One payment's record, curated: the state and its meaning up top, compact
 * facts with truncated copy-to-clipboard hashes, the terms behind a fold,
 * and the ruling — the product — featured. Everything is a live chain read.
 */
export const revalidate = 30;

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id} — Notch` };
}

type Dispute = {
  challenger: string; claim: string; bond_atto: string;
  filed_at: number; terminal_at: number;
};

// The challenge bond the contract will demand: max(10% of the payment, 0.1 GEN).
// Computed here so the panel shows the exact figure the write must carry.
// BigInt() call form, not literals — Next resets tsconfig target to ES2017.
const MIN_CHALLENGE_BOND = BigInt("100000000000000000"); // 0.1 GEN
function challengeBondAtto(amountAtto: string): string {
  let pct: bigint;
  try {
    pct = (BigInt(amountAtto) * BigInt(1000)) / BigInt(10000);
  } catch {
    pct = BigInt(0);
  }
  return (pct > MIN_CHALLENGE_BOND ? pct : MIN_CHALLENGE_BOND).toString();
}

const STATE_LINE: Record<string, string> = {
  AWAITING_RECEIPT: "Recorded; the seller has not yet anchored a receipt. No receipt, no release.",
  WINDOW: "Receipted and inside the challenge window. Unchallenged, it releases automatically.",
  DISPUTED: "Challenged, bond posted. The panel reads only bytes matching the seller's signed digest.",
  RELEASABLE: "Released by rule. The facilitator may submit the held authorization.",
  REFUND_DUE: "Refund by expiry: the authorization will never be submitted. The buyer's money never moved.",
  SETTLED: "Settled on the rail; the reference below is the rail's own record.",
  REFUNDED: "Closed. The authorization expired unsubmitted — the refund cost nothing and touched nothing.",
};

export default async function PaymentRecord({ params }: Params) {
  const { id } = await params;

  let p: CourtPayment | null = null;
  let q: CourtQuote | null = null;
  let readError: string | null = null;
  try {
    p = await getPaymentCached(id);
    if (p) q = await getQuote(p.quote_hash);
  } catch (e) {
    readError = e instanceof Error ? e.message : "read failed";
  }

  if (readError) {
    return (
      <Shell id={id}>
        <h1 className="t-heading-lg">The read failed.</h1>
        <p className="t-body t-body-dim" style={{ marginTop: 18 }}>
          StudioNet did not answer:{" "}
          <span className="t-mono breakable">{readError.slice(0, 160)}</span>.
          The chain state is unchanged — reload in a moment.
        </p>
      </Shell>
    );
  }

  if (!p) {
    return (
      <Shell id={id}>
        <h1 className="t-heading-lg">No payment with this id.</h1>
        <p className="t-body t-body-dim" style={{ marginTop: 18 }}>
          <span className="t-mono">{id}</span> is not on the court. Payments
          appear once the facilitator records a hold.
        </p>
      </Shell>
    );
  }

  const d = p.dispute as Dispute | null;
  const lastTouch =
    p.ruling?.ruled_at || d?.filed_at || p.receipt?.submitted_at || 0;

  return (
    <Shell id={id}>
      {/* header: state, meaning, size, recency */}
      <div className="row" style={{ gap: 20, flexWrap: "wrap", alignItems: "baseline" }}>
        <h1 className="t-heading-lg breakable" style={{ margin: 0 }}>{p.payment_id}</h1>
      </div>
      <div className="row" style={{ marginTop: 20, gap: 20, flexWrap: "wrap" }}>
        <span className={`state st-${p.state}`} style={{ fontSize: 14 }}>{p.state}</span>
        <span className="t-mono-lg">{formatUsdc(p.amount_atto)}</span>
        {lastTouch ? (
          <span className="t-caption" title={isoUtc(lastTouch)}>{ago(lastTouch)}</span>
        ) : null}
      </div>
      <p className="t-body t-body-dim" style={{ marginTop: 16 }}>
        {STATE_LINE[p.state] ?? ""}
      </p>

      {/* the one human action: a bonded challenge, only while the window is open */}
      {p.state === "WINDOW" ? (
        <ChallengePanel
          paymentId={p.payment_id}
          buyer={p.buyer}
          bondAtto={challengeBondAtto(p.amount_atto)}
          windowEndsEpoch={p.window_ends}
        />
      ) : null}

      {/* the ruling first when there is one — it is the product */}
      {p.ruling && d ? (
        <section className="section" style={{ paddingTop: 72 }}>
          <div className="split-rev">
            <div>
              <p className="t-label t-label-spark">The ruling</p>
              <p className={`state st-${p.state}`} style={{ marginTop: 16, fontSize: 15 }}>
                {p.ruling.verdict}
              </p>
              <blockquote style={{ margin: "18px 0 0" }}>
                <p className="ruling-quote" style={{ fontSize: "clamp(20px, 2.2vw, 27px)" }}>
                  &ldquo;{p.ruling.reason}&rdquo;
                </p>
              </blockquote>
              <p className="t-caption" style={{ marginTop: 18 }} title={isoUtc(p.ruling.ruled_at)}>
                Ruled {ago(p.ruling.ruled_at)} by validator consensus.
                Confidence is advisory — only the verdict moves money.
              </p>
            </div>
            <div style={{ alignSelf: "center" }}>
              <p className="t-label t-label-iris">The challenge</p>
              <p className="t-body t-body-dim" style={{ marginTop: 14, fontSize: 16 }}>
                {d.claim}
              </p>
              <dl className="facts" style={{ marginTop: 24 }}>
                <dt className="t-label">Challenger</dt>
                <dd><Hash value={d.challenger} /></dd>
                <dt className="t-label">Bond</dt>
                <dd className="t-mono">{fmtGen(d.bond_atto)} GEN</dd>
              </dl>
            </div>
          </div>
        </section>
      ) : d ? (
        <section className="section" style={{ paddingTop: 72 }}>
          <p className="t-label t-label-iris">The challenge — awaiting adjudication</p>
          <p className="t-body t-body-dim" style={{ marginTop: 14, maxWidth: "52ch" }}>
            {d.claim}
          </p>
          <p className="t-caption" style={{ marginTop: 16, maxWidth: "52ch" }}>
            Anyone may submit the delivered bytes for judgment — the contract
            verifies them against the seller&rsquo;s digest before any panel
            is consulted.
          </p>
        </section>
      ) : null}

      {/* the record: compact facts */}
      <section className="section" style={{ paddingTop: 72 }}>
        <div className="split">
          <div>
            <p className="t-label">Parties &amp; terms</p>
            <dl className="facts" style={{ marginTop: 18 }}>
              <dt className="t-label">Seller</dt>
              <dd><Hash value={p.seller} /></dd>
              <dt className="t-label">Buyer</dt>
              <dd><Hash value={p.buyer} /></dd>
              <dt className="t-label">Quote</dt>
              <dd><Hash value={p.quote_hash} /></dd>
              <dt className="t-label">Window ends</dt>
              <dd className="t-mono" title={isoUtc(p.window_ends)}>{ago(p.window_ends)}</dd>
              {p.settle_ref ? (
                <>
                  <dt className="t-label">Settle ref</dt>
                  <dd><Hash value={p.settle_ref} /></dd>
                </>
              ) : null}
            </dl>
          </div>
          {p.receipt ? (
            <div>
              <p className="t-label">The seller&rsquo;s receipt</p>
              <dl className="facts" style={{ marginTop: 18 }}>
                <dt className="t-label">Body digest</dt>
                <dd><Hash value={p.receipt.body_sha256} /></dd>
                <dt className="t-label">Excerpt digest</dt>
                <dd><Hash value={p.receipt.excerpt_sha256} /></dd>
                <dt className="t-label">Anchored</dt>
                <dd className="t-mono" title={isoUtc(p.receipt.submitted_at)}>{ago(p.receipt.submitted_at)}</dd>
              </dl>
              <p className="t-caption" style={{ marginTop: 16, maxWidth: "44ch" }}>
                A panel may only read bytes hashing to the excerpt digest — the
                seller&rsquo;s own signature decides what is admissible.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {/* the terms, behind a fold */}
      {q ? (
        <section className="section" style={{ paddingTop: 60 }}>
          <details className="fold">
            <summary>What counted as delivery — the terms, verbatim</summary>
            <p className="prose-block" style={{ marginTop: 24 }}>{q.criteria}</p>
            <p className="t-caption" style={{ marginTop: 16 }}>
              Fixed and hashed before payment; the quote hash above commits to
              exactly this text.
            </p>
          </details>
        </section>
      ) : null}

      <p className="section section-tail" style={{ paddingTop: 60 }}>
        <Link href="/console/payments" className="ghost ghost-lit">← All payments</Link>
      </p>
    </Shell>
  );
}

function Shell({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <ConsoleShell>
      <div className="wrap section" style={{ paddingTop: 48 }}>
        <div className="crumb" style={{ marginBottom: 36 }}>
          <Link href="/console">Console</Link>
          <span className="sep">/</span>
          <Link href="/console/payments">Payments</Link>
          <span className="sep">/</span>
          <span className="here">{id}</span>
        </div>
        {children}
      </div>
    </ConsoleShell>
  );
}
