import Link from "next/link";
import { Nav } from "./components/Nav";
import { Constellation } from "./components/Constellation";

/**
 * The landing carries three ideas and nothing else: what Notch is, the one
 * ordering that makes it different, and proof that it ran. Everything with
 * detail behind it lives on its own page — the mechanism on /protocol, the
 * live record in the console.
 */

const PROOF_OPTIMISTIC = "pay_f19709fc2ada6624";
const PROOF_STRUCTURAL = "pay_7e701d83f96c545f";
const PROOF_SEMANTIC = "pay_7e69d93ff9df7a47";

export default function Home() {
  return (
    <main>
      <Nav />

      {/* ── hero ───────────────────────────────────────────────────────── */}
      <header className="wrap section" style={{ paddingTop: 36 }}>
        <div className="split" style={{ alignItems: "center" }}>
          <div>
            <p className="t-label t-label-spark">Recourse for AI agent payments</p>
            <h1 className="t-display" style={{ marginTop: 24 }}>
              Evidence fixed before the money moves.
            </h1>
            <p className="t-body t-body-dim" style={{ marginTop: 30 }}>
              x402 lets an autonomous agent pay for an API call in one shot —
              and get garbage back with no recourse. Notch holds the
              authorization instead of submitting it, and settles against
              evidence both sides fixed before they had a reason to lie.
            </p>
            <div className="row" style={{ marginTop: 36, gap: 24 }}>
              <Link href="/console" className="pill">Open the console</Link>
              <Link href="/protocol" className="ghost ghost-lit">
                How it works →
              </Link>
            </div>
          </div>
          <div style={{ minHeight: 460 }}>
            <Constellation />
          </div>
        </div>
      </header>

      {/* ── the ordering ───────────────────────────────────────────────── */}
      <section className="wrap section">
        <div className="split">
          <h2 className="t-heading-lg">
            The seller mints the tracking number as a condition of being paid.
          </h2>
          <div style={{ display: "grid", gap: 30, alignSelf: "end" }}>
            <MomentLine n="01" head="Terms are hashed before payment" line="Both sides agree what counts as delivery, in advance." />
            <MomentLine n="02" head="The seller signs, or is not paid" line="A receipt from the bonded key, over the exact bytes delivered." />
            <MomentLine n="03" head="The panel reads only what was signed" line="Nothing is fetched at dispute — nothing can be edited." />
            <Link href="/protocol" className="ghost ghost-lit" style={{ fontSize: 14 }}>
              Read the protocol →
            </Link>
          </div>
        </div>
      </section>

      {/* ── two actors ─────────────────────────────────────────────────── */}
      <section className="wrap section">
        <p className="t-label t-label-spark">Two hands on the system</p>
        <div className="split" style={{ marginTop: 24, alignItems: "stretch" }}>
          <div className="panel panel-lg">
            <p className="t-label t-label-iris">The agent</p>
            <h3 className="t-heading-xs" style={{ marginTop: 12 }}>Pays headlessly.</h3>
            <p className="t-body t-body-dim" style={{ marginTop: 14, fontSize: 16 }}>
              The buyer is an autonomous agent. It reads the 402, signs an
              EIP-3009 authorization, and pays over x402 — no human in the
              loop, no wallet popup. Machine-to-machine, exactly as the rail
              intends.
            </p>
          </div>
          <div className="panel panel-lg">
            <p className="t-label t-label-iris">The human</p>
            <h3 className="t-heading-xs" style={{ marginTop: 12 }}>Disputes by hand.</h3>
            <p className="t-body t-body-dim" style={{ marginTop: 14, fontSize: 16 }}>
              When a delivery is wrong, a person steps in: connect a wallet,
              post a bond, and open a challenge inside its window. The one
              human action in an otherwise headless flow — and the only one
              that should be.
            </p>
          </div>
        </div>
      </section>

      {/* ── the proof ──────────────────────────────────────────────────── */}
      <section id="proof" className="wrap section">
        <div className="split-rev" style={{ alignItems: "start", rowGap: 48 }}>
          <div>
            <p className="t-label t-label-iris">Ruled by the panel, on-chain</p>
            <blockquote style={{ margin: "24px 0 0" }}>
              <p className="ruling-quote">
                &ldquo;The form is correct, but the topic is entirely
                unrelated to the specified subject.&rdquo;
              </p>
            </blockquote>
            <p className="t-caption" style={{ marginTop: 24, maxWidth: "44ch" }}>
              A seller signed a receipt for a fluent, well-formed delivery
              about the wrong subject — the failure no schema check can see.
              The panel caught it; the false receipt cost them bond and
              record.
            </p>
          </div>
          <div className="panel">
            <p className="t-label">Three arcs, one deployment</p>
            <div style={{ marginTop: 16 }}>
              <ProofRow id={PROOF_OPTIMISTIC} state="RELEASABLE" line="Delivered honestly — released by rule." />
              <ProofRow id={PROOF_STRUCTURAL} state="REFUND_DUE" line="Receipted garbage — ruled, slashed, refunded." />
              <ProofRow id={PROOF_SEMANTIC} state="REFUND_DUE" line="Well-formed but off-topic — only judgment could catch it." />
            </div>
            <p className="t-caption" style={{ marginTop: 20, marginBottom: 0 }}>
              These pages read the contract live.
            </p>
          </div>
        </div>
      </section>

      {/* ── footer ─────────────────────────────────────────────────────── */}
      <footer className="wrap section section-tail">
        <div className="row-b" style={{ alignItems: "end", flexWrap: "wrap", gap: 30 }}>
          <p className="t-caption" style={{ maxWidth: "52ch", margin: 0 }}>
            Testnet, deliberately — Notch holds live payment authorizations,
            and mainnet waits for review, not for a better demo.
          </p>
          <div className="row" style={{ gap: 30 }}>
            <Link href="/protocol" className="ghost">Protocol</Link>
            <Link href="/console" className="ghost">Console</Link>
            <a href="/api/demo/report" className="ghost">The live 402 ↗</a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function MomentLine({ n, head, line }: { n: string; head: string; line: string }) {
  return (
    <div>
      <p className="t-label">
        <span style={{ color: "var(--iris-lit)" }}>{n}</span>
        <span style={{ marginLeft: 14, color: "var(--bone)" }}>{head}</span>
      </p>
      <p className="t-caption" style={{ marginTop: 6, marginBottom: 0 }}>{line}</p>
    </div>
  );
}

function ProofRow({ id, state, line }: { id: string; state: string; line: string }) {
  return (
    <Link href={`/console/p/${id}`} className="proof-row">
      <div className="row-b" style={{ gap: 12, alignItems: "baseline" }}>
        <span className="t-mono breakable">{id}</span>
        <span className={`state st-${state}`}>{state}</span>
      </div>
      <p className="t-caption" style={{ marginTop: 6, marginBottom: 0 }}>{line}</p>
    </Link>
  );
}
