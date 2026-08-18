"""Core lifecycle: bonds, quotes, payments, receipts, windows, release.

Each test pins a property something downstream depends on. The S30-class
invariants — concurrent reservation, post-terminal refusals, wei conservation
— live in test_notch_invariants.py.
"""
import json
import pytest

from .conftest import (
    OPERATOR, SELLER, BUYER, STRANGER, GEN, CRITERIA, ASSET, AMOUNT, WINDOW,
    as_, advance, sent, sha, panel_says,
    registered_seller, registered_quote, recorded_payment, receipted,
)


# ── seller identity costs something (S27) ────────────────────────────────────

def test_registration_requires_the_minimum_bond(module, c):
    as_(module, SELLER, 10**17)  # 0.1 GEN — under the floor
    with pytest.raises(module.gl.vm.UserError, match="costs something"):
        c.register_seller()


def test_registration_records_the_bond_and_counts_the_seller(module, c):
    registered_seller(module, c)
    s = json.loads(c.get_seller(SELLER))
    assert s["bond_atto"] == str(5 * GEN)
    assert s["reserved_atto"] == "0"
    assert json.loads(c.get_stats())["sellers"] == 1


def test_bond_topup_deepens_rather_than_duplicates(module, c):
    registered_seller(module, c)
    as_(module, SELLER, 2 * GEN)
    c.register_seller()
    assert json.loads(c.get_seller(SELLER))["bond_atto"] == str(7 * GEN)
    assert json.loads(c.get_stats())["sellers"] == 1


def test_withdraw_returns_only_the_unreserved_portion(module, c):
    registered_seller(module, c)
    qh = registered_quote(module, c)
    recorded_payment(module, c, qh)          # reserves 50% of 1 GEN
    as_(module, SELLER, 0)
    with pytest.raises(module.gl.vm.UserError, match="standing behind"):
        c.withdraw_bond(str(5 * GEN))        # all of it — refused
    c.withdraw_bond(str(4 * GEN))            # the free 4.5 has room for 4
    assert json.loads(c.get_seller(SELLER))["bond_atto"] == str(1 * GEN)
    assert sent()[-1] == (SELLER, 4 * GEN)


# ── quotes: terms before money ───────────────────────────────────────────────

def test_quote_criteria_must_be_substantial(module, c):
    registered_seller(module, c)
    as_(module, SELLER, 0)
    with pytest.raises(module.gl.vm.UserError, match="basis of any future dispute"):
        c.register_quote("too short", WINDOW, AMOUNT, ASSET)


def test_identical_quotes_cannot_be_registered_twice(module, c):
    registered_seller(module, c)
    registered_quote(module, c)
    as_(module, SELLER, 0)
    with pytest.raises(module.gl.vm.UserError, match="already registered"):
        c.register_quote(CRITERIA, WINDOW, AMOUNT, ASSET)


def test_only_a_registered_seller_may_quote(module, c):
    as_(module, STRANGER, 0)
    with pytest.raises(module.gl.vm.UserError, match="not a registered seller"):
        c.register_quote(CRITERIA, WINDOW, AMOUNT, ASSET)


def test_a_retired_quote_takes_no_new_payments(module, c):
    registered_seller(module, c)
    qh = registered_quote(module, c)
    as_(module, SELLER, 0)
    c.retire_quote(qh)
    as_(module, OPERATOR, 0)
    with pytest.raises(module.gl.vm.UserError, match="retired"):
        c.record_payment("pay-1", qh, BUYER)


# ── payments: recorded by the operator, reserved at acceptance ───────────────

def test_address_objects_from_the_cli_are_normalized(module, c):
    """The live revert this pins: 'Address' object has no attribute 'lower'.
    The CLI auto-types 40-hex args as Address objects; every address-taking
    entry must normalize rather than assume str."""
    from .conftest import _CliAddress
    registered_seller(module, c)
    qh = registered_quote(module, c)
    as_(module, OPERATOR, 0)
    # buyer arrives as an Address OBJECT, exactly as the CLI delivers it
    c.record_payment("pay-addr", qh, _CliAddress(BUYER))
    import json as _json
    p = _json.loads(c.get_payment("pay-addr"))
    assert p["buyer"] == BUYER                      # normalized to lowercase hex
    # and the buyer index finds it under the plain string key too
    listed = _json.loads(c.get_payments_for(BUYER, "buyer"))
    assert any(x["payment_id"] == "pay-addr" for x in listed)


def test_only_the_operator_records_payments(module, c):
    registered_seller(module, c)
    qh = registered_quote(module, c)
    as_(module, STRANGER, 0)
    with pytest.raises(module.gl.vm.UserError, match="only the operator"):
        c.record_payment("pay-1", qh, BUYER)


def test_a_payment_against_an_unknown_quote_is_refused(module, c):
    as_(module, OPERATOR, 0)
    with pytest.raises(module.gl.vm.UserError, match="unknown quote"):
        c.record_payment("pay-1", "ab" * 32, BUYER)


