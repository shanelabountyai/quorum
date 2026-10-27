// Task 2.5: close and seal. One transaction as the application role: lock the meeting, tally from the Ballot
// rows alone (resultsFromStored → tallyFromResults, the same function tally() ends in), freeze the roster totals,
// and hand the result to quorum_close_meeting — the one function that writes ContestResult rows and the Meeting's
// result columns, whose UPDATE fires the seal trigger (REVOKE SELECT on BallotSecret from quorum_app, sealedAt).
// Idempotent: a closed meeting returns its stored result and writes nothing.
import { shareBps } from '@/tally/asof';
import { resultsFromStored, tallyFromResults, type ContestTally, type MeetingTally } from '@/tally/tally';
import type { Timestamp } from '@/tally/time';
import { assertNotArchived } from './archive';
import { asApp, type Tx } from './db';
import { storedBallots } from './labels';
import { readMeeting, readRoster } from './roster';

export type CloseResult = { closed: boolean; closedAt: string; tally: MeetingTally; stored: StoredResult };
export type StoredResult = { merkleRoot: string; commitment: string; totalUnits: number; totalShareBps: number; contests: { contestId: string; commitment: string; tally: ContestTally }[] };

export const closeMeeting = (meetingRowId: string, closedAt: Timestamp): Promise<CloseResult> => asApp((tx) => closeInTx(tx, meetingRowId, closedAt));

export async function closeInTx(tx: Tx, meetingRowId: string, closedAt: Timestamp): Promise<CloseResult> {
  await tx.$queryRaw`SELECT 1 FROM quorum_lock_meeting(${meetingRowId}::uuid)`;
  const head = await readMeeting(tx, meetingRowId);
  if (head.closedAt) {
    const stored = await readStoredResult(tx, meetingRowId);
    return { closed: false, closedAt: head.closedAt, tally: await recountInTx(tx, meetingRowId), stored };
  }
  await assertNotArchived(tx, head.orgId); // D-43: closing writes the result; an archived org writes nothing new
  const roster = await readRoster(tx, head.orgId);
  const asOf = head.definition.rules.record_date;
  const totalUnits = roster.units.length;
  let totalBps = 0;
  for (const u of roster.units) totalBps += shareBps(roster.shares, u.unit_id, asOf);
  const rows = await storedBallots(tx, meetingRowId);
  const tally = tallyFromResults(head.definition, totalUnits, totalBps, resultsFromStored(head.definition, rows));
  const results = tally.contests.map((c) => ({ contest_id: c.contest_id, commitment: c.commitment, tally: c }));
  const [r] = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT quorum_close_meeting(${meetingRowId}::uuid, ${closedAt}, ${totalUnits}, ${totalBps}, ${tally.merkle_root}, ${JSON.stringify(tally.quorum)}::jsonb, ${tally.meeting_commitment}, ${JSON.stringify(results)}::jsonb) AS ok`;
  if (!r?.ok) throw new Error(`quorum_close_meeting wrote nothing for ${meetingRowId} although the row read as open`);
  return { closed: true, closedAt, tally, stored: await readStoredResult(tx, meetingRowId) };
}

export async function readStoredResult(tx: Tx, meetingRowId: string): Promise<StoredResult> {
  const m = await tx.meeting.findUniqueOrThrow({ where: { id: meetingRowId } });
  if (!m.closedAt || !m.merkleRoot || !m.commitment || m.totalUnits === null || m.totalShareBps === null) throw new Error(`meeting ${meetingRowId} is not closed`);
  const contests = await tx.contestResult.findMany({ where: { meetingId: meetingRowId }, orderBy: { contestId: 'asc' } });
  return { merkleRoot: m.merkleRoot, commitment: m.commitment, totalUnits: m.totalUnits, totalShareBps: m.totalShareBps, contests: contests.map((c) => ({ contestId: c.contestId, commitment: c.commitment, tally: c.tally as unknown as ContestTally })) };
}

/**
 * Task 2.6: the recount from Ballot rows alone — no BallotSecret, no roster. The totals the inequalities need
 * (total units, total shares) are the ones frozen onto the Meeting at close (D-35 h); an open meeting has none,
 * so the recount refuses it: a recount is of a closed meeting.
 */
export async function recountInTx(tx: Tx, meetingRowId: string): Promise<MeetingTally> {
  const head = await readMeeting(tx, meetingRowId);
  const m = await tx.meeting.findUniqueOrThrow({ where: { id: meetingRowId }, select: { totalUnits: true, totalShareBps: true } });
  if (!head.closedAt || m.totalUnits === null || m.totalShareBps === null) throw new Error(`meeting ${head.meetingId} is open; close it before recounting (D-35 h)`);
  const rows = await storedBallots(tx, meetingRowId);
  return tallyFromResults(head.definition, m.totalUnits, m.totalShareBps, resultsFromStored(head.definition, rows));
}

export type RecountVerdict = { tally: MeetingTally; stored: StoredResult; matches: boolean; differences: string[] };

/** The recount beside the stored result: equal commitments, root and per-contest commitments, or the list of what moved. */
export const recountMeeting = (meetingRowId: string): Promise<RecountVerdict> =>
  asApp(async (tx) => {
    const tally = await recountInTx(tx, meetingRowId);
    const stored = await readStoredResult(tx, meetingRowId);
    const differences: string[] = [];
    if (tally.merkle_root !== stored.merkleRoot) differences.push(`merkle_root: recount ${tally.merkle_root}, stored ${stored.merkleRoot}`);
    if (tally.meeting_commitment !== stored.commitment) differences.push(`meeting_commitment: recount ${tally.meeting_commitment}, stored ${stored.commitment}`);
    for (const c of tally.contests) {
      const s = stored.contests.find((x) => x.contestId === c.contest_id);
      if (!s) differences.push(`${c.contest_id}: no stored result`);
      else if (s.commitment !== c.commitment) differences.push(`${c.contest_id}: recount ${c.commitment}, stored ${s.commitment}`);
    }
    return { tally, stored, matches: differences.length === 0, differences };
  });
