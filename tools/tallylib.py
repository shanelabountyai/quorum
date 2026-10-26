"""Quorum — the tally engine spec made executable (test oracle, never product code).

Every rule code in docs/domain-brief.md §4–§8 is implemented here. The TypeScript engine
under src/tally/ is written from the brief, not from this file, and must agree with it on
every ballot, every total, every result and every commitment.

Pure: no clock, no randomness, no I/O. Timestamps are fixed-width strings
("YYYY-MM-DDTHH:MM:SS", one unnamed local zone) compared lexically; dates are "YYYY-MM-DD".
Money and shares are integers (cents, basis points). Standard library only.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field

TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

RESOLUTION_BASES = (
    "MAJORITY_OF_VOTES_CAST",            # T-1  yes*2 > yes+no          (units; abstain excluded)
    "MAJORITY_OF_UNITS_REPRESENTED",     # T-2  yes*2 > units represented (abstain counts against)
    "MAJORITY_OF_ALL_UNITS",             # T-3  yes*2 > total units
    "TWO_THIRDS_OF_VOTES_CAST",          # T-4  yes*3 >= 2*(yes+no), yes+no > 0
    "MAJORITY_OF_WEIGHTED_SHARES_CAST",  # T-5  yes_bps*2 > yes_bps+no_bps
    "TWO_THIRDS_OF_ALL_WEIGHTED_SHARES", # T-6  yes_bps*3 >= 2*total_share_bps
)
ELECTION_MODES = ("UNITS", "WEIGHTED")
RESOLUTION_CHOICES = ("YES", "NO", "ABSTAIN")

# Ballot-level reject codes in precedence order (B-/P-/E- rules). First hit wins.
BALLOT_REJECTS = (
    "UNKNOWN_UNIT", "EARLY", "LATE",
    "PROXY_UNKNOWN", "PROXY_UNIT_MISMATCH", "PROXY_GRANTOR_NOT_OWNER", "PROXY_LATE", "PROXY_REVOKED",
    "PROXY_CHAIN", "PROXY_HOLDER_MISMATCH", "PROXY_HOLDER_NOT_MEMBER",
    "NOT_OWNER", "INELIGIBLE_DELINQUENT", "DUPLICATE_UNIT",
    "PROXY_SUPERSEDED_BY_OWNER",   # E-9: applied to an EARLIER counted proxy ballot when the owner later casts directly
)
# Selection-level codes (S- rules): void one contest on one counted ballot, never the ballot.
SELECTION_VOIDS = ("INVALID_CHOICE", "UNKNOWN_CANDIDATE", "DUPLICATE_CANDIDATE", "OVERVOTE")


# ---------------------------------------------------------------- hashing (C- rules)

def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def canonical_choices(choices: dict) -> str:
    """C-1: JSON, sorted keys, no whitespace; a list value is sorted when every item is a string."""
    out = {}
    for k in sorted(choices):
        v = choices[k]
        if isinstance(v, list) and all(isinstance(x, str) for x in v):
            v = sorted(v)
        out[k] = v
    return json.dumps(out, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def receipt_for(ballot_id: str, nonce: str, choices: dict) -> str:
    """C-2: receipt = SHA-256(ballot_id | nonce | canonical choices), '|' separated, lowercase hex."""
    return sha256_hex(f"{ballot_id}|{nonce}|{canonical_choices(choices)}")


def merkle_root(receipts: list[str]) -> str:
    """C-3: leaves = SHA-256(receipt) sorted ascending; parent = SHA-256(left_hex + right_hex);
    an odd node is carried up unchanged; the root of no receipts is SHA-256("")."""
    level = sorted(sha256_hex(r) for r in receipts)
    if not level:
        return sha256_hex("")
    while len(level) > 1:
        nxt = []
        for i in range(0, len(level), 2):
            if i + 1 < len(level):
                nxt.append(sha256_hex(level[i] + level[i + 1]))
            else:
                nxt.append(level[i])
        level = nxt
    return level[0]


def contest_commitment(root: str, contest_id: str, totals: dict) -> str:
    """C-4: SHA-256(root | contest_id | canonical totals JSON)."""
    return sha256_hex(f"{root}|{contest_id}|{json.dumps(totals, sort_keys=True, separators=(',', ':'))}")


def meeting_commitment(contest_commitments: dict[str, str]) -> str:
    """C-5: SHA-256 of the contest commitments joined by '|' in contest-id order."""
    return sha256_hex("|".join(contest_commitments[c] for c in sorted(contest_commitments)))


# ---------------------------------------------------------------- as-of lookups (E- rules)

def owners_of_unit(ownerships: list[dict], unit_id: str, as_of: str) -> set[str]:
    """E-1: an ownership row covers [from_date, to_date); to_date blank = open."""
    return {o["owner_id"] for o in ownerships
            if o["unit_id"] == unit_id and o["from_date"] <= as_of and (not o["to_date"] or o["to_date"] > as_of)}


def is_member(ownerships: list[dict], owner_id: str, as_of: str) -> bool:
    """E-2: a member is an owner of at least one unit as of the record date."""
    return any(o["owner_id"] == owner_id and o["from_date"] <= as_of and (not o["to_date"] or o["to_date"] > as_of)
               for o in ownerships)


def share_bps(shares: list[dict], unit_id: str, as_of: str) -> int:
    """E-3: the share row with the latest effective_from <= as_of; a later-dated row is ignored."""
    rows = [s for s in shares if s["unit_id"] == unit_id and s["effective_from"] <= as_of]
    if not rows:
        raise ValueError(f"no share for {unit_id} as of {as_of}")
    return int(max(rows, key=lambda s: s["effective_from"])["share_bps"])


def balance_cents(ledger: list[dict], unit_id: str, as_of: str) -> int:
    """E-4: Σ CHARGE + FINE − Σ PAYMENT over entries dated <= as_of (inclusive). Integer cents."""
    bal = 0
    for e in ledger:
        if e["unit_id"] != unit_id or e["date"] > as_of:
            continue
        amt = int(e["amount_cents"])
        if e["kind"] in ("CHARGE", "FINE"):
            bal += amt
        elif e["kind"] == "PAYMENT":
            bal -= amt
        else:
            raise ValueError(f"unknown ledger kind {e['kind']}")
    return bal


def delinquent_units(ledger: list[dict], unit_ids: list[str], as_of: str) -> set[str]:
    """E-5: delinquent iff balance as of the record date > 0."""
    return {u for u in unit_ids if balance_cents(ledger, u, as_of) > 0}


# ---------------------------------------------------------------- ballot evaluation

@dataclass
class BallotResult:
    ballot_id: str
    unit_id: str
    cast_by: str
    via_proxy_id: str
    cast_at: str
    status: str                      # COUNTED | REJECTED
    code: str                        # reject code or ""
    receipt: str
    bps: int                         # share as of record date (0 when unit unknown)
    selections: dict = field(default_factory=dict)   # contest_id -> {"status": VOTED|BLANK|VOID, "code": "", "value": ...}
    unknown_contests: list = field(default_factory=list)


def _check_rules(rules: dict) -> None:
    if rules.get("proxy_max_depth", 1) != 1:
        raise ValueError("RULES_INVALID: only proxy_max_depth 1 is implemented (D-14)")
    if rules["quorum"]["basis"] not in ("UNITS", "WEIGHTED"):
        raise ValueError("RULES_INVALID: quorum.basis")
    for ts in (rules["open_at"], rules["close_at"]):
        if not TS_RE.match(ts):
            raise ValueError(f"RULES_INVALID: timestamp {ts}")
    if not DATE_RE.match(rules["record_date"]):
        raise ValueError("RULES_INVALID: record_date")


def ballot_reject_code(b: dict, rules: dict, unit_ids: set[str], ownerships: list[dict], proxies: dict[str, dict],
                       delinquent: set[str], counted_units: dict[str, str]) -> str:
    """B-1..B-3, P-1..P-8, E-6..E-9 in precedence order. '' means the ballot counts.

    counted_units maps a unit with a COUNTED ballot to that ballot's via_proxy_id ('' = direct).
    E-9 (D-10): a direct owner cast after a counted PROXY ballot counts and supersedes it; the caller
    re-labels the earlier proxy ballot PROXY_SUPERSEDED_BY_OWNER. Any other second cast is DUPLICATE_UNIT."""
    as_of = rules["record_date"]
    if b["unit_id"] not in unit_ids:
        return "UNKNOWN_UNIT"                                         # B-1
    if not TS_RE.match(b["cast_at"]):
        raise ValueError(f"INPUT_INVALID: cast_at {b['cast_at']!r} on {b['ballot_id']}")
    if b["cast_at"] < rules["open_at"]:
        return "EARLY"                                                # B-2
    if b["cast_at"] >= rules["close_at"]:
        return "LATE"                                                 # B-3
    if b["via_proxy_id"]:
        p = proxies.get(b["via_proxy_id"])
        if p is None:
            return "PROXY_UNKNOWN"                                    # P-1
        if p["grantor_unit"] != b["unit_id"]:
            return "PROXY_UNIT_MISMATCH"                              # P-2
        if p["grantor_owner"] not in owners_of_unit(ownerships, p["grantor_unit"], as_of):
            return "PROXY_GRANTOR_NOT_OWNER"                          # P-3
        if p["received_at"] >= rules["close_at"] or p["received_at"] > b["cast_at"]:
            return "PROXY_LATE"                                       # P-4
        if p["revoked_at"] and p["revoked_at"] <= b["cast_at"]:
            return "PROXY_REVOKED"                                    # P-5
        if b["cast_by"] != p["holder_owner"]:
            chained = any(q["grantor_owner"] == p["holder_owner"] and q["holder_owner"] == b["cast_by"]
                          for q in proxies.values())
            return "PROXY_CHAIN" if chained else "PROXY_HOLDER_MISMATCH"   # P-6 / P-7
        if rules.get("proxy_holder_must_be_member", True) and not is_member(ownerships, p["holder_owner"], as_of):
            return "PROXY_HOLDER_NOT_MEMBER"                          # P-8
    else:
        if b["cast_by"] not in owners_of_unit(ownerships, b["unit_id"], as_of):
            return "NOT_OWNER"                                        # E-6
    if rules.get("delinquency_suspends_voting", False) and b["unit_id"] in delinquent:
        return "INELIGIBLE_DELINQUENT"                                # E-7
    if b["unit_id"] in counted_units:
        if not b["via_proxy_id"] and counted_units[b["unit_id"]]:
            return ""                                                 # E-9 owner supersedes the proxy ballot
        return "DUPLICATE_UNIT"                                       # E-8 (B-4 first valid cast wins)
    return ""


def evaluate_selection(contest: dict, value) -> dict:
    """S-1..S-5. Returns {"status": VOTED|BLANK|VOID, "code": str, "value": normalized value}."""
    if value is None or value == "" or value == []:
        return {"status": "BLANK", "code": "", "value": None}            # S-1
    if contest["kind"] == "ELECTION":
        if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
            return {"status": "VOID", "code": "INVALID_CHOICE", "value": None}        # S-2
        ids = {c["id"] for c in contest["candidates"]}
        if any(x not in ids for x in value):
            return {"status": "VOID", "code": "UNKNOWN_CANDIDATE", "value": None}     # S-3
        if len(set(value)) != len(value):
            return {"status": "VOID", "code": "DUPLICATE_CANDIDATE", "value": None}   # S-4
        if len(value) > contest["seats"]:
            return {"status": "VOID", "code": "OVERVOTE", "value": None}              # S-5
        return {"status": "VOTED", "code": "", "value": sorted(value)}
    # RESOLUTION
    if not isinstance(value, str) or value not in RESOLUTION_CHOICES:
        return {"status": "VOID", "code": "INVALID_CHOICE", "value": None}            # S-2
    return {"status": "VOTED", "code": "", "value": value}


def evaluate_ballots(meeting: dict, units: list[dict], shares: list[dict], ownerships: list[dict],
                     ledger: list[dict], proxies: list[dict], ballots: list[dict]) -> list[BallotResult]:
    """Evaluates every ballot in (cast_at, ballot_id) order (B-4). Input order is irrelevant."""
    rules = meeting["rules"]
    _check_rules(rules)
    as_of = rules["record_date"]
    unit_ids = {u["unit_id"] for u in units}
    pmap = {p["proxy_id"]: p for p in proxies}
    delinquent = delinquent_units(ledger, sorted(unit_ids), as_of) if rules.get("delinquency_suspends_voting") else set()
    contests = {c["contest_id"]: c for c in meeting["contests"]}
    counted_units: dict[str, str] = {}
    counted_result: dict[str, BallotResult] = {}
    out: list[BallotResult] = []
    for b in sorted(ballots, key=lambda x: (x["cast_at"], x["ballot_id"])):
        choices = b["choices"] if isinstance(b["choices"], dict) else json.loads(b["choices"])
        code = ballot_reject_code(b, rules, unit_ids, ownerships, pmap, delinquent, counted_units)
        r = BallotResult(ballot_id=b["ballot_id"], unit_id=b["unit_id"], cast_by=b["cast_by"],
                         via_proxy_id=b["via_proxy_id"], cast_at=b["cast_at"],
                         status="REJECTED" if code else "COUNTED", code=code,
                         receipt=receipt_for(b["ballot_id"], b["nonce"], choices),
                         bps=share_bps(shares, b["unit_id"], as_of) if b["unit_id"] in unit_ids else 0)
        if not code:
            prev = counted_result.get(b["unit_id"])
            if prev is not None:                                      # E-9: the earlier proxy ballot is superseded
                prev.status, prev.code = "REJECTED", "PROXY_SUPERSEDED_BY_OWNER"
                prev.selections, prev.unknown_contests = {}, []
            counted_units[b["unit_id"]] = b["via_proxy_id"]
            counted_result[b["unit_id"]] = r
            for cid, c in contests.items():
                r.selections[cid] = evaluate_selection(c, choices.get(cid))
            r.unknown_contests = sorted(k for k in choices if k not in contests)
        out.append(r)
    return out


# ---------------------------------------------------------------- tally

def quorum_status(rules: dict, total_units: int, total_bps: int, results: list[BallotResult]) -> dict:
    """Q-1..Q-4."""
    counted = [r for r in results if r.status == "COUNTED"]
    rep_units = len(counted)                                          # Q-1 one counted ballot = one unit represented
    rep_bps = sum(r.bps for r in counted)
    direct = [r for r in counted if not r.via_proxy_id]
    thr = rules["quorum"]["threshold_bps"]
    units_met = rep_units * 10000 >= thr * total_units                # Q-2
    weighted_met = rep_bps * 10000 >= thr * total_bps                 # Q-3
    direct_met = len(direct) * 10000 >= thr * total_units
    binding = rules["quorum"]["basis"]
    return {
        "basis": binding, "threshold_bps": thr,
        "units_represented": rep_units, "total_units": total_units, "units_met": units_met,
        "bps_represented": rep_bps, "total_bps": total_bps, "weighted_met": weighted_met,
        "direct_units": len(direct), "proxy_units": rep_units - len(direct), "direct_only_met": direct_met,
        "met": units_met if binding == "UNITS" else weighted_met,      # Q-4
    }


def resolution_passes(basis: str, yes: int, no: int, yes_bps: int, no_bps: int,
                      represented_units: int, total_units: int, total_bps: int) -> bool:
    if basis == "MAJORITY_OF_VOTES_CAST":
        return yes * 2 > yes + no
    if basis == "MAJORITY_OF_UNITS_REPRESENTED":
        return yes * 2 > represented_units
    if basis == "MAJORITY_OF_ALL_UNITS":
        return yes * 2 > total_units
    if basis == "TWO_THIRDS_OF_VOTES_CAST":
        return yes + no > 0 and yes * 3 >= 2 * (yes + no)
    if basis == "MAJORITY_OF_WEIGHTED_SHARES_CAST":
        return yes_bps * 2 > yes_bps + no_bps
    if basis == "TWO_THIRDS_OF_ALL_WEIGHTED_SHARES":
        return yes_bps * 3 >= 2 * total_bps
    raise ValueError(f"RULES_INVALID: basis {basis}")


def seats_from_totals(totals: dict[str, int], seats: int) -> dict:
    """T-7/T-8: plurality top-N; the boundary tie is never broken."""
    ranked = sorted(totals.items(), key=lambda kv: (-kv[1], kv[0]))
    if len(ranked) <= seats:
        raise ValueError("RULES_INVALID: candidates must exceed seats")
    boundary = ranked[seats - 1][1]
    above = [c for c, v in ranked if v > boundary]
    at = [c for c, v in ranked if v == boundary]
    remaining = seats - len(above)
    if len(at) == remaining:
        return {"elected": sorted(above + at), "open_seats": 0, "tied": [], "result": "ELECTED"}
    return {"elected": sorted(above), "open_seats": remaining, "tied": sorted(at), "result": "TIE_UNRESOLVED"}


def tally_contest(contest: dict, results: list[BallotResult], quorum: dict, total_units: int, total_bps: int) -> dict:
    cid = contest["contest_id"]
    counted = [r for r in results if r.status == "COUNTED"]
    voted = [r for r in counted if r.selections[cid]["status"] == "VOTED"]
    blank = sum(1 for r in counted if r.selections[cid]["status"] == "BLANK")
    void_by_code: dict[str, int] = {}
    for r in counted:
        s = r.selections[cid]
        if s["status"] == "VOID":
            void_by_code[s["code"]] = void_by_code.get(s["code"], 0) + 1
    out = {"contest_id": cid, "kind": contest["kind"], "title": contest["title"],
           "counted_ballots": len(counted), "voted": len(voted), "blank": blank,
           "void_by_code": dict(sorted(void_by_code.items()))}
    if contest["kind"] == "ELECTION":
        units = {c["id"]: 0 for c in contest["candidates"]}
        weighted = {c["id"]: 0 for c in contest["candidates"]}
        for r in voted:
            for cand in r.selections[cid]["value"]:
                units[cand] += 1                                   # T-9 one vote per unit per candidate
                weighted[cand] += r.bps                            # T-10 share bps per candidate
        mode = contest["mode"]
        binding = units if mode == "UNITS" else weighted
        other = weighted if mode == "UNITS" else units
        seat = seats_from_totals(binding, contest["seats"])
        alt = seats_from_totals(other, contest["seats"])
        out.update({"mode": mode, "seats": contest["seats"],
                    "totals": {"UNITS": units, "WEIGHTED": weighted},
                    "elected": seat["elected"], "open_seats": seat["open_seats"], "tied": seat["tied"],
                    "result": "NO_QUORUM" if not quorum["met"] else seat["result"],          # T-11
                    "informational_other_mode": {"mode": "WEIGHTED" if mode == "UNITS" else "UNITS",
                                                 "elected": alt["elected"], "tied": alt["tied"],
                                                 "differs": alt["elected"] != seat["elected"] or alt["tied"] != seat["tied"]}})
    else:
        u = {k: 0 for k in RESOLUTION_CHOICES}
        w = {k: 0 for k in RESOLUTION_CHOICES}
        for r in counted:
            s = r.selections[cid]
            if s["status"] == "VOTED":
                u[s["value"]] += 1
                w[s["value"]] += r.bps
            elif s["status"] == "BLANK":
                u["ABSTAIN"] += 1                                  # S-1 blank counts as ABSTAIN
                w["ABSTAIN"] += r.bps
        basis = contest["basis"]
        if basis not in RESOLUTION_BASES:
            raise ValueError(f"RULES_INVALID: basis {basis}")
        rep = quorum["units_represented"]
        by_basis = {b: resolution_passes(b, u["YES"], u["NO"], w["YES"], w["NO"], rep, total_units, total_bps)
                    for b in RESOLUTION_BASES}
        out.update({"basis": basis, "totals": {"units": u, "bps": w},
                    "passes_by_basis": by_basis,
                    "result": "NO_QUORUM" if not quorum["met"] else ("PASSED" if by_basis[basis] else "FAILED")})
    return out


def tally(meeting: dict, units: list[dict], shares: list[dict], ownerships: list[dict], ledger: list[dict],
          proxies: list[dict], ballots: list[dict]) -> dict:
    """The whole meeting: ballots → quorum → contests → commitments. Deterministic in ballot order."""
    rules = meeting["rules"]
    results = evaluate_ballots(meeting, units, shares, ownerships, ledger, proxies, ballots)
    as_of = rules["record_date"]
    total_units = len(units)
    total_bps = sum(share_bps(shares, u["unit_id"], as_of) for u in units)
    if total_bps != rules.get("total_share_bps", total_bps):
        raise ValueError(f"RULES_INVALID: shares sum to {total_bps} as of {as_of}, rules say {rules['total_share_bps']}")
    q = quorum_status(rules, total_units, total_bps, results)
    root = merkle_root([r.receipt for r in results])              # C-3 over every received ballot
    contests = []
    commits = {}
    for c in sorted(meeting["contests"], key=lambda c: c["contest_id"]):
        t = tally_contest(c, results, q, total_units, total_bps)
        t["commitment"] = contest_commitment(root, c["contest_id"], t["totals"])
        commits[c["contest_id"]] = t["commitment"]
        contests.append(t)
    rejects: dict[str, int] = {}
    for r in results:
        if r.status == "REJECTED":
            rejects[r.code] = rejects.get(r.code, 0) + 1
    return {
        "meeting_id": meeting["meeting_id"], "record_date": as_of,
        "ballots_received": len(results), "ballots_counted": sum(1 for r in results if r.status == "COUNTED"),
        "ballots_rejected": len(results) - sum(1 for r in results if r.status == "COUNTED"),
        "rejected_by_code": dict(sorted(rejects.items())),
        "unknown_contest_keys": sum(len(r.unknown_contests) for r in results),
        "quorum": q, "merkle_root": root, "contests": contests,
        "meeting_commitment": meeting_commitment(commits),
        "ballot_results": results,
    }
