# Notch — Deployment

## Deployment record — StudioNet (2026-08-18)

| | |
|---|---|
| Contract | `0x3b04440389416407194E7DD979577065c6EbfEfa` |
| Deploy tx | `0xf636bba841443db16050711a7203da1ac1e7699fb849c1de6ea4dee72a14941a` |
| Version | v0.1.1 |
| Supersedes | `0x1E5e00ab…9f01` (v0.1.0 — Address-normalization fix below) |
| Deployer / operator | `0x10dbf82a8bb191bd1c082de5ef915e998aa5ccd7` |
| Network | GenLayer StudioNet (chainId 61999), gasless |
| Runner | pinned `py-genlayer:1jb45aa8…jpz09h6` |

### Pre-deploy gate (all green)
- genvm-lint: `ok:true` (one W004 advisory — the intentional `Exception` inside
  the nondet closure, which is the LLM-error resampling path)
- 44 direct tests: bonds, quotes, payments, receipts, windows, all three
  verdicts, stale-dispute exit, conservation across every dispute path
- Mutation sweep: **16/16 guards pinned**, accept-control survived — every
  money-path guard has a test that fails when it is deleted
- Generator sync verified: `scripts/phase2/10_contract.py` regenerates the
  deployed source byte for byte

### Post-deploy verification
- `get_config` reads clean: operator set, 1 GEN seller bond floor, 10% / 0.1 GEN
  challenge bond, 50% slash, 7d dispute terminal, 60s–24h windows.
- `get_stats` reads clean: empty book.
- **Deployed code byte-matches `contracts/notch.py`** (whitespace-normalized
  containment against `genlayer code`).

### Two defects the gate caught before this deploy
1. **Zero-anchor refund**: a payment recorded during a clock outage carried
   `recorded_at = 0`, making its no-receipt deadline `0 + window + grace` —
   instantly refundable, expiring the seller's receipt period before it began.
   Fixed with the arm-on-outage pattern.
2. **The lying return**: `finalize()` returned hardcoded state strings, so a
   mutation could flip storage while the return kept reporting the right
   state. Found by the mutation sweep, not the test suite — the suite was
   asserting on the return. All returns now echo stored state.

## What is deliberately NOT on this contract
- **Money.** Payments settle in USDC on the x402 rail (Base Sepolia). The
  contract holds only GEN bonds and decides what the facilitator may do with
  the held authorization. `mark_settled` records the rail outcome; it cannot
  create one.
- **The operator's opinions.** The operator records payments and settlement
  references. It cannot touch a bond, decide a dispute, shorten a window, or
  release a blocked payment — pinned by
  `test_the_operator_cannot_touch_bonds_or_rulings` and the mutation sweep.

## Next (Phase 3)
Held-authorization settlement in the facilitator: EIP-3009 signature
verification in `/verify`, submission on RELEASABLE, expiry on REFUND_DUE,
`mark_settled` wired to the real rail outcome. Then the end-to-end proof: one
payment paid by a real x402 client, held, released, and visible on Base
Sepolia.


## Phase 3 — the end-to-end proof (2026-08-18)

An **unmodified `x402-fetch` client** paid our 402 and the full arc ran live:

```text
[3] our EIP-712 domain matches the token's on-chain DOMAIN_SEPARATOR
    paid, delivered, and HELD — payment pay_b110f6cc9c969622
[4] receipt signature recovers to the BONDED seller wallet
    bodySha256 matches the exact bytes received
[5] payment on court — seller exposure reserved (S23)
[6] receipt anchored by the seller's own signed write; window armed
[7] 60s challenge window, real fetched wall-clock time
[8] permissionless finalize -> RELEASABLE
[9] reconcile: rail follows court — DRY RUN (no settlement key funded)
```

`quote hash served == registered == paid-against` (TS/Python parity, live).
The only unexecuted step is the actual USDC submission on Base Sepolia, which
needs `SETTLEMENT_PRIVATE_KEY` funded with testnet ETH; the reconciler
reported that honestly as a dry run rather than inventing a hash.

### Three live-fire bugs the E2E caught that every unit test missed
1. **Two canonicalizations** — the 402 served a Phase-1 hash (bound
   resource/payTo) the contract could never compute. Collapsed to one
   function; a conformance test now pins served == contract hash.
2. **`extra` eviction** — x402 v1's EVM scheme reads the token's EIP-712
   `name`/`version` from `PaymentRequirements.extra`, with a silent on-chain
   fallback. Notch's terms had displaced them, so the client signed under a
   different domain than we verified. They now coexist.
3. **CLI Address auto-typing** — the genlayer CLI delivers any 40-hex arg as
   an Address OBJECT; `buyer.lower()` reverted on-chain while 44 stub-based
   tests stayed green. Every address-taking entry now normalizes via
   `_addr_str`, pinned by a test that passes an Address object.
