"""Quorum — seeded synthetic fixture generator (test oracle, never product code).

Writes, under fixtures/ (default) or --out DIR:
  units.csv           120 units of "Larkspur Commons" (synthetic), type, building, floor
  unit_shares.csv     ownership share in basis points with effective_from (sum is exactly 10000 at every as-of date)
  owners.csv          synthetic owners (example.com emails; no real people)
  ownerships.csv      who owns which unit over [from_date, to_date)
  assessments.csv     dues ledger in integer cents (CHARGE / PAYMENT / FINE), append-only
  meeting.json        the 2026 annual meeting: rules JSON, 2 elections, 4 resolutions
  proxies.csv         proxy grants, some defective on purpose
  ballots.csv         ~110 ballots with injected defects; each carries its random nonce
  answer_key_ballots.csv  the generator's intent per ballot: expected status, code, defect, trap
  MANIFEST.json       seed, counts, defects applied, sha256 of every file

Deterministic: --seed 20261025 twice gives identical bytes. Standard library only.
The generator runs the oracle (tallylib) while building so the deliberate traps hold on this seed;
it asserts every trap before writing and exits non-zero if one does not hold.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tallylib as T  # noqa: E402

SEED_DEFAULT = 20261025
RECORD_DATE = "2026-11-14"
OPEN_AT = "2026-11-01T09:00:00"
CLOSE_AT = "2026-11-14T19:00:00"

FIRST = ["Avery", "Blake", "Carmen", "Dmitri", "Elena", "Farah", "Gavin", "Hana", "Ignacio", "Jun", "Keiko",
         "Lucas", "Maren", "Nadia", "Oren", "Priya", "Quinn", "Rosa", "Soren", "Tamsin", "Umar", "Vera",
         "Wendell", "Ximena", "Yusuf", "Zara", "Beatriz", "Callum", "Delphine", "Emeka", "Freya", "Gustavo",
         "Hollis", "Ines", "Jorah", "Kirsten", "Leandro", "Mireille", "Nikolai", "Odette", "Pavel", "Rhea",
         "Sunita", "Tobias", "Ulla", "Viggo", "Willa", "Yannick", "Zelda", "Anouk"]
LAST = ["Abernathy", "Brandvold", "Castellano", "Delacroix", "Eskildsen", "Fairweather", "Grunwald", "Haddad",
        "Iwata", "Jorgensen", "Kowalczyk", "Lindqvist", "Marchetti", "Nakagawa", "Obuya", "Petrakis", "Quintero",
        "Rasmussen", "Sandoval", "Thibodeaux", "Ustinov", "Vasquez", "Whitfield", "Yamazaki", "Zielinski",
        "Oyelaran", "Brennan", "Castille", "Dufresne", "Ekwueme", "Farrokhzad", "Galloway", "Hinojosa",
        "Ingebrigtsen", "Jablonski", "Kirchner", "Lazzari", "Moreau", "Nwosu", "Okonkwo", "Pellegrino",
        "Reinholt", "Szymanski", "Tanaka", "Uriarte", "Villanueva", "Westergaard", "Xiang", "Yilmaz", "Zapata"]

# position on each floor -> unit type; base bps per type; every unit gets +1 so the 120 sum to exactly 10000
FLOOR_PLAN = ["STUDIO", "1BR", "2BR", "3BR", "1BR", "2BR", "STUDIO", "2BR", "1BR", "3BR"]
BPS = {"STUDIO": 56, "1BR": 71, "2BR": 91, "3BR": 111, "PH": 151}
MONTHLY_CENTS_PER_BPS = 350  # $420,000 annual budget / 12 = $35,000 = 3,500,000 cents / 10000 bps

CANDIDATES_E1 = [("C-01", "Maren Lindqvist"), ("C-02", "Emeka Obuya"), ("C-03", "Rosa Quintero"),
                 ("C-04", "Tobias Grunwald"), ("C-05", "Hana Iwata")]
CANDIDATES_E2 = [("C-11", "Soren Rasmussen"), ("C-12", "Priya Sandoval"), ("C-13", "Wendell Fairweather"),
                 ("C-14", "Delphine Moreau")]


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def write_csv(path: str, rows: list[dict], cols: list[str]) -> bytes:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, lineterminator="\n", extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({c: r.get(c, "") for c in cols})
    data = buf.getvalue().encode("utf-8")
    with open(path, "wb") as f:
        f.write(data)
    return data


def write_text(path: str, text: str) -> bytes:
    data = text.encode("utf-8")
    with open(path, "wb") as f:
        f.write(data)
    return data


class Gen:
    def __init__(self, seed: int):
        self.rng = random.Random(seed)
        self.seed = seed
        self.units: list[dict] = []
        self.shares: list[dict] = []
        self.owners: list[dict] = []
        self.ownerships: list[dict] = []
        self.ledger: list[dict] = []
        self.proxies: list[dict] = []
        self.ballots: list[dict] = []
        self.key: dict[str, dict] = {}       # ballot temp id -> intent
        self.defects: dict[str, int] = {}
        self.unit_owner: dict[str, list[str]] = {}
        self._bid = 0

    # ------------------------------------------------------------ roster
    def build_roster(self) -> None:
        for bld in ("A", "B"):
            for floor in range(1, 7):
                for pos, typ in enumerate(FLOOR_PLAN, start=1):
                    if floor == 6 and typ == "3BR":
                        typ = "PH"
                    uid = f"{bld}-{floor}{pos:02d}"
                    self.units.append({"unit_id": uid, "unit_type": typ, "building": bld, "floor": floor})
                    self.shares.append({"unit_id": uid, "share_bps": BPS[typ], "effective_from": "2019-01-01"})
        assert sum(s["share_bps"] for s in self.shares) == 10000
        # mid-year amendment (effective before the record date) and a future-dated one (must be ignored)
        self.shares += [{"unit_id": "A-301", "share_bps": 60, "effective_from": "2026-07-01"},
                        {"unit_id": "A-302", "share_bps": 67, "effective_from": "2026-07-01"},
                        {"unit_id": "B-610", "share_bps": 160, "effective_from": "2027-01-01"},
                        {"unit_id": "B-601", "share_bps": 47, "effective_from": "2027-01-01"}]
        for as_of in ("2026-01-01", RECORD_DATE, "2027-06-01"):
            assert sum(T.share_bps(self.shares, u["unit_id"], as_of) for u in self.units) == 10000, as_of

        names = [(f, l) for f in FIRST for l in LAST]
        self.rng.shuffle(names)
        n = 0

        def new_owner() -> str:
            nonlocal n
            f, l = names[n]
            n += 1
            oid = f"O-{n:03d}"
            self.owners.append({"owner_id": oid, "name": f"{f} {l}", "email": f"{f}.{l}@example.com".lower()})
            return oid

        unit_ids = [u["unit_id"] for u in self.units]
        # three owners hold two units each
        second_units = ["A-209", "B-404", "B-508"]
        for uid in unit_ids:
            if uid in second_units:
                continue
            oid = new_owner()
            self.ownerships.append({"unit_id": uid, "owner_id": oid, "from_date": "2019-06-01", "to_date": ""})
            self.unit_owner[uid] = [oid]
        for uid, src in zip(second_units, ["A-208", "B-403", "B-507"]):
            oid = self.unit_owner[src][0]
            self.ownerships.append({"unit_id": uid, "owner_id": oid, "from_date": "2022-03-01", "to_date": ""})
            self.unit_owner[uid] = [oid]
        # 20 co-owned units (the special ones named below are among them)
        co_units = ["A-110", "A-205", "B-203", "B-305", "A-402", "A-507", "B-402", "A-604", "B-506", "A-108",
                    "B-209", "A-303", "B-608", "A-406", "B-104", "A-509", "B-301", "A-602", "B-501", "A-610"]
        co_units = [u for u in co_units if u in self.unit_owner][:20]
        assert len(co_units) == 20
        for uid in co_units:
            oid = new_owner()
            self.ownerships.append({"unit_id": uid, "owner_id": oid, "from_date": "2019-06-01", "to_date": ""})
            self.unit_owner[uid].append(oid)
        # A-407 sold on 2026-08-15: the old owner stops being a member that day
        old = self.unit_owner["A-407"][0]
        for o in self.ownerships:
            if o["unit_id"] == "A-407" and o["owner_id"] == old:
                o["to_date"] = "2026-08-15"
        new = new_owner()
        self.ownerships.append({"unit_id": "A-407", "owner_id": new, "from_date": "2026-08-15", "to_date": ""})
        self.unit_owner["A-407"] = [new]
        self.old_owner_a407 = old
        self.co_units = co_units

    # ------------------------------------------------------------ ledger
    def build_ledger(self) -> None:
        # monthly dues Jan–Nov 2026, charged on the 1st, paid on the 5th; delinquents miss payments
        miss = {"A-204": {9, 10, 11}, "B-108": {10, 11}, "A-508": {11}, "B-307": {10, 11}, "A-110": {8, 9, 10, 11},
                "B-509": {7, 8, 9, 10, 11}}
        eid = 0
        for u in self.units:
            uid = u["unit_id"]
            for m in range(1, 12):
                d = f"2026-{m:02d}-01"
                amt = MONTHLY_CENTS_PER_BPS * T.share_bps(self.shares, uid, d)
                eid += 1
                self.ledger.append({"entry_id": f"L-{eid:05d}", "unit_id": uid, "kind": "CHARGE", "amount_cents": amt,
                                    "date": d, "memo": f"2026-{m:02d} dues"})
                if m in miss.get(uid, set()):
                    continue
                eid += 1
                self.ledger.append({"entry_id": f"L-{eid:05d}", "unit_id": uid, "kind": "PAYMENT", "amount_cents": amt,
                                    "date": f"2026-{m:02d}-05", "memo": f"2026-{m:02d} dues"})
        # catch-up payments: B-307 pays on the record date (eligible), A-508 pays the day after (still delinquent)
        for uid, d, months in (("B-307", "2026-11-14", (10, 11)), ("A-508", "2026-11-15", (11,))):
            amt = sum(MONTHLY_CENTS_PER_BPS * T.share_bps(self.shares, uid, f"2026-{m:02d}-01") for m in months)
            eid += 1
            self.ledger.append({"entry_id": f"L-{eid:05d}", "unit_id": uid, "kind": "PAYMENT", "amount_cents": amt,
                                "date": d, "memo": "catch-up"})
        # one violation fine, paid (Phase 3 seam)
        eid += 1
        self.ledger.append({"entry_id": f"L-{eid:05d}", "unit_id": "B-203", "kind": "FINE", "amount_cents": 15000,
                            "date": "2026-09-20", "memo": "V-2026-007 unapproved balcony screen; hearing 2026-09-15"})
        eid += 1
        self.ledger.append({"entry_id": f"L-{eid:05d}", "unit_id": "B-203", "kind": "PAYMENT", "amount_cents": 15000,
                            "date": "2026-10-02", "memo": "V-2026-007 fine"})
        got = T.delinquent_units(self.ledger, [u["unit_id"] for u in self.units], RECORD_DATE)
        assert got == {"A-204", "B-108", "A-508", "A-110", "B-509"}, got

    # ------------------------------------------------------------ meeting
    def build_meeting(self) -> dict:
        return {
            "meeting_id": "AM-2026", "title": "Larkspur Commons Condominium Association — 2026 Annual Meeting",
            "rules": {
                "timezone_label": "America/Chicago", "record_date": RECORD_DATE,
                "open_at": OPEN_AT, "close_at": CLOSE_AT,
                "quorum": {"basis": "UNITS", "threshold_bps": 5000},
                "proxy_max_depth": 1, "proxy_holder_must_be_member": True,
                "delinquency_suspends_voting": True, "duplicate_unit_rule": "FIRST_VALID_CAST_WINS",
                "total_share_bps": 10000,
            },
            "contests": [
                {"contest_id": "E1", "kind": "ELECTION", "title": "Board of Directors", "seats": 3, "mode": "WEIGHTED",
                 "candidates": [{"id": c, "name": n} for c, n in CANDIDATES_E1]},
                {"contest_id": "E2", "kind": "ELECTION", "title": "Reserve Study Committee", "seats": 2, "mode": "UNITS",
                 "candidates": [{"id": c, "name": n} for c, n in CANDIDATES_E2]},
                {"contest_id": "R1", "kind": "RESOLUTION", "title": "Approve the 2027 operating budget ($420,000)",
                 "basis": "MAJORITY_OF_VOTES_CAST"},
                {"contest_id": "R2", "kind": "RESOLUTION", "title": "Special assessment of $180,000 for roof replacement",
                 "basis": "TWO_THIRDS_OF_ALL_WEIGHTED_SHARES"},
                {"contest_id": "R3", "kind": "RESOLUTION", "title": "Amend bylaws §9.2: minimum lease term 30 days",
                 "basis": "MAJORITY_OF_ALL_UNITS"},
                {"contest_id": "R4", "kind": "RESOLUTION", "title": "Adopt the two-pet limit policy",
                 "basis": "MAJORITY_OF_UNITS_REPRESENTED"},
            ],
        }

    # ------------------------------------------------------------ ballots
    def _ts(self, day: str, h0: int, m0: int, h1: int, m1: int) -> str:
        t0, t1 = h0 * 60 + m0, h1 * 60 + m1
        t = self.rng.randint(t0, t1)
        return f"{day}T{t // 60:02d}:{t % 60:02d}:{self.rng.randint(0, 59):02d}"

    def _choices(self, bps: int) -> dict:
        r = self.rng
        pool = [c for c, _ in CANDIDATES_E1]
        k = 2 if r.random() < 0.10 else 3
        if bps >= 111:
            weights = {"C-01": 3, "C-02": 3, "C-03": 2, "C-04": 1, "C-05": 9}
        else:
            weights = {"C-01": 3, "C-02": 3, "C-03": 2, "C-04": 6, "C-05": 2}
        e1 = []
        while len(e1) < k:
            c = r.choices(pool, weights=[weights[p] for p in pool])[0]
            if c not in e1:
                e1.append(c)
        pool2 = [c for c, _ in CANDIDATES_E2]
        k2 = 1 if r.random() < 0.10 else 2
        e2 = r.sample(pool2, k2)

        def res(py: float, pn: float) -> str:
            x = r.random()
            return "YES" if x < py else ("NO" if x < py + pn else "ABSTAIN")
        ch = {"E1": e1, "E2": e2, "R1": res(0.70, 0.22), "R2": res(0.72, 0.20), "R3": res(0.55, 0.37), "R4": res(0.45, 0.40)}
        for cid in list(ch):
            if r.random() < 0.04:
                del ch[cid]      # blank selection (S-1) — counts as ABSTAIN on a resolution, no vote in an election
        return ch

    def _ballot(self, unit: str, cast_by: str, cast_at: str, via: str = "", choices: dict | None = None,
                expect: str = "COUNTED", code: str = "", defect: str = "", trap: str = "") -> dict:
        self._bid += 1
        tmp = f"T{self._bid:04d}"
        if choices is None:
            choices = self._choices(T.share_bps(self.shares, unit, RECORD_DATE) if unit in self.unit_owner else 70)
        b = {"tmp": tmp, "unit_id": unit, "cast_by": cast_by, "via_proxy_id": via, "cast_at": cast_at,
             "nonce": f"{self.rng.getrandbits(128):032x}", "choices": choices}
        self.ballots.append(b)
        self.key[tmp] = {"expected_status": expect, "expected_code": code, "defect": defect, "trap": trap}
        if defect:
            self.defects[defect] = self.defects.get(defect, 0) + 1
        return b

    def _proxy(self, unit: str, grantor: str, holder: str, received_at: str, revoked_at: str = "") -> str:
        pid = f"P-{len(self.proxies) + 1:03d}"
        self.proxies.append({"proxy_id": pid, "grantor_unit": unit, "grantor_owner": grantor, "holder_owner": holder,
                             "received_at": received_at, "revoked_at": revoked_at})
        return pid

    def build_ballots(self, meeting: dict) -> None:
        r = self.rng
        D = "2026-11-14"
        special = {"A-301", "B-610", "A-407", "A-204", "B-108", "A-508", "B-307", "A-110", "B-509",
                   "A-205", "B-305", "A-402", "B-110", "B-409", "A-308",   # duplicate / override cases
                   "A-109", "B-207", "A-310",                   # late
                   "B-410",                                     # early then valid
                   "A-101", "A-102", "A-103", "A-104", "A-105", "A-106", "A-107", "B-101", "B-102", "B-103",  # proxy defects
                   "B-506", "A-507", "B-402"}                   # selection-level defects
        rest = [u["unit_id"] for u in self.units if u["unit_id"] not in special]
        r.shuffle(rest)
        direct_units = rest[:38]
        proxy_units = rest[38:72]
        # direct voters among the specials: A-301 (share changed), B-610 (future change ignored), A-407 new owner,
        # B-307 (paid on record date), the three selection-defect units, A-215/B-315/A-402 first casts, B-420's second cast
        holders_pool = [self.unit_owner[u][0] for u in direct_units]
        r.shuffle(holders_pool)

        # --- counted direct ballots
        for u in direct_units:
            self._ballot(u, self.unit_owner[u][0], self._ts(r.choice(["2026-11-0" + str(r.randint(3, 9)), "2026-11-1" + str(r.randint(0, 3)), D, D, D]),
                                                            9, 0, 18, 55))
        self._ballot("A-301", self.unit_owner["A-301"][0], f"{D}T17:40:11", trap="SHARE_CHANGED_MIDYEAR")
        self._ballot("B-610", self.unit_owner["B-610"][0], f"{D}T17:41:02", trap="SHARE_CHANGE_FUTURE_DATED")
        self._ballot("A-407", self.unit_owner["A-407"][0], f"{D}T17:42:30", trap="UNIT_SOLD_MIDYEAR")
        self._ballot("B-307", self.unit_owner["B-307"][0], f"{D}T17:43:15", trap="PAID_ON_RECORD_DATE")
        # --- counted proxy ballots (holders are direct voters)
        for i, u in enumerate(proxy_units):
            grantor = self.unit_owner[u][0]
            holder = holders_pool[i % len(holders_pool)]
            pid = self._proxy(u, grantor, holder, self._ts("2026-11-" + f"{r.randint(2, 13):02d}", 8, 0, 20, 0))
            self._ballot(u, holder, self._ts(D, 17, 30, 18, 55), via=pid)
        # --- quorum trap: direct ballots alone are below 60 units; direct + proxy clear it (asserted below)

        # --- co-owner duplicates (B-4 / E-8)
        a, b = self.unit_owner["A-205"]
        self._ballot("A-205", a, f"{D}T10:00:00", trap="CO_OWNER_DOUBLE_CAST")
        self._ballot("A-205", b, f"{D}T14:00:00", expect="REJECTED", code="DUPLICATE_UNIT", defect="D-DUP-COOWNER", trap="CO_OWNER_DOUBLE_CAST")
        a, b = self.unit_owner["B-305"]
        self._ballot("B-305", a, f"{D}T10:30:00", trap="CO_OWNER_SAME_INSTANT")    # resolved after ids are assigned
        self._ballot("B-305", b, f"{D}T10:30:00", trap="CO_OWNER_SAME_INSTANT")
        # E-9 (D-10 owner override): the proxy ballot is counted at 11:00, then a co-owner casts directly at 18:00;
        # the owner's cast counts and the proxy ballot is re-labelled PROXY_SUPERSEDED_BY_OWNER
        a, b = self.unit_owner["A-402"]
        pid = self._proxy("A-402", a, holders_pool[0], "2026-11-05T12:00:00")
        self._ballot("A-402", holders_pool[0], f"{D}T11:00:00", via=pid, expect="REJECTED", code="PROXY_SUPERSEDED_BY_OWNER", defect="D-PROXY-SUPERSEDED", trap="OWNER_AFTER_PROXY")
        self._ballot("A-402", b, f"{D}T18:00:00", trap="OWNER_AFTER_PROXY")
        # proxy then a second proxy for the same unit: still DUPLICATE_UNIT (only the owner's own cast supersedes)
        o = self.unit_owner["B-409"][0]
        p1 = self._proxy("B-409", o, holders_pool[12], "2026-11-04T09:00:00")
        p2 = self._proxy("B-409", o, holders_pool[13], "2026-11-09T09:00:00")
        self._ballot("B-409", holders_pool[12], f"{D}T17:35:30", via=p1, trap="PROXY_THEN_PROXY")
        self._ballot("B-409", holders_pool[13], f"{D}T18:05:30", via=p2, expect="REJECTED", code="DUPLICATE_UNIT", defect="D-DUP-PROXY-AFTER-PROXY", trap="PROXY_THEN_PROXY")
        # owner direct first, proxy holder later: DUPLICATE_UNIT (a proxy never supersedes the owner)
        o = self.unit_owner["A-308"][0]
        self._ballot("A-308", o, f"{D}T10:05:00", trap="PROXY_AFTER_OWNER")
        pid = self._proxy("A-308", o, holders_pool[14], "2026-11-06T09:00:00")
        self._ballot("A-308", holders_pool[14], f"{D}T18:06:00", via=pid, expect="REJECTED", code="DUPLICATE_UNIT", defect="D-DUP-PROXY-AFTER-OWNER", trap="PROXY_AFTER_OWNER")
        o = self.unit_owner["B-110"][0]
        self._ballot("B-110", o, f"{D}T12:15:00")
        self._ballot("B-110", o, f"{D}T12:16:30", expect="REJECTED", code="DUPLICATE_UNIT", defect="D-DUP-RESUBMIT")

        # --- timing (B-2, B-3)
        self._ballot("A-109", self.unit_owner["A-109"][0], f"{D}T19:00:00", expect="REJECTED", code="LATE", defect="D-LATE-AT-CLOSE", trap="CAST_AT_CLOSE_INSTANT")
        self._ballot("B-207", self.unit_owner["B-207"][0], f"{D}T19:20:00", expect="REJECTED", code="LATE", defect="D-LATE")
        pid = self._proxy("A-310", self.unit_owner["A-310"][0], holders_pool[1], "2026-11-06T09:00:00")
        self._ballot("A-310", holders_pool[1], f"{D}T19:01:00", via=pid, expect="REJECTED", code="LATE", defect="D-LATE-PROXY-BALLOT")
        self._ballot("B-410", self.unit_owner["B-410"][0], "2026-10-31T17:00:00", expect="REJECTED", code="EARLY", defect="D-EARLY", trap="EARLY_THEN_VALID")
        self._ballot("B-410", self.unit_owner["B-410"][0], f"{D}T17:50:00", trap="EARLY_THEN_VALID")
        self._ballot("A-711", "O-999", f"{D}T17:55:00", expect="REJECTED", code="UNKNOWN_UNIT", defect="D-UNKNOWN-UNIT")

        # --- ownership and eligibility (E-6, E-7)
        self._ballot("A-407", self.old_owner_a407, f"{D}T17:58:00", expect="REJECTED", code="NOT_OWNER", defect="D-NOT-OWNER", trap="UNIT_SOLD_MIDYEAR")
        pid = self._proxy("A-407", self.old_owner_a407, holders_pool[2], "2026-11-04T10:00:00")
        self._ballot("A-407", holders_pool[2], f"{D}T18:05:00", via=pid, expect="REJECTED", code="PROXY_GRANTOR_NOT_OWNER", defect="D-PROXY-GRANTOR-NOT-OWNER", trap="UNIT_SOLD_MIDYEAR")
        self._ballot("A-204", self.unit_owner["A-204"][0], f"{D}T17:35:00", expect="REJECTED", code="INELIGIBLE_DELINQUENT", defect="D-DELINQUENT")
        pid = self._proxy("B-108", self.unit_owner["B-108"][0], holders_pool[3], "2026-11-07T10:00:00")
        self._ballot("B-108", holders_pool[3], f"{D}T18:10:00", via=pid, expect="REJECTED", code="INELIGIBLE_DELINQUENT", defect="D-DELINQUENT-VIA-PROXY")
        self._ballot("A-508", self.unit_owner["A-508"][0], f"{D}T18:12:00", expect="REJECTED", code="INELIGIBLE_DELINQUENT", defect="D-DELINQUENT", trap="PAID_DAY_AFTER_RECORD_DATE")
        a, b = self.unit_owner["A-110"]
        self._ballot("A-110", a, f"{D}T18:14:00", expect="REJECTED", code="INELIGIBLE_DELINQUENT", defect="D-DELINQUENT", trap="DELINQUENT_CO_OWNERS")
        self._ballot("A-110", b, f"{D}T18:16:00", expect="REJECTED", code="INELIGIBLE_DELINQUENT", defect="D-DELINQUENT", trap="DELINQUENT_CO_OWNERS")

        # --- proxy defects (P-1..P-8)
        self._ballot("A-101", holders_pool[4], f"{D}T18:20:00", via="P-999", expect="REJECTED", code="PROXY_UNKNOWN", defect="D-PROXY-UNKNOWN")
        pid = self._proxy("A-102", self.unit_owner["A-102"][0], holders_pool[5], "2026-11-08T10:00:00")
        self._ballot("A-103", holders_pool[5], f"{D}T18:21:00", via=pid, expect="REJECTED", code="PROXY_UNIT_MISMATCH", defect="D-PROXY-UNIT-MISMATCH")
        pid = self._proxy("A-104", self.unit_owner["A-104"][0], holders_pool[6], f"{D}T19:05:00")
        self._ballot("A-104", holders_pool[6], f"{D}T18:30:00", via=pid, expect="REJECTED", code="PROXY_LATE", defect="D-PROXY-LATE-AFTER-CLOSE", trap="LATE_PROXY_EARLY_BALLOT")
        pid = self._proxy("A-105", self.unit_owner["A-105"][0], holders_pool[7], "2026-11-13T12:00:00")
        self._ballot("A-105", holders_pool[7], "2026-11-12T10:00:00", via=pid, expect="REJECTED", code="PROXY_LATE", defect="D-PROXY-AFTER-BALLOT")
        pid = self._proxy("A-106", self.unit_owner["A-106"][0], holders_pool[8], "2026-11-03T09:00:00", revoked_at="2026-11-10T09:00:00")
        self._ballot("A-106", holders_pool[8], "2026-11-12T11:00:00", via=pid, expect="REJECTED", code="PROXY_REVOKED", defect="D-PROXY-REVOKED")
        # chain: A-107 -> owner of B-101 (absent) ; B-101 -> C (present). C votes B-101 (valid) and A-107 via the first proxy (chain)
        b_owner = self.unit_owner["B-101"][0]
        c_owner = holders_pool[9]
        p1 = self._proxy("A-107", self.unit_owner["A-107"][0], b_owner, "2026-11-05T09:00:00")
        p2 = self._proxy("B-101", b_owner, c_owner, "2026-11-06T09:00:00")
        self._ballot("B-101", c_owner, f"{D}T18:25:00", via=p2, trap="PROXY_CHAIN")
        self._ballot("A-107", c_owner, f"{D}T18:26:00", via=p1, expect="REJECTED", code="PROXY_CHAIN", defect="D-PROXY-CHAIN", trap="PROXY_CHAIN")
        pid = self._proxy("B-102", self.unit_owner["B-102"][0], holders_pool[10], "2026-11-05T09:00:00")
        self._ballot("B-102", holders_pool[11], f"{D}T18:27:00", via=pid, expect="REJECTED", code="PROXY_HOLDER_MISMATCH", defect="D-PROXY-HOLDER-MISMATCH")
        pid = self._proxy("B-103", self.unit_owner["B-103"][0], self.old_owner_a407, "2026-11-05T09:00:00")
        self._ballot("B-103", self.old_owner_a407, f"{D}T18:28:00", via=pid, expect="REJECTED", code="PROXY_HOLDER_NOT_MEMBER", defect="D-PROXY-HOLDER-NOT-MEMBER", trap="UNIT_SOLD_MIDYEAR")

        # --- selection-level defects on counted ballots (S-2..S-5) and an unknown contest key
        ch = self._choices(91); ch["E1"] = ["C-01", "C-02", "C-03", "C-04"]
        self._ballot("B-506", self.unit_owner["B-506"][0], f"{D}T17:45:00", choices=ch, defect="D-OVERVOTE-E1")
        ch = self._choices(91); ch["E2"] = ["C-11", "C-12", "C-13"]; ch["R2"] = "MAYBE"
        self._ballot("A-507", self.unit_owner["A-507"][0], f"{D}T17:46:00", choices=ch, defect="D-OVERVOTE-E2+INVALID-R2")
        ch = self._choices(91); ch["E1"] = ["C-09", "C-01"]; ch["E2"] = ["C-11", "C-11"]; ch["R9"] = "YES"
        self._ballot("B-402", self.unit_owner["B-402"][0], f"{D}T17:47:00", choices=ch, defect="D-UNKNOWN-CANDIDATE+DUP-CANDIDATE+UNKNOWN-CONTEST")
        # one fully blank ballot (represented; abstains on every resolution)
        u = direct_units[0]
        for b in self.ballots:
            if b["unit_id"] == u and not b["via_proxy_id"]:
                b["choices"] = {}
                self.key[b["tmp"]]["trap"] = "BLANK_BALLOT"
                break
        # E1 as a bare string instead of a list (INVALID_CHOICE) on a counted proxy ballot
        for b in self.ballots:
            if b["unit_id"] == proxy_units[0]:
                b["choices"]["E1"] = "C-01"
                self.key[b["tmp"]]["defect"] = "D-INVALID-CHOICE-E1"
                self.defects["D-INVALID-CHOICE-E1"] = 1
                break

    # ------------------------------------------------------------ ids, then traps
    def assign_ids(self) -> None:
        order = list(range(len(self.ballots)))
        self.rng.shuffle(order)
        for n, i in enumerate(order, start=1):
            self.ballots[i]["ballot_id"] = f"B-{n:03d}"
        # the same-instant co-owner pair: lower ballot id wins (B-4)
        pair = sorted([b for b in self.ballots if b["unit_id"] == "B-305"], key=lambda b: b["ballot_id"])
        self.key[pair[1]["tmp"]].update({"expected_status": "REJECTED", "expected_code": "DUPLICATE_UNIT", "defect": "D-DUP-SAME-INSTANT"})
        self.defects["D-DUP-SAME-INSTANT"] = 1

    def _run(self, meeting: dict) -> dict:
        return T.tally(meeting, self.units, self.shares, self.ownerships, self.ledger, self.proxies, self.ballots)

    def _voted(self, meeting: dict, cid: str) -> list[dict]:
        res = self._run(meeting)
        counted = {r.ballot_id for r in res["ballot_results"] if r.status == "COUNTED" and r.selections[cid]["status"] == "VOTED"}
        return sorted((b for b in self.ballots if b["ballot_id"] in counted), key=lambda b: b["ballot_id"])

    def _swap_election(self, meeting: dict, cid: str, frm: str, to: str, small_only: bool = False, large_only: bool = False,
                       medium_up: bool = False) -> bool:
        for b in self._voted(meeting, cid):
            bps = T.share_bps(self.shares, b["unit_id"], RECORD_DATE)
            if small_only and bps > 71:
                continue
            if large_only and bps < 111:
                continue
            if medium_up and bps < 91:
                continue
            v = b["choices"][cid]
            if frm in v and to not in v:
                b["choices"][cid] = [to if x == frm else x for x in v]
                return True
        return False

    def _add_election(self, meeting: dict, cid: str, to: str) -> bool:
        """Append `to` to one single-selection (undervote) ballot that does not already name it."""
        for b in self._voted(meeting, cid):
            v = b["choices"][cid]
            if len(v) == 1 and to not in v:
                b["choices"][cid] = v + [to]
                return True
        return False

    def _flip_res(self, meeting: dict, cid: str, frm: str, to: str, large: bool | None = None) -> bool:
        for b in self._voted(meeting, cid):
            bps = T.share_bps(self.shares, b["unit_id"], RECORD_DATE)
            if large is True and bps < 111:
                continue
            if large is False and bps > 71:
                continue
            if b["choices"][cid] == frm:
                b["choices"][cid] = to
                return True
        return False

    def enforce_traps(self, meeting: dict) -> dict:
        # E1: weighted winners differ from unweighted winners, no tie in either mode
        for _ in range(300):
            e1 = next(c for c in self._run(meeting)["contests"] if c["contest_id"] == "E1")
            w = T.seats_from_totals(e1["totals"]["WEIGHTED"], 3)
            u = T.seats_from_totals(e1["totals"]["UNITS"], 3)
            if w["result"] == "ELECTED" and u["result"] == "ELECTED" and w["elected"] != u["elected"]:
                break
            # steer toward WEIGHTED {C-01,C-04,C-05} vs UNITS {C-01,C-02,C-04}: large units lift C-05, small units lift C-02
            if w["result"] != "ELECTED":
                assert self._swap_election(meeting, "E1", w["tied"][0], w["tied"][1], large_only=True)
            elif u["result"] != "ELECTED":
                assert self._swap_election(meeting, "E1", u["tied"][0], u["tied"][1], small_only=True)
            elif "C-05" not in w["elected"]:
                lowest = min(w["elected"], key=lambda c: e1["totals"]["WEIGHTED"][c])
                assert self._swap_election(meeting, "E1", lowest, "C-05", large_only=True) or \
                    self._swap_election(meeting, "E1", lowest, "C-05", medium_up=True), "E1 nudge exhausted (weighted)"
            else:
                assert self._swap_election(meeting, "E1", "C-05", "C-02", small_only=True), "E1 nudge exhausted (units)"
        else:
            raise SystemExit("E1 trap did not converge")
        # E2 (UNITS): exactly one seat filled, the second tied between two candidates
        for _ in range(300):
            e2 = next(c for c in self._run(meeting)["contests"] if c["contest_id"] == "E2")
            ranked = sorted(e2["totals"]["UNITS"].items(), key=lambda kv: (-kv[1], kv[0]))
            (a, va), (b, vb), (c, vc), (d, vd) = ranked
            if va > vb == vc > vd:
                break
            if (vb - vc) % 2 == 1:
                # a swap moves the gap by 2; an odd gap needs one undervote ballot to add the trailing candidate
                assert self._add_election(meeting, "E2", c if vb > vc else b), "E2 parity nudge exhausted"
                continue
            if vb > vc:
                assert self._swap_election(meeting, "E2", b, c)
            elif vc > vb:
                assert self._swap_election(meeting, "E2", c, b)
            elif va == vb:
                assert self._swap_election(meeting, "E2", b, a)
                assert self._swap_election(meeting, "E2", c, b)
            else:  # vc == vd
                assert self._swap_election(meeting, "E2", d, c)
                assert self._swap_election(meeting, "E2", b, d)
        else:
            raise SystemExit("E2 tie did not converge")
        # resolutions
        for _ in range(400):
            res = self._run(meeting)
            rep = res["quorum"]["units_represented"]
            R = {c["contest_id"]: c for c in res["contests"]}
            u = {k: R[k]["totals"]["units"] for k in ("R1", "R2", "R3", "R4")}
            w2 = R["R2"]["totals"]["bps"]
            ok = True
            if not (u["R1"]["YES"] * 2 > u["R1"]["YES"] + u["R1"]["NO"]):
                ok = False; assert self._flip_res(meeting, "R1", "NO", "YES")
            if not (u["R2"]["YES"] * 3 >= 2 * (u["R2"]["YES"] + u["R2"]["NO"])):
                ok = False; assert self._flip_res(meeting, "R2", "NO", "YES", large=False)
            elif not (w2["YES"] * 3 < 2 * 10000):
                ok = False; assert self._flip_res(meeting, "R2", "YES", "NO", large=True)
            y3, n3 = u["R3"]["YES"], u["R3"]["NO"]
            if not (y3 * 2 > y3 + n3):
                ok = False; assert self._flip_res(meeting, "R3", "NO", "YES")
            elif not (y3 * 2 <= 120):
                ok = False; assert self._flip_res(meeting, "R3", "YES", "NO")
            y4, n4 = u["R4"]["YES"], u["R4"]["NO"]
            if not (y4 > n4):
                ok = False; assert self._flip_res(meeting, "R4", "NO", "YES")
            elif not (y4 * 2 <= rep):
                ok = False; assert self._flip_res(meeting, "R4", "YES", "ABSTAIN")
            if ok:
                break
        else:
            raise SystemExit("resolution traps did not converge")
        res = self._run(meeting)
        # final assertions: every trap holds and the answer key agrees with the oracle
        q = res["quorum"]
        assert q["met"] and not q["direct_only_met"], q
        R = {c["contest_id"]: c for c in res["contests"]}
        assert R["E1"]["result"] == "ELECTED" and R["E1"]["informational_other_mode"]["differs"]
        assert R["E2"]["result"] == "TIE_UNRESOLVED" and R["E2"]["open_seats"] == 1 and len(R["E2"]["tied"]) == 2
        assert R["R1"]["result"] == "PASSED"
        assert R["R2"]["result"] == "FAILED" and R["R2"]["passes_by_basis"]["TWO_THIRDS_OF_VOTES_CAST"]
        assert R["R3"]["result"] == "FAILED" and R["R3"]["passes_by_basis"]["MAJORITY_OF_VOTES_CAST"]
        assert R["R4"]["result"] == "FAILED" and R["R4"]["passes_by_basis"]["MAJORITY_OF_VOTES_CAST"]
        by_id = {b["ballot_id"]: b for b in self.ballots}
        mism = 0
        for r in res["ballot_results"]:
            k = self.key[by_id[r.ballot_id]["tmp"]]
            if (r.status, r.code) != (k["expected_status"], k["expected_code"]):
                mism += 1
                print(f"KEY MISMATCH {r.ballot_id} {r.unit_id}: oracle {r.status}/{r.code} key {k['expected_status']}/{k['expected_code']}")
        assert mism == 0, mism
        return res


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=SEED_DEFAULT)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    g = Gen(args.seed)
    g.build_roster()
    g.build_ledger()
    meeting = g.build_meeting()
    g.build_ballots(meeting)
    g.assign_ids()
    res = g.enforce_traps(meeting)

    ballots = sorted(g.ballots, key=lambda b: b["ballot_id"])
    ballot_rows = [{**b, "choices": json.dumps(b["choices"], sort_keys=True, separators=(",", ":"))} for b in ballots]
    key_rows = [{"ballot_id": b["ballot_id"], "unit_id": b["unit_id"], **g.key[b["tmp"]]} for b in ballots]

    h = {}
    o = lambda n: os.path.join(args.out, n)  # noqa: E731
    h["units.csv"] = sha256_bytes(write_csv(o("units.csv"), g.units, ["unit_id", "unit_type", "building", "floor"]))
    h["unit_shares.csv"] = sha256_bytes(write_csv(o("unit_shares.csv"), g.shares, ["unit_id", "share_bps", "effective_from"]))
    h["owners.csv"] = sha256_bytes(write_csv(o("owners.csv"), g.owners, ["owner_id", "name", "email"]))
    h["ownerships.csv"] = sha256_bytes(write_csv(o("ownerships.csv"), g.ownerships, ["unit_id", "owner_id", "from_date", "to_date"]))
    h["assessments.csv"] = sha256_bytes(write_csv(o("assessments.csv"), g.ledger, ["entry_id", "unit_id", "kind", "amount_cents", "date", "memo"]))
    h["meeting.json"] = sha256_bytes(write_text(o("meeting.json"), json.dumps(meeting, indent=2, sort_keys=True) + "\n"))
    h["proxies.csv"] = sha256_bytes(write_csv(o("proxies.csv"), g.proxies, ["proxy_id", "grantor_unit", "grantor_owner", "holder_owner", "received_at", "revoked_at"]))
    h["ballots.csv"] = sha256_bytes(write_csv(o("ballots.csv"), ballot_rows, ["ballot_id", "unit_id", "cast_by", "via_proxy_id", "cast_at", "nonce", "choices"]))
    h["answer_key_ballots.csv"] = sha256_bytes(write_csv(o("answer_key_ballots.csv"), key_rows, ["ballot_id", "unit_id", "expected_status", "expected_code", "defect", "trap"]))

    q = res["quorum"]
    manifest = {
        "generator": "tools/build_fixtures.py", "seed": args.seed,
        "counts": {"units": len(g.units), "owners": len(g.owners), "co_owned_units": len(g.co_units),
                   "ledger_entries": len(g.ledger), "proxies": len(g.proxies), "ballots": len(g.ballots),
                   "ballots_counted": res["ballots_counted"], "ballots_rejected": res["ballots_rejected"],
                   "rejected_by_code": res["rejected_by_code"],
                   "units_represented": q["units_represented"], "direct_units": q["direct_units"], "proxy_units": q["proxy_units"],
                   "bps_represented": q["bps_represented"], "delinquent_units": sorted(T.delinquent_units(g.ledger, [u["unit_id"] for u in g.units], RECORD_DATE)),
                   "traps": sorted({k["trap"] for k in g.key.values() if k["trap"]})},
        "defects_applied": dict(sorted(g.defects.items())),
        "sha256": h,
    }
    mj = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    write_text(o("MANIFEST.json"), mj)
    print(mj)
    return 0


if __name__ == "__main__":
    sys.exit(main())
