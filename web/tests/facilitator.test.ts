import { describe, it, expect, beforeEach } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import { promises as fs } from "node:fs";
import path from "node:path";
import { POST as verify } from "@/app/api/facilitator/verify/route";
import { POST as settle } from "@/app/api/facilitator/settle/route";
import { GET as supported } from "@/app/api/facilitator/supported/route";
import { SUPPORTED_KINDS, NOTCH_EXTENSION } from "@/lib/x402/notch";
import { INVALID } from "@/lib/x402/facilitator";
import {
  TRANSFER_WITH_AUTHORIZATION_TYPES, domainFor, type Authorization,
} from "@/lib/x402/eip3009";
import { quoteHash } from "@/lib/x402/quote-hash";

/**
 * The facilitator, tested with REAL signatures.
 *
 * Phase 1 tested wire shapes with placeholder hex. Phase 3 verifies
 * signatures for real, so every test here signs with an actual key — the
 * suite would catch a verifier that accepts garbage as surely as one that
 * rejects the genuine article.
 */

const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DOMAIN = domainFor(84532, ASSET)!;
const SELLER_ADDR = "0x2222222222222222222222222222222222222222";
const NOW = () => Math.floor(Date.now() / 1000);

const BUYER_PK = generatePrivateKey();
const BUYER = privateKeyToAccount(BUYER_PK);

const CRITERIA = "Respond with valid JSON containing at least ten European capital cities.";
const TERMS = {
  notch: 1,
  criteria: CRITERIA,
  seller: SELLER_ADDR,
  windowSeconds: 600,
  receiptRequired: true,
  // The hash the 402 serves — must equal what the facilitator recomputes.
  quoteHash: quoteHash({
    seller: SELLER_ADDR,
    criteria: CRITERIA,
    windowSeconds: 600,
    amountAtto: "1000000",
    asset: ASSET,
  }),
} as const;

