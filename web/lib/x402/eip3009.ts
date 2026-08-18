/**
 * EIP-3009 — the authorization the buyer signs and Notch holds.
 *
 * `transferWithAuthorization` is a token-level, single-use, time-bounded
 * transfer authorization, signed as EIP-712 typed data whose verifying
 * contract is THE TOKEN ITSELF. That is what makes the whole design work:
 * nothing Notch does can redirect the money, because the recipient and amount
 * are inside the buyer's signature.
 *
 * The domain is SELF-VERIFYING here: rather than hardcoding a name/version we
 * remember for each token, we compute the domain separator we intend to sign
 * under and compare it to the token's own on-chain DOMAIN_SEPARATOR(). If
 * they differ, we refuse to verify anything — a signature checked against the
 * wrong domain is worse than no check, because it fails honest payments and
 * can pass crafted ones.
 */
import {
  recoverTypedDataAddress,
  hashDomain,
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";

/** A fully-specified domain — no optional fields, because a signature checked
 * against a partially-specified domain is a signature checked against a
 * guess. */
export type TokenDomain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
};

export type Authorization = {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
};

/** The canonical EIP-3009 type, verbatim from the spec. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Known token domains, keyed by chainId:address (lowercase). Extend as rails
 * are added. These are STARTING POINTS — verifyDomain() proves them. */
const KNOWN_DOMAINS: Record<string, TokenDomain> = {
  // Circle USDC on Base Sepolia
  "84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e": {
    name: "USDC",
    version: "2",
    chainId: 84532,
    verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
};

export function domainFor(chainId: number, token: string): TokenDomain | null {
  return KNOWN_DOMAINS[`${chainId}:${token.toLowerCase()}`] ?? null;
}

/**
 * Prove our domain matches the token's own view of itself.
 *
 * Called once per token at boot (and cached by the caller). A mismatch means
 * our constants are wrong or the token is not what we think it is — either
 * way, verification must not proceed.
 */
export async function verifyDomain(
  rpcUrl: string,
  domain: TokenDomain,
): Promise<{ ok: boolean; ours: Hex; theirs?: Hex; error?: string }> {
  const ours = hashDomain({
    // hashDomain's uint256 fields want bigint; TokenDomain keeps a number for
    // ergonomics everywhere else.
    domain: { ...domain, chainId: BigInt(domain.chainId) },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
    },
  });
  try {
    const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
    const theirs = (await client.readContract({
      address: domain.verifyingContract as Address,
      abi: [{
        name: "DOMAIN_SEPARATOR", type: "function", stateMutability: "view",
        inputs: [], outputs: [{ type: "bytes32" }],
      }],
      functionName: "DOMAIN_SEPARATOR",
    })) as Hex;
    return { ok: ours.toLowerCase() === theirs.toLowerCase(), ours, theirs };
  } catch (e) {
    return { ok: false, ours, error: e instanceof Error ? e.message : "read failed" };
  }
}

/**
 * Recover the signer of an authorization. Returns the recovered address —
 * the CALLER compares it to `authorization.from` and decides; this function
 * only answers "who signed this".
 */
export async function recoverAuthorizationSigner(
  domain: TokenDomain,
  authorization: Authorization,
  signature: Hex,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from as Address,
      to: authorization.to as Address,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce as Hex,
    },
    signature,
  });
}

/** Convenience: does this signature belong to authorization.from? */
export async function verifyAuthorizationSignature(
  domain: TokenDomain,
  authorization: Authorization,
  signature: Hex,
): Promise<boolean> {
  try {
    const signer = await recoverAuthorizationSigner(domain, authorization, signature);
    return signer.toLowerCase() === authorization.from.toLowerCase();
  } catch {
    // A malformed signature is not an error condition — it is a "no".
    return false;
  }
}
