<p align="center">
  <img src="docs/mark.svg" width="72" alt="Notch" />
</p>

<h1 align="center">Notch</h1>

<p align="center"><em>Evidence fixed before the money moves.</em><br>
A dispute and chargeback layer for x402 agent payments, judged on GenLayer.</p>

---

## What this is

An agent pays for an API call over x402 and gets garbage back. Today there is
no recourse: the x402 specification describes its own settlement as a push
payment, irreversible once executed, and Google's AP2 places dispute
resolution explicitly out of scope. The seller's side of the problem is just
as structural — there is no tracking number for an API response, which is why
digital-goods chargeback rates run roughly double physical goods and why
merchants who fight card disputes win less than half and recover a tenth of
the money.

Notch changes the order of events rather than the quality of the arguing:

1. **The facilitator holds the payment instead of settling it.** An x402
   payment is a signed EIP-3009 authorization. Notch verifies it and holds
   it. Release is submission to the chain; refund is the absence of one —
   the authorization expires and the buyer's money never moved. No escrow
   account exists. This inherits x402's own documented facilitator trust
   profile (can withhold, cannot steal) and adds nothing worse.

2. **The evidence is fixed before anyone has a reason to shade it.** What
   counts as delivery is written in prose, hashed, and registered on the
   court before payment. The seller signs a delivery receipt with the key
   that holds their bond, over digests of the exact bytes delivered — no
   receipt, no release. At dispute, nothing is fetched: the contract accepts
   only bytes that hash to the seller's own signed digest.

3. **A validator panel judges, not a single model.** The ruling is reached by
   GenLayer consensus over the criteria and the seller-signed bytes, with
   the verdict as the only pinned field. One LLM with one key deciding money
   is a measured failure mode — in Kleros' July 2026 disputes, model choice
   alone swung platform win rates from 86% to 95%. Multi-validator consensus
   is the answer this build stakes itself on.

## Live deployment

| | |
|---|---|
| Court contract | `0x5d22edAE1e32f977b57b99B8d95D3A0097e5b517` (GenLayer StudioNet, chainId 61999) |
| Deploy tx | `0xf9ddf1490e8ad67f738ee4a31d804c6918334adfa5d9bb6be0255a399a67a3c7` |
| Contract version | v0.1.2 — deployed code byte-matches [`contracts/notch.py`](contracts/notch.py) |
| Runner | pinned `py-genlayer:1jb45aa8…jpz09h6` |
| Payment rail | Base Sepolia USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`), x402 v1 wire format |
| Web console | Vercel deploy pending — runs locally via `npm run dev` in `web/` |

## The lifecycle

```text
                    buyer pays the 402 (unmodified x402-fetch client)
                                      |
                            EIP-3009 sig verified,
                        domain proven vs DOMAIN_SEPARATOR
                                      |
                                    HELD          <- the authorization, not the money
                                      |
                     operator records on court -> AWAITING_RECEIPT
                                      |
                  seller anchors receipt (their tx IS the signature)
                                      |
                                   WINDOW         <- challenge window, fetched wall-clock
                       ______________|______________
                      |                             |
                no challenge                  bonded challenge
                      |                             |
                 RELEASABLE                     DISPUTED
                      |                             |
             rail submits the auth        panel reads seller-signed bytes
                      |                _____________|_____________
                   SETTLED            |             |             |
                              AS_DESCRIBED   INCONCLUSIVE   NOT_AS_DESCRIBED
                                    |               |             |
                               RELEASABLE      RELEASABLE     REFUND_DUE
                               bond→seller     bond→buyer     bond+slash→buyer
                                                              seller record marked
                                                                    |
                                                          auth expires unsubmitted
                                                                    |
                                                                REFUNDED
```

Uncertainty punishes nobody: INCONCLUSIVE releases on the optimistic default
and refunds the challenger in full. A stuck dispute has a permissionless exit
after 7 days. A payment recorded during a clock outage arms its deadline when
the clock returns rather than becoming instantly refundable.

## The proof — three arcs, live, one deployment

Everything below ran against the deployed contract under real StudioNet
validators, driven by an **unmodified `x402-fetch` client**. The payment ids
are real; the web console resolves each to its full on-chain record.

### 1. The optimistic arc — honest delivery, automatic release

```text
payment          pay_98b926f3ae2f1589
quote hash       38b9c8497f…9dd0a1  (served == registered == paid-against)
receipt signer   0x897282d3…511A2C  == bonded seller
court state      RELEASABLE
rail             DRY RUN — settlement key unfunded, reported honestly
```

Paid, held, receipted, windowed on fetched wall-clock time, finalized by
rule. Nobody's opinion was consulted.

### 2. The structural dispute — garbage, receipted anyway

The seller delivered `{"summary": "Sorry, I can't help with that request.",
"sources": []}` against criteria demanding a 200+ character on-topic summary
and two cited sources — and signed the receipt for it.

```text
payment        pay_843a12d658f2a3cf
verdict        NOT_AS_DESCRIBED
reasoning      "The acceptance criteria require a summary of at least 200
                characters addressing the topic and a sources array with at
                least two entries each containing a url and claim. The
                delivered JSON contains an apologetic short summary and an
                empty sources array, violating both requirements."
