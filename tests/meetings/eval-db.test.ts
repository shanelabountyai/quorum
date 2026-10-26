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
  expect(r.recount.tally.meeting_commitment).toBe('a703d58b3c148c601c9eed219095cb0e4d3894c1d1b86f774d8ac077d6c5037a');
}, 120_000);
