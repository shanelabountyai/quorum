"""Quorum — reference tally and evaluation (test oracle, never product code).

Reads a fixtures directory produced by build_fixtures.py, runs the brief's engine (tallylib)
over ballots.csv, and prints the eval table `npm run tally:eval` must reproduce field for
field: per meeting, ballots received / counted / rejected by code and quorum; per contest,
counted / voted / blank / void by code, totals in both modes, result, commitment.

--write-expected writes fixtures/expected_ballots.csv, expected_totals.csv, expected_results.csv,
expected_quorum.csv and published_ballots.csv (the anonymized list anyone can recount from).
--shuffle N re-runs the tally N times on a shuffled ballot order and fails if any commitment moves.

Usage: python3 tools/reference_tally.py [--fixtures DIR] [--write-expected] [--shuffle N]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tallylib as T  # noqa: E402


def read_csv(path: str) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def load(fixtures: str) -> dict:
    d = {name: read_csv(os.path.join(fixtures, f"{name}.csv"))
         for name in ("units", "unit_shares", "owners", "ownerships", "assessments", "proxies", "ballots")}
    with open(os.path.join(fixtures, "meeting.json"), encoding="utf-8") as f:
        d["meeting"] = json.load(f)
    for b in d["ballots"]:
        b["choices"] = json.loads(b["choices"])
    return d


def run(d: dict, ballots: list[dict] | None = None) -> dict:
    return T.tally(d["meeting"], d["units"], d["unit_shares"], d["ownerships"], d["assessments"], d["proxies"],
                   ballots if ballots is not None else d["ballots"])


def fmt_counts(c: dict) -> str:
    return ", ".join(f"{k} {v}" for k, v in sorted(c.items())) or "none"


def print_report(res: dict) -> None:
    q = res["quorum"]
    print(f"meeting {res['meeting_id']} record_date {res['record_date']}")
    print(f"ballots received {res['ballots_received']} / counted {res['ballots_counted']} / rejected {res['ballots_rejected']}")
    print(f"rejected by code: {fmt_counts(res['rejected_by_code'])}")
    print(f"unknown contest keys on counted ballots: {res['unknown_contest_keys']}")
    print(f"quorum basis {q['basis']} threshold {q['threshold_bps']} bps: units {q['units_represented']}/{q['total_units']} "
          f"{'MET' if q['units_met'] else 'NOT MET'}; weighted {q['bps_represented']}/{q['total_bps']} bps "
          f"{'MET' if q['weighted_met'] else 'NOT MET'}; direct only {q['direct_units']}/{q['total_units']} "
          f"{'MET' if q['direct_only_met'] else 'NOT MET'} (proxy units {q['proxy_units']}); binding: {'MET' if q['met'] else 'NOT MET'}")
    print(f"merkle_root {res['merkle_root']}")
    for c in res["contests"]:
        print()
        head = f"contest {c['contest_id']} \"{c['title']}\" {c['kind']}"
        head += f" seats={c['seats']} mode={c['mode']}" if c["kind"] == "ELECTION" else f" basis={c['basis']}"
        print(head)
        print(f"  counted {c['counted_ballots']} / voted {c['voted']} / blank {c['blank']} / void: {fmt_counts(c['void_by_code'])}")
        if c["kind"] == "ELECTION":
            for mode in ("UNITS", "WEIGHTED"):
                tag = "binding" if mode == c["mode"] else "informational"
                print(f"  totals {mode} ({tag}): " + ", ".join(f"{k} {v}" for k, v in sorted(c["totals"][mode].items(), key=lambda kv: (-kv[1], kv[0]))))
            print(f"  result {c['result']}: elected {', '.join(c['elected']) or '-'}; open seats {c['open_seats']}; tied {', '.join(c['tied']) or '-'}")
            o = c["informational_other_mode"]
            print(f"  other mode {o['mode']} would elect {', '.join(o['elected']) or '-'} (tied {', '.join(o['tied']) or '-'}); differs: {o['differs']}")
        else:
            u, w = c["totals"]["units"], c["totals"]["bps"]
            print(f"  totals units: YES {u['YES']}, NO {u['NO']}, ABSTAIN {u['ABSTAIN']}; bps: YES {w['YES']}, NO {w['NO']}, ABSTAIN {w['ABSTAIN']}")
            print(f"  result {c['result']} under {c['basis']}")
            print("  by basis: " + ", ".join(f"{b} {'PASS' if v else 'FAIL'}" for b, v in c["passes_by_basis"].items()))
        print(f"  commitment {c['commitment']}")
    print()
    print(f"meeting_commitment {res['meeting_commitment']}")


def write_expected(fixtures: str, res: dict, ballots: list[dict]) -> None:
    def w(name: str, cols: list[str], rows: list[list]) -> None:
        with open(os.path.join(fixtures, name), "w", newline="", encoding="utf-8") as f:
            wr = csv.writer(f, lineterminator="\n")
            wr.writerow(cols)
            wr.writerows(rows)
    rs = sorted(res["ballot_results"], key=lambda r: r.ballot_id)
    w("expected_ballots.csv", ["ballot_id", "unit_id", "status", "code", "bps", "receipt", "selection_codes"],
      [[r.ballot_id, r.unit_id, r.status, r.code, r.bps, r.receipt,
        ";".join(f"{cid}:{s['status']}{(':' + s['code']) if s['code'] else ''}" for cid, s in sorted(r.selections.items()))] for r in rs])
    by_id = {b["ballot_id"]: b for b in ballots}
    pub = sorted(rs, key=lambda r: r.receipt)
    w("published_ballots.csv", ["receipt", "ballot_id", "status", "code", "choices_canonical"],
      [[r.receipt, r.ballot_id, r.status, r.code, T.canonical_choices(by_id[r.ballot_id]["choices"])] for r in pub])
    totals = []
    for c in res["contests"]:
        if c["kind"] == "ELECTION":
            for mode in ("UNITS", "WEIGHTED"):
                for k, v in sorted(c["totals"][mode].items()):
                    totals.append([c["contest_id"], mode, k, v])
        else:
            for mode, key in (("UNITS", "units"), ("WEIGHTED", "bps")):
                for k, v in sorted(c["totals"][key].items()):
                    totals.append([c["contest_id"], mode, k, v])
    w("expected_totals.csv", ["contest_id", "mode", "option", "value"], totals)
    rows = []
    for c in res["contests"]:
        if c["kind"] == "ELECTION":
            rows.append([c["contest_id"], c["kind"], c["mode"], c["result"], ";".join(c["elected"]), c["open_seats"], ";".join(c["tied"]),
                         c["counted_ballots"], c["voted"], c["blank"], fmt_counts(c["void_by_code"]), c["commitment"]])
        else:
            rows.append([c["contest_id"], c["kind"], c["basis"], c["result"], "", "", "",
                         c["counted_ballots"], c["voted"], c["blank"], fmt_counts(c["void_by_code"]), c["commitment"]])
    rows.append(["MEETING", "", "", "", "", "", "", res["ballots_received"], res["ballots_counted"], res["ballots_rejected"],
                 fmt_counts(res["rejected_by_code"]), res["meeting_commitment"]])
    w("expected_results.csv", ["contest_id", "kind", "mode_or_basis", "result", "elected", "open_seats", "tied",
                               "counted", "voted", "blank", "void_or_rejected_by_code", "commitment"], rows)
    q = res["quorum"]
    w("expected_quorum.csv", ["field", "value"], [[k, str(v)] for k, v in q.items()] + [["merkle_root", res["merkle_root"]]])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures"))
    ap.add_argument("--write-expected", action="store_true")
    ap.add_argument("--shuffle", type=int, default=0)
    a = ap.parse_args()
    d = load(a.fixtures)
    res = run(d)
    print_report(res)
    if a.shuffle:
        rng = random.Random(1)
        for i in range(a.shuffle):
            shuffled = list(d["ballots"])
            rng.shuffle(shuffled)
            r2 = run(d, shuffled)
            if r2["meeting_commitment"] != res["meeting_commitment"] or \
               [c["totals"] for c in r2["contests"]] != [c["totals"] for c in res["contests"]]:
                print(f"ORDER DEPENDENCE on shuffle {i + 1}")
                return 1
        print(f"order independence: {a.shuffle} shuffles, same totals and meeting_commitment")
    if a.write_expected:
        write_expected(a.fixtures, res, d["ballots"])
        print("wrote expected_ballots.csv, expected_totals.csv, expected_results.csv, expected_quorum.csv, published_ballots.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
