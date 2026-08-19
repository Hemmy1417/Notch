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

Two hands touch the system, and only two. The **buyer is an autonomous
agent** — it reads the 402, signs an EIP-3009 authorization, and pays over
x402 with no human in the loop. The **one human action** is the dispute: when
a delivery is wrong, a person connects a wallet, posts a bond, and files a
challenge inside its window. Everything else is machine-to-machine.

## Live deployment

| | |
|---|---|
| Court contract | `0x612bBb4942DB87A1677FfFaD3a7DDb26d3f06e02` (GenLayer StudioNet, chainId 61999) |
| Deploy tx | `0x4433dca8c891328b333ec454766eea2d55d1adacc23355cb6092954d7e6ce309` |
| Contract version | v0.1.3 — deployed code byte-matches [`contracts/notch.py`](contracts/notch.py) |
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
are real; the web console resolves each to its full on-chain record. A fourth,
adversarial arc — prompt injection hidden inside the seller-signed delivery —
is the flagship of [`docs/STRESS_TEST.md`](docs/STRESS_TEST.md); the panel
named the embedded override attempt and ruled against it anyway.

### 1. The optimistic arc — honest delivery, automatic release

```text
payment          pay_f19709fc2ada6624
quote hash       38b9c8497f…9dd0a1  (served == registered == paid-against)
receipt signer   0x897282d3…511A2C  == bonded seller (3 GEN bond, 2.5 GEN reserved)
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
payment        pay_7e701d83f96c545f
verdict        NOT_AS_DESCRIBED
reasoning      "The acceptance criteria require a summary of at least 200
                characters addressing the topic and a sources array with at
                least two entries each containing a url and claim. The
                delivered JSON contains an apologetic short summary and an
                empty sources array, violating both requirements."
court state    REFUND_DUE -> hold REFUNDED (authorization never submitted)
the slash      1.25 GEN — 50% of the 2.5-GEN payment value, verified on-chain
conservation   pot == remaining bond to the atto after bond+slash left to buyer
```

### 3. The semantic dispute — well-formed, fluent, and about the wrong thing

This is the arc that proves the panel is load-bearing. The delivery passes
every structural check — 380-character fluent summary, two plausible sources
with `url` and `claim` fields — but it is about sourdough baking, and the
criteria pin the topic to x402 settlement mechanics. **No schema validator,
regex, or deterministic contract can catch this one.**

```text
payment        pay_7e69d93ff9df7a47
delivered      "Sourdough fermentation depends on a stable starter culture…"
               (380 chars, fluent, two sources with url+claim — structurally valid)
verdict        NOT_AS_DESCRIBED
reasoning      "The delivered content does not address the x402 payment protocol
                or the settlement and dispute mechanics of machine-to-machine
                payments as required… Instead it discusses sourdough baking,
                which is unrelated to the specified topic."
court state    REFUND_DUE -> hold REFUNDED (authorization never submitted)
the slash      1.25 GEN — 50% of the 2.5-GEN payment value, real bond, on-chain
seller record  1 broken receipt; the record follows the key, not the delivery
```

The panel said it itself: *the topic is unrelated.* Every deterministic check
passes. The ruling exists only because validators read the words — and the
false receipt cost the seller 1.25 GEN of real bond, not dust.

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
| Mutation sweep | **17/17 money-path guards pinned** — every guard has a test that fails when the guard is deleted; accept-control included |
| Web tests | 49 passing — facilitator verify/settle, EIP-3009 recovery, TS/Python quote-hash parity vectors, x402 v1 conformance |
| genvm-lint | clean (one advisory: the intentional LLM-error resampling exception) |
| Deployed byte-match | `genlayer code` output matches the repo source, whitespace-normalized |

The adversarial surface — prompt injection inside signed evidence, digest
forgery, bond overlap, operator overreach, clock outage, stuck disputes — is
mapped attack-by-attack to its guard and its proof in
[`docs/STRESS_TEST.md`](docs/STRESS_TEST.md).

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
node scripts/e2e-dispute.mjs inject     # semantic dispute under prompt injection
```

```bash
# contract verification
python -m pytest tests/direct -q        # 46 direct tests
python scripts/phase2/12_mutate.py      # the mutation sweep
```

## Filing a challenge by hand (the one human action)

Everything above is agent-driven — the buyer pays headlessly over x402. But
raising a dispute is a person's decision, so the console has a wallet-connected
challenge flow on any payment inside its window (`/console/p/<id>` →
**Dispute this payment**). It connects a GenLayer wallet (EIP-6963), shows the
exact bond the write must carry, refuses the submit unless the connected wallet
is the payment's buyer (the contract enforces buyer-only), and files the bonded
`challenge` transaction — then the record flips to DISPUTED.

To see it live, seed a payment and leave it in its window:

```bash
# from web/  (needs a ~600s window: NEXT_PUBLIC_NOTCH_WINDOW_SECONDS=600)
node scripts/seed-window.mjs offtopic
# → prints a /console/p/<id> URL with ~10 minutes on the clock
```

Open the URL, connect the buyer wallet (its key is the demo buyer in
`web/.data/e2e-keys.json`; add StudioNet to the wallet), and file the
challenge. The panel's reads route through a same-origin `/api/rpc` proxy so a
rate-limited StudioNet response can't surface as a bare "Failed to fetch"
mid-write.

## Honest limitations

- **The rail dry-runs.** `SETTLEMENT_PRIVATE_KEY` is unfunded, so the final
  USDC submission on Base Sepolia is reported as a dry run rather than
  executed. The reconciler prints what it would submit; it never invents a
  transaction hash.
- **The price rate is fixed, not oracle-fed.** Payments are USDC-atomic and
  bonds are GEN-wei; the contract converts between them at a fixed 1 USDC = 1
  GEN rate, so a $2.50 payment reserves 2.5 GEN and a 50% slash costs the
  seller 1.25 GEN — real bond, not dust. Production replaces the fixed rate
  with a price oracle; the reserve/slash mechanism is already rate-agnostic.
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
