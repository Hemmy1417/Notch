import { describe, it, expect } from "vitest";
import { PaymentRequirementsSchema as X402Schema } from "x402/types";
import { buildProtectedQuote, quoteHashOf, paymentRequiredBody } from "@/lib/x402/quote";
import { notchTermsOf, isProtected, NotchTermsSchema } from "@/lib/x402/notch";
import { meetsFloor, MIN_PROTECTED_ATOMIC } from "@/lib/config";

const BASE = {
  resource: "https://notch.example/api/report",
  description: "A researched summary with cited sources.",
  network: "base-sepolia",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  maxAmountRequired: "2500000",
  payTo: "0x1111111111111111111111111111111111111111",
  seller: "0x1111111111111111111111111111111111111111",
  criteria:
    "The response must be a JSON object with a summary of at least 200 characters " +
    "addressing the requested topic, and at least two sources each with a url and a claim.",
  windowSeconds: 600,
};

describe("our 402 is a real x402 quote", () => {
  /**
   * THE Phase 1 property. If this fails, every downstream claim about
   * compatibility is false: a seller's existing x402 middleware would break
   * the moment they enabled Notch, and a seller whose integration breaks will
   * never enable it.
   *
   * Asserted against the x402 PACKAGE's own schema, not our restatement of it,
   * so an upgrade that changes the wire shape fails here rather than in a
   * payment path.
   */
  it("validates against the x402 package's own PaymentRequirements schema", () => {
    const quote = buildProtectedQuote(BASE);
    const parsed = X402Schema.safeParse(quote);
    if (!parsed.success) {
      throw new Error(
        `our quote is not valid x402: ${JSON.stringify(parsed.error.issues, null, 2)}`,
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("emits the v1 wire shape the shipped clients actually speak", () => {
    const quote = buildProtectedQuote(BASE);
    // v1 names these fields; the spec repo's v2 renames them. Building to v2
    // before the clients ship it would produce a quote nobody can pay.
    expect(quote).toHaveProperty("maxAmountRequired");
    expect(quote).not.toHaveProperty("amount");
    expect(typeof quote.resource).toBe("string");
    expect(quote.scheme).toBe("exact");
  });

  it("wraps into a 402 body a client can read", () => {
    const body = paymentRequiredBody([buildProtectedQuote(BASE)]);
    expect(body.x402Version).toBe(1);
    expect(Array.isArray(body.accepts)).toBe(true);
    expect(body.accepts).toHaveLength(1);
  });
});

describe("the Notch terms ride in extra without disturbing x402", () => {
  it("puts everything in `extra`, which the spec leaves open", () => {
    const quote = buildProtectedQuote(BASE);
    const terms = notchTermsOf(quote.extra);
    expect(terms).not.toBeNull();
    expect(terms!.notch).toBe(1);
    expect(terms!.receiptRequired).toBe(true);
    expect(terms!.criteria).toBe(BASE.criteria);
  });

  /**
   * A client that has never heard of Notch must be able to pay. Strip `extra`
   * and the quote has to remain valid x402 — that is what "additive" means.
   */
  it("remains a valid quote with `extra` removed entirely", () => {
    const withoutNotch: Record<string, unknown> = { ...buildProtectedQuote(BASE) };
    delete withoutNotch.extra;
    expect(X402Schema.safeParse(withoutNotch).success).toBe(true);
    // Nothing Notch-shaped survives the strip — the object is a plain quote.
    expect("extra" in withoutNotch).toBe(false);
    expect(isProtected(undefined)).toBe(false);
  });

  it("treats a quote with no extra as unprotected rather than broken", () => {
    expect(isProtected(undefined)).toBe(false);
    expect(isProtected({})).toBe(false);
    expect(notchTermsOf({ notch: 1 })).toBeNull(); // partial terms are not terms
  });
});

describe("the quote hash binds what was promised", () => {
  it("is stable for identical terms", () => {
    expect(quoteHashOf(BASE)).toBe(quoteHashOf(BASE));
  });

  /**
   * Every field below changes what was promised or what it costs. If any one
   * of them could move without changing the hash, a seller could sign a
   * receipt naming terms the buyer never agreed to.
   */
  it("changes when any promised term changes", () => {
    const base = quoteHashOf(BASE);
    const mutations: Array<[string, Partial<typeof BASE>]> = [
      ["price", { maxAmountRequired: "2500001" }],
      ["criteria", { criteria: BASE.criteria + " Also anything goes." }],
      ["window", { windowSeconds: 601 }],
      ["seller", { seller: "0x2222222222222222222222222222222222222222" }],
      ["payTo", { payTo: "0x2222222222222222222222222222222222222222" }],
      ["asset", { asset: "0x0000000000000000000000000000000000000002" }],
      ["network", { network: "base" }],
      ["resource", { resource: "https://notch.example/api/other" }],
    ];
    for (const [name, patch] of mutations) {
      expect(quoteHashOf({ ...BASE, ...patch }), `${name} did not move the hash`)
        .not.toBe(base);
    }
  });

  it("is carried inside the terms, so a receipt can name them", () => {
    const quote = buildProtectedQuote(BASE);
    expect(notchTermsOf(quote.extra)!.quoteHash).toBe(quoteHashOf(BASE));
  });

  it("ignores address casing, which wallets vary freely", () => {
    expect(quoteHashOf({ ...BASE, seller: BASE.seller.toUpperCase().replace("0X", "0x") }))
      .toBe(quoteHashOf(BASE));
  });
});

describe("criteria a panel could actually apply", () => {
  it("refuses criteria too thin to adjudicate", () => {
    expect(() => buildProtectedQuote({ ...BASE, criteria: "must be good" }))
      .toThrow(/what delivery means/i);
  });

  it("refuses criteria too long to read", () => {
    expect(() => buildProtectedQuote({ ...BASE, criteria: "x".repeat(2000) }))
      .toThrow(/exceeds/i);
  });

  it("rejects a malformed seller address before it reaches a quote", () => {
    expect(() => NotchTermsSchema.parse({
      notch: 1, criteria: BASE.criteria, seller: "not-an-address",
      windowSeconds: 600, receiptRequired: true, quoteHash: "a".repeat(64),
    })).toThrow();
  });

  it("holds the window inside sane bounds", () => {
    expect(() => buildProtectedQuote({ ...BASE, windowSeconds: 5 })).toThrow();
    expect(() => buildProtectedQuote({ ...BASE, windowSeconds: 999_999 })).toThrow();
  });
});

describe("the price floor is real, and stated", () => {
  it("engages at a dollar and above", () => {
    expect(meetsFloor("1000000")).toBe(true);
    expect(meetsFloor("2500000")).toBe(true);
  });

  /**
   * The median x402 call is ~$0.028. Adjudicating one costs more than the call
   * — the trap card chargebacks fell into, where settling an $84 dispute costs
   * $315. Naming our own floor is a credibility move, so it must be enforced
   * rather than merely documented.
   */
  it("declines below it", () => {
    expect(meetsFloor("28000")).toBe(false);   // the median call
    expect(meetsFloor("999999")).toBe(false);  // just under
    expect(meetsFloor("0")).toBe(false);
  });

  it("treats a malformed amount as below the floor", () => {
    expect(meetsFloor("not-a-number")).toBe(false);
    expect(meetsFloor("")).toBe(false);
  });

  it("states the floor as one dollar at six decimals", () => {
    expect(MIN_PROTECTED_ATOMIC).toBe(BigInt(1_000_000));
  });
});
