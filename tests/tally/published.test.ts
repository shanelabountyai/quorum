// Task 1.11 (amended by D-37): verify and recount from the published list alone (C-6, C-7). Every fixture receipt is
// a leaf of the recomputed root; a flipped hex digit is not; the recount's totals in both modes, root, results and
// commitments equal the reference's. No unit, owner, proxy or ballots.csv file is read here.
import { describe, expect, it } from 'vitest';
import { merkleRoot } from '../../src/tally/commit';
import { recountFromPublished, toPublished, toPublishedTotals, totalsByMode } from '../../src/tally/published';
import { parseMeeting } from '../../src/tally/rules';
import { readExpected } from '../../scripts/tally-fixtures';
import { verifyReceipt } from '../../scripts/tally-verify';
import { readFileSync } from 'node:fs';

const published = toPublished(readExpected('published_ballots'));
const meeting = parseMeeting(JSON.parse(readFileSync('fixtures/meeting.json', 'utf8')));
const quorum = Object.fromEntries(readExpected('expected_quorum').map((r) => [r.field!, r.value!]));
const results = Object.fromEntries(readExpected('expected_results').map((r) => [r.contest_id!, r]));

describe('tally:verify (C-7)', () => {
  it('the published list is sorted by receipt and carries no unit, caster or timestamp', () => {
    const receipts = published.map((p) => p.receipt);
    expect(receipts).toEqual([...receipts].sort());
    expect(Object.keys(readExpected('published_ballots')[0]!)).toEqual(['receipt', 'ballot_id', 'status', 'code', 'bps_as_of', 'choices_canonical']);
  });
  it('every one of the 113 receipts is a leaf of the recomputed root', () => {
    expect(published.length).toBe(113);
    const root = merkleRoot(published.map((p) => p.receipt));
    expect(root).toBe(quorum.merkle_root);
    for (const p of published) expect(verifyReceipt(p.receipt, published)).toMatchObject({ found: true, root });
  });
  it('a flipped hex digit does not verify', () => {
    const r = published[7]!.receipt;
    const flipped = (r[0] === 'f' ? '0' : 'f') + r.slice(1);
    expect(verifyReceipt(flipped, published).found).toBe(false);
  });
  it('a superseded or rejected ballot is still in the list, with its code (D-11, O-6)', () => {
    expect(published.find((p) => p.ballot_id === 'B-99da35485afc')).toMatchObject({ status: 'REJECTED', code: 'PROXY_SUPERSEDED_BY_OWNER' });
    expect(published.filter((p) => p.status === 'REJECTED').length).toBe(26);
  });
});

describe('tally:recount (C-6, D-37)', () => {
  const totals = toPublishedTotals(readExpected('expected_totals'));
  const rc = recountFromPublished(meeting, published, Number(quorum.total_units), totals);
  it('root, counts, quorum figures and every total in BOTH modes are recomputed from the list and equal the reference', () => {
    expect(rc.tally.merkle_root).toBe(quorum.merkle_root);
    expect([rc.tally.ballots_received, rc.tally.ballots_counted, rc.tally.ballots_rejected]).toEqual([113, 87, 26]);
    for (const c of rc.tally.contests) expect(totalsByMode(c)).toEqual(totals[c.contest_id]);
    expect(rc.checks.filter((k) => k.name.endsWith(' totals')).map((k) => k.verdict)).toEqual(Array(12).fill('ok'));
    expect([rc.tally.quorum.units_represented, rc.tally.quorum.bps_represented, rc.tally.quorum.met]).toEqual([Number(quorum.units_represented), Number(quorum.bps_represented), quorum.met === 'True']);
  });
  it('every result and commitment is recomputed from the list alone, with no published total supplied (D-37 closes D-28)', () => {
    const alone = recountFromPublished(meeting, published, Number(quorum.total_units));
    for (const c of alone.tally.contests) {
      expect(c.commitment).toBe(results[c.contest_id]!.commitment);
      expect(c.result).toBe(results[c.contest_id]!.result);
    }
    expect(alone.tally.meeting_commitment).toBe(results.MEETING!.commitment);
    expect(alone.checks.filter((k) => k.name.endsWith(' totals')).every((k) => k.verdict === 'unpublished')).toBe(true);
    const e1 = alone.tally.contests.find((c) => c.contest_id === 'E1')!;
    expect(e1.kind === 'ELECTION' && e1.elected).toEqual(['C-02', 'C-04', 'C-05']); // the WEIGHTED-mode winners: the half D-28 could not recount
  });
  it('only the direct/proxy split is not recomputable (no proxy flag is published)', () => {
    expect(rc.checks.filter((k) => k.verdict === 'not-recomputable').map((k) => k.name)).toEqual(['direct / proxy units']);
  });
  it('a changed published bps_as_of moves the WEIGHTED totals and the commitments; a changed published total is reported as differing', () => {
    const i = published.findIndex((p) => p.status === 'COUNTED' && p.bps_as_of === 151);
    const edited = published.map((p, j) => (j === i ? { ...p, bps_as_of: 152 } : p));
    const moved = recountFromPublished(meeting, edited, 120, totals);
    expect(moved.tally.merkle_root).toBe(quorum.merkle_root); // bps is not in the receipt: the root cannot see it
    expect(moved.tally.meeting_commitment).not.toBe(results.MEETING!.commitment); // the commitment can (C-4 binds the totals)
    expect(moved.checks.filter((k) => k.verdict === 'differs').map((k) => k.name)).toContain('E1 WEIGHTED totals');
    const tampered = structuredClone(totals);
    tampered.R2!.WEIGHTED!.YES = 6700;
    const rc2 = recountFromPublished(meeting, published, 120, tampered);
    expect(rc2.checks.find((k) => k.name === 'R2 WEIGHTED totals')!.verdict).toBe('differs');
    expect(rc2.tally.meeting_commitment).toBe(results.MEETING!.commitment); // the published totals are compared, never used
  });
});
