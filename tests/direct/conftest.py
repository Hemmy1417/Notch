"""Shared direct-mode harness for notch.py.

Installs a stubbed genlayer runtime so the contract runs under plain pytest.
The stub's design carries two hard-won lessons from siblings:

  PER-SOURCE CLOCK SKEW. An earlier project's stub served every time source
  from one shared clock — modelling a world where no clock ever lies — and a
  divergence guard that was broken in production stayed green for weeks. Every
  source here can be skewed or killed independently.

  TRANSFERS ARE RECORDED, NOT MOCKED AWAY. The EOA payout proxy appends to a
  ledger the tests can sum, so wei conservation is checkable after every
  scenario rather than asserted by hope.

  THE STUB REFUSES WHAT THE RUNNER REFUSES. An earlier version of this file
  invented gl.native.transfer — an API the real runner does not have — and
  45 green tests certified payout code that crashed on-chain at the first
  real ruling. gl here now raises AttributeError for unknown attributes,
  exactly like the runner, so an invented API fails the suite instead of
  the demo.
"""
import hashlib
import importlib.util
import json
import pathlib
import sys
import types

import pytest

CONTRACT_PATH = pathlib.Path(__file__).resolve().parents[2] / "contracts" / "notch.py"

OPERATOR = "0x00000000000000000000000000000000000f00fa"
SELLER = "0x1111111111111111111111111111111111111111"
BUYER = "0x2222222222222222222222222222222222222222"
STRANGER = "0x3333333333333333333333333333333333333333"

GEN = 10**18

# Test wall-clock, ~2026-08. Tests advance it to pass real time.
_NOW = [1_760_000_000]
# Per-source skew in seconds, keyed by URL substring. Sources can lie alone.
_SKEW = {}
# URL substrings that raise, simulating dead sources.
_DEAD = set()
# What the panel says, as the JSON the deliberate() closure returns.
_PANEL = ['{"verdict": "AS_DESCRIBED", "confidence": "HIGH", "reason": "stub"}']
# Every native transfer: (to, amount).
_SENT = []


class _UserError(Exception):
    pass


class _VmModule:
    UserError = _UserError


class _TreeMap(dict):
    def get(self, k, default=None):
        return super().get(k, default)


class _U256(int):
    def __new__(cls, v):
        return super().__new__(cls, int(v))


class _Address(str):
    def __new__(cls, v):
        return super().__new__(cls, str(v))


class _CliAddress:
    """What the genlayer CLI actually delivers for a 40-hex argument: an
    Address OBJECT with .as_hex and no str methods. A live record_payment
    reverted on .lower() because the stub modelled every param as str —
    this class exists so the suite can never be blind to that again."""
    def __init__(self, hex_str):
        self.as_hex = hex_str
    def __repr__(self):
        return f"<Address {self.as_hex}>"


class _ViewDeco:
    def __call__(self, fn):
        return fn


class _WriteDeco:
    payable = staticmethod(lambda fn: fn)

    def __call__(self, fn):
        return fn


class _Public:
    view = _ViewDeco()
    write = _WriteDeco()


class _EvmProxyInstance:
    """What calling an empty @gl.evm.contract_interface proxy at an address
    yields. emit_transfer(value=..., on="finalized") is the real payout API;
    it records into the ledger the conservation tests sum."""
    def __init__(self, addr):
        self._addr = addr

    def emit_transfer(self, value=0, on="finalized"):
        if on != "finalized":
            raise AssertionError("payouts must ride on='finalized'")
        _SENT.append((str(self._addr).lower(), int(value)))


class _EvmModule:
    @staticmethod
    def contract_interface(cls):
        return lambda addr: _EvmProxyInstance(addr)