def test_recording_reserves_the_slashable_exposure(module, c):
    registered_seller(module, c)
    qh = registered_quote(module, c)
    recorded_payment(module, c, qh)
    s = json.loads(c.get_seller(SELLER))
    assert s["reserved_atto"] == str(GEN // 2)   # SLASH_BPS = 50%


def test_a_bond_that_cannot_answer_refuses_the_payment(module, c):
    registered_seller(module, c, bond=GEN)       # 1 GEN bond
    qh = registered_quote(module, c)
    recorded_payment(module, c, qh, "pay-1")     # reserves 0.5
    recorded_payment(module, c, qh, "pay-2")     # reserves the other 0.5
    as_(module, OPERATOR, 0)
    with pytest.raises(module.gl.vm.UserError, match="cannot answer"):
        c.record_payment("pay-3", qh, BUYER)     # nothing left to reserve


# ── receipts: the tally cut ──────────────────────────────────────────────────

def test_only_the_sellers_bonded_wallet_signs_the_receipt(module, c):
    registered_seller(module, c)
    qh = registered_quote(module, c)
    pid = recorded_payment(module, c, qh)
    as_(module, STRANGER, 0)
    with pytest.raises(module.gl.vm.UserError, match="bonded wallet"):
        c.submit_receipt(pid, sha("x"), sha("x"), 1)
    as_(module, BUYER, 0)
    with pytest.raises(module.gl.vm.UserError, match="bonded wallet"):
        c.submit_receipt(pid, sha("x"), sha("x"), 1)


def test_a_receipt_starts_the_window(module, c):
    registered_seller(module, c)
    qh = registered_quote(module, c)
    pid = recorded_payment(module, c, qh)
    receipted(module, c, pid)
    p = json.loads(c.get_payment(pid))
    assert p["state"] == "WINDOW"
    assert p["window_ends"] > 0
    assert p["receipt"]["excerpt_sha256"] == sha("the delivered body")


def test_the_window_cannot_start_on_a_dead_clock(module, c):
    from .conftest import _DEAD
    registered_seller(module, c)
    qh = registered_quote(module, c)
    pid = recorded_payment(module, c, qh)
    _DEAD.update({"cdn-cgi", "blockscout", "headers/head"})
    as_(module, SELLER, 0)
    with pytest.raises(module.gl.vm.UserError, match="unreachable or unreliable"):
        c.submit_receipt(pid, sha("x"), sha("x"), 1)


# ── the deterministic exits ──────────────────────────────────────────────────

def test_an_unchallenged_window_releases_after_expiry(module, c):
    registered_seller(module, c)
    qh = registered_quote(module, c)
    pid = recorded_payment(module, c, qh)
    receipted(module, c, pid)
    as_(module, STRANGER, 0)                     # permissionless
    with pytest.raises(module.gl.vm.UserError, match="still open"):
        c.finalize(pid)
    advance(WINDOW + 1)
    out = json.loads(c.finalize(pid))
    assert out["state"] == "RELEASABLE"
    # the seller's reserve is freed
    assert json.loads(c.get_seller(SELLER))["reserved_atto"] == "0"


def test_no_receipt_no_release_and_then_refund(module, c):
    """THE enforcement point of the whole scheme."""
    registered_seller(module, c)
    qh = registered_quote(module, c)
    pid = recorded_payment(module, c, qh)
    as_(module, STRANGER, 0)
    with pytest.raises(module.gl.vm.UserError, match="still has"):
        c.finalize(pid)                          # seller's receipt period runs
    advance(WINDOW + 3600 + 1)                   # window + grace
    out = json.loads(c.finalize(pid))
    assert out["state"] == "REFUND_DUE"
    assert "no receipt" in out["reason"]


def test_the_refund_deadline_arms_rather_than_fires_on_a_zero_anchor(module, c):
    """The arm-on-outage bug found before a single test ran: recorded_at of 0
    made the deadline 0+window+grace — INSTANTLY refundable, expiring the
    seller's receipt period before it began."""
    registered_seller(module, c)
    qh = registered_quote(module, c)
    pid = recorded_payment(module, c, qh)
    # simulate a payment recorded during a clock outage
    c.payments[pid].recorded_at = module.u256(0)
    as_(module, STRANGER, 0)
    out = json.loads(c.finalize(pid))
    assert out["state"] == "AWAITING_RECEIPT"    # armed, not refunded
    assert "anchor" in out["note"]
    # and the deadline now runs from the armed anchor
    with pytest.raises(module.gl.vm.UserError, match="still has"):
        c.finalize(pid)


def test_mark_settled_is_operator_only_and_records_the_rail(module, c):
    registered_seller(module, c)
    qh = registered_quote(module, c)
    pid = recorded_payment(module, c, qh)
    receipted(module, c, pid)
    advance(WINDOW + 1)
    as_(module, STRANGER, 0)
    c.finalize(pid)
    with pytest.raises(module.gl.vm.UserError, match="only the operator"):
        c.mark_settled(pid, "0xdeadbeef")
    as_(module, OPERATOR, 0)
    out = json.loads(c.mark_settled(pid, "0xdeadbeef"))
    assert out["state"] == "RELEASED"
    assert json.loads(c.get_payment(pid))["settle_ref"] == "0xdeadbeef"


def test_settlement_cannot_be_recorded_over_a_live_state(module, c):
    registered_seller(module, c)
    qh = registered_quote(module, c)
    pid = recorded_payment(module, c, qh)
    as_(module, OPERATOR, 0)
    with pytest.raises(module.gl.vm.UserError, match="RELEASABLE or"):
        c.mark_settled(pid, "0xdeadbeef")
