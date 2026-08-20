import { describe, expect, it } from "vitest";
import { FileHoldStore } from "@/lib/server/holds";
import { flowSettled } from "@/lib/server/courtflow";
import type { Authorization } from "@/lib/x402/eip3009";

/**
 * The service-driven court flow's deterministic ground: the hold's progress
 * flags. The flow itself (record -> anchor -> heal) is proven live by the
 * E2E arcs, which now OBSERVE the service instead of doing the writes.
 */

const AUTH: Authorization = {
  from: "0x" + "1".repeat(40),
  to: "0x" + "2".repeat(40),
  value: "2500000",
  validAfter: "0",
  validBefore: "99999999999",
  nonce: "0x" + "ab".repeat(32),
};

function fresh(paymentId: string) {
  return {
    paymentId,
    quoteHash: "q".repeat(64),
    network: "base-sepolia",
    asset: "0x" + "3".repeat(40),
    authorization: { ...AUTH, nonce: ("0x" + paymentId.slice(-2).repeat(32)).slice(0, 66) },
    signature: "0x" + "cd".repeat(65),
  };
}

describe("hold court-flow progress", () => {
  it("update() patches only the flow fields and persists them", async () => {
    const store = new FileHoldStore();
    const id = `pay_flow_${Date.now().toString(16)}`;
    await store.put(fresh(id));

    let h = await store.update(id, { courtRecorded: true });
    expect(h.courtRecorded).toBe(true);
    expect(h.state).toBe("HELD");            // state untouched

    h = await store.update(id, {
      receipt: { bodySha256: "b".repeat(64), excerptSha256: "e".repeat(64), excerptLen: 42 },
    });
    expect(h.receipt?.excerptLen).toBe(42);

    h = await store.update(id, { receiptAnchored: true });
    expect(h.receiptAnchored).toBe(true);

    const back = await store.get(id);
    expect(back?.courtRecorded).toBe(true);
    expect(back?.receiptAnchored).toBe(true);
  });

  it("flowSettled: recorded + (no receipt yet, or receipt anchored)", async () => {
    const base = {
      ...fresh("pay_x"), state: "HELD" as const, settleRef: null,
      createdAt: 0, updatedAt: 0,
    };
    // nothing driven yet
    expect(flowSettled({ ...base })).toBe(false);
    // recorded, nothing delivered yet — the healer has nothing to do
    expect(flowSettled({ ...base, courtRecorded: true })).toBe(true);
    // recorded, delivered but not anchored — healer must anchor
    expect(flowSettled({
      ...base, courtRecorded: true,
      receipt: { bodySha256: "b".repeat(64), excerptSha256: "e".repeat(64), excerptLen: 1 },
    })).toBe(false);
    // fully driven
    expect(flowSettled({
      ...base, courtRecorded: true, receiptAnchored: true,
      receipt: { bodySha256: "b".repeat(64), excerptSha256: "e".repeat(64), excerptLen: 1 },
    })).toBe(true);
  });
});
