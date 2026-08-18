import Link from "next/link";
import { CHAIN, DEFAULT_WINDOW_SECONDS, CONTRACT_ADDRESS, CONTRACT_CONFIGURED, formatUsdc, MIN_PROTECTED_ATOMIC } from "@/lib/config";
import { Nav } from "./components/Nav";
import { Constellation } from "./components/Constellation";

/**
 * The landing page.
 *
 * It leads with the mechanism, not the court — "escrow plus an AI panel" is
 * the ecosystem's reference architecture and would read as derivative. What
 * is ours is the ordering: the evidence is fixed before anyone has a reason
 * to shade it. The proof section quotes a real ruling, by id, that the
 * console reads live off the chain.
 */

// The two arcs proven on the current deployment. These are real ids; the
// console pages behind them read the chain, not a database.
const PROOF_OPTIMISTIC = "pay_9261d354ceb85bb3";
const PROOF_DISPUTE = "pay_843a12d658f2a3cf";

export default function Home() {
  return (
    <main>
      <Nav />

      {/* ── hero: headline left, the split tally right ─────────────────── */}
      <header className="wrap section" style={{ paddingTop: 36 }}>
        <div className="split" style={{ alignItems: "center" }}>
          <div>
            <p className="t-label t-label-spark">A recourse layer for x402</p>
            <h1 className="t-display" style={{ marginTop: 24 }}>
              Evidence cut before the money moves.
            </h1>
            <p className="t-body t-body-dim" style={{ marginTop: 30 }}>
              An agent pays for an API call and gets nothing back. x402 calls its
              own settlement a push payment, irreversible once executed — and
              means it. Notch holds the payment authorization instead of
              submitting it, and settles against evidence both sides fixed
              before they had a reason to lie.
            </p>
            <div className="row" style={{ marginTop: 36, gap: 24 }}>
              <Link href="/console" className="pill">Open the console</Link>
              <a href="/api/demo/report" className="ghost ghost-lit">
                Read the live 402 ↗
              </a>
            </div>
          </div>
          <div style={{ minHeight: 460 }}>
            <Constellation />
          </div>
        </div>
      </header>

      {/* ── the problem ────────────────────────────────────────────────── */}
      <section className="wrap section">
        <div className="split">
          <h2 className="t-heading-lg">
            A digital seller must prove delivery, and structurally cannot.
          </h2>
          <div>
            <p className="t-label">The problem, precisely</p>
            <p className="t-body t-body-dim" style={{ marginTop: 18 }}>
              There is no tracking number for an API response — which is why
              SaaS chargeback rates run roughly double physical goods, and why
              merchants who fight card disputes win less than half and recover
              a tenth of the money.
            </p>
            <p className="t-body" style={{ marginTop: 18 }}>
              Notch does not adjudicate that better. It makes the seller mint
              the tracking number as a condition of being paid.
            </p>
          </div>
        </div>
      </section>

      {/* ── the three moments ──────────────────────────────────────────── */}
      <section id="protocol" className="wrap section">
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

      {/* ── the proof: a real ruling, quoted ───────────────────────────── */}
      <section id="proof" className="wrap section">
        <div className="split-rev">
          <div>
            <p className="t-label t-label-iris">Ruled by the panel, on-chain</p>
            <blockquote style={{ margin: "24px 0 0" }}>
              <p className="ruling-quote">
                &ldquo;The delivered JSON contains an apologetic short summary
                and an empty sources array, violating both requirements.&rdquo;
              </p>
            </blockquote>
            <p className="t-caption" style={{ marginTop: 24 }}>
              Verdict NOT_AS_DESCRIBED — a seller signed a receipt for a
              delivery that plainly failed the published criteria. The refund
              cost the buyer nothing, because the money had never moved; the
              false receipt cost the seller bond and record.
            </p>
          </div>
          <div>
            <p className="t-label">Both arcs, one deployment</p>
            <div style={{ marginTop: 24, display: "grid", gap: 30 }}>
              <ProofRow
                id={PROOF_OPTIMISTIC}
                state="RELEASABLE"
                line="Delivered honestly, receipted, unchallenged — released by rule, nobody's opinion involved."
              />
              <ProofRow
                id={PROOF_DISPUTE}
                state="REFUND_DUE"
                line="Delivered garbage, receipted anyway, challenged — the panel ruled, the slash landed to the atto."
              />
            </div>
            <p className="t-caption" style={{ marginTop: 30 }}>
              These pages read the contract live. Nothing on them is stored
              anywhere Notch could edit.
            </p>
          </div>
        </div>
      </section>

      {/* ── where notch engages ────────────────────────────────────────── */}
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

      {/* ── footer: the honest state of things ─────────────────────────── */}
      <footer className="wrap section section-tail">
        <p className="t-caption" style={{ maxWidth: "68ch" }}>
          Testnet, deliberately — Notch holds live payment authorizations, and
          pointing that at mainnet before the settlement path is reviewed would
          risk other people&rsquo;s money to make a demo look better. Both arcs
          above ran under real validators against the deployed contract; the
          one unexecuted step is the USDC submission on Base Sepolia, which the
          reconciler reports as an honest dry run until the settlement key is
          funded. Bonds are GEN-denominated while quotes are USDC-atomic, so
          demo slashes are exact but tiny — a rate mapping is production work,
          stated rather than hidden.
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

function ProofRow({ id, state, line }: { id: string; state: string; line: string }) {
  return (
    <Link href={`/console/p/${id}`} style={{ textDecoration: "none", display: "block" }}>
      <span className="t-mono-lg breakable">{id}</span>
      <span className={`state st-${state}`} style={{ marginLeft: 16 }}>{state}</span>
      <p className="t-caption" style={{ marginTop: 8, marginBottom: 0 }}>{line}</p>
    </Link>
  );
}
