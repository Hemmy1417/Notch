/**
 * Notch — the Phase 3 proof, end to end.
 *
 * A genuine, unmodified x402-fetch client pays our 402. The facilitator
 * verifies the EIP-3009 signature for real, HOLDS the authorization, and the
 * seller signs a delivery receipt over the exact bytes delivered. Then the
 * court takes over: the payment is recorded, the receipt anchored on-chain by
 * the seller's own bonded wallet, the window runs, and the ruling drives the
 * rail.
 *
 * Run it twice the first time:
 *   1st run  generates keys, writes env, asks for a dev-server restart
 *   2nd run  walks the whole arc and prints the proof
 *
 * From web/:  node scripts/e2e.mjs
 *
 * Honest degradation, stated up front:
 *   - no GEN on the seller  -> stops with the exact funding command
 *   - no SETTLEMENT_PRIVATE_KEY -> the release is a reported dry run
 *   - the window wait is real seconds; the script says what it is waiting for
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { wrapFetchWithPayment } from "x402-fetch";
import { createSigner } from "x402/types";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const WEB = process.cwd();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");  // Notch/
const DATA = path.join(WEB, ".data");
const KEYS_FILE = path.join(DATA, "e2e-keys.json");
const ENV_FILE = path.join(WEB, ".env.local");

const BASE_URL = process.env.NOTCH_BASE_URL || "http://localhost:3000";
const RPC = "https://studio.genlayer.com/api";
const WINDOW = 60;                       // the contract's minimum — a real wait
const GEN = 10n ** 18n;

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const short = (s) => `${String(s).slice(0, 10)}…${String(s).slice(-6)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function step(n, msg) { console.log(`\n[${n}] ${msg}`); }
function ok(msg) { console.log(`    ✓ ${msg}`); }
function info(msg) { console.log(`    ${msg}`); }
function die(msg) { console.error(`\n✗ ${msg}`); process.exit(1); }

// ── keys and env ─────────────────────────────────────────────────────────────

function loadKeys() {
  mkdirSync(DATA, { recursive: true });
  if (existsSync(KEYS_FILE)) return JSON.parse(readFileSync(KEYS_FILE, "utf-8"));
  const keys = { buyerPk: generatePrivateKey(), sellerPk: generatePrivateKey() };
  writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
  return keys;
}

function upsertEnv(pairs) {
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf-8") : "";
  let changed = false;
  for (const [key, value] of Object.entries(pairs)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) {
      if (!text.match(re)[0].endsWith(`=${value}`)) { text = text.replace(re, line); changed = true; }
    } else {
      text = text.trimEnd() + `\n${line}\n`;
      changed = true;
    }
  }
  if (changed) writeFileSync(ENV_FILE, text);
  return changed;
}

// ── the arc ──────────────────────────────────────────────────────────────────

const keys = loadKeys();
const buyer = privateKeyToAccount(keys.buyerPk);
const seller = privateKeyToAccount(keys.sellerPk);
const CONTRACT = (readFileSync(ENV_FILE, "utf-8").match(/^NEXT_PUBLIC_CONTRACT_ADDRESS=(0x[0-9a-fA-F]{40})/m) || [])[1];
if (!CONTRACT) die("NEXT_PUBLIC_CONTRACT_ADDRESS missing from web/.env.local");

console.log("NOTCH E2E — a held payment, end to end");
console.log(`  buyer   ${buyer.address}`);
console.log(`  seller  ${seller.address}`);
console.log(`  court   ${CONTRACT}`);

step(0, "environment");
const envChanged = upsertEnv({
  NOTCH_DEMO_SELLER: seller.address,
  NOTCH_DEMO_SELLER_PRIVATE_KEY: keys.sellerPk,
  NEXT_PUBLIC_NOTCH_WINDOW_SECONDS: String(WINDOW),
});
if (envChanged) {
  die("web/.env.local was updated with the demo seller + a 60s window.\n" +
      "  Restart the dev server (npm run dev) and run this script again.");
}
ok("env already matches the generated keys");

// server up?
let probe;
try {
  probe = await fetch(`${BASE_URL}/api/demo/report`);
} catch {
  die(`no server at ${BASE_URL} — start it with: npm run dev`);
}
if (probe.status !== 402) die(`expected a 402 from the unpaid endpoint, got ${probe.status}`);
ok("the unpaid endpoint answers 402 — a real x402 quote");

// ── genlayer clients ────────────────────────────────────────────────────────
const sellerChain = createClient({ chain: studionet, endpoint: RPC, account: createAccount(keys.sellerPk) });
const reader = createClient({ chain: studionet, endpoint: RPC });

const TRANSIENT = /rate limit|429|-32029|failed to fetch|unreachable|doctype|not valid json|unknown rpc|unexpected token|502|503|504|timeout|econnreset/i;

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

async function sellerWrite(fn, args, valueWei = 0n) {
  for (let i = 0; ; i++) {
    try {
      return await sellerChain.writeContract({
        address: CONTRACT, functionName: fn, args, value: valueWei,
      });
    } catch (e) {
      if (TRANSIENT.test(String(e?.message)) && i < 3) { await sleep(15000); continue; }
      throw e;
    }
  }
}

function cliWrite(method, args) {
  // Operator writes go through the CLI, whose active unlocked account IS the
  // contract's operator. --args types: plain strings.
  const quoted = args.map((a) => `"${a}"`).join(" ");
  const cmd = `genlayer write ${CONTRACT} ${method} --args ${quoted} --rpc ${RPC}`;
  info(`operator (CLI): ${method}`);
  const out = execSync(cmd, {
    cwd: ROOT, encoding: "utf-8", timeout: 300000,
    env: { ...process.env, PYTHONUTF8: "1" },
  });
  if (!/successfully|Transaction Hash|ACCEPTED/i.test(out)) {
    throw new Error(`CLI write did not confirm:\n${out.slice(-400)}`);
  }
  return out;
}

// ── 1: the seller is bonded, or we bond them ────────────────────────────────
step(1, "the seller's identity costs something (bond on the court)");
let sellerRec = await courtRead("get_seller", [seller.address]);
if (!sellerRec) {
  info("seller is not registered — bonding 1 GEN");
  try {
    await sellerWrite("register_seller", [], GEN);
  } catch (e) {
    if (/insufficient|balance|funds/i.test(String(e?.message))) {
      die(`the seller wallet has no GEN for its bond. Fund it, then rerun:\n` +
          `  genlayer account send ${seller.address} 2 --rpc ${RPC}`);
    }
    throw e;
  }
  // reads are ground truth — poll past lag
  for (let i = 0; i < 12 && !sellerRec; i++) { await sleep(5000); sellerRec = await courtRead("get_seller", [seller.address]); }
  if (!sellerRec) die("register_seller submitted but the seller never appeared — StudioNet lag; rerun in a minute");
}
ok(`seller bonded: ${sellerRec.bond_atto} atto, ${sellerRec.reserved_atto} reserved`);

// ── 2: the quote is registered — the SAME terms the 402 serves ─────────────
step(2, "terms bound before money (quote on the court)");
const q402 = await (await fetch(`${BASE_URL}/api/demo/report`)).json();
const served = q402.accepts[0];
const servedHash = served.extra.quoteHash;
info(`the 402 serves quoteHash ${short(servedHash)}`);

let quote = await courtRead("get_quote", [servedHash]);
if (!quote) {
  info("registering the identical quote on-chain");
  await sellerWrite("register_quote", [
    served.extra.criteria,
    served.extra.windowSeconds,
    served.maxAmountRequired,
    served.asset,
  ]);
  for (let i = 0; i < 12 && !quote; i++) { await sleep(5000); quote = await courtRead("get_quote", [servedHash]); }
  if (!quote) die("register_quote submitted but the quote never appeared under the served hash — " +
                  "if this persists, the TS/Python canonicalization has drifted (see quote-hash tests)");
}
ok(`the court holds the same quote hash the 402 served — TS/Python parity live`);

// ── 3: an unmodified x402 client pays ───────────────────────────────────────
step(3, "a real x402-fetch client pays the 402");

// Before signing anything: prove our EIP-712 domain against the token's own
// on-chain DOMAIN_SEPARATOR. A wrong name/version here would surface as
// invalid_signature three steps later with no hint of why.
{
  const { createPublicClient, http, hashDomain } = await import("viem");
  const { baseSepolia } = await import("viem/chains");
  const domain = { name: "USDC", version: "2", chainId: 84532,
                   verifyingContract: served.asset };
  const ours = hashDomain({
    domain: { ...domain, chainId: BigInt(domain.chainId) },
    types: { EIP712Domain: [
      { name: "name", type: "string" }, { name: "version", type: "string" },
      { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
    ]},
  });
  const pub = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
  const theirs = await pub.readContract({
    address: served.asset,
    abi: [{ name: "DOMAIN_SEPARATOR", type: "function", stateMutability: "view",
            inputs: [], outputs: [{ type: "bytes32" }] }],
    functionName: "DOMAIN_SEPARATOR",
  });
  if (ours.toLowerCase() !== theirs.toLowerCase()) {
    die(`EIP-712 domain mismatch: our separator ${ours} vs the token's ${theirs}.
` +
        "  The name/version constants for this token are wrong — fix KNOWN_DOMAINS before anything can verify.");
  }
  ok("our EIP-712 domain matches the token's on-chain DOMAIN_SEPARATOR");
}
const signer = await createSigner("base-sepolia", keys.buyerPk);
const paidFetch = wrapFetchWithPayment(fetch, signer, BigInt(3_000_000));
const res = await paidFetch(`${BASE_URL}/api/demo/report`);
if (res.status !== 200) die(`paid request failed: ${res.status} ${await res.text()}`);
const bodyText = await res.text();
const payRes = JSON.parse(Buffer.from(res.headers.get("x-payment-response"), "base64").toString("utf-8"));
const notch = payRes.notch;
if (!notch?.receipt) die("no signed receipt in X-PAYMENT-RESPONSE");
ok(`paid, delivered, and HELD — payment ${notch.paymentId}`);
info(`errorReason on the wire: ${payRes.errorReason} (the money has NOT moved)`);

// ── 4: the buyer verifies the tally on the spot ─────────────────────────────
step(4, "the buyer verifies the seller's signed receipt");
const r = notch.receipt.receipt;
const recovered = await recoverTypedDataAddress({
  domain: { name: "Notch", version: "1" },
  types: {
    DeliveryReceipt: [
      { name: "paymentId", type: "string" },
      { name: "quoteHash", type: "bytes32" },
      { name: "bodySha256", type: "bytes32" },
      { name: "excerptSha256", type: "bytes32" },
      { name: "excerptLen", type: "uint256" },
      { name: "deliveredAt", type: "uint256" },
    ],
  },
  primaryType: "DeliveryReceipt",
  message: {
    paymentId: r.paymentId,
    quoteHash: `0x${r.quoteHash}`,
    bodySha256: `0x${r.bodySha256}`,
    excerptSha256: `0x${r.excerptSha256}`,
    excerptLen: BigInt(r.excerptLen),
    deliveredAt: BigInt(r.deliveredAt),
  },
  signature: notch.receipt.signature,
});
if (recovered.toLowerCase() !== seller.address.toLowerCase()) {
  die(`receipt signed by ${recovered}, not the bonded seller ${seller.address}`);
}
ok(`receipt signature recovers to the BONDED seller wallet`);
if (r.bodySha256 !== sha256(bodyText)) die("receipt bodySha256 does not match the delivered bytes");
ok(`bodySha256 matches the exact bytes received — the tally is honest`);

// ── 5: the court records the payment (operator) ─────────────────────────────
step(5, "the operator records the hold on the court");
let courtPayment = await courtRead("get_payment", [notch.paymentId]);
if (!courtPayment) {
  cliWrite("record_payment", [notch.paymentId, notch.quoteHash, buyer.address]);
  for (let i = 0; i < 12 && !courtPayment; i++) { await sleep(5000); courtPayment = await courtRead("get_payment", [notch.paymentId]); }
  if (!courtPayment) die("record_payment submitted but never readable — rerun shortly");
}
ok(`payment on court in state ${courtPayment.state}; seller exposure reserved`);

// ── 6: the seller anchors the receipt with their bonded wallet ─────────────
step(6, "the seller anchors the receipt on-chain (their tx signature IS the receipt signature)");
if (courtPayment.state === "AWAITING_RECEIPT") {
  await sellerWrite("submit_receipt", [notch.paymentId, r.bodySha256, r.excerptSha256, r.excerptLen]);
  for (let i = 0; i < 18; i++) {
    await sleep(5000);
    courtPayment = await courtRead("get_payment", [notch.paymentId]);
    if (courtPayment?.state === "WINDOW") break;
  }
}
if (courtPayment.state !== "WINDOW") die(`expected WINDOW, court says ${courtPayment.state}`);
ok(`window armed — closes at epoch ${courtPayment.window_ends}`);

// ── 7: the window runs (real seconds; nobody can shorten it) ────────────────
step(7, `the challenge window (${WINDOW}s of real, fetched wall-clock time)`);
info("no challenge will be filed — this arc proves the optimistic path");
await sleep((WINDOW + 20) * 1000);

// ── 8: permissionless finalize ─────────────────────────────────────────────
step(8, "anyone finalizes — the window expired with a receipt and no challenge");
await sellerWrite("finalize", [notch.paymentId]);   // seller is 'anyone' here
for (let i = 0; i < 18; i++) {
  await sleep(5000);
  courtPayment = await courtRead("get_payment", [notch.paymentId]);
  if (courtPayment?.state === "RELEASABLE") break;
}
if (courtPayment.state !== "RELEASABLE") die(`expected RELEASABLE, court says ${courtPayment.state}`);
ok("the court says RELEASABLE — the ruling that lets the rail move");

// ── 9: the rail follows the ruling ──────────────────────────────────────────
step(9, "the facilitator reconciles: rail follows court");
const rec = await (await fetch(`${BASE_URL}/api/facilitator/reconcile`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ paymentId: notch.paymentId }),
})).json();

console.log("\n════════ PROOF ════════");
console.log(`payment          ${notch.paymentId}`);
console.log(`quote hash       ${short(notch.quoteHash)}  (served == registered == paid-against)`);
console.log(`receipt signer   ${short(recovered)}  == bonded seller`);
console.log(`body sha256      ${short(r.bodySha256)}  == delivered bytes`);
console.log(`court state      ${courtPayment.state}`);
if (rec.rail?.txHash) {
  console.log(`rail             RELEASED — ${rec.rail.txHash}`);
  console.log(`                 the buyer's USDC moved to the seller by the buyer's own signature`);
} else if (rec.dryRun) {
  console.log(`rail             DRY RUN — ${rec.dryRun.split(".")[0]}.`);
  console.log(`                 fund SETTLEMENT_PRIVATE_KEY with Base Sepolia ETH to submit for real`);
} else {
  console.log(`rail             ${JSON.stringify(rec)}`);
}
console.log("═══════════════════════");
console.log("\nWhat was proven: an unmodified x402 client paid; the signature was");
console.log("verified against the token's own domain; the authorization was HELD, not");
console.log("settled; the seller signed the tally and anchored it with their bonded");
console.log("wallet; the window ran on fetched wall-clock time; and the release was");
console.log("decided by the court's published rules — not by anyone's opinion.");
