// Task 2.4: the cast path. The 113 fixture ballots through castBallot (in cast order, D-36) reproduce every
// status, code, bps and receipt of expected_ballots.csv on the tables; E-9 is an appended label with its cause
// (D-31); a cast from the past, a malformed instant, a float choice and a cast after close are refused before
// anything is written; the product path mints the nonce and the id.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { castBallot, castBallotWithNonce, unitHashFor } from '@/meetings/cast';
import { closeMeeting } from '@/meetings/close';
import { asApp, asOwner } from '@/meetings/db';
import { CastOutOfOrder, MeetingClosed } from '@/meetings/errors';
import { currentLabels, storedBallots } from '@/meetings/labels';
import { evaluateBallots } from '@/tally/ballots';
import { receiptFor } from '@/tally/commit';
import { InputInvalid } from '@/tally/errors';
import type { Timestamp } from '@/tally/time';
import { loadFixtures, readExpected } from '../../scripts/tally-fixtures';
import { ensureOrg } from '../../scripts/quorum-load';
import { emptyDatabase, REPLAY_CLOSED_AT, REPLAY_SALT, replayFixture, type Replay } from '../../scripts/tally-eval-db';

const f = loadFixtures();
const ts = (s: string) => s as Timestamp;

describe('2.4 castBallot', () => {
  let orgId = '';
  let replay: Replay;
  beforeAll(async () => {
    await emptyDatabase();
    orgId = await ensureOrg('larkspur');
    replay = await replayFixture(orgId);
  }, 120_000);

  it('113 ballots in, 113 Ballot rows, 113 sealed links, 114 labels (113 at cast + 1 for E-9)', async () => {
    expect(replay.casts).toHaveLength(113);
    expect(await db.ballot.count()).toBe(113);
    expect(await db.ballotSecret.count()).toBe(113);
    expect(await db.ballotStatusEvent.count()).toBe(114);
  });

  it('every row of expected_ballots.csv: status, code, bps, receipt — read from Ballot + the latest label, no sealed link', async () => {
    const rows = await asApp((tx) => storedBallots(tx, replay.meetingRowId));
    const byId = new Map(rows.map((r) => [r.ballot_id, r]));
    const expected = readExpected('expected_ballots');
    expect(expected).toHaveLength(113);
    for (const e of expected) {
      const r = byId.get(e.ballot_id!)!;
      expect(r, e.ballot_id).toBeDefined();
      expect([r.status, r.code, String(r.bps), r.receipt], e.ballot_id).toEqual([e.status, e.code, e.bps, e.receipt]);
    }
  });

  it('the stored labels are exactly what evaluateBallots computes over the same set (D-36)', async () => {
    const rows = await asApp((tx) => storedBallots(tx, replay.meetingRowId));
    const engine = new Map(evaluateBallots(f.meeting, f.units, f.shares, f.ownerships, f.ledger, f.proxies, f.ballots).map((r) => [r.ballot_id, `${r.status}:${r.code}`]));
    for (const r of rows) expect(`${r.status}:${r.code}`, r.ballot_id).toBe(engine.get(r.ballot_id));
  });

  it('E-9 on tables: B-088 (A-402 by proxy) has seq 1 COUNTED and seq 2 REJECTED/PROXY_SUPERSEDED_BY_OWNER caused by B-029, at B-029\'s castAt (D-31)', async () => {
    const b088 = await db.ballot.findFirstOrThrow({ where: { ballotId: 'B-088' } });
    const b029 = await db.ballot.findFirstOrThrow({ where: { ballotId: 'B-029' } });
    const events = await db.ballotStatusEvent.findMany({ where: { ballotId: b088.id }, orderBy: { seq: 'asc' } });
    expect(events.map((e) => [e.seq, e.status, e.code, e.at, e.causeBallotId])).toEqual([
      [1, 'COUNTED', null, b088.castAt, null],
      [2, 'REJECTED', 'PROXY_SUPERSEDED_BY_OWNER', b029.castAt, b029.id],
    ]);
    expect(b088.viaProxy).toBe(true);
    expect(b088.unitHash).toBe(b029.unitHash); // same unit under the salt, which is how the cast path found it
    const cast029 = replay.casts.find((c) => c.ballotId === 'B-029')!;
    expect(cast029).toMatchObject({ status: 'COUNTED', code: '', supersededRowId: b088.id });
    // the label reader agrees
    const labels = await asApp((tx) => currentLabels(tx, replay.meetingRowId));
    expect(labels.get(b088.id)).toMatchObject({ seq: 2, status: 'REJECTED', code: 'PROXY_SUPERSEDED_BY_OWNER' });
    expect(labels.get(b029.id)).toMatchObject({ seq: 1, status: 'COUNTED', code: '' });
  });

  it('the sealed link holds the ids as cast, resolved where the roster has them (D-35 e)', async () => {
    const b061 = await db.ballot.findFirstOrThrow({ where: { ballotId: 'B-061' } }); // UNKNOWN_UNIT A-711
    const s = await db.ballotSecret.findUniqueOrThrow({ where: { ballotId: b061.id } });
    expect(s).toMatchObject({ unitRef: 'A-711', unitId: null, viaProxyRef: '', viaProxyId: null });
    expect(s.castByRef).toBe('O-999');
    expect(s.castById).toBeNull();
    const b044 = await db.ballot.findFirstOrThrow({ where: { ballotId: 'B-044' } }); // PROXY_UNKNOWN P-999
    expect(await db.ballotSecret.findUniqueOrThrow({ where: { ballotId: b044.id } })).toMatchObject({ unitRef: 'A-101', viaProxyRef: 'P-999', viaProxyId: null });
    expect(b061.unitHash).toBe(unitHashFor(replay.meetingRowId, 'A-711', REPLAY_SALT));
    expect(b061.bpsAsOf).toBe(0);
  });

  it('a cast from the past is CAST_OUT_OF_ORDER and writes nothing (D-36)', async () => {
    const before = await db.ballot.count();
    const attempt = castBallot({ meetingRowId: replay.meetingRowId, unitId: 'A-101', castBy: 'O-001', viaProxyId: '', castAt: ts('2026-11-01T09:00:01'), choices: { R1: 'YES' } });
    await expect(attempt).rejects.toBeInstanceOf(CastOutOfOrder);
    expect(await db.ballot.count()).toBe(before);
  });

  it('a malformed castAt is INPUT_INVALID from the engine, and a float choice is refused by the canonical serializer, before any write', async () => {
    const before = await db.ballot.count();
    await expect(castBallot({ meetingRowId: replay.meetingRowId, unitId: 'A-101', castBy: 'O-001', viaProxyId: '', castAt: ts('2026-11-14 19:20:00'), choices: {} })).rejects.toBeInstanceOf(InputInvalid);
    await expect(castBallot({ meetingRowId: replay.meetingRowId, unitId: 'A-101', castBy: 'O-001', viaProxyId: '', castAt: ts('2026-11-14T19:20:00'), choices: { R1: 1.5 } })).rejects.toThrow();
    expect(await db.ballot.count()).toBe(before);
  });

  it('the product path mints a 32-hex nonce and the next id, and the receipt is C-2 over them', async () => {
    const r = await castBallot({ meetingRowId: replay.meetingRowId, unitId: 'A-101', castBy: 'O-001', viaProxyId: '', castAt: ts('2026-11-14T19:20:00'), choices: { R1: 'YES' } });
    expect(r.ballotId).toBe('B-114');
    expect(r.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(r.receipt).toBe(receiptFor('B-114', r.nonce, { R1: 'YES' }));
    expect(r).toMatchObject({ status: 'REJECTED', code: 'LATE' }); // 19:20 is after close_at; received, labelled, in the root
    const row = await db.ballot.findFirstOrThrow({ where: { ballotId: 'B-114' } });
    expect(row.nonceHash).not.toBe(r.nonce);
    expect(row.nonceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('after closeMeeting a cast is MeetingClosed — from the lock, and from the trigger if the lock is bypassed', async () => {
    await closeMeeting(replay.meetingRowId, REPLAY_CLOSED_AT);
    const before = await db.ballot.count();
    await expect(castBallot({ meetingRowId: replay.meetingRowId, unitId: 'A-101', castBy: 'O-001', viaProxyId: '', castAt: ts('2026-11-14T19:40:00'), choices: {} })).rejects.toBeInstanceOf(MeetingClosed);
    // the owner role, straight at the function: the function's own check
    const direct = asOwner((tx) => tx.$queryRaw`SELECT quorum_cast_ballot(${replay.meetingRowId}::uuid, 'B-999', ${'a'.repeat(64)}, 0, '2026-11-14T19:40:00', false, '{}', ${'b'.repeat(64)}, ${'c'.repeat(64)}, NULL::"BallotCode", NULL::uuid, 'A-101', NULL::uuid, 'O-001', NULL::uuid, '', NULL::uuid)`);
    await expect(direct).rejects.toBeInstanceOf(MeetingClosed);
    // the owner role, straight at the table: the trigger
    const insert = asOwner((tx) => tx.ballot.create({ data: { meetingId: replay.meetingRowId, ballotId: 'B-999', unitHash: 'a'.repeat(64), bpsAsOf: 0, castAt: '2026-11-14T19:40:00', viaProxy: false, choicesCanonical: '{}', nonceHash: 'b'.repeat(64), receipt: 'c'.repeat(64) } }));
    await expect(insert).rejects.toMatchObject({ name: 'MeetingClosed', sqlState: 'P0001', detail: expect.stringContaining('is closed; no ballot can be recorded (D-34)') });
    expect(await db.ballot.count()).toBe(before);
  });

  it('castBallotWithNonce refuses a nonce that is not 128 bits', async () => {
    await expect(castBallotWithNonce({ meetingRowId: replay.meetingRowId, unitId: 'A-101', castBy: 'O-001', viaProxyId: '', castAt: ts('2026-11-14T19:40:00'), choices: {} }, 'abc')).rejects.toThrow(/128 bits/);
  });
});
