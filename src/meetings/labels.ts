// D-31: a ballot's label is its latest BallotStatusEvent, read in ONE place. Everything that needs a status or a
// code — the cast path's duplicate check, close, the recount, the published export, the Phase 3 views — goes
// through here, so "a status enum is never one edit" (Bookable) has exactly one reader to grep for.
import type { BallotRejectCode, BallotStatus } from '@/tally/codes';
import type { StoredBallot } from '@/tally/tally';
import type { Timestamp } from '@/tally/time';
import type { Tx } from './db';

export type Label = { ballotRowId: string; seq: number; status: BallotStatus; code: BallotRejectCode | '' };

type LabelRow = { ballotId: string; seq: number; status: BallotStatus; code: BallotRejectCode | null };

/** ballot row id → its current label, for every ballot of the meeting. */
export async function currentLabels(tx: Tx, meetingRowId: string): Promise<Map<string, Label>> {
  const rows = await tx.$queryRaw<LabelRow[]>`
    SELECT DISTINCT ON (e."ballotId") e."ballotId", e.seq, e.status, e.code
    FROM "BallotStatusEvent" e JOIN "Ballot" b ON b.id = e."ballotId"
    WHERE b."meetingId" = ${meetingRowId}::uuid
    ORDER BY e."ballotId", e.seq DESC`;
  return new Map(rows.map((r) => [r.ballotId, { ballotRowId: r.ballotId, seq: r.seq, status: r.status, code: r.code ?? '' }]));
}

/** The meeting's ballots as the engine's StoredBallot (what D-20 keeps), each with its current label; row order is the database's. */
export async function storedBallots(tx: Tx, meetingRowId: string): Promise<(StoredBallot & { row_id: string; unit_hash: string })[]> {
  const labels = await currentLabels(tx, meetingRowId);
  const rows = await tx.ballot.findMany({ where: { meetingId: meetingRowId } });
  return rows.map((b) => {
    const l = labels.get(b.id);
    if (!l) throw new Error(`ballot ${b.ballotId} (${b.id}) has no label; quorum_cast_ballot writes seq 1 in the same transaction`);
    return { row_id: b.id, unit_hash: b.unitHash, ballot_id: b.ballotId, via_proxy: b.viaProxy, cast_at: b.castAt as Timestamp, bps: b.bpsAsOf, status: l.status, code: l.code, receipt: b.receipt, choices_canonical: b.choicesCanonical };
  });
}
