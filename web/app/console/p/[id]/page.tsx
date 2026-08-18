import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "../../../components/Nav";
import { formatUsdc } from "@/lib/config";
import {
  getPayment, getQuote,
  type CourtPayment, type CourtQuote,
} from "@/lib/server/court";

/**
 * One payment's full record, read live: the terms it was paid under, the
 * digests the seller signed for, the dispute if one was filed, and the
 * ruling with its reasoning. The page renders what the chain says and
 * nothing else.
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

const STATE_LINE: Record<string, string> = {
  AWAITING_RECEIPT: "Recorded on the court; the seller has not yet anchored a receipt. No receipt, no release.",
  WINDOW: "Receipted and inside the challenge window. If nobody challenges, release is automatic.",
  DISPUTED: "Challenged, bond posted. The panel will read only bytes that hash to the seller's signed digest.",
  RELEASABLE: "Released by rule. The facilitator may submit the held authorization.",
  REFUND_DUE: "Refund by expiry: the authorization will never be submitted. The buyer's money never moved.",
  SETTLED: "Settled on the rail; the reference below is the rail's own record.",
  REFUNDED: "Closed. The authorization expired unsubmitted — the refund cost nothing and touched nothing.",
};

function epoch(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toISOString().replace(".000Z", "Z");
}

export default async function PaymentRecord({ params }: Params) {
  const { id } = await params;

  let p: CourtPayment | null = null;
  let q: CourtQuote | null = null;
  let readError: string | null = null;
  try {
    p = await getPayment(id);
    if (p) q = await getQuote(p.quote_hash);
  } catch (e) {
    readError = e instanceof Error ? e.message : "read failed";
  }

  if (readError) {
    return (
      <Shell>
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
      <Shell>
        <h1 className="t-heading-lg">No payment with this id.</h1>
        <p className="t-body t-body-dim" style={{ marginTop: 18 }}>
          <span className="t-mono">{id}</span> is not on the court. Payments
          appear here once the facilitator records the hold.
        </p>
        <p style={{ marginTop: 30 }}>
          <Link href="/console" className="ghost ghost-lit">← Back to the console</Link>
        </p>
      </Shell>
    );
  }

  const d = p.dispute as Dispute | null;

  return (
    <Shell>
      <p className="t-label">Payment record</p>
      <h1 className="t-heading-lg breakable" style={{ marginTop: 14 }}>{p.payment_id}</h1>
      <p className="row" style={{ marginTop: 24, gap: 18, flexWrap: "wrap" }}>
        <span className={`state st-${p.state}`} style={{ fontSize: 14 }}>{p.state}</span>
        <span className="t-mono">{formatUsdc(p.amount_atto)}</span>
      </p>
      <p className="t-body t-body-dim" style={{ marginTop: 16 }}>
        {STATE_LINE[p.state] ?? ""}
      </p>

      {/* parties + terms */}
      <section className="section" style={{ paddingTop: 60 }}>
        <div className="split">
          <div>
            <p className="t-label">Parties</p>
            <dl className="facts" style={{ marginTop: 18 }}>
              <dt className="t-label">Seller</dt>
              <dd className="t-mono breakable">{p.seller}</dd>
              <dt className="t-label">Buyer</dt>
              <dd className="t-mono breakable">{p.buyer}</dd>
              <dt className="t-label">Quote</dt>
              <dd className="t-mono breakable">{p.quote_hash}</dd>
              <dt className="t-label">Window ends</dt>
              <dd className="t-mono">{epoch(p.window_ends)}</dd>
              {p.settle_ref ? (
                <>
                  <dt className="t-label">Settle ref</dt>
                  <dd className="t-mono breakable">{p.settle_ref}</dd>
                </>
              ) : null}
            </dl>
          </div>
          {q ? (
            <div>
              <p className="t-label t-label-spark">What counted as delivery — fixed before payment</p>
              <p className="prose-block" style={{ marginTop: 18 }}>{q.criteria}</p>
            </div>
          ) : null}
        </div>
      </section>

      {/* receipt */}
      {p.receipt ? (
        <section className="section" style={{ paddingTop: 60 }}>
          <p className="t-label">The seller&rsquo;s receipt — anchored by their own signed write</p>
          <dl className="facts" style={{ marginTop: 18 }}>
            <dt className="t-label">Body sha256</dt>
            <dd className="t-mono breakable">{p.receipt.body_sha256}</dd>
            <dt className="t-label">Excerpt sha256</dt>
            <dd className="t-mono breakable">{p.receipt.excerpt_sha256}</dd>
            <dt className="t-label">Excerpt length</dt>
            <dd className="t-mono">{p.receipt.excerpt_len} bytes</dd>
            <dt className="t-label">Anchored</dt>
            <dd className="t-mono">{epoch(p.receipt.submitted_at)}</dd>
          </dl>
          <p className="t-caption" style={{ marginTop: 16, maxWidth: "62ch" }}>
            A dispute panel may only read bytes that hash to the excerpt digest
            above — the seller&rsquo;s own signature decides what is admissible.
          </p>
        </section>
      ) : null}

      {/* dispute + ruling */}
      {d ? (
        <section className="section" style={{ paddingTop: 60 }}>
          <div className="split">
            <div>
              <p className="t-label t-label-iris">The challenge</p>
              <p className="prose-block" style={{ marginTop: 18 }}>{d.claim}</p>
              <dl className="facts" style={{ marginTop: 24 }}>
                <dt className="t-label">Challenger</dt>
                <dd className="t-mono breakable">{d.challenger}</dd>
                <dt className="t-label">Bond</dt>
                <dd className="t-mono">{d.bond_atto} atto GEN</dd>
                <dt className="t-label">Filed</dt>
                <dd className="t-mono">{epoch(d.filed_at)}</dd>
              </dl>
              <p className="t-caption" style={{ marginTop: 16, maxWidth: "52ch" }}>
                A challenge is advocacy from an interested party, never proof.
                The panel judges the criteria against the seller-signed bytes.
              </p>
            </div>
            {p.ruling ? (
              <div>
                <p className="t-label t-label-spark">The ruling</p>
                <p className={`state st-${p.state}`} style={{ marginTop: 18, fontSize: 15 }}>
                  {p.ruling.verdict}
                </p>
                <blockquote style={{ margin: "18px 0 0" }}>
                  <p className="ruling-quote" style={{ fontSize: "clamp(19px, 2vw, 25px)" }}>
                    &ldquo;{p.ruling.reason}&rdquo;
                  </p>
                </blockquote>
                <p className="t-caption" style={{ marginTop: 18 }}>
                  Ruled {epoch(p.ruling.ruled_at)}. Confidence is advisory and
                  gates nothing — only the verdict moves money.
                </p>
              </div>
            ) : (
              <div>
                <p className="t-label">Awaiting adjudication</p>
                <p className="t-body t-body-dim" style={{ marginTop: 18 }}>
                  Anyone may submit the delivered bytes for judgment — the
                  contract verifies them against the seller&rsquo;s digest
                  before any panel is consulted.
                </p>
              </div>
            )}
          </div>
        </section>
      ) : null}

      <p className="section section-tail" style={{ paddingTop: 60 }}>
        <Link href="/console" className="ghost ghost-lit">← Back to the console</Link>
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <Nav active="console" />
      <div className="wrap section" style={{ paddingTop: 36 }}>{children}</div>
    </main>
  );
}
