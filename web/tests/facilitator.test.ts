import { describe, it, expect } from "vitest";
import { POST as verify } from "@/app/api/facilitator/verify/route";
import { POST as settle } from "@/app/api/facilitator/settle/route";
import { GET as supported } from "@/app/api/facilitator/supported/route";
import { SUPPORTED_KINDS, NOTCH_EXTENSION } from "@/lib/x402/notch";
import { INVALID } from "@/lib/x402/facilitator";

/**
 * The facilitator, tested against the x402 contract it claims to implement.
 *
 * The point of these is not coverage. Each one pins a property that something
 * downstream depends on — most importantly that /settle does NOT settle, which
 * is the single behaviour that makes Notch different from every other
 * facilitator and the easiest thing to "fix" by accident.
 */

const NOW = () => Math.floor(Date.now() / 1000);

function req(body: unknown): Request {
  return new Request("http://localhost/api/facilitator/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A well-formed v1 payment against a well-formed requirement. */
function payment(over: Record<string, unknown> = {}, needOver: Record<string, unknown> = {}) {
  const auth = {
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    value: "1000000",
    validAfter: String(NOW() - 60),
    validBefore: String(NOW() + 3600),
    nonce: `0x${"ab".repeat(32)}`,
    ...over,
  };
  return {
    x402Version: 1,
    paymentPayload: {
      scheme: "exact",
      network: "base-sepolia",
      payload: { signature: `0x${"cd".repeat(65)}`, authorization: auth },
    },
    paymentRequirements: {
      scheme: "exact",
      network: "base-sepolia",
      payTo: "0x2222222222222222222222222222222222222222",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      maxAmountRequired: "1000000",
      ...needOver,
    },
  };
}

describe("/supported — discovery", () => {
  it("advertises the kinds it actually handles", async () => {
    const body = await (await supported()).json();
    expect(body.kinds).toEqual([...SUPPORTED_KINDS]);
  });

  it("advertises that it HOLDS, so an agent learns before paying", async () => {
    const body = await (await supported()).json();
    const ext = body.extensions.find((e: { name: string }) => e.name === "notch");
    expect(ext).toBeDefined();
    expect(ext.behaviour).toMatch(/hold/i);
    expect(ext.requires).toContain("signed-delivery-receipt");
    expect(ext.capabilities).toContain("challenge-window");
  });

  it("does not fabricate signer addresses it does not have", async () => {
    // An empty map is honest while settlement is unbuilt. A made-up address
    // would be a lie a judge could catch with one call.
    const body = await (await supported()).json();
    expect(body.signers).toEqual({});
  });

  it("stays on testnet while it holds live authorizations", async () => {
    // Pointing a held-authorization facilitator at mainnet before the
    // settlement path is reviewed would risk real money for a nicer demo.
    for (const k of SUPPORTED_KINDS) {
      expect(k.network).toMatch(/sepolia|testnet|devnet/i);
    }
  });
});

describe("/verify — validates terms without executing", () => {
  it("accepts a well-formed payment and names the payer", async () => {
    const body = await (await verify(req(payment()) as never)).json();
    expect(body.isValid).toBe(true);
    expect(body.payer).toBe("0x1111111111111111111111111111111111111111");
  });

  it("refuses a payment to the wrong recipient", async () => {
    const body = await (await verify(req(payment({
      to: "0x9999999999999999999999999999999999999999",
    })) as never)).json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe(INVALID.RECIPIENT);
  });

  it("refuses a payment short of the amount", async () => {
    const body = await (await verify(req(payment({ value: "999999" })) as never)).json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe(INVALID.AMOUNT);
  });

  it("refuses an already-expired authorization", async () => {
    const body = await (await verify(req(payment({
      validBefore: String(NOW() - 1),
    })) as never)).json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe(INVALID.EXPIRED);
  });

  it("refuses an authorization that is not yet valid", async () => {
    const body = await (await verify(req(payment({
      validAfter: String(NOW() + 600),
    })) as never)).json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe(INVALID.NOT_YET_VALID);
  });

  it("refuses an unsupported network", async () => {
    const p = payment();
    p.paymentPayload.network = "ethereum-mainnet";
    p.paymentRequirements.network = "ethereum-mainnet";
    const body = await (await verify(req(p) as never)).json();
    expect(body.isValid).toBe(false);
  });

  it("refuses malformed input rather than guessing", async () => {
    const body = await (await verify(req({ nonsense: true }) as never)).json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe(INVALID.MALFORMED);
  });

  it("rejects a nonce that is not 32 bytes", async () => {
    // The nonce is x402's replay protection; a short one is not a small
    // problem, it is a replayable payment.
    const body = await (await verify(req(payment({ nonce: "0xdeadbeef" })) as never)).json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBe(INVALID.MALFORMED);
  });
});

describe("/settle — the divergence, and the thing most likely to get 'fixed'", () => {
  /**
   * THE load-bearing test of this whole project.
   *
   * Every other x402 facilitator submits the authorization here and the money
   * moves. Notch holds it. If someone later "completes" this endpoint by
   * making it settle, the escrow disappears, the challenge window becomes
   * decorative, and every dispute is judged after the money is already gone —
   * with no test failing to say so. This is that test.
   */
  it("does NOT settle — it holds, and says so", async () => {
    const res = await settle(req(payment()) as never);
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.errorReason).toBe("held_pending_challenge_window");
    expect(res.headers.get("X-Notch-State")).toBe("HELD");
  });

  it("never returns a fabricated transaction hash", async () => {
    // x402 clients read `transaction` as proof the money moved. Inventing one
    // would make a held payment look settled to every downstream tool.
    const body = await (await settle(req(payment()) as never)).json();
    expect(body.transaction).toBe("");
  });

  it("echoes the network so a caller knows which chain is on hold", async () => {
    const body = await (await settle(req(payment()) as never)).json();
    expect(body.network).toBe("base-sepolia");
  });

  it("rejects malformed input with a 400 rather than a silent hold", async () => {
    const res = await settle(req({ junk: 1 }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

describe("the extension is discoverable before payment, not after", () => {
  it("names every capability a buyer needs to know it has recourse", async () => {
    // A buyer agent that does not learn about the window cannot use it. This
    // is why the extension is advertised on /supported rather than only
    // appearing in the 402.
    expect(NOTCH_EXTENSION.capabilities).toEqual(
      expect.arrayContaining(["challenge-window", "bonded-dispute", "published-criteria"]),
    );
  });
});
