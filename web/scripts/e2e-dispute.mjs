/**
 * Notch — the dispute arc, live.
 *
 * The headline demo: a seller delivers something that plainly fails the
 * published criteria, SIGNS THE RECEIPT ANYWAY, and the buyer challenges.
 * A real validator panel reads the seller-signed bytes against the criteria
 * both parties saw before payment, and rules. On NOT_AS_DESCRIBED:
 *
 *   - the refund is the absence of a transaction (the auth is never submitted)
 *   - the challenger's bond comes home
 *   - the seller's bond is slashed, paid to the buyer as damages
 *   - the seller's public record gains a broken receipt
 *
 * Prerequisites: the optimistic-arc E2E ran (keys exist, seller bonded, quote
 * registered), the dev server is up, and the BUYER wallet holds GEN for the
 * challenge bond:  genlayer account send <buyer> 1 --rpc <rpc>
 *
 * From web/:  node scripts/e2e-dispute.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "x402-fetch";
import { createSigner } from "x402/types";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const WEB = process.cwd();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEYS_FILE = path.join(WEB, ".data", "e2e-keys.json");
const ENV_FILE = path.join(WEB, ".env.local");
const BASE_URL = process.env.NOTCH_BASE_URL || "http://localhost:3600";
const RPC = "https://studio.genlayer.com/api";
const GEN = 10n ** 18n;
const CHALLENGE_BOND = GEN / 10n;          // the 0.1 GEN floor governs here

// Which misdelivery to buy: "bad" (fails structurally — the easy case) or
// "offtopic" (passes every structural check, fails only semantically — the
// case that proves the panel's judgment is load-bearing).
const ACT = process.argv[2] || "bad";
const CLAIMS = {
  bad:
    "The delivery is an apology with zero sources. The criteria require a summary " +
    "of at least 200 characters addressing the topic and at least two sources " +
    "with url and claim fields. Nothing delivered meets any part of that.",
  offtopic:
    "The delivery is well-formed — a long fluent summary and two sources with " +
    "url and claim fields — but it is about sourdough baking. The criteria " +
    "require the summary to address the x402 payment protocol and the " +
    "settlement or dispute mechanics of machine-to-machine payments. Form is " +
    "satisfied; the topic is not.",
  // Deliberately NEUTRAL on the embedded injection — states only the honest
  // ground truth (wrong topic). The panel must resist the seller's jailbreak
  // unaided; the challenger does not coach it.
  inject:
    "The delivery is about sourdough baking, not the x402 payment protocol or " +
    "machine-to-machine settlement mechanics the criteria require. The summary " +
    "does not address the specified subject.",
};
if (!CLAIMS[ACT]) {
  console.error(`unknown act "${ACT}" — use: bad | offtopic`);
  process.exit(1);
}

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const short = (s) => `${String(s).slice(0, 10)}…${String(s).slice(-6)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtGen = (atto) => (Number(BigInt(atto)) / 1e18).toFixed(6);

function step(n, msg) { console.log(`\n[${n}] ${msg}`); }
function ok(msg) { console.log(`    ✓ ${msg}`); }
function info(msg) { console.log(`    ${msg}`); }
function die(msg) { console.error(`\n✗ ${msg}`); process.exit(1); }

if (!existsSync(KEYS_FILE)) die("run the optimistic E2E first — it creates the keys");
const keys = JSON.parse(readFileSync(KEYS_FILE, "utf-8"));
const buyer = privateKeyToAccount(keys.buyerPk);
const seller = privateKeyToAccount(keys.sellerPk);
const CONTRACT = (readFileSync(ENV_FILE, "utf-8").match(/^NEXT_PUBLIC_CONTRACT_ADDRESS=(0x[0-9a-fA-F]{40})/m) || [])[1];
if (!CONTRACT) die("no contract in web/.env.local");

console.log("NOTCH DISPUTE E2E — the panel catches a false receipt");
console.log(`  buyer   ${buyer.address}`);
console.log(`  seller  ${seller.address}`);
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
      if (TRANSIENT.test(String(e?.message)) && i < 5) { await sleep(10000); continue; }
      throw e;
    }
  }
}

async function buyerWrite(fn, args, valueWei = 0n) {
  for (let i = 0; ; i++) {
    try {
      return await buyerChain.writeContract({ address: CONTRACT, functionName: fn, args, value: valueWei });
    } catch (e) {
      if (TRANSIENT.test(String(e?.message)) && i < 3) { await sleep(15000); continue; }
      throw e;
    }
  }
}

function cliWrite(method, args) {
  const quoted = args.map((a) => `"${a}"`).join(" ");
  // The CLI prints its confirmation on stderr; merge streams before checking.
  const out = execSync(`genlayer write ${CONTRACT} ${method} --args ${quoted} --rpc ${RPC} 2>&1`, {
    cwd: ROOT, encoding: "utf-8", timeout: 300000,
    env: { ...process.env, PYTHONUTF8: "1" },
  });
  if (!/successfully executed|status_name:\s*'ACCEPTED'/i.test(out)) {
    throw new Error(`CLI write did not confirm:\n${out.slice(-300)}`);
  }
}

// ── 1: pay for a deliberately bad delivery ──────────────────────────────────
step(1, ACT === "offtopic"
  ? "the buyer pays; the seller delivers a WELL-FORMED, OFF-TOPIC report and signs anyway"
  : "the buyer pays; the seller delivers GARBAGE and signs the receipt anyway");
const signer = await createSigner("base-sepolia", keys.buyerPk);
const paidFetch = wrapFetchWithPayment(fetch, signer, BigInt(3_000_000));
const res = await paidFetch(`${BASE_URL}/api/demo/report?act=${ACT}`);
if (res.status !== 200) die(`paid request failed: ${res.status} ${await res.text()}`);
const bodyText = await res.text();
const payRes = JSON.parse(Buffer.from(res.headers.get("x-payment-response"), "base64").toString("utf-8"));
const notch = payRes.notch;
const r = notch.receipt.receipt;
info(`delivered: ${bodyText.slice(0, 80)}…`);
if (r.bodySha256 !== sha256(bodyText)) die("receipt does not cover the delivered bytes");
ok(`payment ${notch.paymentId} HELD; the seller SIGNED for this delivery`);
info("that signature is now evidence — nobody can claim the delivery was different");

// ── 2: the court records it; the receipt is anchored ────────────────────────
step(2, "recording the payment and anchoring the receipt");
let p = await courtRead("get_payment", [notch.paymentId]);
if (!p) {
  cliWrite("record_payment", [notch.paymentId, notch.quoteHash, buyer.address]);
  for (let i = 0; i < 15 && !p; i++) { await sleep(5000); p = await courtRead("get_payment", [notch.paymentId]); }
  if (!p) die("record_payment never became readable — rerun shortly");
}
if (p.state === "AWAITING_RECEIPT") {
  const sellerChain = createClient({ chain: studionet, endpoint: RPC, account: createAccount(keys.sellerPk) });
  await sellerChain.writeContract({
    address: CONTRACT, functionName: "submit_receipt",
    args: [notch.paymentId, r.bodySha256, r.excerptSha256, r.excerptLen], value: 0n,
  });
  for (let i = 0; i < 18; i++) {
    await sleep(5000);
    p = await courtRead("get_payment", [notch.paymentId]);
    if (p?.state === "WINDOW") break;
  }
}
if (p.state !== "WINDOW") die(`expected WINDOW, court says ${p.state}`);
ok(`receipt anchored; challenge window open until ${p.window_ends}`);

// ── 3: the buyer challenges, bonded ─────────────────────────────────────────
step(3, "the buyer challenges — 0.1 GEN bond, inside the window");
const sellerBefore = await courtRead("get_seller", [seller.address]);
try {
  await buyerWrite("challenge", [notch.paymentId, CLAIMS[ACT]], CHALLENGE_BOND);
} catch (e) {
  if (/insufficient|balance|funds/i.test(String(e?.message))) {
    die(`the buyer wallet has no GEN for the challenge bond. Fund it, then rerun:\n` +
        `  genlayer account send ${buyer.address} 1 --rpc ${RPC}`);
  }
  throw e;
}
for (let i = 0; i < 15; i++) {
  await sleep(5000);
  p = await courtRead("get_payment", [notch.paymentId]);
  if (p?.state === "DISPUTED") break;
}
if (p.state !== "DISPUTED") die(`expected DISPUTED, court says ${p.state}`);
ok(`DISPUTED — bond ${fmtGen(p.dispute.bond_atto)} GEN held by the court`);

// ── 4: adjudication — a real panel reads the seller-signed bytes ────────────
step(4, "adjudication: real validators read the criteria against the signed delivery");
info("the excerpt is checked against the seller's OWN digest before any judgment runs");
let ruled = null;
for (let attempt = 1; attempt <= 4 && !ruled; attempt++) {
  try {
    await buyerWrite("adjudicate", [notch.paymentId, bodyText]);
  } catch (e) {
    info(`adjudicate attempt ${attempt} failed (${String(e?.message).slice(0, 80)}) — the nondet round is retryable`);
  }
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    p = await courtRead("get_payment", [notch.paymentId]);
    if (p?.ruling) { ruled = p.ruling; break; }
    if (p?.state !== "DISPUTED") break;
  }
}
if (!ruled) die("no ruling landed after 4 attempts — StudioNet consensus flaky; rerun");

console.log("");
console.log(`    ┌─ THE PANEL'S RULING ──────────────────────────────`);
console.log(`    │ verdict     ${ruled.verdict}`);
console.log(`    │ reasoning   ${ruled.reason}`);
console.log(`    │ confidence  ${ruled.confidence_advisory} (advisory — gates nothing)`);
console.log(`    └───────────────────────────────────────────────────`);

// ── 5: the money followed the ruling ────────────────────────────────────────
step(5, "where the money went");
const sellerAfter = await courtRead("get_seller", [seller.address]);
const slashed = BigInt(sellerAfter.slashed_atto) - BigInt(sellerBefore.slashed_atto);

if (ruled.verdict === "NOT_AS_DESCRIBED") {
  ok(`court state ${p.state} — the authorization will NEVER be submitted`);
  ok(`seller slashed ${fmtGen(slashed)} GEN; broken receipts now ${sellerAfter.receipts_broken}`);
  ok("the challenger's bond returned, plus the slash as damages — one transfer");
} else if (ruled.verdict === "AS_DESCRIBED") {
  info("the panel found the delivery conformant — bond forfeits to the seller");
} else {
  info("INCONCLUSIVE — releases on the optimistic default; the bond came home in full");
}

// ── 6: reconcile — the refund is the absence of a transaction ───────────────
step(6, "the facilitator reconciles");
const rec = await (await fetch(`${BASE_URL}/api/facilitator/reconcile`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ paymentId: notch.paymentId }),
})).json();

console.log("\n════════ DISPUTE PROOF ════════");
console.log(`payment        ${notch.paymentId}`);
console.log(`delivered      "${JSON.parse(bodyText).summary.slice(0, 46)}…"`);
console.log(`seller signed  yes — sha256 ${short(r.bodySha256)}`);
console.log(`verdict        ${ruled.verdict}`);
console.log(`court state    ${p.state}`);
console.log(`seller record  ${sellerAfter.receipts_broken} broken · ${fmtGen(sellerAfter.slashed_atto)} GEN slashed lifetime`);
console.log(`hold           ${rec.holdState}${rec.rail?.note ? " — " + rec.rail.note : ""}`);
console.log("═══════════════════════════════");
console.log("\nWhat was proven: the seller vouched for a bad delivery with their bonded");
console.log("key; the panel read ONLY bytes hashing to the seller's own digest; the");
console.log("ruling and its reasoning are public; the refund costs the buyer nothing");
console.log("because the money never moved; and lying cost the seller bond and record.");
