import { NextRequest, NextResponse } from "next/server";
import { buildProtectedQuote, paymentRequiredBody } from "@/lib/x402/quote";
import { CHAIN, DEFAULT_WINDOW_SECONDS, meetsFloor } from "@/lib/config";

/**
 * A real x402 resource, protected by Notch.
 *
 * This exists to be paid by an unmodified x402 client. It issues a genuine 402
 * with a v1 `PaymentRequirements`, and the Notch terms ride in `extra` — the
 * spec's own open field — so a client that has never heard of Notch reads the
 * quote, ignores `extra`, and pays exactly as it would anywhere else.
 *
 * Phase 1 stops at the 402. Verification and settlement arrive in Phase 3,
 * and until then this route says so rather than pretending to accept payment.
 */

const PRICE_ATOMIC = "2500000"; // $2.50 — above the floor, so protection applies

const CRITERIA = `The response must be a JSON object containing a "summary" string of at \
least 200 characters that addresses the requested topic, and a "sources" array \
with at least two entries, each having a "url" and a "claim" field. A response \
that is well-formed but does not address the requested topic does not satisfy \
this criterion. An empty summary, a summary consisting of an apology or a \
refusal, or fewer than two sources, does not satisfy it either.`;

/** The seller's bonded wallet. In production this comes from the registry. */
const SELLER =
  process.env.NOTCH_DEMO_SELLER ?? "0x0000000000000000000000000000000000000001";

function resourceUrl(req: NextRequest): string {
  const url = new URL(req.url);
  return `${url.origin}${url.pathname}`;
}

export async function GET(req: NextRequest) {
  const resource = resourceUrl(req);

  const quote = buildProtectedQuote({
    resource,
    description: "A researched summary with cited sources.",
    network: CHAIN.network,
    asset: CHAIN.asset,
    maxAmountRequired: PRICE_ATOMIC,
    payTo: SELLER,
    seller: SELLER,
    criteria: CRITERIA,
    windowSeconds: DEFAULT_WINDOW_SECONDS,
  });

  // x402 v1 carries the client's payment in X-PAYMENT.
  const payment = req.headers.get("x-payment");

  if (!payment) {
    return NextResponse.json(
      paymentRequiredBody([quote], "Payment required."),
      {
        status: 402,
        headers: { "cache-control": "no-store" },
      },
    );
  }

  // A payment arrived. Phase 3 verifies and holds the authorization; saying so
  // plainly beats returning a resource we were not paid for.
  return NextResponse.json(
    {
      error: "not_yet_settling",
      detail:
        "This quote is Notch-protected and the facilitator does not hold authorizations yet (Phase 3). The 402 above is real and its terms are final.",
      quoteHash: quote.extra?.quoteHash,
    },
    { status: 501, headers: { "cache-control": "no-store" } },
  );
}

/**
 * A companion quote below the price floor, to show the boundary is real.
 *
 * Notch declares that it does not engage under $1 — adjudicating a three-cent
 * call costs more than the call. Below the floor the quote is served
 * unprotected, which is not a degraded mode: it is exactly what x402 does
 * everywhere today.
 */
export async function POST(req: NextRequest) {
  const resource = resourceUrl(req);
  const cheap = "20000"; // $0.02

  if (meetsFloor(cheap)) {
    throw new Error("unreachable: the demo cheap price must sit below the floor");
  }

  return NextResponse.json(
    paymentRequiredBody([
      {
        scheme: "exact",
        network: CHAIN.network,
        maxAmountRequired: cheap,
        resource,
        description: "A single lookup. Below the Notch floor — settles with no recourse.",
        mimeType: "application/json",
        payTo: SELLER,
        maxTimeoutSeconds: 120,
        asset: CHAIN.asset,
        // No `extra`: unprotected, and honest about it.
      },
    ]),
    { status: 402, headers: { "cache-control": "no-store" } },
  );
}
