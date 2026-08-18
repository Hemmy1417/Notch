import { describe, it, expect } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import {
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  domainFor,
  recoverAuthorizationSigner,
  verifyAuthorizationSignature,
  type Authorization,
} from "@/lib/x402/eip3009";

/**
 * Signature verification, proven with real keys.
 *
 * These tests sign with viem's own EIP-712 implementation and recover with
 * ours — a genuine roundtrip, not a mock agreeing with itself. The on-chain
 * DOMAIN_SEPARATOR comparison is exercised separately in the E2E (it needs a
 * network); what is pinned here is everything that must hold before any
 * network is involved.
 */

const DOMAIN = domainFor(84532, "0x036CbD53842c5426634e7929541eC2318f3dCF7e")!;

function freshAuth(from: string, over: Partial<Authorization> = {}): Authorization {
  const now = Math.floor(Date.now() / 1000);
  return {
    from,
    to: "0x2222222222222222222222222222222222222222",
    value: "1000000",
    validAfter: String(now - 60),
    validBefore: String(now + 3600),
    nonce: `0x${"ab".repeat(32)}`,
    ...over,
  };
}

async function sign(pk: Hex, auth: Authorization): Promise<Hex> {
  const account = privateKeyToAccount(pk);
  return account.signTypedData({
    domain: DOMAIN,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from as `0x${string}`,
      to: auth.to as `0x${string}`,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce as `0x${string}`,
    },
  });
}

describe("the known domain table", () => {
  it("has Base Sepolia USDC", () => {
    expect(DOMAIN).not.toBeNull();
    expect(DOMAIN.chainId).toBe(84532);
  });

  it("returns null rather than a guess for unknown tokens", () => {
    expect(domainFor(84532, "0x" + "99".repeat(20))).toBeNull();
    expect(domainFor(1, "0x036CbD53842c5426634e7929541eC2318f3dCF7e")).toBeNull();
  });
});

describe("signature recovery — a real roundtrip", () => {
  it("recovers the actual signer", async () => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const auth = freshAuth(account.address);
    const sig = await sign(pk, auth);
    const recovered = await recoverAuthorizationSigner(DOMAIN, auth, sig);
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("accepts a signature from the named payer", async () => {
    const pk = generatePrivateKey();
    const auth = freshAuth(privateKeyToAccount(pk).address);
    expect(await verifyAuthorizationSignature(DOMAIN, auth, await sign(pk, auth))).toBe(true);
  });

  it("rejects a signature from anyone else — the impersonation case", async () => {
    const victim = privateKeyToAccount(generatePrivateKey());
    const attackerPk = generatePrivateKey();
    // attacker signs an authorization claiming to be FROM the victim
    const auth = freshAuth(victim.address);
    const sig = await sign(attackerPk, auth);
    expect(await verifyAuthorizationSignature(DOMAIN, auth, sig)).toBe(false);
  });

  it("rejects a signature after ANY field is tampered", async () => {
    const pk = generatePrivateKey();
    const me = privateKeyToAccount(pk).address;
    const auth = freshAuth(me);
    const sig = await sign(pk, auth);
    const tampered: Array<Partial<Authorization>> = [
      { to: "0x9999999999999999999999999999999999999999" },   // redirect
      { value: "999000000" },                                  // raise
      { validBefore: String(Math.floor(Date.now() / 1000) + 999999) }, // extend
      { nonce: `0x${"cd".repeat(32)}` },                       // replay slot
    ];
    for (const change of tampered) {
      expect(
        await verifyAuthorizationSignature(DOMAIN, { ...auth, ...change }, sig),
        `tamper ${Object.keys(change)[0]} must invalidate`,
      ).toBe(false);
    }
  });

  it("treats a malformed signature as a refusal, not an exception", async () => {
    const auth = freshAuth("0x1111111111111111111111111111111111111111");
    expect(await verifyAuthorizationSignature(DOMAIN, auth, "0xdead" as Hex)).toBe(false);
  });

  it("is domain-bound — the same message under another domain fails", async () => {
    // The signature must not survive a chain or token swap; this is what
    // stops a testnet authorization being replayed against mainnet USDC.
    const pk = generatePrivateKey();
    const auth = freshAuth(privateKeyToAccount(pk).address);
    const sig = await sign(pk, auth);
    const otherDomain = { ...DOMAIN, chainId: 8453 };  // Base mainnet
    expect(await verifyAuthorizationSignature(otherDomain, auth, sig)).toBe(false);
  });
});
