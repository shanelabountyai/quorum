// Task 2.9: tally:eval over the tables — the 113 ballots through castBallot, closeMeeting, the recount from
// Ballot rows, and the same diff against the four expected files, plus the published export byte for byte.
import { expect, it } from 'vitest';
import { evalDatabase } from '../../scripts/tally-eval-db';

it('tally:eval:db: 0 differences against the oracle, the published export equal, the recount equal to the stored result', async () => {
  const r = await evalDatabase();
  expect(r.diff).toBeNull();
  expect(r.publishedDiff).toBeNull();
  expect(r.recount.matches).toBe(true);
  expect(r.closed).toBe(true);
  expect([r.recount.tally.ballots_received, r.recount.tally.ballots_counted, r.recount.tally.ballots_rejected]).toEqual([113, 87, 26]);
  expect(r.recount.tally.meeting_commitment).toBe('3e6f583ccb0a793735a01944e1a9deaf3289f431e0060e2dfaa11c79bb9337e9');
}, 120_000);
