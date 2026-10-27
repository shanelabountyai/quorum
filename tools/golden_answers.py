"""Quorum — kickoff answer key (test oracle, never product code).

Re-derives every golden case in docs/domain-brief.md §9 (GT-01..GT-21, tally) and §10
(GQ-01..GQ-12, quorum and eligibility) from tools/tallylib.py and checks each against the
value worked by hand in the brief. Prints one line per case and ends with OK, or exits 1
naming the first mismatch.

The EXPECTED values below are the hand-derived ones. If tallylib disagrees, the brief and
tallylib are out of step: fix both deliberately, never this file's expected value.
The two hash constants (GT-02, GT-03) were checked independently with `sha256sum`.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tallylib as T  # noqa: E402

# A four-unit association for the hand cases. Shares 1000/2000/3000/4000 bps (sum 10000).
UNITS = [{"unit_id": u} for u in ("U1", "U2", "U3", "U4")]
SHARES = [{"unit_id": "U1", "share_bps": 1000, "effective_from": "2019-01-01"},
          {"unit_id": "U1", "share_bps": 1200, "effective_from": "2026-07-01"},   # GQ-02 only (see shares_for)
          {"unit_id": "U1", "share_bps": 1500, "effective_from": "2027-01-01"},
          {"unit_id": "U2", "share_bps": 2000, "effective_from": "2019-01-01"},
          {"unit_id": "U3", "share_bps": 3000, "effective_from": "2019-01-01"},
          {"unit_id": "U4", "share_bps": 4000, "effective_from": "2019-01-01"}]
SHARES_FLAT = [s for s in SHARES if s["effective_from"] == "2019-01-01"]
OWNERSHIPS = [{"unit_id": "U1", "owner_id": "o1", "from_date": "2019-01-01", "to_date": ""},
              {"unit_id": "U2", "owner_id": "o2", "from_date": "2019-01-01", "to_date": ""},
              {"unit_id": "U2", "owner_id": "o2b", "from_date": "2019-01-01", "to_date": ""},
              {"unit_id": "U3", "owner_id": "o3", "from_date": "2019-01-01", "to_date": ""},
              {"unit_id": "U4", "owner_id": "o4old", "from_date": "2019-01-01", "to_date": "2026-06-01"},
              {"unit_id": "U4", "owner_id": "o4", "from_date": "2026-06-01", "to_date": ""}]
LEDGER = [{"entry_id": "L1", "unit_id": "U3", "kind": "CHARGE", "amount_cents": "10000", "date": "2026-10-01"}]
RULES = {"timezone_label": "America/Chicago", "record_date": "2026-11-14", "open_at": "2026-11-01T09:00:00",
         "close_at": "2026-11-14T19:00:00", "quorum": {"basis": "UNITS", "threshold_bps": 5000},
         "proxy_max_depth": 1, "proxy_holder_must_be_member": True, "delinquency_suspends_voting": True,
         "duplicate_unit_rule": "FIRST_VALID_CAST_WINS", "total_share_bps": 10000}
ELECTION = {"contest_id": "E", "kind": "ELECTION", "title": "Board", "seats": 2, "mode": "WEIGHTED",
            "candidates": [{"id": "X", "name": "X"}, {"id": "Y", "name": "Y"}, {"id": "Z", "name": "Z"}]}


def meeting(basis: str = "MAJORITY_OF_VOTES_CAST") -> dict:
    return {"meeting_id": "M", "rules": RULES, "contests": [ELECTION, {"contest_id": "R", "kind": "RESOLUTION", "title": "R", "basis": basis}]}


def ballot(bid: str, unit: str, by: str, at: str, choices: dict, via: str = "", nonce: str = "0" * 32) -> dict:
    return {"ballot_id": bid, "unit_id": unit, "cast_by": by, "via_proxy_id": via, "cast_at": at, "nonce": nonce, "choices": choices}


# GT-15 ballots: U1 YES+[X]; U2 NO+[Y,Z]; U2 co-owner later (duplicate); U4 blank; U3 delinquent
B15 = [ballot("b1", "U1", "o1", "2026-11-14T10:00:00", {"E": ["X"], "R": "YES"}),
       ballot("b2", "U2", "o2", "2026-11-14T10:05:00", {"E": ["Z", "Y"], "R": "NO"}),
       ballot("b3", "U2", "o2b", "2026-11-14T10:06:00", {"E": ["X"], "R": "YES"}),
       ballot("b4", "U4", "o4", "2026-11-14T10:07:00", {}),
       ballot("b5", "U3", "o3", "2026-11-14T10:08:00", {"E": ["X"], "R": "YES"})]


def run(ballots: list[dict], basis: str = "MAJORITY_OF_VOTES_CAST") -> dict:
    return T.tally(meeting(basis), UNITS, SHARES_FLAT, OWNERSHIPS, LEDGER, [], ballots)


def contest(res: dict, cid: str) -> dict:
    return next(c for c in res["contests"] if c["contest_id"] == cid)


def reject(b: dict, proxies: list[dict], counted: dict[str, str] | None = None, delinquent: set[str] | None = None) -> str:
    """counted: unit -> via_proxy_id of its COUNTED ballot ('' = direct)."""
    return T.ballot_reject_code(b, RULES, {"U1", "U2", "U3", "U4"}, OWNERSHIPS, {p["proxy_id"]: p for p in proxies},
                                delinquent or set(), counted or {})


def main() -> int:
    cases: list[tuple[str, str, object, object]] = []
    add = lambda gid, desc, got, exp: cases.append((gid, desc, got, exp))  # noqa: E731

    # ---- GT: tally
    add("GT-01", "canonical choices: sorted keys, sorted candidate list, no whitespace",
        T.canonical_choices({"R1": "YES", "E1": ["C-02", "C-01"]}), '{"E1":["C-01","C-02"],"R1":"YES"}')
    add("GT-02", "receipt = SHA-256(ballot_id|nonce|canonical)",
        T.receipt_for("B-001", "0" * 31 + "1", {"R1": "YES", "E1": ["C-02", "C-01"]}),
        "d7c74b79b185da57e77d7125fe65cf1e87d4000b19758471dd5220069311a4b9")
    add("GT-03", "merkle root of no receipts = SHA-256('')", T.merkle_root([]),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    r1 = "d7c74b79b185da57e77d7125fe65cf1e87d4000b19758471dd5220069311a4b9"
    add("GT-04", "merkle root of one receipt = SHA-256(receipt)", T.merkle_root([r1]),
        "bbfa71fac1a53fab6bb8c92e6421f924e0364fa57f4f94eb1fa662dcb4fb1825")
    rs = ["aa", "bb", "cc"]
    l1, l2, l3 = sorted(T.sha256_hex(r) for r in rs)
    add("GT-05", "merkle root of three receipts = SHA-256(SHA-256(l1+l2)+l3), order-independent",
        (T.merkle_root(rs) == T.merkle_root(["cc", "aa", "bb"]), T.merkle_root(rs) == T.sha256_hex(T.sha256_hex(l1 + l2) + l3)), (True, True))
    add("GT-06", "seats: boundary tie leaves the seat open", T.seats_from_totals({"X": 5, "Y": 3, "Z": 3}, 2),
        {"elected": ["X"], "open_seats": 1, "tied": ["Y", "Z"], "result": "TIE_UNRESOLVED"})
    add("GT-07", "seats: a tie that fills exactly the remaining seats is not a tie", T.seats_from_totals({"X": 5, "Y": 5, "Z": 1}, 2),
        {"elected": ["X", "Y"], "open_seats": 0, "tied": [], "result": "ELECTED"})
    add("GT-08", "seats: three-way tie for two seats leaves both open", T.seats_from_totals({"X": 4, "Y": 4, "Z": 4}, 2),
        {"elected": [], "open_seats": 2, "tied": ["X", "Y", "Z"], "result": "TIE_UNRESOLVED"})
    add("GT-09", "seats: a zero-vote tie is still a tie", T.seats_from_totals({"X": 3, "Y": 0, "Z": 0}, 2),
        {"elected": ["X"], "open_seats": 1, "tied": ["Y", "Z"], "result": "TIE_UNRESOLVED"})
    P = T.resolution_passes
    add("GT-10", "MAJORITY_OF_VOTES_CAST: 5-5 fails, 6-5 passes",
        (P("MAJORITY_OF_VOTES_CAST", 5, 5, 0, 0, 10, 120, 10000), P("MAJORITY_OF_VOTES_CAST", 6, 5, 0, 0, 11, 120, 10000)), (False, True))
    add("GT-11", "TWO_THIRDS_OF_VOTES_CAST: 2-1 passes (>=), 0-0 fails",
        (P("TWO_THIRDS_OF_VOTES_CAST", 2, 1, 0, 0, 3, 120, 10000), P("TWO_THIRDS_OF_VOTES_CAST", 0, 0, 0, 0, 3, 120, 10000)), (True, False))
    add("GT-12", "MAJORITY_OF_ALL_UNITS of 120: 60 fails, 61 passes",
        (P("MAJORITY_OF_ALL_UNITS", 60, 0, 0, 0, 85, 120, 10000), P("MAJORITY_OF_ALL_UNITS", 61, 0, 0, 0, 85, 120, 10000)), (False, True))
    add("GT-13", "TWO_THIRDS_OF_ALL_WEIGHTED_SHARES: 6666 bps fails, 6667 passes",
        (P("TWO_THIRDS_OF_ALL_WEIGHTED_SHARES", 0, 0, 6666, 0, 85, 120, 10000), P("TWO_THIRDS_OF_ALL_WEIGHTED_SHARES", 0, 0, 6667, 0, 85, 120, 10000)), (False, True))
    ev = lambda v: (T.evaluate_selection(ELECTION, v)["status"], T.evaluate_selection(ELECTION, v)["code"])  # noqa: E731
    add("GT-14", "selection codes and precedence (election, 2 seats)",
        (ev(["X", "Y", "Z"]), ev(["X", "X"]), ev(["Q"]), ev("X"), ev([]), ev(["Q", "Q", "X"]), ev(["Y", "X"])),
        (("VOID", "OVERVOTE"), ("VOID", "DUPLICATE_CANDIDATE"), ("VOID", "UNKNOWN_CANDIDATE"), ("VOID", "INVALID_CHOICE"),
         ("BLANK", ""), ("VOID", "UNKNOWN_CANDIDATE"), ("VOTED", "")))   # exactly N selections is a vote, not an overvote
    res = run(B15)
    st = {r.ballot_id: (r.status, r.code) for r in res["ballot_results"]}
    add("GT-15", "mini meeting: statuses, quorum 3/4 units, election WEIGHTED Y,Z elected vs UNITS three-way tie",
        (st, res["quorum"]["units_represented"], res["quorum"]["bps_represented"], res["quorum"]["met"],
         contest(res, "E")["totals"], contest(res, "E")["elected"], contest(res, "E")["result"],
         contest(res, "E")["informational_other_mode"]["tied"], contest(res, "E")["informational_other_mode"]["differs"]),
        ({"b1": ("COUNTED", ""), "b2": ("COUNTED", ""), "b3": ("REJECTED", "DUPLICATE_UNIT"), "b4": ("COUNTED", ""),
          "b5": ("REJECTED", "INELIGIBLE_DELINQUENT")}, 3, 7000, True,
         {"UNITS": {"X": 1, "Y": 1, "Z": 1}, "WEIGHTED": {"X": 1000, "Y": 2000, "Z": 2000}}, ["Y", "Z"], "ELECTED", ["X", "Y", "Z"], True))
    add("GT-16", "mini meeting: resolution totals, blank counts as ABSTAIN, 1-1 fails majority of votes cast",
        (contest(res, "R")["totals"], contest(res, "R")["result"], contest(res, "R")["blank"]),
        ({"units": {"YES": 1, "NO": 1, "ABSTAIN": 1}, "bps": {"YES": 1000, "NO": 2000, "ABSTAIN": 4000}}, "FAILED", 1))
    res_rev = run(list(reversed(B15)))
    add("GT-17", "order independence: reversed ballot order gives the same commitments and totals",
        (res_rev["meeting_commitment"] == res["meeting_commitment"], res_rev["merkle_root"] == res["merkle_root"],
         [c["totals"] for c in res_rev["contests"]] == [c["totals"] for c in res["contests"]]), (True, True, True))
    add("GT-18", "mini meeting under MAJORITY_OF_UNITS_REPRESENTED (1*2 > 3 is false) and MAJORITY_OF_WEIGHTED_SHARES_CAST (1000*2 > 3000 is false)",
        (contest(run(B15, "MAJORITY_OF_UNITS_REPRESENTED"), "R")["result"], contest(run(B15, "MAJORITY_OF_WEIGHTED_SHARES_CAST"), "R")["result"]),
        ("FAILED", "FAILED"))
    res_q = run(B15[:1])
    add("GT-19", "one unit of four is below a 50% quorum: both contests NO_QUORUM, totals still reported",
        (res_q["quorum"]["met"], contest(res_q, "E")["result"], contest(res_q, "R")["result"], contest(res_q, "E")["totals"]["WEIGHTED"]),
        (False, "NO_QUORUM", "NO_QUORUM", {"X": 1000, "Y": 0, "Z": 0}))
    root = res["merkle_root"]
    tot = contest(res, "R")["totals"]
    tot2 = {"units": {"YES": 2, "NO": 1, "ABSTAIN": 0}, "bps": tot["bps"]}
    add("GT-20", "commitment binds the totals: same root, different totals, different commitment; identical inputs, identical",
        (T.contest_commitment(root, "R", tot) == contest(res, "R")["commitment"], T.contest_commitment(root, "R", tot2) != contest(res, "R")["commitment"],
         T.meeting_commitment({"R": "r", "E": "e"}) == T.sha256_hex("e|r")), (True, True, True))

    # GT-21: owner override (E-9). Proxy P1 (U1 o1 -> o2) casts YES+[X] at 10:00; o1 casts NO+[Y] directly at 12:00;
    # o2 casts again by proxy at 13:00; o1 casts again at 14:00. Final: only the 12:00 direct cast counts.
    P1 = {"proxy_id": "P1", "grantor_unit": "U1", "grantor_owner": "o1", "holder_owner": "o2", "received_at": "2026-11-05T09:00:00", "revoked_at": ""}
    B21 = [ballot("p1", "U1", "o2", "2026-11-14T10:00:00", {"E": ["X"], "R": "YES"}, via="P1"),
           ballot("d1", "U1", "o1", "2026-11-14T12:00:00", {"E": ["Y"], "R": "NO"}),
           ballot("p2", "U1", "o2", "2026-11-14T13:00:00", {"E": ["X"], "R": "YES"}, via="P1"),
           ballot("d2", "U1", "o1", "2026-11-14T14:00:00", {"E": ["Z"], "R": "YES"})]
    res21 = T.tally(meeting(), UNITS, SHARES_FLAT, OWNERSHIPS, LEDGER, [P1], B21)
    res21r = T.tally(meeting(), UNITS, SHARES_FLAT, OWNERSHIPS, LEDGER, [P1], list(reversed(B21)))
    st21 = {r.ballot_id: (r.status, r.code) for r in res21["ballot_results"]}
    add("GT-21", "owner override: a direct owner cast supersedes the counted proxy ballot; later proxy and direct casts are duplicates; order-independent",
        (st21, res21["quorum"]["units_represented"], contest(res21, "R")["totals"]["units"], contest(res21, "E")["totals"]["WEIGHTED"],
         res21r["meeting_commitment"] == res21["meeting_commitment"], len([r for r in res21["ballot_results"] if r.status == "REJECTED"])),
        ({"p1": ("REJECTED", "PROXY_SUPERSEDED_BY_OWNER"), "d1": ("COUNTED", ""), "p2": ("REJECTED", "DUPLICATE_UNIT"), "d2": ("REJECTED", "DUPLICATE_UNIT")},
         1, {"YES": 0, "NO": 1, "ABSTAIN": 0}, {"X": 0, "Y": 1000, "Z": 0}, True, 3))

    # ---- GQ: quorum and eligibility
    add("GQ-01", "owners as of: to_date is exclusive (sold 2026-06-01)",
        (T.owners_of_unit(OWNERSHIPS, "U4", "2026-05-31"), T.owners_of_unit(OWNERSHIPS, "U4", "2026-06-01"), T.is_member(OWNERSHIPS, "o4old", "2026-11-14")),
        ({"o4old"}, {"o4"}, False))
    add("GQ-02", "share as of: latest effective_from <= as-of; a future-dated row is ignored",
        (T.share_bps(SHARES, "U1", "2026-06-30"), T.share_bps(SHARES, "U1", "2026-11-14"), T.share_bps(SHARES, "U1", "2027-01-01")), (1000, 1200, 1500))
    led = [{"unit_id": "U1", "kind": "CHARGE", "amount_cents": "19600", "date": "2026-11-01"},
           {"unit_id": "U1", "kind": "PAYMENT", "amount_cents": "19600", "date": "2026-11-15"}]
    add("GQ-03", "balance as of: a payment the day after the record date does not count", (T.balance_cents(led, "U1", "2026-11-14"), T.balance_cents(led, "U1", "2026-11-15")), (19600, 0))
    led2 = [dict(led[0]), {**led[1], "date": "2026-11-14"}]
    add("GQ-04", "balance as of: a payment on the record date counts (inclusive)", (T.balance_cents(led2, "U1", "2026-11-14"), T.delinquent_units(led2, ["U1"], "2026-11-14")), (0, set()))
    led3 = [{"unit_id": "U1", "kind": "FINE", "amount_cents": "15000", "date": "2026-09-20"}]
    add("GQ-05", "an unpaid fine makes a unit delinquent", (T.balance_cents(led3, "U1", "2026-11-14"), T.delinquent_units(led3, ["U1"], "2026-11-14")), (15000, {"U1"}))
    br = lambda bid, unit, bps, via="": T.BallotResult(bid, unit, "o", via, "2026-11-14T10:00:00", "COUNTED", "", "r", bps)  # noqa: E731
    q = T.quorum_status(RULES, 4, 10000, [br("b1", "U1", 1000), br("b2", "U2", 2000)])
    qw = T.quorum_status({**RULES, "quorum": {"basis": "WEIGHTED", "threshold_bps": 5000}}, 4, 10000, [br("b1", "U1", 1000), br("b2", "U2", 2000)])
    add("GQ-06", "quorum 2 of 4 units at 50%: met by units (2*10000 >= 5000*4), not by weight (3000 < 5000); the basis decides",
        (q["units_met"], q["weighted_met"], q["met"], qw["met"]), (True, False, True, False))
    q2 = T.quorum_status(RULES, 4, 10000, [br("b1", "U1", 1000), br("b2", "U2", 2000, via="P1")])
    add("GQ-07", "quorum met only through a proxy: direct 1/4 not met, direct+proxy 2/4 met",
        (q2["direct_units"], q2["proxy_units"], q2["direct_only_met"], q2["met"]), (1, 1, False, True))
    late_dup = ballot("x", "U1", "o1", "2026-11-14T19:00:00", {})
    del_dup = ballot("y", "U3", "o3", "2026-11-14T10:00:00", {})
    add("GQ-08", "precedence: LATE before DUPLICATE_UNIT; INELIGIBLE_DELINQUENT before DUPLICATE_UNIT; at the close instant is LATE",
        (reject(late_dup, [], counted={"U1": ""}), reject(del_dup, [], counted={"U3": ""}, delinquent={"U3"}),
         reject(ballot("z", "U1", "o1", "2026-11-14T18:59:59", {}), []), reject(ballot("w", "U1", "o1", "2026-11-14T10:00:00", {}), [], counted={"U1": ""})),
        ("LATE", "INELIGIBLE_DELINQUENT", "", "DUPLICATE_UNIT"))
    P1 = {"proxy_id": "P1", "grantor_unit": "U1", "grantor_owner": "o1", "holder_owner": "o2", "received_at": "2026-11-05T09:00:00", "revoked_at": ""}
    P2 = {"proxy_id": "P2", "grantor_unit": "U2", "grantor_owner": "o2", "holder_owner": "o3", "received_at": "2026-11-06T09:00:00", "revoked_at": ""}
    at = "2026-11-14T10:00:00"
    add("GQ-09", "proxy: holder casts OK; the holder's own proxy-holder casting is PROXY_CHAIN; anyone else is PROXY_HOLDER_MISMATCH; wrong unit is PROXY_UNIT_MISMATCH",
        (reject(ballot("a", "U1", "o2", at, {}, via="P1"), [P1, P2]), reject(ballot("b", "U1", "o3", at, {}, via="P1"), [P1, P2]),
         reject(ballot("c", "U1", "o4", at, {}, via="P1"), [P1, P2]), reject(ballot("d", "U2", "o2", at, {}, via="P1"), [P1, P2])),
        ("", "PROXY_CHAIN", "PROXY_HOLDER_MISMATCH", "PROXY_UNIT_MISMATCH"))
    P3 = {**P1, "proxy_id": "P3", "received_at": "2026-11-14T19:05:00"}
    P4 = {**P1, "proxy_id": "P4", "received_at": "2026-11-13T12:00:00"}
    P5 = {**P1, "proxy_id": "P5", "revoked_at": "2026-11-10T09:00:00"}
    P6 = {"proxy_id": "P6", "grantor_unit": "U1", "grantor_owner": "o1", "holder_owner": "o4old", "received_at": "2026-11-05T09:00:00", "revoked_at": ""}
    P7 = {"proxy_id": "P7", "grantor_unit": "U4", "grantor_owner": "o4old", "holder_owner": "o1", "received_at": "2026-11-05T09:00:00", "revoked_at": ""}
    add("GQ-10", "proxy: received after close or after the ballot is PROXY_LATE; revoked at or before the cast is PROXY_REVOKED; a former owner cannot hold or grant",
        (reject(ballot("a", "U1", "o2", "2026-11-14T18:30:00", {}, via="P3"), [P3]), reject(ballot("b", "U1", "o2", "2026-11-12T10:00:00", {}, via="P4"), [P4]),
         reject(ballot("c", "U1", "o2", "2026-11-12T11:00:00", {}, via="P5"), [P5]), reject(ballot("d", "U1", "o4old", at, {}, via="P6"), [P6]),
         reject(ballot("e", "U4", "o1", at, {}, via="P7"), [P7]), reject(ballot("f", "U4", "o4old", at, {}), [])),
        ("PROXY_LATE", "PROXY_LATE", "PROXY_REVOKED", "PROXY_HOLDER_NOT_MEMBER", "PROXY_GRANTOR_NOT_OWNER", "NOT_OWNER"))

    add("GQ-11", "E-8/E-9 at the reject-code level: direct after counted proxy counts; proxy after proxy, proxy after direct, and direct after direct are DUPLICATE_UNIT",
        (reject(ballot("a", "U1", "o1", at, {}), [P1], counted={"U1": "P1"}),
         reject(ballot("b", "U1", "o2", at, {}, via="P1"), [P1], counted={"U1": "P1"}),
         reject(ballot("c", "U1", "o2", at, {}, via="P1"), [P1], counted={"U1": ""}),
         reject(ballot("d", "U1", "o1", at, {}), [P1], counted={"U1": ""})),
        ("", "DUPLICATE_UNIT", "DUPLICATE_UNIT", "DUPLICATE_UNIT"))

    # GQ-12 (D-41): a CREDIT reduces the balance exactly like a PAYMENT, dated the same way (E-4 inclusive).
    led4 = [{"unit_id": "U1", "kind": "CHARGE", "amount_cents": "19600", "date": "2026-11-01"},
            {"unit_id": "U1", "kind": "CREDIT", "amount_cents": "4600", "date": "2026-11-10"},
            {"unit_id": "U1", "kind": "PAYMENT", "amount_cents": "15000", "date": "2026-11-12"}]
    led5 = [dict(led4[0]), {"unit_id": "U1", "kind": "CREDIT", "amount_cents": "19600", "date": "2026-11-15"}]
    add("GQ-12", "a CREDIT reduces the balance like a payment; one dated after the record date does not count",
        (T.balance_cents(led4, "U1", "2026-11-09"), T.balance_cents(led4, "U1", "2026-11-10"), T.balance_cents(led4, "U1", "2026-11-14"),
         T.delinquent_units(led4, ["U1"], "2026-11-14"), T.balance_cents(led5, "U1", "2026-11-14"), T.delinquent_units(led5, ["U1"], "2026-11-14")),
        (19600, 15000, 0, set(), 19600, {"U1"}))

    bad = 0
    for gid, desc, got, exp in cases:
        ok = got == exp
        bad += 0 if ok else 1
        print(f"{gid:6} {'ok ' if ok else 'BAD'} {desc}" + ("" if ok else f"\n       got      {got!r}\n       expected {exp!r}"))
    print()
    if bad:
        print(f"FAIL: {bad} mismatch(es)")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
