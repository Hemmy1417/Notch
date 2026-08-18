# Notch — Deployment

## Deployment record — StudioNet (2026-08-18)

| | |
|---|---|
| Contract | `0x1E5e00ab31f21E84885738EC9716143eDCc89f01` |
| Deploy tx | `0xed8de0255c914ba9f550841119c81e63f12badb96d25ac7130ec31299ab6470c` |
| Version | v0.1.0 |
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
