/**
 * The rail — where a ruling becomes a token transfer, or deliberately never
 * does.
 *
 * Exactly two operations exist, mirroring the contract's two terminal
 * decisions:
 *
 *   RELEASE  submit the held transferWithAuthorization; the seller is paid by
 *            the buyer's own signature, gas paid by the settlement key.
 *   REFUND   never submit. The authorization dies at validBefore. There is no
 *            refund transaction because the money never moved.
 *
 * Every path is honest about configuration: with no settlement key present,
 * release() reports a dry run instead of pretending, because a fabricated tx
 * hash would propagate into mark_settled and the public record.
 */
import {
  createWalletClient,
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { parseSignature } from "viem";
import type { StoredHold } from "./holds";

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

/** FiatTokenV2 transferWithAuthorization (v,r,s form — universally present). */
const EIP3009_ABI = [{
  name: "transferWithAuthorization",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "v", type: "uint8" },
    { name: "r", type: "bytes32" },
    { name: "s", type: "bytes32" },
  ],
  outputs: [],
}] as const;

export type ReleaseResult =
  | { mode: "SUBMITTED"; txHash: string }
  | { mode: "DRY_RUN"; wouldSubmit: true; reason: string }
  | { mode: "FAILED"; error: string };

export async function release(hold: StoredHold): Promise<ReleaseResult> {
  const pk = process.env.SETTLEMENT_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    return {
      mode: "DRY_RUN",
      wouldSubmit: true,
      reason:
        "SETTLEMENT_PRIVATE_KEY is not configured. The ruling stands and the " +
        "authorization is intact; nothing was submitted, and no transaction " +
        "hash was invented.",
    };
  }
  try {
    const account = privateKeyToAccount(pk as Hex);
    const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
    const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

    const { v, r, s } = parseSignature(hold.signature as Hex);
    const a = hold.authorization;

    const txHash = await wallet.writeContract({
      address: hold.asset as Address,
      abi: EIP3009_ABI,
      functionName: "transferWithAuthorization",
      args: [
        a.from as Address, a.to as Address, BigInt(a.value),
        BigInt(a.validAfter), BigInt(a.validBefore), a.nonce as Hex,
        Number(v), r, s,
      ],
    });
    // One confirmation is enough for a testnet demo; the receipt proves the
    // transfer actually executed rather than merely being accepted.
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
    if (receipt.status !== "success") {
      return { mode: "FAILED", error: `transaction reverted: ${txHash}` };
    }
    return { mode: "SUBMITTED", txHash };
  } catch (e) {
    return { mode: "FAILED", error: e instanceof Error ? e.message : "submission failed" };
  }
}

/**
 * A refund is the absence of a transaction. This exists so the reconciler has
 * something honest to record: the authorization's own expiry is the proof.
 */
export function refundReference(hold: StoredHold): string {
  return `refund: authorization never submitted; expires at validBefore=${hold.authorization.validBefore}`;
}
