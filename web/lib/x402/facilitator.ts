/**
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
  receipt: import("./notch").SignedReceipt | null;
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
 * The delivery receipt lives in `notch.ts` alongside its zod schema and the
 * EIP-712 domain it is signed under — one definition, validated at the edge
 * rather than trusted as a bare TypeScript shape.
 */
export type { SignedReceipt } from "./notch";

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
