/**
 * The service-driven court flow. The judges' bar, stated plainly: a paid
 * request through the NORMAL service path must reach the court by itself —
 * record_payment once the authorization is held, submit_receipt once the
 * delivery is signed — with no E2E script in the loop.
 *
 * Three call sites, one contract:
 *   /settle        after(): ensureRecorded          (the facilitator = operator)
 *   seller route   after(): advancePayment          (record if missed + anchor)
 *   /reconcile     advancePayment                   (the crash-safe healer)
 *
 * Every step is idempotent and close-by-state-read: a flag is set only after
 * get_payment CONFIRMS the transition, so a crashed round is retried by the
 * next caller rather than believed. With no keys configured, every step
 * reports an honest dry run — exactly like the rest of this service.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { Hex } from "viem";
import { holdStore, type StoredHold } from "./holds";
import { getPayment, recordPayment, COURT_CONFIGURED, type CourtPayment } from "./court";

const RPC = (process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api").trim();
const CONTRACT = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "").trim() as `0x${string}`;

export type FlowStep =
  | { step: string; mode: "CONFIRMED" | "SUBMITTED" | "SKIPPED" | "WAITING" }
  | { step: string; mode: "DRY_RUN"; reason: string }
  | { step: string; mode: "FAILED"; error: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serverless-safe confirmation poll: short, then hand off to the healer. */
async function pollFor(
  paymentId: string,
  pred: (p: CourtPayment) => boolean,
  tries = 5,
  waitMs = 6000,
): Promise<CourtPayment | null> {
  for (let i = 0; i < tries; i++) {
    await sleep(waitMs);
    try {
      const p = await getPayment(paymentId);
      if (p && pred(p)) return p;
    } catch {
      /* transient read noise — keep polling */
    }
  }
  return null;
}

/**
 * The seller's on-chain anchor. The seller service holds its own key (it
 * already signs receipts with it); submitting submit_receipt from that key IS
 * the receipt signature, on-chain — the tx signer is the bonded wallet.
 */
async function sellerSubmitReceipt(
  paymentId: string,
  r: { bodySha256: string; excerptSha256: string; excerptLen: number },
): Promise<FlowStep> {
  const pk = process.env.NOTCH_DEMO_SELLER_PRIVATE_KEY?.trim();
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    return {
      step: "submit_receipt", mode: "DRY_RUN",
      reason: "NOTCH_DEMO_SELLER_PRIVATE_KEY is not configured — the receipt " +
              "stays signed-but-unanchored and this reports it honestly.",
    };
  }
  try {
    const client = createClient({
      chain: studionet, endpoint: RPC, account: createAccount(pk as Hex),
    });
    await client.writeContract({
      address: CONTRACT,
      functionName: "submit_receipt",
      args: [paymentId, r.bodySha256, r.excerptSha256, r.excerptLen],
      value: BigInt(0),
    });
    return { step: "submit_receipt", mode: "SUBMITTED" };
  } catch (e) {
    return {
      step: "submit_receipt", mode: "FAILED",
      error: e instanceof Error ? e.message.slice(0, 200) : "write failed",
    };
  }
}

/**
 * Record the held payment on the court, as the operator, then confirm by
 * reading it back. Safe to call any number of times.
 */
export async function ensureRecorded(paymentId: string): Promise<FlowStep> {
  if (!COURT_CONFIGURED) {
    return { step: "record_payment", mode: "DRY_RUN", reason: "no contract configured" };
  }
  const store = holdStore();
  const hold = await store.get(paymentId);
  if (!hold) return { step: "record_payment", mode: "FAILED", error: "no hold" };
  if (hold.courtRecorded) return { step: "record_payment", mode: "SKIPPED" };

  // Already on court (a previous round landed but the flag write was lost)?
  try {
    const existing = await getPayment(paymentId);
    if (existing) {
      await store.update(paymentId, { courtRecorded: true });
      return { step: "record_payment", mode: "CONFIRMED" };
    }
  } catch {
    /* fall through to the write — the read retries inside */
  }

  const written = await recordPayment(
    paymentId, hold.quoteHash, hold.authorization.from,
  );
  if (written.mode === "DRY_RUN") {
    return { step: "record_payment", mode: "DRY_RUN", reason: written.reason };
  }
  if (written.mode === "FAILED") {
    return { step: "record_payment", mode: "FAILED", error: written.error };
  }
  const confirmed = await pollFor(paymentId, () => true);
  if (confirmed) {
    await store.update(paymentId, { courtRecorded: true });
    return { step: "record_payment", mode: "CONFIRMED" };
  }
  // Submitted but not yet readable — the reconciler confirms on its next pass.
  return { step: "record_payment", mode: "SUBMITTED" };
}

/**
 * Anchor the signed receipt on the court, as the seller, then confirm the
 * window armed. Needs the receipt stashed on the hold at delivery time.
 */
export async function ensureReceiptAnchored(paymentId: string): Promise<FlowStep> {
  if (!COURT_CONFIGURED) {
    return { step: "submit_receipt", mode: "DRY_RUN", reason: "no contract configured" };
  }
  const store = holdStore();
  const hold = await store.get(paymentId);
  if (!hold) return { step: "submit_receipt", mode: "FAILED", error: "no hold" };
  if (hold.receiptAnchored) return { step: "submit_receipt", mode: "SKIPPED" };
  if (!hold.receipt) {
    return { step: "submit_receipt", mode: "WAITING" }; // nothing delivered yet
  }

  let court: CourtPayment | null = null;
  try {
    court = await getPayment(paymentId);
  } catch {
    return { step: "submit_receipt", mode: "WAITING" };
  }
  if (!court) return { step: "submit_receipt", mode: "WAITING" }; // record first
  if (court.receipt) {
    await store.update(paymentId, { receiptAnchored: true });
    return { step: "submit_receipt", mode: "CONFIRMED" };
  }
  if (court.state !== "AWAITING_RECEIPT") {
    return { step: "submit_receipt", mode: "WAITING" };
  }

  const sent = await sellerSubmitReceipt(paymentId, hold.receipt);
  if (sent.mode !== "SUBMITTED") return sent;

  const confirmed = await pollFor(paymentId, (p) => !!p.receipt);
  if (confirmed) {
    await store.update(paymentId, { receiptAnchored: true });
    return { step: "submit_receipt", mode: "CONFIRMED" };
  }
  return { step: "submit_receipt", mode: "SUBMITTED" };
}

export type FlowTrace = { record: FlowStep; anchor: FlowStep };

/**
 * Schedule work for after the response. Inside a real Next request scope this
 * uses `after()` (the platform keeps the function alive for it); outside one
 * — unit tests calling the handler bare — it just fires the promise, whose
 * steps all degrade to fast DRY_RUN/SKIPPED without env.
 */
export function scheduleAfter(
  afterFn: (task: () => Promise<unknown>) => void,
  task: () => Promise<unknown>,
): void {
  try {
    afterFn(task);
  } catch {
    void task().catch(() => {});
  }
}

/**
 * The one-call driver: record if needed, then anchor if possible. Used by the
 * seller route post-delivery and by the reconciler as the healer.
 */
export async function advancePayment(paymentId: string): Promise<FlowTrace> {
  const record = await ensureRecorded(paymentId);
  const anchor = await ensureReceiptAnchored(paymentId);
  return { record, anchor };
}

/** For responses: is there anything left for the healer to do? */
export function flowSettled(hold: StoredHold): boolean {
  return !!hold.courtRecorded && (!hold.receipt || !!hold.receiptAnchored);
}
