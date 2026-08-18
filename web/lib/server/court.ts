/**
 * The court client — how the service reads the contract's decisions and, as
 * operator, records what the rail did about them.
 *
 * Reads need no key and no trust: anyone can call get_payment. Writes are the
 * operator's two narrow verbs (record_payment, mark_settled) and require
 * OPERATOR_PRIVATE_KEY; with no key present, every writer reports an honest
 * dry run instead of pretending.
 *
 * Lessons carried in from siblings: reads are ground truth (close a write by
 * re-reading state, not by trusting the receipt), and transient StudioNet
 * failures (429s, HTML error pages) get retried rather than surfaced as
 * outcomes.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { Hex } from "viem";

const RPC = process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";
const CONTRACT = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "") as `0x${string}`;

export const COURT_CONFIGURED = /^0x[a-fA-F0-9]{40}$/.test(CONTRACT);

const TRANSIENT = /rate limit|429|-32029|failed to fetch|fetch failed|unreachable|doctype|not valid json|unknown rpc|unexpected token|502|503|504|timeout|econnreset|socket/i;

export type CourtPayment = {
  payment_id: string;
  quote_hash: string;
  seller: string;
  buyer: string;
  amount_atto: string;
  state: string;
  receipt: {
    body_sha256: string;
    excerpt_sha256: string;
    excerpt_len: number;
    submitted_at: number;
  } | null;
  window_ends: number;
  dispute: unknown | null;
  ruling: { verdict: string; reason: string; ruled_at: number } | null;
  settle_ref: string;
};

function readClient() {
  return createClient({ chain: studionet, endpoint: RPC });
}

async function readWithRetry<T>(fn: string, args: string[]): Promise<T | null> {
  const client = readClient();
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = await client.readContract({
        address: CONTRACT,
        functionName: fn,
        args,
      });
      if (typeof raw === "string" && raw.length > 0) return JSON.parse(raw) as T;
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (TRANSIENT.test(msg) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

export async function getPayment(paymentId: string): Promise<CourtPayment | null> {
  if (!COURT_CONFIGURED) return null;
  return readWithRetry<CourtPayment>("get_payment", [paymentId]);
}

// ── console reads ────────────────────────────────────────────────────────────
// The observatory's views. Same retry discipline; null means "not on court"
// (an empty string from the contract), while a thrown error means the read
// itself failed and the page must say so rather than render an empty book.

export type CourtStats = {
  sellers: number; quotes: number; payments: number; disputes: number;
  upheld: number; refunds: number; inconclusive: number;
  bonds_held_atto: string;
};

export type CourtConfig = {
  operator: string; min_bond_atto: string; min_challenge_bond_atto: string;
  challenge_bond_bps: number; slash_bps: number;
  dispute_terminal_seconds: number; receipt_grace_seconds: number;
  window_seconds: [number, number];
};

export type CourtSeller = {
  seller: string; bond_atto: string; reserved_atto: string;
  quotes: number; payments: number;
  receipts_upheld: number; receipts_broken: number; slashed_atto: string;
};

export type CourtQuote = {
  quote_hash: string; seller: string; criteria: string;
  window_seconds: number; amount_atto: string; asset: string; active: boolean;
};

export type CourtPaymentRow = {
  payment_id: string; state: string; amount_atto: string;
  seller: string; buyer: string;
};

export async function getStats(): Promise<CourtStats | null> {
  if (!COURT_CONFIGURED) return null;
  return readWithRetry<CourtStats>("get_stats", []);
}

export async function getConfig(): Promise<CourtConfig | null> {
  if (!COURT_CONFIGURED) return null;
  return readWithRetry<CourtConfig>("get_config", []);
}

export async function getSeller(addr: string): Promise<CourtSeller | null> {
  if (!COURT_CONFIGURED) return null;
  return readWithRetry<CourtSeller>("get_seller", [addr]);
}

export async function getQuote(quoteHash: string): Promise<CourtQuote | null> {
  if (!COURT_CONFIGURED) return null;
  return readWithRetry<CourtQuote>("get_quote", [quoteHash]);
}

export async function getPaymentsFor(
  addr: string, role: "seller" | "buyer", offset = 0,
): Promise<CourtPaymentRow[]> {
  if (!COURT_CONFIGURED) return [];
  const rows = await readWithRetry<CourtPaymentRow[]>(
    "get_payments_for", [addr, role, String(offset)],
  );
  return rows ?? [];
}

export type OperatorWrite =
  | { mode: "WRITTEN"; result: unknown }
  | { mode: "DRY_RUN"; wouldCall: string; args: string[]; reason: string }
  | { mode: "FAILED"; error: string };

/**
 * The operator's write path. Close-by-state-poll is the caller's job — this
 * submits and confirms acceptance, but the truth of what changed is read back
 * via get_payment afterwards.
 */
async function operatorWrite(fn: string, args: string[]): Promise<OperatorWrite> {
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    return {
      mode: "DRY_RUN",
      wouldCall: fn,
      args,
      reason:
        "OPERATOR_PRIVATE_KEY is not configured. The decision is unchanged on " +
        "chain; this reports what the operator would record rather than " +
        "pretending it was recorded.",
    };
  }
  try {
    const account = createAccount(pk as Hex);
    const client = createClient({ chain: studionet, endpoint: RPC, account });
    const hash = await client.writeContract({
      address: CONTRACT,
      functionName: fn,
      args,
      value: BigInt(0),
    });
    // Submission succeeded; acceptance is confirmed by the caller re-reading
    // state. We return the tx hash as evidence of submission only.
    return { mode: "WRITTEN", result: { txHash: hash } };
  } catch (e) {
    return { mode: "FAILED", error: e instanceof Error ? e.message : "write failed" };
  }
}

export async function recordPayment(
  paymentId: string, quoteHash: string, buyer: string,
): Promise<OperatorWrite> {
  return operatorWrite("record_payment", [paymentId, quoteHash, buyer]);
}

export async function markSettled(
  paymentId: string, settleRef: string,
): Promise<OperatorWrite> {
  return operatorWrite("mark_settled", [paymentId, settleRef]);
}