class _NondetWeb:
    @staticmethod
    def render(url, mode="text"):
        for dead in _DEAD:
            if dead in url:
                raise RuntimeError("dead source")
        skew = next((v for k, v in _SKEW.items() if k in url), 0)
        now = _NOW[0] + skew
        if "cdn-cgi/trace" in url:
            return f"fl=1\nts={now}.000\n"
        if "blockscout" in url:
            import datetime as _dt
            t = _dt.datetime.fromtimestamp(now, _dt.timezone.utc)
            return json.dumps([{"timestamp": t.strftime("%Y-%m-%dT%H:%M:%S.000000Z")}])
        if "headers/head" in url:
            slot = (now - 1606824023) // 12
            return json.dumps({"data": {"header": {"message": {"slot": str(slot)}}}})
        return f"[page {url}]"


class _Nondet:
    web = _NondetWeb()

    @staticmethod
    def exec_prompt(prompt):
        _EqPrinciple.last_prompt = prompt
        return _PANEL[0]


class _EqPrinciple:
    last_prompt = ""
    last_principle = ""
    # ALL principles seen this test, in order. One write can run several
    # consensus rounds (the ruling, then the clock), and a single last-slot
    # gets overwritten by whichever ran last — the exact stub bug that once
    # hid a sibling's S7 gap.
    principles = []

    @classmethod
    def prompt_comparative(cls, fn, principle):
        cls.last_principle = principle
        cls.principles.append(principle)
        return fn()


class _GL:
    class Contract:
        pass

    nondet = _Nondet()
    eq_principle = _EqPrinciple
    public = _Public()
    vm = _VmModule
    evm = _EvmModule()
    # NO gl.native here — the real runner has no such attribute, and neither
    # may the stub. An unknown gl.<attr> raises AttributeError, as live.

    class message:
        sender_address = OPERATOR
        value = 0


def _install():
    mod = types.ModuleType("genlayer")
    mod.gl = _GL
    mod.TreeMap = _TreeMap
    mod.u256 = _U256
    mod.Address = _Address
    mod.allow_storage = lambda cls: cls
    mod.__all__ = ["gl", "TreeMap", "u256", "Address", "allow_storage"]
    sys.modules["genlayer"] = mod


def _load():
    _install()
    spec = importlib.util.spec_from_file_location("notch_contract", CONTRACT_PATH)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def module():
    return _load()


@pytest.fixture
def c(module):
    """A fresh contract with a registered, bonded seller and a quote."""
    _NOW[0] = 1_760_000_000
    _SKEW.clear()
    _DEAD.clear()
    _SENT.clear()
    _PANEL[0] = '{"verdict": "AS_DESCRIBED", "confidence": "HIGH", "reason": "stub"}'
    _GL.eq_principle.principles = []

    as_(module, OPERATOR, 0)
    inst = module.Notch()
    for name in ("sellers", "quotes", "payments", "seller_payments", "buyer_payments"):
        setattr(inst, name, module.TreeMap())
    return inst


def as_(module, who, value=0):
    module.gl.message.sender_address = who
    module.gl.message.value = value


def advance(seconds):
    _NOW[0] += seconds


def sent():
    return list(_SENT)


def panel_says(verdict, confidence="HIGH", reason="stubbed ruling"):
    _PANEL[0] = json.dumps({"verdict": verdict, "confidence": confidence, "reason": reason})


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ── canonical fixtures ───────────────────────────────────────────────────────

CRITERIA = ("Respond with valid JSON containing at least ten European capital "
            "cities, each with its country and population.")
ASSET = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
AMOUNT = str(GEN)  # 1 GEN-equivalent for easy math
WINDOW = 600


def registered_seller(module, c, bond=5 * GEN):
    as_(module, SELLER, bond)
    c.register_seller()
    return SELLER


def registered_quote(module, c):
    as_(module, SELLER, 0)
    out = json.loads(c.register_quote(CRITERIA, WINDOW, AMOUNT, ASSET))
    return out["quote_hash"]


def recorded_payment(module, c, qh, pid="pay-1"):
    as_(module, OPERATOR, 0)
    c.record_payment(pid, qh, BUYER)
    return pid


def receipted(module, c, pid, body="the delivered body", excerpt=None):
    ex = excerpt if excerpt is not None else "the delivered body"
    as_(module, SELLER, 0)
    c.submit_receipt(pid, sha(body), sha(ex), len(ex))
    return ex
