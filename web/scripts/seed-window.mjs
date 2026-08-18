/**
 * Seed a payment and leave it IN ITS CHALLENGE WINDOW, so a human can file a
 * challenge from the browser (console record page → "Dispute this payment").
 *
 * It runs the honest first half of the arc — pay the 402, record the hold,
 * anchor the seller's receipt — and then STOPS. The payment sits in WINDOW
 * for the full window duration; open the printed URL and challenge it with a
 * connected wallet before the clock runs out.
 *
 * The window comes from the 402 (NEXT_PUBLIC_NOTCH_WINDOW_SECONDS). For a
 * comfortable browser flow that should be ~600s; this script warns if the
 * served window is too short to click through.
 *
 * From web/:  node scripts/seed-window.mjs [bad|offtopic|inject]
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
const ACT = process.argv[2] || "offtopic";

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (m) => { console.error(`\n✗ ${m}`); process.exit(1); };
const ok = (m) => console.log(`    ✓ ${m}`);

if (!existsSync(KEYS_FILE)) die("run scripts/e2e.mjs first — it creates the keys and bonds the seller");
const keys = JSON.parse(readFileSync(KEYS_FILE, "utf-8"));
const buyer = privateKeyToAccount(keys.buyerPk);
const CONTRACT = (readFileSync(ENV_FILE, "utf-8").match(/^NEXT_PUBLIC_CONTRACT_ADDRESS=(0x[0-9a-fA-F]{40})/m) || [])[1];
if (!CONTRACT) die("no contract in web/.env.local");

const reader = createClient({ chain: studionet, endpoint: RPC });
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

async function cliWrite(method, args) {
  const quoted = args.map((a) => `"${a}"`).join(" ");
  for (let attempt = 1; ; attempt++) {
    let out = "";
    try {
      out = execSync(`genlayer write ${CONTRACT} ${method} --args ${quoted} --rpc ${RPC} 2>&1`, {
        cwd: ROOT, encoding: "utf-8", timeout: 300000, env: { ...process.env, PYTHONUTF8: "1" },
      });
    } catch (e) {
      out = String(e?.stdout || e?.message || "");
    }
    if (/successfully executed|status_name:\s*'ACCEPTED'/i.test(out)) return;
    // StudioNet drops connections under load; the submission may simply not
    // have been sent. Retry transient failures rather than aborting the seed.
    if (TRANSIENT.test(out) && attempt < 5) {
      console.log(`    (record_payment attempt ${attempt} hit a transient RPC error — retrying)`);
      await sleep(15000);
      continue;
    }
    throw new Error(`CLI write did not confirm:\n${out.slice(-300)}`);
  }
}

console.log(`SEED A CHALLENGEABLE PAYMENT — act=${ACT}`);
console.log(`  court ${CONTRACT}`);

const sellerChain = createClient({ chain: studionet, endpoint: RPC, account: createAccount(keys.sellerPk) });

// 0: the served terms bind a quote hash; if the window (or anything) changed,
// that hash is new and must be registered before a payment can record against
// it. Register it here so the seed is self-contained across window changes.
const quoteRes = await (await fetch(`${BASE_URL}/api/demo/report`)).json();
const served = quoteRes.accepts?.[0];
if (!served) die("could not read the 402 quote");
const terms = served.extra;
const servedHash = terms.quoteHash;
let existing = await courtRead("get_quote", [servedHash]);
if (!existing) {
  console.log(`    quote ${servedHash.slice(0, 10)}… not registered (window ${terms.windowSeconds}s) — registering`);
  await sellerChain.writeContract({
    address: CONTRACT, functionName: "register_quote",
    args: [terms.criteria, terms.windowSeconds, served.maxAmountRequired, served.asset],
    value: 0n,
  });
  for (let i = 0; i < 40 && !existing; i++) { await sleep(6000); existing = await courtRead("get_quote", [servedHash]); }
  if (!existing) die("register_quote never became readable — StudioNet lag; rerun shortly");
  ok(`quote registered on the court`);
} else {
  ok(`quote already registered`);
}

// 1: pay the 402 (the delivery is the chosen misbehavior; the seller signs it)
const signer = await createSigner("base-sepolia", keys.buyerPk);
const paidFetch = wrapFetchWithPayment(fetch, signer, BigInt(3_000_000));
const res = await paidFetch(`${BASE_URL}/api/demo/report?act=${ACT}`);
if (res.status !== 200) die(`paid request failed: ${res.status} ${await res.text()}`);
const bodyText = await res.text();
const payRes = JSON.parse(Buffer.from(res.headers.get("x-payment-response"), "base64").toString("utf-8"));
const notch = payRes.notch;
const r = notch.receipt.receipt;
if (r.bodySha256 !== sha256(bodyText)) die("receipt does not cover the delivered bytes");
ok(`payment ${notch.paymentId} HELD; seller signed the delivery`);

// 2: record + anchor the receipt → the window opens
let p = await courtRead("get_payment", [notch.paymentId]);
if (!p) {
  await cliWrite("record_payment", [notch.paymentId, notch.quoteHash, buyer.address]);
  // StudioNet finalization can lag a minute or two behind a confirmed write.
  for (let i = 0; i < 40 && !p; i++) { await sleep(6000); p = await courtRead("get_payment", [notch.paymentId]); }
  if (!p) die("record_payment never became readable — StudioNet lag; rerun shortly");
}
if (p.state === "AWAITING_RECEIPT") {
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

const secondsLeft = Number(p.window_ends) - Math.floor(Date.now() / 1000);
ok(`receipt anchored — the payment is now CHALLENGEABLE`);

console.log("\n════════ READY TO CHALLENGE ════════");
console.log(`payment   ${notch.paymentId}`);
console.log(`open      ${BASE_URL}/console/p/${notch.paymentId}`);
console.log(`window    ~${Math.max(0, Math.floor(secondsLeft / 60))}m ${Math.max(0, secondsLeft % 60)}s left`);
console.log(`buyer     ${buyer.address}`);
console.log("════════════════════════════════════");
if (secondsLeft < 240) {
  console.log("\n⚠ the window is short for a hand-driven challenge. For ~10 minutes,");
  console.log("  set NEXT_PUBLIC_NOTCH_WINDOW_SECONDS=600 in web/.env.local, restart");
  console.log("  the dev server, and rerun this script.");
}
console.log("\nTo challenge in the browser you must connect the BUYER wallet above.");
console.log("Its key is in web/.data/e2e-keys.json (buyerPk) — import it into your");
console.log("wallet, add StudioNet, and open the URL. Or challenge headlessly:");
console.log(`  node scripts/e2e-dispute.mjs ${ACT === "bad" ? "bad" : ACT === "inject" ? "inject" : "offtopic"}`);
