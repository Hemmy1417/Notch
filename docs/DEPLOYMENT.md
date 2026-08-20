# Notch — Deployment

## Deployment record — StudioNet (2026-08-19)

| | |
|---|---|
| Contract | `0x612bBb4942DB87A1677FfFaD3a7DDb26d3f06e02` |
| Deploy tx | `0x4433dca8c891328b333ec454766eea2d55d1adacc23355cb6092954d7e6ce309` |
| Version | v0.1.3 |
| Supersedes | `0x5d22edAE…b517` (v0.1.2 — pre unit-mapping), `0x3b044403…fEfa` (v0.1.1 — payout-API fix), `0x1E5e00ab…9f01` (v0.1.0 — Address fix) |
| Deployer / operator | `0x10dbf82a8bb191bd1c082de5ef915e998aa5ccd7` |
| Network | GenLayer StudioNet (chainId 61999), gasless |
| Runner | pinned `py-genlayer:1jb45aa8…jpz09h6` |

### v0.1.3 — the price mapping (economics made real)

Payments are quoted in USDC atomic (6 decimals); bonds and slashes are GEN wei
(18 decimals). Before v0.1.3 the reserve and slash used the USDC-atomic number
directly, so a 50% slash of a $2.50 payment was 1,250,000 wei — dust. v0.1.3
converts payment value to GEN at a fixed 1 USDC = 1 GEN demo rate (an oracle in
production; the mechanism is rate-agnostic), so the same payment reserves
**2.5 GEN** and a false receipt costs the seller **1.25 GEN** of real bond. A
new mutation-sweep guard pins the conversion: reverting it makes a slash dust
again and a test fails. Gate: 46 direct tests, **17/17 mutation guards**,
generator byte-sync, deployed byte-match.

### v0.1.2 — the payout-API fix (live-fire bug #4)

The first real adjudication on v0.1.1 reached a verdict — the validator panel
ran, ruled on the seller-signed excerpt — and then crashed **paying the
buyer**: every payout site called `gl.native.transfer`, an API that does not
exist in the runner (`module 'genlayer.gl' has no attribute 'native'`). The
test stub had *invented* that API, so 45 green tests certified payout code
that could never run. No live path had ever sent GEN out of the contract:
bonds arrive as payable receives, and the optimistic arc's finalize is
storage-only — the dispute ruling was the first outbound transfer ever
attempted, and it found the seam.

Fixes, all mutation-checked:
- Every transfer now rides the proven EOA payout proxy
  (`@gl.evm.contract_interface` + `emit_transfer(value=…, on="finalized")`),
  the exact pattern live-verified on a sibling deployment. `on="finalized"`
  is load-bearing: value moves only once the ruling has survived to finality.
- The stub no longer has `gl.native` — an unknown `gl.<attr>` now raises
  `AttributeError` exactly like the runner, so an invented API fails the
  suite instead of the demo. A source-level tripwire test pins this.
- The nondet closure read `p.r_excerpt_sha256` (a storage object) inside the
  prompt; the runner warns that reading storage in nondet mode is
  unsupported. The digest is now hoisted to a plain local before the closure.

Gate for this deploy: 46 direct tests green, mutation sweep **16/16 pinned**
with accept-control, genvm-lint passed (the one standing advisory is the
intentional LLM-error resampling `Exception` in the nondet closure), deployed
code byte-matches `contracts/notch.py`, generator regenerates it byte for
byte.

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

## Phase 4 — the dispute arc, live (2026-08-18)

The headline proof, on v0.1.2 under real validators: a seller delivered
`{"summary": "Sorry, I can't help with that request.", "sources": []}`
against published criteria demanding a 200+ character on-topic summary and
two cited sources — **and signed the delivery receipt anyway**. The buyer
challenged (0.1 GEN bond), and a real panel read the seller-signed bytes:

```text
payment        pay_843a12d658f2a3cf
verdict        NOT_AS_DESCRIBED  (confidence HIGH — advisory, gates nothing)
reasoning      "The acceptance criteria require a summary of at least 200
                characters addressing the topic and a sources array with at
                least two entries each containing a url and claim. The
                delivered JSON contains an apologetic short summary and an
                empty sources array, violating both requirements."
court state    REFUND_DUE — the authorization will never be submitted
hold           REFUNDED — expires at validBefore
seller record  1 broken receipt · 1,250,000 atto slashed (50% of amount)
```

Verified on-chain after the ruling: the seller's bond is 1 GEN minus
exactly the slash; reserved exposure released to zero; the global pot
equals the remaining bond precisely, meaning the challenge bond and the
slash left the contract to the buyer — one finalized transfer, nothing
stranded. The refund itself costs nothing and touches nothing: the held
authorization simply expires.

Both arcs — optimistic release (`pay_9261d354ceb85bb3`) and disputed
refund (`pay_843a12d658f2a3cf`) — now stand on the same deployment.

Known simplification, stated rather than hidden: quote amounts are in the
payment asset's atomic units (USDC, 6 decimals) while bonds and slashes are
GEN-denominated, so a $2.50 payment produces a microscopic slash in GEN
terms. Production needs a rate mapping or GEN-denominated pricing; the
mechanism — reserve, ruling, slash, routing — is what this deployment
proves, and it moved the exact numbers the rules dictate.

## Judge-feedback fixes (2026-08-20) — the service drives the court

Two asks from review, both closed and proven live:

1. **The normal service flow now performs the court writes itself.** After
   /settle holds an authorization, the facilitator records it on the court
   (record_payment) from a post-response hook; after the seller route signs a
   delivery, the service anchors the receipt (submit_receipt) the same way;
   the reconciler heals anything a crash or rate-limit missed, idempotently,
   confirmed by state reads. The E2E scripts are now OBSERVERS with dry-run
   fallbacks only.

   Live proof `pay_ffbfcc45fd06bfd4`: an unmodified x402 client paid; the
   observer script found the payment already recorded AND anchored (state
   WINDOW) with neither fallback firing — zero court writes off-service.

2. **Authorizations survive the full dispute lifecycle.** maxTimeoutSeconds
   now carries window + the contract's 7-day terminal-dispute period + grace
   (+ margin), and /settle refuses any authorization that could expire
   mid-dispute (`authorization_cannot_survive_dispute_period`) — a seller who
   WINS a fought dispute must still be payable, or every dispute becomes a
   free refund. The extended buyer-drain exposure this creates is stated in
   the README, not hidden.
