/**
 * Building a Notch-protected 402.
 *
 * The output is a genuine x402 v1 `PaymentRequirements` — an unmodified x402
 * client can read it, and one that knows nothing about Notch will simply
 * ignore `extra` and pay as normal. Compatibility is not a nice-to-have here:
 * a seller whose existing middleware breaks the moment they enable disputes
 * will never enable disputes.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { NotchTermsSchema, type NotchTerms, MAX_CRITERIA_CHARS } from "./notch";

/**
 * The x402 v1 wire shape, restated here rather than imported.
 *
 * x402@1.2.0 exports its schemas through deep subpaths that move between
 * releases; pinning the shape locally means an upgrade shows up as a failing
 * test rather than as a runtime surprise in a payment path. The conformance
 * test asserts our object satisfies the package's own schema, so the two
 * cannot drift silently.
 */
export const PaymentRequirementsSchema = z.object({
  scheme: z.literal("exact"),
  network: z.string(),
  maxAmountRequired: z.string(),
  resource: z.string(),
  description: z.string(),
  mimeType: z.string(),
  outputSchema: z.record(z.string(), z.any()).optional(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number(),
  asset: z.string(),
  extra: z.record(z.string(), z.any()).optional(),
});

export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;

export const sha256 = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex");

/**
 * The quote digest.
 *
 * Covers every field that decides what was promised and what it costs. A
 * seller who alters any of them after the buyer signed produces a different
 * hash, so the receipt they later sign cannot name the terms the buyer agreed
 * to. Field order is fixed and the value is JSON with no incidental
 * whitespace, because the buyer's client, our facilitator and the contract
 * must all arrive at the same string independently.
 */
export function quoteHashOf(input: {
  resource: string;
  network: string;
  asset: string;
  maxAmountRequired: string;
  payTo: string;
  seller: string;
  criteria: string;
  windowSeconds: number;
}): string {
  const canonical = JSON.stringify([
    "notch.quote.v1",
    input.resource,
    input.network,
    input.asset,
    input.maxAmountRequired,
    input.payTo.toLowerCase(),
    input.seller.toLowerCase(),
    input.criteria,
    input.windowSeconds,
  ]);
  return sha256(canonical);
}

export type BuildQuoteInput = {
  resource: string;
  description: string;
  network: string;
  asset: string;
  /** Atomic units, as a string — 6 decimals for USDC. */
  maxAmountRequired: string;
  /** Where settlement lands. For a protected quote this is the seller. */
  payTo: string;
  /** The seller's bonded wallet, and the key their receipt must be signed by. */
  seller: string;
  criteria: string;
  windowSeconds: number;
  mimeType?: string;
  maxTimeoutSeconds?: number;
};

/**
 * Builds the 402 body.
 *
 * Throws on bad input rather than emitting a quote that cannot be honoured —
 * a malformed quote discovered at dispute time is a quote whose criteria
 * nobody can apply, and by then the money has moved.
 */
export function buildProtectedQuote(input: BuildQuoteInput): PaymentRequirements {
  if (input.criteria.trim().length < 20) {
    throw new Error(
      "criteria must actually say what delivery means — a panel will read this verbatim",
    );
  }
  if (input.criteria.length > MAX_CRITERIA_CHARS) {
    throw new Error(`criteria exceeds ${MAX_CRITERIA_CHARS} characters`);
  }

  const quoteHash = quoteHashOf(input);

  const terms: NotchTerms = {
    notch: 1,
    criteria: input.criteria,
    seller: input.seller.toLowerCase(),
    windowSeconds: input.windowSeconds,
    receiptRequired: true,
    quoteHash,
  };

  // Fail loudly here rather than shipping a quote whose extra will not parse
  // on the buyer's side.
  NotchTermsSchema.parse(terms);

  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: input.network,
    maxAmountRequired: input.maxAmountRequired,
    resource: input.resource,
    description: input.description,
    mimeType: input.mimeType ?? "application/json",
    payTo: input.payTo,
    // The window is a Notch concept and lives in `extra`; maxTimeoutSeconds
    // remains x402's own settlement timeout and is left alone.
    maxTimeoutSeconds: input.maxTimeoutSeconds ?? 120,
    asset: input.asset,
    extra: terms,
  };

  return PaymentRequirementsSchema.parse(requirements);
}

/** The 402 body: x402 clients read `accepts[]` and pick one. */
export function paymentRequiredBody(accepts: PaymentRequirements[], error?: string) {
  return {
    x402Version: 1,
    accepts,
    error: error ?? "",
  };
}