function freshAuth(over: Partial<Authorization> = {}): Authorization {
  return {
    from: BUYER.address,
    to: SELLER_ADDR,
    value: "1000000",
    validAfter: String(NOW() - 60),
    // must outlive the 600s challenge window
    validBefore: String(NOW() + 7200),
    nonce: ("0x" +
      Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0")).join("")) as string,
    ...over,
  };
}

async function signAuth(auth: Authorization, pk: Hex = BUYER_PK): Promise<Hex> {
  return privateKeyToAccount(pk).signTypedData({
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

async function paymentBody(
  authOver: Partial<Authorization> = {},
  opts: { badSig?: boolean; noTerms?: boolean } = {},
) {
  const auth = freshAuth(authOver);
  const signature = opts.badSig
    ? await signAuth(auth, generatePrivateKey())     // signed by an impostor
    : await signAuth(auth);
  return {
    x402Version: 1,
    paymentPayload: {
      scheme: "exact",
      network: "base-sepolia",
      payload: { signature, authorization: auth },
    },
    paymentRequirements: {
      scheme: "exact",
      network: "base-sepolia",
      payTo: SELLER_ADDR,
      asset: ASSET,
      maxAmountRequired: "1000000",
      // NotchTerms IS the extra object (notch:1 is its marker field), not a
      // nested key — the schema parses `extra` directly.
      ...(opts.noTerms ? {} : { extra: TERMS }),
    },
  };
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/facilitator", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  // fresh hold store per test — the store is file-backed in dev
  await fs.rm(path.join(process.cwd(), ".data", "holds.json"), { force: true });
});

describe("/supported — discovery", () => {
  it("advertises kinds, the notch extension, and no fabricated signers", async () => {
    const body = await (await supported()).json();
    expect(body.kinds).toEqual([...SUPPORTED_KINDS]);
    const ext = body.extensions.find((e: { name: string }) => e.name === "notch");
    expect(ext.behaviour).toMatch(/hold/i);
    expect(body.signers).toEqual({});
  });

  it("stays on testnet while it holds live authorizations", async () => {
    for (const k of SUPPORTED_KINDS) expect(k.network).toMatch(/sepolia|testnet|devnet/i);
  });
});

describe("/verify — now with real signature recovery", () => {
  it("accepts a genuinely signed payment", async () => {
    const body = await (await verify(req(await paymentBody()) as never)).json();
    expect(body.isValid).toBe(true);
    expect(body.payer.toLowerCase()).toBe(BUYER.address.toLowerCase());
  });

  it("rejects an impostor's signature — the check Phase 1 could not make", async () => {
    const body = await (await verify(req(await paymentBody({}, { badSig: true })) as never)).json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe(INVALID.SIGNATURE);
  });

  it("rejects a tampered amount even with a once-valid signature", async () => {
    const p = await paymentBody();
    p.paymentPayload.payload.authorization.value = "9000000";   // raised after signing
    const body = await (await verify(req(p) as never)).json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe(INVALID.SIGNATURE);
  });

  it("still refuses wrong recipients, short amounts, dead windows", async () => {
    for (const [over, reason] of [
      [{ to: "0x9999999999999999999999999999999999999999" }, INVALID.RECIPIENT],
      [{ value: "999" }, INVALID.AMOUNT],
      [{ validBefore: String(NOW() - 1) }, INVALID.EXPIRED],
      [{ validAfter: String(NOW() + 999) }, INVALID.NOT_YET_VALID],
    ] as const) {
      const body = await (await verify(req(await paymentBody(over)) as never)).json();
      expect(body.isValid).toBe(false);
      expect(body.invalidReason).toBe(reason);
    }
  });

  it("refuses malformed input rather than guessing", async () => {
    const body = await (await verify(req({ junk: 1 }) as never)).json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe(INVALID.MALFORMED);
  });
});

describe("/settle — the hold, now real", () => {
  it("holds a valid payment: verified, hashed, persisted — never settled", async () => {
    const res = await settle(req(await paymentBody()) as never);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.transaction).toBe("");
    expect(body.errorReason).toBe("held_pending_challenge_window");
    expect(res.headers.get("X-Notch-State")).toBe("HELD");
    expect(body.notch.paymentId).toMatch(/^pay_[0-9a-f]{16}$/);
    expect(body.notch.quoteHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is idempotent by authorization nonce", async () => {
    const p = await paymentBody();
    const first = await (await settle(req(p) as never)).json();
    const second = await (await settle(req(p) as never)).json();
    expect(second.notch.paymentId).toBe(first.notch.paymentId);
    expect(second.notch.idempotent).toBe(true);
  });

  it("refuses an impostor's signature", async () => {
    const body = await (await settle(req(await paymentBody({}, { badSig: true })) as never)).json();
    expect(body.errorReason).toBe("invalid_signature");
  });

  it("refuses a payment with no bound terms — nothing could ever judge it", async () => {
    const body = await (await settle(req(await paymentBody({}, { noTerms: true })) as never)).json();
    expect(body.errorReason).toBe("missing_notch_terms");
  });

  it("refuses an authorization that expires inside the challenge window", async () => {
    // validBefore only 60s out, window 600s: a RELEASE ruling after the
    // window would be unexecutable — the money would already be unreachable.
    const body = await (await settle(
      req(await paymentBody({ validBefore: String(NOW() + 60) })) as never,
    )).json();
    expect(body.errorReason).toBe("authorization_expires_inside_challenge_window");
  });

  it("never returns a fabricated transaction hash", async () => {
    const body = await (await settle(req(await paymentBody()) as never)).json();
    expect(body.transaction).toBe("");
  });

  it("rejects malformed input with a 400 rather than a silent hold", async () => {
    const res = await settle(req({ junk: 1 }) as never);
    expect(res.status).toBe(400);
  });
});

describe("the extension is discoverable before payment", () => {
  it("names the capabilities a buyer needs to know it has recourse", () => {
    expect(NOTCH_EXTENSION.capabilities).toEqual(
      expect.arrayContaining(["challenge-window", "bonded-dispute", "published-criteria"]),
    );
  });
});
