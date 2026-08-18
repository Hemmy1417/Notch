import { NextRequest, NextResponse } from "next/server";
import { buildProtectedQuote, paymentRequiredBody } from "@/lib/x402/quote";
import { CHAIN, DEFAULT_WINDOW_SECONDS, meetsFloor } from "@/lib/config";
import { signReceipt, receiptFor } from "@/lib/x402/receipt";

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

  // ── a payment arrived: verify + hold, deliver, and SIGN for it ─────────
  const sellerPk = process.env.NOTCH_DEMO_SELLER_PRIVATE_KEY;
  if (!sellerPk || !/^0x[0-9a-fA-F]{64}$/.test(sellerPk)) {
    return NextResponse.json(
      {
        error: "seller_not_configured",
        detail:
          "NOTCH_DEMO_SELLER_PRIVATE_KEY is not set, so this seller cannot sign " +
          "a delivery receipt — and under Notch's rules, no receipt means no " +
          "release. Refusing the payment beats taking money we could not be " +
          "held to account for.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  // Decode the v1 X-PAYMENT header (base64 JSON) and hand it to our own
  // facilitator — the same endpoint any external seller would call.
  let paymentPayload: unknown;
  try {
    paymentPayload = JSON.parse(Buffer.from(payment, "base64").toString("utf-8"));
  } catch {
    return NextResponse.json(
      paymentRequiredBody([quote], "The X-PAYMENT header could not be decoded."),
      { status: 402, headers: { "cache-control": "no-store" } },
    );
  }

  const url = new URL(req.url);
  const settleRes = await fetch(`${url.origin}/api/facilitator/settle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      x402Version: 1,
      paymentPayload,
      paymentRequirements: quote,
    }),
  });
  const settled = await settleRes.json();

  if (settled.errorReason !== "held_pending_challenge_window") {
    // The payment did not verify. Say exactly why — the buyer's client can fix
    // an expiry or a signature; it cannot fix a silent 402 loop.
    return NextResponse.json(
      paymentRequiredBody([quote], `Payment refused: ${settled.errorReason}.`),
      { status: 402, headers: { "cache-control": "no-store" } },
    );
  }

  // The hold is real. Deliver the work…
  const body = {
    summary:
      "Notch demonstration report. This body is produced in exchange for a held " +
      "x402 payment: the buyer's authorization is verified and retained by the " +
      "facilitator rather than submitted, so the funds have not moved. The seller " +
      "signs a delivery receipt over the hash of exactly these bytes, and that " +
      "signature is the only evidence a future dispute will read.",
    sources: [
      { url: "https://docs.x402.org", claim: "x402's exact scheme is a push payment, irreversible once executed." },
      { url: "https://eips.ethereum.org/EIPS/eip-3009", claim: "EIP-3009 authorizations are single-use, time-bounded, and name recipient and amount." },
    ],
    paymentId: settled.notch.paymentId,
  };
  const bodyText = JSON.stringify(body);

  // …and sign the tally for it.
  const signedReceipt = await signReceipt(
    sellerPk as `0x${string}`,
    receiptFor(settled.notch.paymentId, settled.notch.quoteHash, bodyText),
  );

  // v1 carries the settlement response back in X-PAYMENT-RESPONSE (base64).
  const paymentResponse = Buffer.from(JSON.stringify({
    success: false,
    transaction: "",
    network: CHAIN.network,
    errorReason: "held_pending_challenge_window",
    notch: {
      paymentId: settled.notch.paymentId,
      quoteHash: settled.notch.quoteHash,
      state: "HELD",
      receipt: signedReceipt,
    },
  })).toString("base64");

  return new NextResponse(bodyText, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-payment-response": paymentResponse,
      "x-notch-payment-id": settled.notch.paymentId,
    },
  });
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
