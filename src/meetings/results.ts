// Task 3.3: the results of a closed meeting, read from what close stored (ContestResult + Meeting) and checked
// against a recount from the Ballot rows; the published list (C-6 with bps_as_of, D-37); and the receipt check
// (C-7). Nothing here reads BallotSecret — after close the application cannot.
import { notFound } from 'next/navigation';
import { Refused } from '@/core/errors';
import { parseChoices } from '@/tally/load';
import { merkleRoot, receiptFor } from '@/tally/commit';
import { meetingInOrg } from './admin';
import { readStoredResult, recountInTx, type StoredResult } from './close';
import { asApp } from './db';
import { publishedCsv, publishedRows, type PublishedRow } from './published';
import type { QuorumStatus } from '@/tally/quorum';

export type ResultsView =
  | { closed: false; meetingId: string; title: string }
  | { closed: true; meetingId: string; title: string; closedAt: string; stored: StoredResult; quorum: QuorumStatus; recountMatches: boolean; differences: string[]; rows: PublishedRow[]; counted: number; rejected: number; byCode: Record<string, number> };

export const resultsView = (orgId: string, meetingRowId: string): Promise<ResultsView> =>
  asApp(async (tx) => {
    const head = await meetingInOrg(tx, orgId, meetingRowId);
    if (!head.closedAt) return { closed: false, meetingId: head.meetingId, title: head.definition.title };
    const stored = await readStoredResult(tx, head.id);
    const m = await tx.meeting.findUniqueOrThrow({ where: { id: head.id }, select: { quorum: true } });
    const recount = await recountInTx(tx, head.id);
    const differences: string[] = [];
    if (recount.merkle_root !== stored.merkleRoot) differences.push('merkle_root');
    if (recount.meeting_commitment !== stored.commitment) differences.push('meeting_commitment');
    for (const c of recount.contests) if (stored.contests.find((s) => s.contestId === c.contest_id)?.commitment !== c.commitment) differences.push(c.contest_id);
    const rows = await publishedRows(tx, head.id);
    const byCode: Record<string, number> = {};
    for (const r of rows) if (r.status === 'REJECTED') byCode[r.code] = (byCode[r.code] ?? 0) + 1;
    return { closed: true, meetingId: head.meetingId, title: head.definition.title, closedAt: head.closedAt, stored, quorum: m.quorum as unknown as QuorumStatus, recountMatches: differences.length === 0, differences, rows, counted: rows.filter((r) => r.status === 'COUNTED').length, rejected: rows.filter((r) => r.status === 'REJECTED').length, byCode };
  });

/** The C-6 CSV of a closed meeting, byte for byte as tools/reference_tally.py writes it. */
export const publishedCsvFor = (orgId: string, meetingRowId: string): Promise<string> =>
  asApp(async (tx) => {
    const head = await meetingInOrg(tx, orgId, meetingRowId);
    if (!head.closedAt) notFound();
    return publishedCsv(await publishedRows(tx, head.id));
  });

/** C-7: the receipt against the published root, and — with the nonce — recomputed from the published ballot id and choices. */
export const verifyOnList = (orgId: string, meetingRowId: string, receiptIn: string, nonceIn: string): Promise<string> =>
  asApp(async (tx) => {
    const head = await meetingInOrg(tx, orgId, meetingRowId);
    if (!head.closedAt) throw new Refused('The published list exists once the meeting is closed.');
    const receipt = receiptIn.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(receipt)) throw new Refused('A receipt is 64 hexadecimal characters.');
    const rows = await publishedRows(tx, head.id);
    const root = merkleRoot(rows.map((r) => r.receipt));
    const row = rows.find((r) => r.receipt === receipt);
    if (!row) return `NOT in the published list of ${rows.length} receipts (root ${root}).`;
    let tail = '';
    const nonce = nonceIn.trim().toLowerCase();
    if (nonce) {
      if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Refused('A nonce is 32 hexadecimal characters.');
      const again = receiptFor(row.ballot_id, nonce, parseChoices(row.choices_canonical, 'published'));
      tail = again === receipt ? ' With your nonce the receipt recomputes from the published ballot id and choices: the choices shown are the ones you cast.' : ' With that nonce the receipt does NOT recompute from the published ballot id and choices.';
    }
    return `IN THE ROOT ${root}: ballot ${row.ballot_id}, ${row.status}${row.code ? ` ${row.code}` : ''}, choices ${row.choices_canonical}.${tail}`;
  });
