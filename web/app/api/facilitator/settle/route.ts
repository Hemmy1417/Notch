import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import type { SettleResult } from "@/lib/x402/facilitator";
import { SUPPORTED_KINDS, notchTermsOf, minAuthLifetimeSeconds } from "@/lib/x402/notch";
import { domainFor, verifyAuthorizationSignature } from "@/lib/x402/eip3009";
import { quoteHash } from "@/lib/x402/quote-hash";
import { holdStore } from "@/lib/server/holds";
import { ensureRecorded, scheduleAfter } from "@/lib/server/courtflow";
import type { Hex } from "viem";

// The post-response court record can take a few StudioNet round-trips.
export const maxDuration = 60;

/**
 * POST /api/facilitator/settle
 *
 * Where Notch diverges from every other facilitator: a valid payment is not
 * submitted — it is HELD. The buyer's funds stay in the buyer's wallet, the
 * seller is not yet paid, and what happens next is decided by the contract's
 * published rules, not by this service.
 *
 * As of Phase 3 the hold is real: the signature is recovered against the
 * token's EIP-712 domain, the quote hash is recomputed from the served terms,
 * and the authorization is persisted (idempotent by nonce — one replay slot,
 * one hold, ever). What remains operator-driven on-chain (record_payment) is
 * reported in the response rather than implied.
 */

const NETWORK_CHAIN: Record<string, number> = { "base-sepolia": 84532 };

const AuthSchema = z.object({
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  value: z.string().regex(/^[0-9]+$/),
  validAfter: z.string().regex(/^[0-9]+$/),
  validBefore: z.string().regex(/^[0-9]+$/),
  nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

const SettleSchema = z.object({
  x402Version: z.number().int(),
  paymentPayload: z.object({
    scheme: z.string().min(1),
    network: z.string().min(1),
    payload: z.object({
      signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
      authorization: AuthSchema,
    }),
  }),
  paymentRequirements: z.object({
    scheme: z.string(),
    network: z.string(),
    payTo: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    asset: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    maxAmountRequired: z.string().regex(/^[0-9]+$/),
    extra: z.record(z.string(), z.unknown()).optional(),
  }),
});

function refuse(network: string, reason: string, status = 200): NextResponse {
  const body: SettleResult = { success: false, transaction: "", network, errorReason: reason };
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof SettleSchema>;
  try {
    parsed = SettleSchema.parse(await req.json());
  } catch {
    return refuse("", "malformed_payment_payload", 400);
  }

  const { paymentPayload: pay, paymentRequirements: need } = parsed;
  const network = pay.network;

  const kind = `${pay.scheme}:${network}`;
  if (!SUPPORTED_KINDS.some((k: { scheme: string; network: string }) =>
        `${k.scheme}:${k.network}` === kind)) {
    return refuse(network, "unsupported_scheme_or_network");
  }

  const auth = pay.payload.authorization;

  // The terms this payment was made under. No Notch terms, no hold — a
  // payment with no bound criteria has nothing a dispute could judge.
  const terms = notchTermsOf(need.extra);
  if (!terms) {
    return refuse(network, "missing_notch_terms");
  }

  // ── the real checks ────────────────────────────────────────────────────
  const chainId = NETWORK_CHAIN[network];
  const domain = chainId ? domainFor(chainId, need.asset) : null;
  if (!domain) {
    return refuse(network, "unknown_token_domain");
  }
  const genuine = await verifyAuthorizationSignature(
    domain, auth, pay.payload.signature as Hex,
  );
  if (!genuine) {
    return refuse(network, "invalid_signature");
  }
  if (auth.to.toLowerCase() !== need.payTo.toLowerCase()) {
    return refuse(network, "wrong_recipient");
  }
  if (BigInt(auth.value) < BigInt(need.maxAmountRequired)) {
    return refuse(network, "insufficient_amount");
  }
  const now = Math.floor(Date.now() / 1000);
  if (Number(auth.validBefore) <= now) return refuse(network, "authorization_expired");
  if (Number(auth.validAfter) > now) return refuse(network, "authorization_not_yet_valid");

  // The authorization must outlive the FULL dispute lifecycle — window plus
  // the contract's 7-day terminal-dispute period plus grace. A challenge filed
  // at the window's last second opens a dispute the court may take days to
  // resolve, and a seller who WINS it must still be payable: an authorization
  // that expires mid-dispute makes every RELEASE ruling unexecutable and turns
  // disputes into free refunds.
  if (Number(auth.validBefore) < now + minAuthLifetimeSeconds(terms.windowSeconds)) {
    return refuse(network, "authorization_cannot_survive_dispute_period");
  }

  const qh = quoteHash({
    seller: terms.seller,
    criteria: terms.criteria,
    windowSeconds: terms.windowSeconds,
    amountAtto: need.maxAmountRequired,
    asset: need.asset,
  });
  // The 402 carried the seller's claimed quote hash; recompute and compare.
  // A mismatch means the served terms and the served hash disagree — a seller
  // lying about their own quote — and nothing downstream could ever bind that
  // payment to registered terms.
  if (terms.quoteHash !== qh) {
    return refuse(network, "quote_hash_mismatch");
  }

  // Deterministic payment id from the replay slot: same authorization, same
  // id, so a retried /settle cannot double-hold.
  const paymentId = `pay_${auth.nonce.slice(2, 18)}`;

  try {
    await holdStore().put({
      paymentId,
      quoteHash: qh,
      network,
      asset: need.asset,
      authorization: auth,
      signature: pay.payload.signature,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("already held")) {
      // Idempotent success: this exact authorization is already on hold.
      return NextResponse.json(
        {
          success: false, transaction: "", network,
          errorReason: "held_pending_challenge_window",
          notch: { paymentId, quoteHash: qh, state: "HELD", idempotent: true },
        },
        { status: 200, headers: { "X-Notch-State": "HELD", "X-Notch-Payment-Id": paymentId } },
      );
    }
    return refuse(network, "hold_conflict_nonce_reused");
  }

  // The normal service flow records the hold on the court itself, after the
  // response is sent — no script, no manual operator step. The reconciler
  // heals any record this misses (a crash, a rate-limited round).
  scheduleAfter(after, () => ensureRecorded(paymentId));

  return NextResponse.json(
    {
      success: false,           // true would mean "settled on-chain" — it is not
      transaction: "",          // never fabricated
      network,
      payer: auth.from,
      errorReason: "held_pending_challenge_window",
      notch: {
        paymentId,
        quoteHash: qh,
        state: "HELD",
        windowSeconds: terms.windowSeconds,
        note: "The authorization is held, not submitted. The facilitator is " +
              "recording this payment on the court now; release or refund is " +
              "decided by the contract's published rules.",
      },
    },
    { status: 200, headers: { "X-Notch-State": "HELD", "X-Notch-Payment-Id": paymentId } },
  );
}
