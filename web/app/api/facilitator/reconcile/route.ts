import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { holdStore } from "@/lib/server/holds";
import { getPayment, markSettled, COURT_CONFIGURED } from "@/lib/server/court";
import { release, refundReference } from "@/lib/server/rail";
import { advancePayment, flowSettled } from "@/lib/server/courtflow";

// Healing (record + anchor + confirm) can take StudioNet round-trips.
export const maxDuration = 60;

/**
 * POST /api/facilitator/reconcile  { paymentId }
 *
 * The bailiff's rounds: read what the court decided, make the rail match it,
 * record that it happened. This endpoint DECIDES nothing — every branch below
 * is dictated by the contract's state, and the honest summary of this file is
 * a table:
 *
 *   court says       rail does                      then records
 *   RELEASABLE       submit the held authorization  mark_settled(txHash)
 *   REFUND_DUE       nothing, forever               mark_settled(expiry note)
 *   anything else    nothing                        nothing — reports waiting
 *
 * Idempotent and safe to call repeatedly: a hold that has already moved past
 * HELD reports its state rather than acting twice, and a FAILED submission is
 * retryable on the next call.
 */

const Body = z.object({ paymentId: z.string().min(1).max(100) });

export async function POST(req: NextRequest) {
  let paymentId: string;
  try {
    paymentId = Body.parse(await req.json()).paymentId;
  } catch {
    return NextResponse.json({ error: "paymentId is required" }, { status: 400 });
  }

  if (!COURT_CONFIGURED) {
    return NextResponse.json(
      { error: "no contract is configured; there is no court to reconcile against" },
      { status: 503 },
    );
  }

  const store = holdStore();
  const hold = await store.get(paymentId);
  if (!hold) {
    return NextResponse.json({ error: `no hold for payment ${paymentId}` }, { status: 404 });
  }

  // Terminal holds report themselves; nothing acts twice.
  if (hold.state === "RELEASED" || hold.state === "REFUNDED") {
    return NextResponse.json({
      paymentId, holdState: hold.state, settleRef: hold.settleRef, acted: false,
    });
  }

  // The healer: whatever the service's post-response hooks missed (a crash,
  // a rate-limited round), the reconciler drives now — record_payment, then
  // submit_receipt — before reading the court's decision. Idempotent: steps
  // already confirmed are skipped via the hold's flags.
  let flow = null;
  if (!flowSettled(hold)) {
    flow = await advancePayment(paymentId);
  }

  const court = await getPayment(paymentId);
  if (!court) {
    return NextResponse.json({
      paymentId, holdState: hold.state, acted: false, flow,
      waiting: "the court has no record of this payment yet — the record was " +
               "just driven; it becomes readable after finalization",
    });
  }

  // ── RELEASABLE: submit the authorization ────────────────────────────────
  if (court.state === "RELEASABLE") {
    const marked = hold.state === "FAILED"
      ? await store.transition(paymentId, "SUBMITTED")       // retry path
      : await store.transition(paymentId, "SUBMITTED");
    void marked;
    const result = await release(hold);

    if (result.mode === "SUBMITTED") {
      await store.transition(paymentId, "RELEASED", result.txHash);
      const recorded = await markSettled(paymentId, result.txHash);
      return NextResponse.json({
        paymentId, holdState: "RELEASED", acted: true,
        rail: { txHash: result.txHash },
        court: recorded,
      });
    }
    if (result.mode === "DRY_RUN") {
      // Nothing moved; put the hold back where it was and say so.
      await store.transition(paymentId, "FAILED", "dry-run: no settlement key");
      return NextResponse.json({
        paymentId, holdState: "HELD", acted: false,
        dryRun: result.reason,
        note: "The court says RELEASABLE. With SETTLEMENT_PRIVATE_KEY configured, " +
              "this call would submit the held authorization and record the hash.",
      });
    }
    await store.transition(paymentId, "FAILED", result.error);
    return NextResponse.json(
      { paymentId, holdState: "FAILED", acted: false, error: result.error },
      { status: 502 },
    );
  }

  // ── REFUND_DUE: the refund is the absence of a transaction ──────────────
  if (court.state === "REFUND_DUE") {
    const ref = refundReference(hold);
    await store.transition(paymentId, "REFUNDED", ref);
    const recorded = await markSettled(paymentId, ref);
    return NextResponse.json({
      paymentId, holdState: "REFUNDED", acted: true,
      rail: { note: ref },
      court: recorded,
    });
  }

  // ── everything else: the court is still working ─────────────────────────
  return NextResponse.json({
    paymentId, holdState: hold.state, acted: false, flow,
    waiting: `court state is ${court.state}`,
    windowEnds: court.window_ends || undefined,
  });
}
