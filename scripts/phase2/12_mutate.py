"""Notch — Phase 2: break each guard in a scratch copy; prove the suite fails.

"Tests pass" does not mean "a regression would be caught". Each mutation below
disables one guard the money depends on. A mutation that SURVIVES means that
guard is unpinned — free to be deleted by a refactor with nothing failing.

Includes an accept-control: a harmless mutation the suite SHOULD survive, so a
sweep that kills everything (an over-brittle suite) is also visible.

Run from the project root:  python scripts/phase2/12_mutate.py
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".mutwork"

MUTANTS = [
    ("S27: registration bond floor removed",
     "if bond < MIN_BOND_ATTO:",
     "if False:"),
    ("S23: exposure reservation skipped",
     "if reserve > free:",
     "if False:"),
    ("S23: reserve never released on finalize",
     "def _release_reserve(self, s: Seller, p: Payment) -> None:\n        reserve = self._reserve_for(int(p.amount_atto))",
     "def _release_reserve(self, s: Seller, p: Payment) -> None:\n        return\n        reserve = self._reserve_for(int(p.amount_atto))"),
    ("receipt: seller-only check removed",
     'if self._sender() != p.seller:',
     "if False:"),
    ("receipt gate: no-receipt refund path disabled",
     'p.state = "REFUND_DUE"\n            s = self._seller_or_fail(p.seller)\n            self._release_reserve(s, p)\n            self.refund_count',
     'p.state = "RELEASABLE"\n            s = self._seller_or_fail(p.seller)\n            self._release_reserve(s, p)\n            self.refund_count'),
    ("challenge: window check removed",
     "if now >= int(p.window_ends):",
     "if False:"),
    ("challenge: bond floor removed",
     "if bond < need:",
     "if False:"),
    ("anchored excerpt: digest check removed",
     "if _sha256_hex(ex) != p.r_excerpt_sha256:",
     "if False:"),
    ("S19: defang dropped from the excerpt",
     "safe_excerpt = _defang(ex)",
     "safe_excerpt = ex"),
    ("S19: defang dropped from the claim",
     "claim = _defang(p.d_claim)",
     "claim = p.d_claim"),
    ("slash: seller keeps the bond on a broken receipt",
     "slash = min(self._reserve_for(int(p.amount_atto)), int(s.bond_atto))",
     "slash = 0"),
    ("S5: inconclusive punishes the challenger (bond kept)",
     'self.pot_atto = u256(int(self.pot_atto) - bond)\n            gl.native.transfer(Address(p.buyer), u256(bond))\n            self.inconclusive_count',
     'self.inconclusive_count'),
    ("S17: stale-dispute exit removed",
     'if int(p.d_terminal_at) == 0 or now < int(p.d_terminal_at):',
     'if True:'),
    ("window: finalize ignores the clock",
     'if now < int(p.window_ends):',
     'if False:'),
    ("operator gate: anyone can record payments",
     'if self._sender() != str(self.operator).lower():\n            raise gl.vm.UserError(f"{ERROR_EXPECTED} only the operator records payments")',
     'if False:\n            raise gl.vm.UserError(f"{ERROR_EXPECTED} only the operator records payments")'),
    ("S16: garbage verdict settles instead of reverting",
     'if verdict not in VERDICTS:\n            raise gl.vm.UserError(f"{ERROR_LLM} adjudication failed validation — retry")',
     'if verdict not in VERDICTS:\n            verdict = "AS_DESCRIBED"'),
    # accept-control: cosmetic change the suite SHOULD tolerate
    ("CONTROL (should survive): stats key order irrelevant",
     '"sellers": int(self.seller_count),',
     '"sellers": int(self.seller_count) + 0,'),
]


def run_suite() -> bool:
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/direct", "-q", "-x", "--no-header"],
        cwd=WORK, capture_output=True, text=True, timeout=600,
    )
    return r.returncode == 0


def fresh():
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir()
    shutil.copytree(ROOT / "contracts", WORK / "contracts")
    shutil.copytree(ROOT / "tests", WORK / "tests")


fresh()
if not run_suite():
    print("BASELINE FAILED — fix the suite before mutating"); sys.exit(1)
print("baseline green; mutating\n")

target = WORK / "contracts" / "notch.py"
original = target.read_text(encoding="utf-8")

killed, survived, control_ok = [], [], True
for name, old, new in MUTANTS:
    is_control = name.startswith("CONTROL")
    if old not in original:
        print(f"  ??  ANCHOR MISSING  {name}")
        survived.append(name + " [anchor missing]")
        continue
    target.write_text(original.replace(old, new, 1), encoding="utf-8")
    green = run_suite()
    target.write_text(original, encoding="utf-8")
    if is_control:
        control_ok = green
        print(f"  {'OK' if green else '!!'}  CONTROL {'survived (good)' if green else 'KILLED (suite is brittle)'}")
    elif green:
        survived.append(name)
        print(f"  !!  SURVIVED  {name}")
    else:
        killed.append(name)
        print(f"  OK  killed    {name}")

print(f"\n{len(killed)}/{len(MUTANTS) - 1} guards pinned; control {'ok' if control_ok else 'FAILED'}")
if survived:
    print("\nUNPINNED (a refactor could delete these silently):")
    for s in survived:
        print("  -", s)
    sys.exit(1)
print("every guard is pinned by at least one failing test")
shutil.rmtree(WORK)
