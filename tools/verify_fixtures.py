"""Quorum — fixture freeze check (test oracle, never product code).

Regenerates the fixtures with the pinned seed into a temporary directory, runs the reference
tally there with --write-expected, and compares the sha256 of every file (generated and
expected_*) with fixtures/MANIFEST.json plus the expected_* files on disk. Then re-runs
golden_answers. Prints OK or names the first file whose bytes moved. Used by `npm run fixtures:check`.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
EXPECTED = ("expected_ballots.csv", "expected_totals.csv", "expected_results.csv", "expected_quorum.csv", "published_ballots.csv")


def sha(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main() -> int:
    fixtures = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "fixtures")
    manifest_path = os.path.join(fixtures, "MANIFEST.json")
    if not os.path.exists(manifest_path):
        print(f"no MANIFEST.json in {fixtures}; run tools/build_fixtures.py first")
        return 1
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    seed = manifest["seed"]
    want = dict(manifest["sha256"])
    for name in EXPECTED:
        p = os.path.join(fixtures, name)
        if os.path.exists(p):
            want[name] = sha(p)
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "build_fixtures.py"), "--seed", str(seed), "--out", tmp],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-2000:], r.stderr[-2000:])
            return 1
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "reference_tally.py"), "--fixtures", tmp, "--write-expected", "--shuffle", "3"],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-2000:], r.stderr[-2000:])
            return 1
        with open(os.path.join(tmp, "MANIFEST.json"), encoding="utf-8") as f:
            fresh = json.load(f)["sha256"]
        for name in EXPECTED:
            fresh[name] = sha(os.path.join(tmp, name))
    bad = 0
    for name, h in sorted(want.items()):
        got = fresh.get(name)
        if got != h:
            bad += 1
            print(f"MOVED {name}: on disk {h[:12]}… regenerated {str(got)[:12]}…")
        else:
            print(f"ok    {name} {h[:12]}…")
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "golden_answers.py")], capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.rstrip().endswith("OK"):
        bad += 1
        print("golden_answers.py did not end with OK")
        print(r.stdout[-2000:])
    if bad:
        print(f"FAIL: {bad}")
        return 1
    print(f"OK seed={seed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
