/**
 * The Notch extension to x402.
 *
 * x402's `PaymentRequirements.extra` is an open `Record<string, any>` — the
 * spec's sanctioned place for scheme-adjacent data. Notch puts three things
 * there, and the ORDER THEY EXIST IN is the whole design:
 *
 *   criteria      what "delivered" means, in prose, agreed BEFORE payment
 *   receipt       proof that the seller must sign to be paid at all
 *   window        how long the buyer has to challenge before funds release
 *
 * Everything Notch claims rests on those being fixed before the buyer signs.
 * Evidence gathered after a dispute begins is evidence someone had a reason to
 * shade; this is the same lesson Visa learned with Compelling Evidence 3.0.
 *
 * Built against x402@1.2.0, which ships the v1 wire shape
 * (`maxAmountRequired`, `resource` as a string, named networks). The spec repo
 * has a v2 with different field names — do not build to it until the clients
 * ship it.
 */
import { z } from "zod";

/** Reasonable ceiling on the prose a panel will read. */
export const MAX_CRITERIA_CHARS = 1200;

/**
 * Scheme/network pairs this facilitator handles, in the v1 wire shape that
 * x402@1.2.0 actually sends — named networks, not CAIP-2 ids.
 *
 * Testnet only, deliberately. Notch holds live payment authorizations, and
 * pointing that at mainnet before the settlement path is tested and reviewed
 * would risk other people's money to make a demo look better.
 */
export const SUPPORTED_KINDS = [
  { scheme: "exact", network: "base-sepolia" },
] as const;

/**
 * Advertised on /supported, so a buyer's agent can discover BEFORE paying that
 * this facilitator holds rather than settles, requires a signed delivery
 * receipt, and runs a challenge window.
 *
 * Discovery matters more here than in a normal facilitator: an agent that does
 * not know a payment is held cannot know it has a window in which to complain.
 */
export const NOTCH_EXTENSION = {
  name: "notch",
  version: 1,
  /** What this facilitator does differently, in one line an agent can log. */
  behaviour: "holds the payment authorization until a published ruling releases it",
  requires: ["signed-delivery-receipt"],
  capabilities: ["challenge-window", "bonded-dispute", "published-criteria"],
} as const;

/**
 * The seller commits to these before the buyer pays.
 *
 * `criteria` is deliberately prose rather than a schema: the disputes worth
 * adjudicating are the ones where two careful readers can disagree about
 * whether what arrived matches what was promised. A machine-checkable schema
 * would only move the argument to whether the schema was the right one.
 */
export const NotchTermsSchema = z.object({
  /** Marks this quote as carrying Notch protection. */
  notch: z.literal(1),

  /** What counts as delivery. Read by a panel, verbatim, if it comes to that. */
  criteria: z.string().min(20).max(MAX_CRITERIA_CHARS),

  /**
   * The seller's on-chain identity — the wallet holding their bond and the key
   * their delivery receipt must be signed with. Anyone can check a receipt
   * against this without asking us.
   */
  seller: z.string().regex(/^0x[a-fA-F0-9]{40}$/),

  /**
   * Seconds the buyer has to challenge after delivery. Funds release
   * automatically when it expires — the common case costs nothing and waits
   * for nobody.
   */
  windowSeconds: z.number().int().min(60).max(86_400),

  /**
   * Whether a signed delivery receipt is required for release.
   *
   * Always true in practice, and it is the enforcement point for the whole
   * scheme: no receipt, no release. It is a field rather than a constant so a
   * quote states its own terms rather than relying on our defaults.
   */
  receiptRequired: z.literal(true),

  /** The quote's own digest, so a receipt can name which terms it fulfils. */
  quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type NotchTerms = z.infer<typeof NotchTermsSchema>;

/**
 * A delivery receipt, signed by the seller at the moment of delivery.
 *
 * This is the tally: the seller cuts the notch, the buyer keeps the stick.
 * It travels in the x402 payment response, and after that it does not matter
 * who holds or forwards it — the signature is what makes it trustworthy, not
 * the source it came from. Nothing is fetched at dispute time, so there is no
 * endpoint to edit and no server that can be conveniently unavailable.
 */
export const DeliveryReceiptSchema = z.object({
  paymentId: z.string().min(1).max(128),
  /** Binds the receipt to the exact terms it claims to satisfy. */
  quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Digest of the full delivered body. */
  bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** Digest of the bounded slice a panel will actually read. */
  excerptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  excerptLen: z.number().int().min(0),
  deliveredAt: z.number().int().positive(),
});

export type DeliveryReceipt = z.infer<typeof DeliveryReceiptSchema>;

/** The receipt plus the seller's signature over it, as it rides the wire. */
export const SignedReceiptSchema = z.object({
  receipt: DeliveryReceiptSchema,
  /** EIP-712 signature by the seller key named in the quote. */
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
});

export type SignedReceipt = z.infer<typeof SignedReceiptSchema>;

/** EIP-712 domain and types — stable, because old receipts must stay verifiable. */
export const RECEIPT_DOMAIN = {
  name: "Notch",
  version: "1",
} as const;

export const RECEIPT_TYPES = {
  DeliveryReceipt: [
    { name: "paymentId", type: "string" },
    { name: "quoteHash", type: "bytes32" },
    { name: "bodySha256", type: "bytes32" },
    { name: "excerptSha256", type: "bytes32" },
    { name: "excerptLen", type: "uint256" },
    { name: "deliveredAt", type: "uint256" },
  ],
} as const;

/** Reads Notch terms off a PaymentRequirements. Returns null when absent. */
export function notchTermsOf(extra: unknown): NotchTerms | null {
  const parsed = NotchTermsSchema.safeParse(extra);
  return parsed.success ? parsed.data : null;
}

/**
 * Is this quote Notch-protected?
 *
 * A plain x402 quote is still a perfectly good quote — it simply settles
 * immediately with no recourse, which is what x402 does today. Notch is
 * additive, and a seller who has not opted in is not broken.
 */
export function isProtected(extra: unknown): boolean {
  return notchTermsOf(extra) !== null;
}
