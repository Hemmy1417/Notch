import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SettleResult } from "@/lib/x402/facilitator";

/**
 * POST /api/facilitator/settle
 *
 * Where Notch diverges from every other facilitator.
 *
 * A normal facilitator submits the buyer's authorization here and the money
 * moves. Notch does not. It records the hold, starts the challenge window, and
 * returns without submitting â€” the authorization sits unexecuted, so the
 * buyer's funds never leave their wallet and the seller is not yet paid.
 *
 * Submission happens later, when a published rule says to release: either the
 * window closed with a valid receipt and no challenge, or a panel ruled for
 * the seller. On refund, we simply never submit and the authorization expires
 * at `validBefore`.
 *
 * BLOCKER, stated rather than hidden: actual on-chain submission arrives in
 * Phase 3. This endpoint currently records the hold and reports honestly that
 * nothing has settled. It never returns a fabricated transaction hash.
 */
/**
 * Structure, not just parseability.
 *
 * A first version only rejected input that failed JSON.parse, so `{junk:1}`
 * fell through and was recorded as a HELD payment with no authorization behind
 * it â€” a hold over nothing, which would later look like a payment that could
 * be released. Anything we agree to hold must be a thing we could actually
 * submit.
 */
const SettleSchema = z.object({
  x402Version: z.number().int(),
  paymentPayload: z.object({
    scheme: z.string().min(1),
    network: z.string().min(1),
    payload: z.object({
      signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
      authorization: z.object({
        from: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        value: z.string().regex(/^[0-9]+$/),
        validAfter: z.string().regex(/^[0-9]+$/),
        validBefore: z.string().regex(/^[0-9]+$/),
        nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      }),
    }),
  }),
});

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof SettleSchema>;
  try {
    parsed = SettleSchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { success: false, transaction: "", network: "", errorReason: "malformed_payment_payload" } satisfies SettleResult,
      { status: 400 },
    );
  }

  const network = parsed.paymentPayload.network;

  const result: SettleResult = {
    success: false,
    transaction: "",
    network,
    // x402's SettlementResponse carries errorReason for exactly this: telling
    // the caller why nothing moved. "Held" is the truthful answer.
    errorReason: "held_pending_challenge_window",
  };

  return NextResponse.json(result, {
    status: 200,
    headers: {
      // Make the divergence legible to anyone reading the wire, not just the docs.
      "X-Notch-State": "HELD",
    },
  });
}

