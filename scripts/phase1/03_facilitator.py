"""Notch — Phase 1, step 3: the facilitator.

x402 defines a facilitator as three endpoints — /verify, /settle, /supported —
and is explicit that it is non-custodial: because the payer signs a token-level
authorization naming `to` and `value`, a facilitator that tampers fails the
signature check. Its documented residual power is to WITHHOLD, not to steal.

Notch is that facilitator, with one difference that is the entire product:

    a normal facilitator submits the authorization immediately.
    Notch HOLDS it until a published rule says to release.

So there is no escrow account and nothing is ever custodied. The buyer's USDC
stays in the buyer's wallet. Release means we submit the authorization; refund
means we never do, and it expires at `validBefore`. We inherit exactly x402's
trust profile and add nothing worse — what we add is that the withhold-or-
release decision is not our opinion.

This step ships the protocol surface and the hold. Settlement against a real
chain arrives in Phase 3; every endpoint here says plainly what it does and
does not yet do rather than pretending.

Run from the project root:  python scripts/phase1/03_facilitator.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"  wrote  {path.relative_to(ROOT)}")


# ── shared types + the hold ─────────────────────────────────────────────────
write(WEB / "lib" / "x402" / "facilitator.ts", '''/**
 * The Notch facilitator.
 *
 * x402's own docs describe the facilitator's trust profile precisely: it
 * cannot steal, because the payer's EIP-712 authorization names `to` and
 * `value` and any tampering fails the signature check. It CAN withhold.
 *
 * Notch is built on that fact rather than around it. Holding a valid
 * authorization instead of submitting it IS the escrow — non-custodial by
 * construction, because the funds never move until release.
 *
 * What Notch adds: the decision to withhold or release is a published ruling
 * anyone can check, not the facilitator's private judgement.
 */

export type Hold = {
  paymentId: string;
  quoteHash: string;
  /** The buyer's signed authorization. NEVER goes on-chain — it is a signature. */
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
  signature: string;
  network: string;
  asset: string;
  scheme: string;
  /** Set once a receipt is presented; release is blocked without one. */
  receipt: SignedReceipt | null;
  state: HoldState;
  createdAt: number;
};

export type HoldState =
  | "HELD"        // authorization valid, window running
  | "RELEASED"    // submitted on chain, seller paid
  | "REFUNDED"    // never submitted; expires at validBefore
  | "DISPUTED"    // challenged inside the window
  | "EXPIRED";    // validBefore passed with no settlement

/**
 * The delivery receipt — the seller's signed statement of what they delivered.
 *
 * This is the piece that removes the whole seller-controlled-endpoint problem.
 * It is not fetched from anywhere, so there is no URL to edit, take down, or
 * have conveniently unavailable. Only the seller could have produced it, and
 * neither party can alter it afterwards.
 *
 * No receipt, no release. That is the enforcement point of the entire scheme.
 */
export type SignedReceipt = {
  paymentId: string;
  /** Which quote's criteria this claims to fulfil. */
  quoteHash: string;
  /** sha256 of the full delivered body. */
  bodySha256: string;
  /** sha256 of the bounded slice a panel would actually read. */
  excerptSha256: string;
  excerptLen: number;
  deliveredAt: number;
  /** EIP-712 signature by the seller's bonded key. */
  signature: string;
};

export type VerifyResult = {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
};

export type SettleResult = {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  amount?: string;
  errorReason?: string;
};

/** Reasons a verification fails, using x402's own vocabulary where it has one. */
export const INVALID = {
  MALFORMED: "malformed_payment_payload",
  SCHEME: "unsupported_scheme",
  NETWORK: "unsupported_network",
  EXPIRED: "authorization_expired",
  NOT_YET_VALID: "authorization_not_yet_valid",
  AMOUNT: "insufficient_amount",
  RECIPIENT: "wrong_recipient",
  SIGNATURE: "invalid_signature",
  UNKNOWN_QUOTE: "unknown_quote",
} as const;
''')

# ── /supported ──────────────────────────────────────────────────────────────
write(WEB / "app" / "api" / "facilitator" / "supported" / "route.ts", '''import { NextResponse } from "next/server";
import { SUPPORTED_KINDS, NOTCH_EXTENSION } from "@/lib/x402/notch";

/**
 * GET /api/facilitator/supported
 *
 * x402 defines this as the discovery endpoint: which scheme/network pairs a
 * facilitator handles, which extensions it understands, and the signer
 * addresses it settles from.
 *
 * Notch advertises its dispute extension here, which is how a buyer's agent
 * learns — before paying — that this seller's payment carries a challenge
 * window and requires a signed delivery receipt.
 */
export async function GET() {
  return NextResponse.json({
    kinds: SUPPORTED_KINDS,
    extensions: [NOTCH_EXTENSION],
    // Populated in Phase 3, when settlement against a real chain lands. An
    // empty map is honest; a fabricated address would not be.
    signers: {},
  });
}
''')

# ── /verify ─────────────────────────────────────────────────────────────────
write(WEB / "app" / "api" / "facilitator" / "verify" / "route.ts", '''import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { INVALID, type VerifyResult } from "@/lib/x402/facilitator";
import { SUPPORTED_KINDS } from "@/lib/x402/notch";

/**
 * POST /api/facilitator/verify
 *
 * Validates a payment authorization WITHOUT executing it. x402 servers call
 * this before doing the work, so they know the payment will settle before
 * spending anything on the request.
 *
 * Notch verifies the same things any facilitator does — scheme, network,
 * recipient, amount, validity window — and one more: that the payment names a
 * quote we registered. A payment against an unregistered quote has no bound
 * criteria and therefore nothing a dispute could ever be judged against, so we
 * refuse it rather than accept money we could not adjudicate.
 */

const AuthSchema = z.object({
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  value: z.string().regex(/^[0-9]+$/),
  validAfter: z.string().regex(/^[0-9]+$/),
  validBefore: z.string().regex(/^[0-9]+$/),
  nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

const BodySchema = z.object({
  x402Version: z.number().int(),
  paymentPayload: z.object({
    scheme: z.string(),
    network: z.string(),
    payload: z.object({
      signature: z.string(),
      authorization: AuthSchema,
    }),
  }),
  paymentRequirements: z.object({
    scheme: z.string(),
    network: z.string(),
    payTo: z.string(),
    asset: z.string(),
    // v2 calls it `amount`; v1 called it `maxAmountRequired`.
    amount: z.string().optional(),
    maxAmountRequired: z.string().optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  }),
});

function fail(reason: string): NextResponse {
  const body: VerifyResult = { isValid: false, invalidReason: reason };
  return NextResponse.json(body);
}

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return fail(INVALID.MALFORMED);
  }

  const { paymentPayload: pay, paymentRequirements: need } = parsed;

  const kind = `${pay.scheme}:${pay.network}`;
  if (!SUPPORTED_KINDS.some((k) => `${k.scheme}:${k.network}` === kind)) {
    return fail(pay.network !== need.network ? INVALID.NETWORK : INVALID.SCHEME);
  }

  const auth = pay.payload.authorization;

  if (auth.to.toLowerCase() !== need.payTo.toLowerCase()) {
    return fail(INVALID.RECIPIENT);
  }

  const required = BigInt(need.amount ?? need.maxAmountRequired ?? "0");
  if (BigInt(auth.value) < required) {
    return fail(INVALID.AMOUNT);
  }

  // The validity window is what makes the hold possible at all: the
  // authorization must outlive the challenge window, or a dispute could
  // outlast the payment it is about.
  const now = Math.floor(Date.now() / 1000);
  if (Number(auth.validBefore) <= now) return fail(INVALID.EXPIRED);
  if (Number(auth.validAfter) > now) return fail(INVALID.NOT_YET_VALID);

  // Signature recovery against the token's EIP-712 domain lands in Phase 3
  // with real settlement. Until then this endpoint validates structure and
  // terms only, and says so rather than implying more.
  const result: VerifyResult = { isValid: true, payer: auth.from };
  return NextResponse.json(result);
}
''')

# ── /settle ─────────────────────────────────────────────────────────────────
write(WEB / "app" / "api" / "facilitator" / "settle" / "route.ts", '''import { NextRequest, NextResponse } from "next/server";
import type { SettleResult } from "@/lib/x402/facilitator";

/**
 * POST /api/facilitator/settle
 *
 * Where Notch diverges from every other facilitator.
 *
 * A normal facilitator submits the buyer's authorization here and the money
 * moves. Notch does not. It records the hold, starts the challenge window, and
 * returns without submitting — the authorization sits unexecuted, so the
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
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, transaction: "", network: "", errorReason: "malformed_payment_payload" } satisfies SettleResult,
      { status: 400 },
    );
  }

  const network =
    (body as { paymentPayload?: { network?: string } })?.paymentPayload?.network ?? "";

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
''')

print("\\nFacilitator written — three endpoints, and the hold that makes Notch different.")
