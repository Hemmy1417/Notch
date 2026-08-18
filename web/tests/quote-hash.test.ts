import { describe, it, expect } from "vitest";
import { quoteHash, canonicalQuote } from "@/lib/x402/quote-hash";

/**
 * TS/Python parity, pinned by fixed vectors.
 *
 * The expected hashes below were computed by running the CONTRACT'S OWN
 * _quote_hash code in Python — not by this implementation agreeing with
 * itself. If canonicalization drifts by one byte (key order, escaping,
 * ensure_ascii, separators), these fail and every payment would have been
 * unrecordable on-chain.
 */

describe("quote hash parity with the contract", () => {
  it("plain ASCII", () => {
    expect(quoteHash({
      seller: "0xAbC1111111111111111111111111111111111111",
      criteria: "Respond with valid JSON containing at least ten European capital cities.",
      windowSeconds: 600,
      amountAtto: "1000000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    })).toBe("3702eb3c2574d160183857dbf942377faa3af655387870e07600bfe0faf62bd7");
  });

  it("quotes, backslashes and control characters", () => {
    expect(quoteHash({
      seller: "0x2222222222222222222222222222222222222222",
      criteria: "Deliver a \"signed\" report with C:\\paths and a\nnewline plus a tab\t.",
      windowSeconds: 3600,
      amountAtto: "250000",
      asset: "0x036CBD53842C5426634E7929541EC2318F3DCF7E",
    })).toBe("4613437f316b660609fc22a8d2ec1c78151888daacc633eba448987c78036e40");
  });

  it("non-ASCII (ensure_ascii escaping, astral emoji surrogate pairs)", () => {
    expect(quoteHash({
      seller: "0x3333333333333333333333333333333333333333",
      criteria: "Criteria with dash — and fences ‹‹‹ and emoji 🜃 inside.",
      windowSeconds: 86400,
      amountAtto: "999999999999999999",
      asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    })).toBe("0761491007db51a374a20449f221b4a2d565524f8c5ac60cd860816fd67d22f6");
  });

  it("normalizes address case the way the contract does", () => {
    const a = quoteHash({
      seller: "0xABC1111111111111111111111111111111111111",
      criteria: "same terms",
      windowSeconds: 60,
      amountAtto: "1",
      asset: "0x036CBD53842C5426634E7929541EC2318F3DCF7E",
    });
    const b = quoteHash({
      seller: "0xabc1111111111111111111111111111111111111",
      criteria: "same terms",
      windowSeconds: 60,
      amountAtto: "1",
      asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    });
    expect(a).toBe(b);
  });

  it("criteria case is NOT normalized — the words are the terms", () => {
    const a = quoteHash({ seller: "0x" + "11".repeat(20), criteria: "Deliver JSON",
                          windowSeconds: 60, amountAtto: "1", asset: "0x" + "22".repeat(20) });
    const b = quoteHash({ seller: "0x" + "11".repeat(20), criteria: "deliver json",
                          windowSeconds: 60, amountAtto: "1", asset: "0x" + "22".repeat(20) });
    expect(a).not.toBe(b);
  });

  it("canonical form is stable and key-sorted", () => {
    const canon = canonicalQuote({
      seller: "0x" + "11".repeat(20), criteria: "x".repeat(20),
      windowSeconds: 60, amountAtto: "5", asset: "0x" + "22".repeat(20),
    });
    const keys = [...canon.matchAll(/"(\w+)":/g)].map((m) => m[1]);
    expect(keys).toEqual(["amountAtto", "asset", "criteria", "seller", "windowSeconds"]);
  });
});
