/**
 * The hold store — where held authorizations live.
 *
 * This is the most sensitive data Notch touches: a stored authorization IS
 * the ability to move the buyer's money to the seller (and nowhere else —
 * the signature pins recipient and amount). Losing one fails SAFE for the
 * buyer (funds never move) and unfairly for the seller (delivered work,
 * no payment), so durability is a fairness property, not just hygiene.
 *
 * The interface is narrow so the backing store can change without touching
 * callers. Two adapters:
 *
 *   FileHoldStore — dev-grade, a JSON file under .data/ (gitignored). Fine
 *   for local development and the E2E proof; stated plainly as such.
 *
 *   The production adapter (Supabase, service-role only) slots in behind the
 *   same interface when the project is provisioned. Until it exists, nothing
 *   here pretends otherwise.
 *
 * Idempotency is by AUTHORIZATION NONCE, not payment id: the nonce is the
 * token-level replay slot, so two holds with one nonce can never both settle
 * — refusing the second at storage time surfaces the conflict where it can
 * still be handled.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Authorization } from "@/lib/x402/eip3009";

export type StoredHold = {
  paymentId: string;
  quoteHash: string;
  network: string;
  asset: string;
  authorization: Authorization;
  signature: string;
  state: "HELD" | "SUBMITTED" | "RELEASED" | "REFUNDED" | "FAILED";
  /** Rail outcome once known: tx hash on release, expiry note on refund. */
  settleRef: string | null;
  createdAt: number;
  updatedAt: number;
};

export interface HoldStore {
  /** Stores a new hold. Throws if the nonce is already held. */
  put(hold: Omit<StoredHold, "state" | "settleRef" | "createdAt" | "updatedAt">): Promise<StoredHold>;
  get(paymentId: string): Promise<StoredHold | null>;
  /** State transition with optional rail reference. Returns the updated hold. */
  transition(paymentId: string, state: StoredHold["state"], settleRef?: string): Promise<StoredHold>;
  list(): Promise<StoredHold[]>;
}

// Prefer .data/ next to the app; fall back to the OS temp dir on hosts whose
// project filesystem is read-only (Vercel and most serverless runtimes expose
// only their temp dir as writable). The temp dir is per-instance and ephemeral
// — fine for this dev-grade store, whose durable production replacement is the
// Supabase adapter noted above. Resolved once, then reused.
let resolvedDir: string | null = null;
async function dataDir(): Promise<string> {
  if (resolvedDir) return resolvedDir;
  const preferred = path.join(process.cwd(), ".data");
  try {
    await fs.mkdir(preferred, { recursive: true });
    // Probe writability — mkdir can succeed on a read-only mount for an
    // already-present dir, so confirm we can actually write.
    await fs.writeFile(path.join(preferred, ".probe"), "", "utf-8");
    resolvedDir = preferred;
  } catch {
    resolvedDir = path.join(os.tmpdir(), "notch-holds");
    await fs.mkdir(resolvedDir, { recursive: true }).catch(() => {});
  }
  return resolvedDir;
}

export class FileHoldStore implements HoldStore {
  private async read(): Promise<Record<string, StoredHold>> {
    try {
      return JSON.parse(await fs.readFile(path.join(await dataDir(), "holds.json"), "utf-8"));
    } catch {
      return {};
    }
  }

  private async write(all: Record<string, StoredHold>): Promise<void> {
    const dir = await dataDir();
    const file = path.join(dir, "holds.json");
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all, null, 2), "utf-8");
    await fs.rename(tmp, file);   // atomic on the same volume
  }

  async put(hold: Omit<StoredHold, "state" | "settleRef" | "createdAt" | "updatedAt">): Promise<StoredHold> {
    const all = await this.read();
    if (all[hold.paymentId]) {
      throw new Error(`payment ${hold.paymentId} is already held`);
    }
    const nonce = hold.authorization.nonce.toLowerCase();
    for (const existing of Object.values(all)) {
      if (existing.authorization.nonce.toLowerCase() === nonce) {
        // One nonce, one settlement — the token enforces it on-chain, so the
        // store must refuse it here where the conflict is still visible.
        throw new Error(`authorization nonce already held under payment ${existing.paymentId}`);
      }
    }
    const now = Date.now();
    const stored: StoredHold = { ...hold, state: "HELD", settleRef: null, createdAt: now, updatedAt: now };
    all[hold.paymentId] = stored;
    await this.write(all);
    return stored;
  }

  async get(paymentId: string): Promise<StoredHold | null> {
    return (await this.read())[paymentId] ?? null;
  }

  async transition(paymentId: string, state: StoredHold["state"], settleRef?: string): Promise<StoredHold> {
    const all = await this.read();
    const hold = all[paymentId];
    if (!hold) throw new Error(`no hold for payment ${paymentId}`);

    const allowed: Record<StoredHold["state"], StoredHold["state"][]> = {
      HELD: ["SUBMITTED", "REFUNDED", "FAILED"],
      SUBMITTED: ["RELEASED", "FAILED"],
      RELEASED: [],
      REFUNDED: [],
      FAILED: ["SUBMITTED"],   // a failed submission may be retried
    };
    if (!allowed[hold.state].includes(state)) {
      throw new Error(`hold ${paymentId}: illegal transition ${hold.state} -> ${state}`);
    }
    hold.state = state;
    if (settleRef !== undefined) hold.settleRef = settleRef;
    hold.updatedAt = Date.now();
    await this.write(all);
    return hold;
  }

  async list(): Promise<StoredHold[]> {
    return Object.values(await this.read());
  }
}

let store: HoldStore | null = null;

/** The process-wide store. File-backed until the Supabase adapter lands. */
export function holdStore(): HoldStore {
  if (!store) store = new FileHoldStore();
  return store;
}
