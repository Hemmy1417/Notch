/**
 * The delivery receipt — signing and verification.
 *
 * The receipt is the tally cut: the seller's signed statement of exactly what
 * they delivered, made at delivery time with the same key that holds their
 * bond. The buyer verifies it the moment it arrives; the contract's
 * adjudicator later reads only bytes that hash to the digest inside it.
 *
 * Nothing here is fetched from anywhere. There is no URL to edit, take down,
 * or have conveniently unavailable — the signature is what makes the receipt
 * trustworthy, not its source.
 */
import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Hex } from "viem";
import { RECEIPT_DOMAIN, RECEIPT_TYPES, type DeliveryReceipt, type SignedReceipt } from "./notch";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The typed-data message, with hex digests carried as bytes32. */
function receiptMessage(r: DeliveryReceipt) {
  return {
    paymentId: r.paymentId,
    quoteHash: `0x${r.quoteHash}` as Hex,
    bodySha256: `0x${r.bodySha256}` as Hex,
    excerptSha256: `0x${r.excerptSha256}` as Hex,
    excerptLen: BigInt(r.excerptLen),
    deliveredAt: BigInt(r.deliveredAt),
  };
}

export async function signReceipt(sellerPk: Hex, receipt: DeliveryReceipt): Promise<SignedReceipt> {
  const account = privateKeyToAccount(sellerPk);
  const signature = await account.signTypedData({
    domain: RECEIPT_DOMAIN,
    types: RECEIPT_TYPES,
    primaryType: "DeliveryReceipt",
    message: receiptMessage(receipt),
  });
  return { receipt, signature };
}

/** Who signed this receipt? The caller compares against the bonded seller. */
export async function recoverReceiptSigner(signed: SignedReceipt): Promise<string> {
  return recoverTypedDataAddress({
    domain: RECEIPT_DOMAIN,
    types: RECEIPT_TYPES,
    primaryType: "DeliveryReceipt",
    message: receiptMessage(signed.receipt),
    signature: signed.signature as Hex,
  });
}

export async function verifyReceipt(
  sellerAddr: string,
  signed: SignedReceipt,
): Promise<boolean> {
  try {
    const signer = await recoverReceiptSigner(signed);
    return signer.toLowerCase() === sellerAddr.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Build the receipt for a delivered body.
 *
 * The excerpt is the bounded slice a panel would actually read (the contract
 * caps it at 4000 chars). For small bodies it IS the body, which keeps the
 * common case simple: one digest pair, no ambiguity about what was vouched
 * for.
 */
export function receiptFor(
  paymentId: string,
  quoteHash: string,
  body: string,
  excerptMax = 4000,
): DeliveryReceipt {
  const excerpt = body.slice(0, excerptMax);
  return {
    paymentId,
    quoteHash,
    bodySha256: sha256Hex(body),
    excerptSha256: sha256Hex(excerpt),
    excerptLen: excerpt.length,
    deliveredAt: Math.floor(Date.now() / 1000),
  };
}
