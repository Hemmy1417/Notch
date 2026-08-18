import type { Metadata } from "next";
import { ConsoleShell } from "../../components/ConsoleShell";
import { Lookup } from "../Lookup";

export const metadata: Metadata = { title: "Verify — Notch" };

/**
 * Verification as a feature: any payment id resolves to its full on-chain
 * record. This is the page a buyer's operator lands on with an id from an
 * X-Payment-Response header in hand.
 */
export default function Verify() {
  return (
    <ConsoleShell active="verify">
      <header className="wrap section" style={{ paddingTop: 60 }}>
        <p className="t-label t-label-spark">Independent verification</p>
        <h1 className="t-heading-lg" style={{ marginTop: 18, maxWidth: "16ch" }}>
          Resolve a payment to its record.
        </h1>
        <p className="t-caption" style={{ marginTop: 14, maxWidth: "52ch" }}>
          Every Notch payment returns its id in the X-Payment-Response header.
          Paste one here to read what the chain says about it — the terms it
          was paid under, the receipt the seller signed, and any ruling.
        </p>
      </header>

      <section className="wrap section section-tail">
        <Lookup />
        <p className="t-caption" style={{ marginTop: 24, maxWidth: "52ch" }}>
          Ids look like <span className="t-mono">pay_9261d354ceb85bb3</span>.
          The record page reads the contract directly; nothing is served from
          a database Notch could edit.
        </p>
      </section>
    </ConsoleShell>
  );
}
