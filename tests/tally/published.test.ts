// Task 1.11: verify and recount from the published list alone (C-6, C-7). Every fixture receipt is a leaf of the
// recomputed root; a flipped hex digit is not; the recount's UNITS totals, root and (with the published WEIGHTED
// totals) commitments equal the reference's. No unit, owner, proxy or ballots.csv file is read here.
import { describe, expect, it } from 'vitest';
import { merkleRoot } from '../../src/tally/commit';
import { recountFromPublished, toPublished, toPublishedTotals } from '../../src/tally/published';
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
    expect(Object.keys(readExpected('published_ballots')[0]!)).toEqual(['receipt', 'ballot_id', 'status', 'code', 'choices_canonical']);
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
    expect(published.find((p) => p.ballot_id === 'B-088')).toMatchObject({ status: 'REJECTED', code: 'PROXY_SUPERSEDED_BY_OWNER' });
    expect(published.filter((p) => p.status === 'REJECTED').length).toBe(26);
  });
});

describe('tally:recount (C-6)', () => {
  const totals = toPublishedTotals(readExpected('expected_totals'));
  const rc = recountFromPublished(meeting, published, totals, Number(quorum.total_units));
  it('root, counts and every UNITS total are recomputed from the list and equal the reference', () => {
    expect(rc.merkle_root).toBe(quorum.merkle_root);
    expect([rc.received, rc.counted, rc.rejected]).toEqual([113, 87, 26]);
    for (const c of rc.contests) expect(c.units_totals).toEqual(totals[c.contest_id]!.UNITS);
    expect(rc.checks.filter((k) => k.name.endsWith('UNITS totals')).every((k) => k.verdict === 'ok')).toBe(true);
  });
  it('WEIGHTED totals are reported as not recomputable (no bps on the published row, D-28)', () => {
    expect(rc.checks.filter((k) => k.name.endsWith('WEIGHTED totals')).map((k) => k.verdict)).toEqual(Array(6).fill('not-recomputable'));
  });
  it('commitments recomputed from the root and the published totals equal the published ones', () => {
    for (const c of rc.contests) expect(c.commitment).toBe(results[c.contest_id]!.commitment);
    expect(rc.meeting_commitment).toBe(results.MEETING!.commitment);
  });
  it('a changed published total breaks the commitment', () => {
    const tampered = structuredClone(totals);
    tampered.R2!.WEIGHTED!.YES = 6700;
    const rc2 = recountFromPublished(meeting, published, tampered, 120);
    expect(rc2.contests.find((c) => c.contest_id === 'R2')!.commitment).not.toBe(results.R2!.commitment);
    expect(rc2.meeting_commitment).not.toBe(results.MEETING!.commitment);
  });
  it('without published totals the UNITS half still recounts and no commitment is claimed', () => {
    const rc3 = recountFromPublished(meeting, published, undefined, undefined);
    expect(rc3.contests.find((c) => c.contest_id === 'E2')!.units_result).toMatchObject({ elected: ['C-12'], open_seats: 1, tied: ['C-13', 'C-14'] });
    expect(rc3.contests.every((c) => c.commitment === undefined)).toBe(true);
    expect(rc3.meeting_commitment).toBeUndefined();
  });
});
