import { NextResponse } from "next/server";
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
