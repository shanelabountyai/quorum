// Tasks 2.5, 2.6, 2.7: close and seal, the recount from Ballot rows alone, the published export, and the tamper
// proofs — each refusal asserted on its SQLSTATE or message, never on "it threw". The last test is the proof that
// the commitment binds the rows: with the trigger disabled as a superuser, one flipped choice moves the meeting
// commitment and the recount says so.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { db } from '@/core/db';
import { closeMeeting, readStoredResult, recountMeeting } from '@/meetings/close';
import { asApp, asOwner } from '@/meetings/db';
import { AppendOnlyViolation, MeetingSealed, PrivilegeDenied } from '@/meetings/errors';
import { publishedList } from '@/meetings/published';
import { readExpected } from '../../scripts/tally-fixtures';
import { ensureOrg } from '../../scripts/quorum-load';
import { emptyDatabase, REPLAY_CLOSED_AT, replayFixture, type Replay } from '../../scripts/tally-eval-db';

describe('2.5 close and seal, 2.6 recount, 2.7 tamper', () => {
  let replay: Replay;
  beforeAll(async () => {
    await emptyDatabase();
    replay = await replayFixture(await ensureOrg('larkspur'));
  }, 120_000);

  it('before close: the app role can read the sealed link, and a recount refuses (a recount is of a closed meeting)', async () => {
    const n = await asApp((tx) => tx.ballotSecret.count({ where: { meetingId: replay.meetingRowId } }));
    expect(n).toBe(113);
    await expect(recountMeeting(replay.meetingRowId)).rejects.toThrow(/is open; close it before recounting/);
  });

  it('close: the commitments equal expected_results.csv, the root expected_quorum.csv; the row is CLOSED, sealed, with the roster totals frozen', async () => {
    const r = await closeMeeting(replay.meetingRowId, REPLAY_CLOSED_AT);
    expect(r.closed).toBe(true);
    const expected = readExpected('expected_results');
    for (const e of expected) {
      if (e.contest_id === 'MEETING') expect(r.stored.commitment, 'MEETING').toBe(e.commitment);
      else expect(r.stored.contests.find((c) => c.contestId === e.contest_id)?.commitment, e.contest_id).toBe(e.commitment);
    }
    expect(r.stored.merkleRoot).toBe(readExpected('expected_quorum').find((q) => q.field === 'merkle_root')!.value);
    expect(r.stored.totalUnits).toBe(120);
    expect(r.stored.totalShareBps).toBe(10000);
    const m = await db.meeting.findUniqueOrThrow({ where: { id: replay.meetingRowId } });
    expect(m.status).toBe('CLOSED');
    expect(m.closedAt).toBe(REPLAY_CLOSED_AT);
    expect(m.sealedAt).not.toBeNull();
    expect(m.commitment).toBe(r.tally.meeting_commitment);
    expect(await db.contestResult.count({ where: { meetingId: replay.meetingRowId } })).toBe(6);
    expect((m.quorum as { met: boolean }).met).toBe(true);
  });

  it('close is idempotent: a second close writes nothing and returns the stored commitments', async () => {
    const before = await db.meeting.findUniqueOrThrow({ where: { id: replay.meetingRowId } });
    const r = await closeMeeting(replay.meetingRowId, '2026-11-15T09:00:00' as typeof REPLAY_CLOSED_AT);
    expect(r.closed).toBe(false);
    expect(r.closedAt).toBe(REPLAY_CLOSED_AT);
    const after = await db.meeting.findUniqueOrThrow({ where: { id: replay.meetingRowId } });
    expect(after).toEqual(before);
    expect(await db.contestResult.count()).toBe(6);
    expect(r.stored.commitment).toBe(before.commitment);
  });

  it('the recount from Ballot rows alone equals the stored result and the Phase 1 meeting commitment', async () => {
    const v = await recountMeeting(replay.meetingRowId);
    expect(v.differences).toEqual([]);
    expect(v.matches).toBe(true);
    expect(v.tally.meeting_commitment).toBe('a703d58b3c148c601c9eed219095cb0e4d3894c1d1b86f774d8ac077d6c5037a');
    expect(v.tally.ballots_counted).toBe(87);
    expect(v.tally.ballot_results.every((r) => r.unit_id === '' && r.cast_by === '')).toBe(true);
  });

  it('the published export equals fixtures/published_ballots.csv byte for byte (C-6, D-32)', async () => {
    const { rows, csv } = await publishedList(replay.meetingRowId);
    expect(rows).toHaveLength(113);
    expect(csv).toBe(readFileSync('fixtures/published_ballots.csv', 'utf8'));
  });

  it('2.7 after close the app role cannot read BallotSecret: 42501, typed PrivilegeDenied', async () => {
    const raw = asApp((tx) => tx.$queryRawUnsafe('SELECT * FROM "BallotSecret"'));
    await expect(raw).rejects.toBeInstanceOf(PrivilegeDenied);
    await expect(raw).rejects.toMatchObject({ sqlState: '42501', detail: 'permission denied for table BallotSecret' });
    await expect(asApp((tx) => tx.ballotSecret.count())).rejects.toMatchObject({ name: 'PrivilegeDenied', sqlState: '42501' });
    // the grant table agrees, and the owner (the migration role) still can — the table is sealed, not gone
    const grants = await db.$queryRaw<{ p: string }[]>`SELECT privilege_type AS p FROM information_schema.role_table_grants WHERE grantee = 'quorum_app' AND table_name = 'BallotSecret'`;
    expect(grants).toEqual([]);
    expect(await db.ballotSecret.count()).toBe(113);
  });

  it('2.7 after close an UPDATE on Ballot is refused by the trigger, as the app role and as the owner', async () => {
    const b = await db.ballot.findFirstOrThrow({ where: { ballotId: 'B-001' } });
    await expect(asApp((tx) => tx.$executeRawUnsafe(`UPDATE "Ballot" SET "choicesCanonical" = '{}' WHERE id = '${b.id}'`))).rejects.toMatchObject({ name: 'PrivilegeDenied', sqlState: '42501' });
    const owner = asOwner((tx) => tx.$executeRawUnsafe(`UPDATE "Ballot" SET "choicesCanonical" = '{}' WHERE id = '${b.id}'`));
    await expect(owner).rejects.toBeInstanceOf(AppendOnlyViolation);
    await expect(owner).rejects.toMatchObject({ sqlState: 'P0001', detail: 'Ballot is append-only (D-19)' });
    await expect(asOwner((tx) => tx.$executeRawUnsafe(`INSERT INTO "BallotStatusEvent" ("ballotId", seq, status, code, at) VALUES ('${b.id}', 2, 'REJECTED', 'LATE', '2026-11-14T19:30:00')`))).rejects.toMatchObject({ sqlState: 'P0001', detail: expect.stringContaining('its label is sealed (D-20)') });
  });

  it('2.7 after close the Meeting row is frozen: a changed commitment is MeetingSealed', async () => {
    const attempt = asOwner((tx) => tx.meeting.update({ where: { id: replay.meetingRowId }, data: { commitment: 'f'.repeat(64) } }));
    await expect(attempt).rejects.toBeInstanceOf(MeetingSealed);
    await expect(attempt).rejects.toMatchObject({ sqlState: 'P0001', detail: expect.stringContaining('closed and sealed; nothing on it changes (D-20)') });
    await expect(asOwner((tx) => tx.meeting.update({ where: { id: replay.meetingRowId }, data: { title: 'x' } }))).rejects.toBeInstanceOf(MeetingSealed);
    await expect(asOwner((tx) => tx.meeting.update({ where: { id: replay.meetingRowId }, data: { sealedAt: new Date(0) } }))).rejects.toBeInstanceOf(MeetingSealed);
    expect(await recountMeeting(replay.meetingRowId)).toMatchObject({ matches: true });
  });

  it('2.7 the commitment binds the rows: a superuser who disables the trigger and flips one choice is caught by the recount', async () => {
    const b = await db.ballot.findFirstOrThrow({ where: { ballotId: 'B-001' } });
    expect(b.choicesCanonical).toContain('"R1":"YES"');
    const flipped = b.choicesCanonical.replace('"R1":"YES"', '"R1":"NO"');
    await db.$executeRawUnsafe('ALTER TABLE "Ballot" DISABLE TRIGGER "Ballot_append_only"');
    try {
      await db.$executeRaw`UPDATE "Ballot" SET "choicesCanonical" = ${flipped} WHERE id = ${b.id}::uuid`;
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "Ballot" ENABLE TRIGGER "Ballot_append_only"');
    }
    const v = await recountMeeting(replay.meetingRowId);
    expect(v.matches).toBe(false);
    expect(v.differences.map((d) => d.split(':')[0])).toEqual(['meeting_commitment', 'R1']); // the receipt was not touched: the root stands, R1's totals moved
    expect(v.tally.merkle_root).toBe(v.stored.merkleRoot);
    expect(v.tally.meeting_commitment).not.toBe(v.stored.commitment);
    expect((await readStoredResultAsApp(replay.meetingRowId)).commitment).toBe(v.stored.commitment); // the stored result itself did not move
    // the trigger is back
    await expect(asOwner((tx) => tx.$executeRaw`UPDATE "Ballot" SET "choicesCanonical" = ${b.choicesCanonical} WHERE id = ${b.id}::uuid`)).rejects.toBeInstanceOf(AppendOnlyViolation);
  });
});

const readStoredResultAsApp = (meetingRowId: string) => asApp((tx) => readStoredResult(tx, meetingRowId));
