"""Notch — keep the generator honest.

The contract gained two fixes after its generator first ran:

  1. finalize() arms a zero recorded_at anchor instead of treating it as an
     instantly-expired deadline (the arm-on-outage lesson), and
  2. every finalize() return echoes the STORED state rather than a hardcoded
     literal (a mutation survived the suite because the return said
     REFUND_DUE while storage said otherwise).

A generator that regenerates the PRE-fix contract is a trap for whoever runs
it next — it would silently undo both. This script rewrites the generator's
embedded source from the canonical file on disk, so the two can never drift:
the repo's contracts/notch.py is the truth, and the generator reproduces it.

Run from the project root:  python scripts/phase2/13_sync_generator.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "scripts" / "phase2" / "10_contract.py"
CONTRACT = ROOT / "contracts" / "notch.py"

source = CONTRACT.read_text(encoding="utf-8")
gen = GENERATOR.read_text(encoding="utf-8")

BEGIN = "CONTRACT = r'''"
END = "'''\n\npath = ROOT"

start = gen.index(BEGIN) + len(BEGIN)
end = gen.index(END)

updated = gen[:start] + source + gen[end + 3:]
# Re-anchor the closing quotes correctly around the tail.
updated = gen[:start] + source + "'''\n\npath = ROOT" + gen[end + len(END):]

GENERATOR.write_text(updated, encoding="utf-8")
print("generator now reproduces the canonical contract byte for byte")

# prove it: run the generator into a scratch path and diff
import subprocess, sys, tempfile, shutil

with tempfile.TemporaryDirectory() as td:
    scratch = Path(td) / "repo"
    (scratch / "scripts" / "phase2").mkdir(parents=True)
    (scratch / "contracts").mkdir()
    shutil.copy(GENERATOR, scratch / "scripts" / "phase2" / "10_contract.py")
    subprocess.run([sys.executable, "scripts/phase2/10_contract.py"],
                   cwd=scratch, check=True, capture_output=True)
    regenerated = (scratch / "contracts" / "notch.py").read_text(encoding="utf-8")
    if regenerated == source:
        print("verified: regeneration is byte-identical to the canonical file")
    else:
        print("MISMATCH — do not trust the generator until this is fixed")
        sys.exit(1)
