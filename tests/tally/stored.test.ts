// Phase 2 task 2.6 (engine half): the tally from stored rows. After close the database holds, per ballot, only
// what D-20 allows — public id, direct/proxy flag, castAt, bps as of the record date, the current label, the
// receipt and the canonical choices — and the engine must reproduce the Phase 1 commitments from exactly that,
// in any row order. tallyFromResults is also what tally() itself runs after evaluateBallots, so the two paths
// cannot drift apart.
import { describe, expect, it } from 'vitest';
import { evaluateBallots } from '../../src/tally/ballots';
import { shareBps } from '../../src/tally/asof';
import { canonicalChoices } from '../../src/tally/commit';
import { parseChoices } from '../../src/tally/load';
import { resultsFromStored, tally, tallyFromResults, type StoredBallot } from '../../src/tally/tally';
import { loadFixtures } from '../../scripts/tally-fixtures';

const f = loadFixtures();
const ref = tally(f.meeting, f.units, f.shares, f.ownerships, f.ledger, f.proxies, f.ballots);

/** What the Phase 2 tables keep (D-20, D-31): the evaluated results stripped of unit, caster and proxy id. */
function stored(): StoredBallot[] {
  return evaluateBallots(f.meeting, f.units, f.shares, f.ownerships, f.ledger, f.proxies, f.ballots).map((r) => {
    const b = f.ballots.find((x) => x.ballot_id === r.ballot_id)!;
    return { ballot_id: r.ballot_id, via_proxy: r.via_proxy_id !== '', cast_at: r.cast_at, bps: r.bps, status: r.status, code: r.code, receipt: r.receipt, choices_canonical: canonicalChoices(b.choices) };
  });
}

describe('tallyFromResults (task 2.6)', () => {
  it('tally() is evaluateBallots followed by tallyFromResults, byte for byte', () => {
    const results = evaluateBallots(f.meeting, f.units, f.shares, f.ownerships, f.ledger, f.proxies, f.ballots);
    const totalBps = f.units.reduce((n, u) => n + shareBps(f.shares, u.unit_id, f.meeting.rules.record_date), 0);
    expect(JSON.stringify(tallyFromResults(f.meeting, f.units.length, totalBps, results))).toBe(JSON.stringify(ref));
  });

  it('the stored rows alone reproduce every commitment, the root, the quorum and every total', () => {
    const rows = stored();
    expect(rows.every((r) => !('unit_id' in r) && !('cast_by' in r))).toBe(true);
    const res = tallyFromResults(f.meeting, 120, 10000, resultsFromStored(f.meeting, rows));
    expect(res.meeting_commitment).toBe(ref.meeting_commitment);
    expect(res.merkle_root).toBe(ref.merkle_root);
    expect(res.quorum).toEqual(ref.quorum);
    expect(res.contests).toEqual(ref.contests);
    expect(res.rejected_by_code).toEqual(ref.rejected_by_code);
    expect(res.unknown_contest_keys).toBe(ref.unknown_contest_keys);
    expect(res.ballots_counted).toBe(87);
  });

  it('is independent of row order and re-derives the selections from the canonical choices', () => {
    const rows = stored().reverse();
    const res = tallyFromResults(f.meeting, 120, 10000, resultsFromStored(f.meeting, rows));
    expect(res.meeting_commitment).toBe(ref.meeting_commitment);
    expect(res.ballot_results.map((r) => r.ballot_id)).toEqual(ref.ballot_results.map((r) => r.ballot_id)); // cast order, not input order
    const b012 = res.ballot_results.find((r) => r.ballot_id === 'B-24a5d8fa1964')!;
    expect(b012.selections.E2).toEqual({ status: 'VOID', code: 'OVERVOTE', value: null });
    expect(b012.selections.R2).toEqual({ status: 'VOID', code: 'INVALID_CHOICE', value: null });
    const b062 = res.ballot_results.find((r) => r.ballot_id === 'B-da48c5729a09')!;
    expect(b062.unknown_contests).toEqual(['R9']);
  });

  it('a rejected row carries no selections, whatever its choices say', () => {
    const rows = stored();
    const late = rows.find((r) => r.ballot_id === 'B-d4c80a6d785a')!;
    expect(late.code).toBe('LATE');
    const r = resultsFromStored(f.meeting, [late])[0]!;
    expect(r.selections).toEqual({});
    expect(r.via_proxy_id).toBe('');
    expect(parseChoices(late.choices_canonical, 'x')).not.toEqual({});
  });

  it('one changed stored row changes the meeting commitment (the commitment binds the rows)', () => {
    const rows = stored();
    const i = rows.findIndex((r) => r.ballot_id === 'B-d06b0ce017f2');
    rows[i] = { ...rows[i]!, choices_canonical: rows[i]!.choices_canonical.replace('"R1":"YES"', '"R1":"NO"') };
    const res = tallyFromResults(f.meeting, 120, 10000, resultsFromStored(f.meeting, rows));
    expect(res.merkle_root).toBe(ref.merkle_root); // the receipt was not touched, so the root stands
    expect(res.meeting_commitment).not.toBe(ref.meeting_commitment); // the totals moved, so the commitment moves
  });
});
