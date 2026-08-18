import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Hex } from "viem";
import { INVALID, type VerifyResult } from "@/lib/x402/facilitator";
import { SUPPORTED_KINDS } from "@/lib/x402/notch";
import { domainFor, verifyAuthorizationSignature } from "@/lib/x402/eip3009";

const NETWORK_CHAIN: Record<string, number> = { "base-sepolia": 84532 };

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
  if (!SUPPORTED_KINDS.some((k: { scheme: string; network: string }) =>
        `${k.scheme}:${k.network}` === kind)) {
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

  // The real check: recover the signer against the token's EIP-712 domain.
  // An authorization whose signature does not belong to `from` is not a
  // payment — it is a claim about someone else's money.
  const chainId = NETWORK_CHAIN[pay.network];
  const domain = chainId ? domainFor(chainId, need.asset) : null;
  if (!domain) {
    return fail(INVALID.NETWORK);
  }
  const genuine = await verifyAuthorizationSignature(
    domain, auth, pay.payload.signature as Hex,
  );
  if (!genuine) {
    return fail(INVALID.SIGNATURE);
  }

  const result: VerifyResult = { isValid: true, payer: auth.from };
  return NextResponse.json(result);
}
