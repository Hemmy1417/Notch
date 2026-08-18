/**
 * Submit ONE adjudicate and dump the full transaction record — execution
 * result, stages, stderr — so a failing nondet round tells us why.
 *
 * From web/:  node scripts/debug-adjudicate.mjs pay_<16hex>
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const WEB = process.cwd();
const keys = JSON.parse(readFileSync(path.join(WEB, ".data", "e2e-keys.json"), "utf-8"));
const CONTRACT = (readFileSync(path.join(WEB, ".env.local"), "utf-8")
  .match(/^NEXT_PUBLIC_CONTRACT_ADDRESS=(0x[0-9a-fA-F]{40})/m) || [])[1];
const RPC = "https://studio.genlayer.com/api";
const PAYMENT_ID = process.argv[2];

const bodyText = JSON.stringify({
  summary: "Sorry, I can't help with that request.",
  sources: [],
  paymentId: PAYMENT_ID,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = createClient({ chain: studionet, endpoint: RPC, account: createAccount(keys.buyerPk) });

console.log(`adjudicate(${PAYMENT_ID}) on ${CONTRACT} — one shot, full dump`);

const hash = await client.writeContract({
  address: CONTRACT, functionName: "adjudicate",
  args: [PAYMENT_ID, bodyText], value: 0n,
});
console.log(`tx: ${typeof hash === "string" ? hash : JSON.stringify(hash)}`);

const txHash = typeof hash === "string" ? hash : hash?.transactionHash ?? hash?.hash;

for (let i = 0; i < 40; i++) {
  await sleep(6000);
  let tx;
  try {
    tx = await client.getTransaction({ hash: txHash });
  } catch (e) {
    console.log(`getTransaction: ${String(e?.message).slice(0, 100)}`);
    continue;
  }
  const status = tx?.status_name ?? tx?.status;
  console.log(`[${i}] status ${status}`);
  if (["ACCEPTED", "FINALIZED", "UNDETERMINED", "CANCELED", "LEADER_TIMEOUT"].includes(String(status))) {
    const data = tx?.consensus_data ?? tx;
    const leader = data?.leader_receipt ?? data?.leaderReceipt;
    const receipts = Array.isArray(leader) ? leader : [leader].filter(Boolean);
    for (const r of receipts) {
      console.log(`— leader receipt —`);
      console.log(`  result: ${r?.result ?? r?.execution_result}`);
      console.log(`  vote:   ${r?.vote}`);
      const out = r?.genvm_result ?? r?.calldata ?? {};
      if (out?.stdout) console.log(`  stdout: ${String(out.stdout).slice(0, 1500)}`);
      if (out?.stderr) console.log(`  stderr: ${String(out.stderr).slice(0, 3000)}`);
    }
    // Fallback: print everything if the shapes above missed it.
    if (!receipts.length) {
      console.log(JSON.stringify(tx, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2).slice(0, 6000));
    }
    break;
  }
}