court state    REFUND_DUE -> hold REFUNDED (authorization never submitted)
the slash      1,250,000 atto — exactly 50% of the payment, verified on-chain
conservation   pot == remaining bond to the atto after bond+slash left to buyer
```

### 3. The semantic dispute — well-formed, fluent, and about the wrong thing

This is the arc that proves the panel is load-bearing. The delivery passes
every structural check — 380-character fluent summary, two plausible sources
with `url` and `claim` fields — but it is about sourdough baking, and the
criteria pin the topic to x402 settlement mechanics. **No schema validator,
regex, or deterministic contract can catch this one.**

```text
payment        pay_5047729e03d30dcd
delivered      "Sourdough fermentation depends on a stable starter culture…"
               (380 chars, fluent, two sources with url+claim — structurally valid)
verdict        NOT_AS_DESCRIBED
reasoning      "The delivered content's 'summary' addresses sourdough baking,
                not the x402 payment protocol or machine-to-machine payment
                mechanics as required by the criteria. The form is correct,
                but the topic is entirely unrelated to the specified subject."
court state    REFUND_DUE -> hold REFUNDED (authorization never submitted)
seller record  2 broken receipts, slashed again — the record follows the key
```

The panel said it itself: *the form is correct.* Every deterministic check
passes. The ruling exists only because validators read the words.

## Why GenLayer, plainly

The bonds, windows, and slashing are ordinary deterministic contract logic —
any chain could host them. The money moves on Base, not GenLayer. What cannot
exist anywhere else is the judgment: terms written in prose by arbitrary
sellers, and a dispute question — *did this delivery address what was asked?*
— that is semantic, not structural. Arc 3 above is the demonstration: a
delivery that passes every check a deterministic contract could express, and
fails the only one that matters.

The panel is deliberately caged:

- It reads **only** bytes that hash to the seller's own signed digest — the
  deterministic check runs before any model is consulted.
- Party text is sanitized and fenced; the fence delimiter cannot appear in
  party input, so a "fence" inside a claim is the author's fabrication and
  weighs against them.
- Only the **verdict** is consensus-pinned. Confidence and reasoning are
  advisory — pinning fields that decide nothing costs validators for no
  security, a lesson paid for on a sibling deployment.
- The challenge is labeled advocacy, never evidence.

## What is deliberately NOT on the contract

- **Money.** Payments settle in USDC on Base Sepolia. The contract holds only
  GEN bonds and decides what the facilitator may do with the held
  authorization. `mark_settled` records the rail outcome; it cannot invent one.
- **The operator's opinions.** The operator (the facilitator service) records
  payments and settlement references. It cannot touch a bond, decide a
  dispute, shorten a window, or release a blocked payment — pinned by tests
  and a mutation sweep, not by promise.

## Verification discipline

| Gate | Result |
|---|---|
| Direct contract tests | 46 passing — bonds, quotes, receipts, all three verdicts, conservation across every dispute path, concurrency invariants |
| Mutation sweep | **16/16 money-path guards pinned** — every guard has a test that fails when the guard is deleted; accept-control included |
| Web tests | 49 passing — facilitator verify/settle, EIP-3009 recovery, TS/Python quote-hash parity vectors, x402 v1 conformance |
| genvm-lint | clean (one advisory: the intentional LLM-error resampling exception) |
| Deployed byte-match | `genlayer code` output matches the repo source, whitespace-normalized |

Four bugs that every green unit test missed were caught by running the real
arcs live — two canonicalizations of the quote hash, x402's silent EIP-712
domain fallback, the CLI's Address auto-typing, and a payout API that the
test stub had invented and the runner did not have. Each is documented in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), each now has a regression test,
and the last one is why the stub now refuses unknown APIs exactly like the
runner does.

## Running it

```bash
cd web
npm install
cp ../.env.example .env.local   # fill in contract + RPC; see comments
npm run dev                     # landing, protocol, console on :3000
```

```bash
# the arcs, against your own dev server
node scripts/e2e.mjs                    # optimistic: pay → hold → receipt → window → release
node scripts/e2e-dispute.mjs bad        # structural dispute
node scripts/e2e-dispute.mjs offtopic   # semantic dispute
```

```bash
# contract verification
python -m pytest tests/direct -q        # 46 direct tests
python scripts/phase2/12_mutate.py      # the mutation sweep
```

## Honest limitations

- **The rail dry-runs.** `SETTLEMENT_PRIVATE_KEY` is unfunded, so the final
  USDC submission on Base Sepolia is reported as a dry run rather than
  executed. The reconciler prints what it would submit; it never invents a
  transaction hash.
- **Units are conflated.** Quote amounts are USDC-atomic while bonds are
  GEN-denominated, so a $2.50 payment produces a microscopic slash in GEN
  terms. The mechanism moved the exact numbers the rules dictate — verified
  to the atto — but production needs a rate mapping or GEN-denominated
  pricing.
- **The window is seller risk.** A buyer can drain their wallet during the
  challenge window, making a released authorization unsubmittable. This is
  stated x402 facilitator reality, and it argues for short windows.
- **Testnet only, deliberately.** Notch holds live payment authorizations.
  Pointing that at mainnet before the settlement path is reviewed would risk
  other people's money to make a demo look better.
- **One facilitator.** The court is permissionless; the facilitator is not
  yet. Decentralizing the operator role (or making holds provable) is the
  obvious next hardening step.

## Repository

```text
contracts/notch.py        the court (deployed byte-for-byte)
scripts/phase2/           contract generator, mutation sweep, generator-sync check
tests/direct/             46 direct tests + the runner-faithful stub
web/                      facilitator (x402 v1), console, landing
web/scripts/              the live E2E arcs
docs/DEPLOYMENT.md        deploy record, gates, and the four live-fire bugs
```
