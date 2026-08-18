import { CHAIN, DEFAULT_WINDOW_SECONDS, CONTRACT_CONFIGURED, formatUsdc, MIN_PROTECTED_ATOMIC } from "@/lib/config";

/**
 * The landing page.
 *
 * It leads with the mechanism, not the court — "escrow plus an AI panel" is
 * the ecosystem's reference architecture as of July 2026 and would read as
 * derivative. What is ours is the ordering: the evidence is fixed before
 * anyone has a reason to shade it.
 */
export default function Home() {
  return (
    <main>
      <header style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="wrap row-b" style={{ height: 62 }}>
          <span className="row" style={{ gap: 10 }}>
            <Mark />
            <span className="t-mono" style={{ fontSize: 14, letterSpacing: ".06em", color: "#fff" }}>
              NOTCH
            </span>
          </span>
          <span className="t-label">{CHAIN.network}</span>
        </div>
      </header>

      <section className="wrap" style={{ padding: "76px 20px 56px" }}>
        <p className="t-label t-label-lit">A recourse layer for x402</p>
        <h1 className="t-hero" style={{ margin: "16px 0 0", maxWidth: "17ch" }}>
          Evidence cut before the money moves
        </h1>
        <p className="t-lede" style={{ marginTop: 20 }}>
          An agent pays for an API call and gets nothing back. Today there is no
          recourse — x402 calls its own settlement{" "}
          <em style={{ color: "var(--ink)" }}>&ldquo;a push payment, irreversible once
          executed&rdquo;</em>, and Google&rsquo;s AP2 puts dispute resolution
          explicitly out of scope.
        </p>
        <p className="t-lede" style={{ marginTop: 14 }}>
          Notch holds the payment authorization instead of submitting it, and
          settles it against evidence that was fixed before anyone had a reason
          to lie about it.
        </p>
      </section>

      <section className="wrap" style={{ paddingBottom: 56 }}>
        <div className="record">
          <p className="t-label">The problem, precisely</p>
          <p className="record-prose" style={{ marginTop: 12 }}>
            A digital seller must prove delivery and structurally cannot. There
            is no tracking number for an API response — which is why SaaS
            chargeback rates run roughly double physical goods, and why
            merchants who fight card disputes win 44.6% of them yet recover only
            10.7% of the money.
          </p>
          <p className="record-prose" style={{ marginTop: 14 }}>
            Notch does not adjudicate that better. It makes the seller mint the
            tracking number as a condition of being paid.
          </p>
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 64 }}>
        <h2 className="t-title notch">Three moments, and the order is the point</h2>
        <div className="stack" style={{ marginTop: 24 }}>
          <Step
            when="At the quote"
            what="Before any money moves"
            body="The 402 carries what counts as delivery, in prose, plus the seller's bonded key and the challenge window. Notch hashes it. The buyer's agent reads it before signing — so both sides agreed what would count as proof, in advance."
          />
          <Step
            when="At delivery"
            what="The seller signs, the buyer keeps"
            body="The seller returns a receipt signed with the key that holds their bond: which quote it fulfils, and digests of what was delivered. No receipt, no release. The buyer's client verifies it the instant it arrives."
          />
          <Step
            when="At dispute"
            what="Nothing is fetched"
            body="Whoever files submits the receipt. The contract checks the signature and the digest. There is no endpoint to read, so there is nothing to edit and no server that can be conveniently unavailable."
          />
        </div>
      </section>

      <section className="wrap" style={{ paddingBottom: 72 }}>
        <div className="panel">
          <div className="panel-head">
            <span className="t-label">Where Notch engages</span>
            <span className="state state-held">testnet</span>
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "minmax(140px,auto) 1fr", gap: "10px 22px", margin: 0 }}>
            <dt className="t-label">Floor</dt>
            <dd className="t-mono" style={{ margin: 0, color: "var(--ink)" }}>
              {formatUsdc(MIN_PROTECTED_ATOMIC.toString())} — below this a quote is served
              unprotected, exactly as x402 works today
            </dd>
            <dt className="t-label">Window</dt>
            <dd className="t-mono" style={{ margin: 0, color: "var(--ink)" }}>
              {DEFAULT_WINDOW_SECONDS}s to challenge, then release is automatic
            </dd>
            <dt className="t-label">Asset</dt>
            <dd className="t-mono breakable" style={{ margin: 0, color: "var(--ink)" }}>
              USDC · {CHAIN.asset}
            </dd>
            <dt className="t-label">Court</dt>
            <dd className="t-mono" style={{ margin: 0, color: CONTRACT_CONFIGURED ? "var(--ink)" : "var(--ink-3)" }}>
              {CONTRACT_CONFIGURED ? "GenLayer, configured" : "not deployed yet — Phase 2"}
            </dd>
          </dl>
          <p className="t-small" style={{ marginTop: 16, marginBottom: 0 }}>
            The median x402 call is about three cents. Adjudicating one would cost
            more than the call — the trap card disputes fell into, where settling
            an $84 dispute costs $315. Notch names its own floor rather than
            pretending to serve every payment.
          </p>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid var(--line)" }}>
        <div className="wrap" style={{ padding: "22px 20px 40px" }}>
          <p className="t-small" style={{ margin: 0 }}>
            Phase 1. The 402 above is real and its terms are final — a genuine
            x402 client can read and pay it. Holding authorizations, the court,
            and disputes are not built yet, and nothing here claims otherwise.
          </p>
        </div>
      </footer>
    </main>
  );
}

function Step({ when, what, body }: { when: string; what: string; body: string }) {
  return (
    <div className="panel">
      <div className="row" style={{ gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
        <span className="t-label t-label-lit" style={{ minWidth: 96 }}>{when}</span>
        <span className="t-mono" style={{ color: "#fff", fontSize: 14 }}>{what}</span>
      </div>
      <p className="t-body" style={{ margin: "10px 0 0", maxWidth: "72ch" }}>{body}</p>
    </div>
  );
}

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden style={{ flexShrink: 0 }}>
      <rect width="32" height="32" rx="6" fill="var(--raised)" />
      <rect x="9" y="5" width="5.5" height="22" rx="1.4" fill="var(--bone)" />
      <rect x="17.5" y="5" width="5.5" height="22" rx="1.4" fill="var(--ink-2)" />
      <path d="M9 15.2 L14.5 12.4 L14.5 17.6 Z" fill="var(--copper)" />
      <path d="M23 15.2 L17.5 12.4 L17.5 17.6 Z" fill="var(--copper)" />
    </svg>
  );
}
