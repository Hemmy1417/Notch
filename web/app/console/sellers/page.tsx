import type { Metadata } from "next";
import { ConsoleShell } from "../../components/ConsoleShell";
import { Hash } from "../../components/Hash";
import { fmtGen } from "@/lib/fmt";
import { COURT_CONFIGURED, getSeller, type CourtSeller } from "@/lib/server/court";

export const metadata: Metadata = { title: "Sellers — Notch" };
export const revalidate = 60;

const DEMO_SELLER = process.env.NOTCH_DEMO_SELLER ?? "";

/**
 * The registry: the public record that follows a bonded key. A seller who
 * signs a false receipt carries the broken count on every future quote —
 * that number is the product.
 */
export default async function Sellers() {
  let seller: CourtSeller | null = null;
  let readError: string | null = null;

  if (COURT_CONFIGURED && DEMO_SELLER) {
    try {
      seller = await getSeller(DEMO_SELLER);
    } catch (e) {
      readError = e instanceof Error ? e.message : "read failed";
    }
  }

  return (
    <ConsoleShell active="sellers">
      <header className="wrap section" style={{ paddingTop: 60 }}>
        <p className="t-label t-label-spark">The registry</p>
        <h1 className="t-heading-lg" style={{ marginTop: 18 }}>Sellers</h1>
        <p className="t-caption" style={{ marginTop: 14, maxWidth: "52ch" }}>
          Identity on Notch is a bonded key. The bond answers for false
          receipts; the record follows the key forever.
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

      {seller ? (
        <section className="wrap section section-tail">
          <div className="split">
            <div>
              <p className="t-label">Bonded key</p>
              <p style={{ marginTop: 10 }}>
                <Hash value={seller.seller} head={12} tail={8} />
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                  gap: 36,
                  marginTop: 48,
                }}
              >
                <Stat n={fmtGen(seller.bond_atto)} label="GEN bonded" />
                <Stat n={fmtGen(seller.reserved_atto)} label="Reserved" />
                <Stat n={seller.receipts_upheld} label="Upheld" />
                <Stat n={seller.receipts_broken} label="Broken" lit={seller.receipts_broken > 0} />
              </div>
            </div>
            <div style={{ alignSelf: "end" }}>
              <p className="t-label">How to read this</p>
              <p className="t-body t-body-dim" style={{ marginTop: 14 }}>
                The bond is what the key stands to lose; the reserve is the
                slice standing behind payments still open. Upheld and broken
                count rulings — a broken receipt means the panel found the
                seller signed for a delivery that failed the terms
                {seller.slashed_atto !== "0"
                  ? `, and ${seller.slashed_atto} atto GEN has been slashed from this key`
                  : ""}
                . Buyers&rsquo; agents can read this before paying.
              </p>
            </div>
          </div>
        </section>
      ) : !readError ? (
        <section className="wrap section">
          <p className="t-body t-body-dim">No sellers registered yet.</p>
        </section>
      ) : null}
    </ConsoleShell>
  );
}

function Stat({ n, label, lit }: { n: number | string; label: string; lit?: boolean }) {
  return (
    <div>
      <p className="t-figure" style={{ margin: 0, fontSize: "clamp(32px, 3.4vw, 48px)", color: lit ? "var(--iris-lit)" : undefined }}>
        {n}
      </p>
      <p className="t-label" style={{ marginTop: 8 }}>{label}</p>
    </div>
  );
}
