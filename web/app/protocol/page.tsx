import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "../components/Nav";
import { CHAIN, DEFAULT_WINDOW_SECONDS, CONTRACT_ADDRESS, CONTRACT_CONFIGURED, formatUsdc, MIN_PROTECTED_ATOMIC } from "@/lib/config";

export const metadata: Metadata = {
  title: "Protocol — Notch",
  description:
    "How Notch works: terms hashed before payment, seller-signed receipts, " +
    "and disputes judged against evidence nobody could edit afterwards.",
};

/**
 * The mechanism, in full. This page owns the detail the landing refuses to
 * carry: the problem, the three moments, the boundaries, the trust model.
 */
export default function Protocol() {
  return (
    <main>
      <Nav active="protocol" />

      <header className="wrap section" style={{ paddingTop: 36 }}>
        <p className="t-label t-label-spark">Protocol</p>
        <h1 className="t-heading-lg" style={{ marginTop: 18, maxWidth: "18ch" }}>
          A digital seller must prove delivery, and structurally cannot.
        </h1>
        <p className="t-body t-body-dim" style={{ marginTop: 24 }}>
          There is no tracking number for an API response — which is why SaaS
          chargeback rates run roughly double physical goods, and why merchants
          who fight card disputes win less than half and recover a tenth of the
          money. Notch does not adjudicate that better. It makes the seller
          mint the tracking number as a condition of being paid.
        </p>
      </header>

      {/* the hold */}
      <section className="wrap section">
        <div className="split">
          <h2 className="t-heading">The hold: escrow without custody.</h2>
          <p className="t-body t-body-dim" style={{ alignSelf: "end" }}>
            An x402 payment is a signed authorization the seller&rsquo;s side
            submits to the chain. Notch&rsquo;s facilitator verifies it and
            then holds it instead of submitting. Release is submission; refund
            is the absence of one — the authorization simply expires, and the
            buyer&rsquo;s money never moved. No escrow account exists to hack
            or freeze. This inherits x402&rsquo;s own facilitator trust
            profile: it can withhold, it cannot steal.
          </p>
        </div>
      </section>

      {/* the three moments, full */}
      <section className="wrap section">
        <p className="t-label t-label-spark">Three moments, and the order is the point</p>
        <div style={{ display: "grid", gap: 60, marginTop: 48 }}>
          <Moment
            n="01"
            when="At the quote"
            head="Terms are hashed before any money moves."
            body="The 402 carries what counts as delivery, in prose, plus the seller's bonded key and the challenge window. Notch hashes it and the hash is registered on the court. The buyer's agent reads it before signing — both sides agreed what would count as proof, in advance."
          />
          <Moment
            n="02"
            when="At delivery"
            head="The seller signs, or the seller is not paid."
            body="The seller returns a receipt signed with the key that holds their bond: which quote it fulfils, and digests of exactly what was delivered. No receipt, no release. The signature is evidence the seller cannot take back."
          />
          <Moment
            n="03"
            when="At dispute"
            head="The panel reads only what the seller vouched for."
            body="Whoever files submits the bytes. The contract checks them against the seller's own signed digest before any judgment runs — there is no endpoint to fetch, so there is nothing to edit and no server that can be conveniently unavailable. A false receipt costs the seller half the payment from their bond, on their public record."
          />
        </div>
      </section>

      {/* boundaries */}
      <section className="wrap section">
        <div className="split">
          <h2 className="t-heading">
            Notch names its own floor rather than pretending to serve every payment.
          </h2>
          <div>
            <dl className="facts">
              <dt className="t-label">Floor</dt>
              <dd className="t-mono">
                {formatUsdc(MIN_PROTECTED_ATOMIC.toString())} — below this a quote is
                served unprotected, exactly as x402 works today
              </dd>
              <dt className="t-label">Window</dt>
              <dd className="t-mono">{DEFAULT_WINDOW_SECONDS}s to challenge, then release is automatic</dd>
              <dt className="t-label">Asset</dt>
              <dd className="t-mono breakable">USDC · {CHAIN.asset}</dd>
              <dt className="t-label">Court</dt>
              <dd className="t-mono breakable">
                {CONTRACT_CONFIGURED ? `GenLayer StudioNet · ${CONTRACT_ADDRESS}` : "not configured"}
              </dd>
            </dl>
            <p className="t-caption" style={{ marginTop: 30 }}>
              The median x402 call is about three cents. Adjudicating one would
              cost more than the call — the trap card disputes fell into, where
              settling an $84 dispute costs $315.
            </p>
          </div>
        </div>
      </section>

      {/* trust model */}
      <section className="wrap section">
        <div className="split">
          <h2 className="t-heading">What the operator can never do.</h2>
          <p className="t-body t-body-dim" style={{ alignSelf: "end" }}>
            The operator records payments and settlement outcomes, because it
            is the party holding the authorizations. It cannot touch a bond,
            decide a dispute, shorten a window, or release a payment the rules
            say is blocked — every decision that moves value is either
            deterministic code or validator consensus, on a record both
            parties contributed to before they disagreed. This is pinned by
            tests and a mutation sweep, not by promise.
          </p>
        </div>
      </section>

      {/* honesty */}
      <footer className="wrap section section-tail">
        <p className="t-label">Stated, not hidden</p>
        <p className="t-caption" style={{ marginTop: 14, maxWidth: "68ch" }}>
          Testnet only — Notch holds live payment authorizations, and pointing
          that at mainnet before the settlement path is reviewed would risk
          other people&rsquo;s money to make a demo look better. The one
          unexecuted step is the USDC submission on Base Sepolia, which the
          reconciler reports as an honest dry run until the settlement key is
          funded. Bonds are GEN-denominated while quotes are USDC-atomic, so
          demo slashes are exact but tiny — a rate mapping is production work.
          A buyer can drain their wallet during the window; that is seller
          risk, and it argues for short windows.
        </p>
        <p style={{ marginTop: 30 }}>
          <Link href="/console" className="ghost ghost-lit">See it live in the console →</Link>
        </p>
      </footer>
    </main>
  );
}

function Moment({ n, when, head, body }: { n: string; when: string; head: string; body: string }) {
  return (
    <div className="split">
      <div>
        <p className="t-label">
          <span style={{ color: "var(--iris-lit)" }}>{n}</span>
          <span style={{ marginLeft: 14 }}>{when}</span>
        </p>
        <h3 className="t-heading" style={{ marginTop: 14 }}>{head}</h3>
      </div>
      <p className="t-body t-body-dim" style={{ alignSelf: "end" }}>{body}</p>
    </div>
  );
}
