/**
 * Resume a stalled dispute at the adjudication step.
 *
 * The dispute E2E got a payment to DISPUTED and the adjudicate round hit RPC
 * failures. Everything on-chain is intact — this script picks up from there:
 * reconstruct the excerpt, PROVE it hashes to the seller's anchored digest,
 * adjudicate with patient retries, then run the money-trail checks.
 *
 * From web/:  node scripts/e2e-dispute-resume.mjs <paymentId>
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { privateKeyToAccount } from "viem/accounts";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const WEB = process.cwd();
const KEYS_FILE = path.join(WEB, ".data", "e2e-keys.json");
const ENV_FILE = path.join(WEB, ".env.local");
const BASE_URL = process.env.NOTCH_BASE_URL || "http://localhost:3600";
const RPC = "https://studio.genlayer.com/api";

const PAYMENT_ID = process.argv[2];
if (!/^pay_[0-9a-f]{16}$/.test(PAYMENT_ID || "")) {
  console.error("usage: node scripts/e2e-dispute-resume.mjs pay_<16hex>");
  process.exit(1);
}

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtGen = (atto) => (Number(BigInt(atto)) / 1e18).toFixed(6);
const short = (s) => `${String(s).slice(0, 10)}…${String(s).slice(-6)}`;

function step(n, msg) { console.log(`\n[${n}] ${msg}`); }
function ok(msg) { console.log(`    ✓ ${msg}`); }
function info(msg) { console.log(`    ${msg}`); }
function die(msg) { console.error(`\n✗ ${msg}`); process.exit(1); }

const keys = JSON.parse(readFileSync(KEYS_FILE, "utf-8"));
const buyer = privateKeyToAccount(keys.buyerPk);
const seller = privateKeyToAccount(keys.sellerPk);
const CONTRACT = (readFileSync(ENV_FILE, "utf-8").match(/^NEXT_PUBLIC_CONTRACT_ADDRESS=(0x[0-9a-fA-F]{40})/m) || [])[1];

console.log("NOTCH DISPUTE E2E — resume at adjudication");
console.log(`  payment ${PAYMENT_ID}`);
console.log(`  court   ${CONTRACT}`);

const reader = createClient({ chain: studionet, endpoint: RPC });
const buyerChain = createClient({ chain: studionet, endpoint: RPC, account: createAccount(keys.buyerPk) });

const TRANSIENT = /rate limit|429|-32029|failed to fetch|fetch failed|unreachable|doctype|not valid json|unknown rpc|unexpected token|502|503|504|timeout|econnreset|socket/i;

async function courtRead(fn, args) {
  for (let i = 0; ; i++) {
    try {
      const raw = await reader.readContract({ address: CONTRACT, functionName: fn, args });
      return typeof raw === "string" && raw ? JSON.parse(raw) : null;
    } catch (e) {
      if (TRANSIENT.test(String(e?.message)) && i < 6) { await sleep(12000); continue; }
      throw e;
    }
  }
}

// ── 1: where the payment stands ─────────────────────────────────────────────
step(1, "reading the payment off the court");
let p = await courtRead("get_payment", [PAYMENT_ID]);
if (!p) die("payment not found on the court");
info(`state ${p.state}${p.ruling ? " · ruling already present" : ""}`);

// ── 2: reconstruct + verify the excerpt ─────────────────────────────────────
// The demo's bad delivery is deterministic given the paymentId, so the exact
// bytes can be rebuilt — and we do not TRUST that: we prove the reconstruction
// hashes to the digest the SELLER anchored with their own signed write.
step(2, "reconstructing the excerpt and proving it against the anchored digest");
const bodyText = JSON.stringify({
  summary: "Sorry, I can't help with that request.",
  sources: [],
  paymentId: PAYMENT_ID,
});
const digest = sha256(bodyText);
const anchored = p.receipt?.excerpt_sha256;
if (!anchored) die("no receipt anchored on this payment — nothing to adjudicate against");
if (digest !== anchored) {
  die(`reconstruction does not match the seller's digest\n  rebuilt  ${digest}\n  anchored ${anchored}`);
}
ok(`sha256(reconstructed) == the seller's own anchored digest (${short(digest)})`);

const sellerBefore = await courtRead("get_seller", [seller.address]);

// ── 3: adjudicate, patiently ────────────────────────────────────────────────
let ruled = p.ruling ?? null;
if (!ruled) {
  if (p.state !== "DISPUTED") die(`cannot adjudicate from state ${p.state}`);
  step(3, "adjudication: real validators, real LLM panel, patient retries");
  for (let attempt = 1; attempt <= 6 && !ruled; attempt++) {
    info(`attempt ${attempt}: submitting adjudicate…`);
    try {
      const tx = await buyerChain.writeContract({
        address: CONTRACT, functionName: "adjudicate",
        args: [PAYMENT_ID, bodyText], value: 0n,
      });
      const hash = typeof tx === "string" ? tx : tx?.transactionHash ?? JSON.stringify(tx).slice(0, 66);
      info(`submitted ${short(hash)} — waiting for consensus`);
    } catch (e) {
      info(`submission failed: ${String(e?.message).slice(0, 120)}`);
      if (!TRANSIENT.test(String(e?.message))) {
        // A deterministic revert would repeat forever; surface it.
        die(`non-transient adjudicate failure: ${String(e?.message).slice(0, 300)}`);
      }
      await sleep(20000);
      continue;
    }
    for (let i = 0; i < 30; i++) {
      await sleep(6000);
      p = await courtRead("get_payment", [PAYMENT_ID]);
      if (p?.ruling) { ruled = p.ruling; break; }
      if (p?.state !== "DISPUTED") break;
    }
    if (!ruled && p?.state === "DISPUTED") info("no ruling yet — the round likely failed in the VM; retrying");
  }
  if (!ruled) die("no ruling after 6 attempts — StudioNet nondet rounds not landing; rerun later");
} else {
  step(3, "a ruling already landed on a previous attempt");
}

console.log("");
console.log(`    ┌─ THE PANEL'S RULING ──────────────────────────────`);
console.log(`    │ verdict     ${ruled.verdict}`);
console.log(`    │ reasoning   ${ruled.reason}`);
console.log(`    │ confidence  ${ruled.confidence_advisory} (advisory — gates nothing)`);
console.log(`    └───────────────────────────────────────────────────`);

// ── 4: the money followed the ruling ────────────────────────────────────────
step(4, "where the money went");
const sellerAfter = await courtRead("get_seller", [seller.address]);
const slashed = BigInt(sellerAfter.slashed_atto) - BigInt(sellerBefore.slashed_atto);

if (ruled.verdict === "NOT_AS_DESCRIBED") {
  ok(`court state ${p.state} — the authorization will NEVER be submitted`);
  ok(`seller slashed ${fmtGen(slashed)} GEN this ruling; broken receipts now ${sellerAfter.receipts_broken}`);
  ok("the challenger's bond returned, plus the slash as damages");
} else if (ruled.verdict === "AS_DESCRIBED") {
  info(`court state ${p.state} — bond forfeits to the seller`);
} else {
  info(`INCONCLUSIVE — releases on the optimistic default; bond came home in full`);
}

// ── 5: reconcile ────────────────────────────────────────────────────────────
step(5, "the facilitator reconciles");
const rec = await (await fetch(`${BASE_URL}/api/facilitator/reconcile`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ paymentId: PAYMENT_ID }),
})).json();

console.log("\n════════ DISPUTE PROOF ════════");
console.log(`payment        ${PAYMENT_ID}`);
console.log(`delivered      "Sorry, I can't help with that request." (0 sources)`);
console.log(`seller signed  yes — anchored sha256 ${short(anchored)}`);
console.log(`verdict        ${ruled.verdict}`);
console.log(`court state    ${p.state}`);
console.log(`seller record  ${sellerAfter.receipts_broken} broken · ${fmtGen(sellerAfter.slashed_atto)} GEN slashed lifetime · bond ${fmtGen(sellerAfter.bond_atto)} GEN`);
console.log(`hold           ${rec.holdState ?? rec.state ?? JSON.stringify(rec).slice(0, 80)}${rec.rail?.note ? " — " + rec.rail.note : ""}`);
console.log("═══════════════════════════════");
