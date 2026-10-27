// Task 2.4: the cast path. The 113 fixture ballots through castBallot (in cast order, D-36) reproduce every
// status, code, bps and receipt of expected_ballots.csv on the tables; E-9 is an appended label with its cause
// (D-31); a cast from the past, a malformed instant, a float choice and a cast after close are refused before
// anything is written; the product path mints the nonce and the id.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { BALLOT_ID_RE, castBallot, castBallotWithNonce, mintBallotId, unitHashFor } from '@/meetings/cast';
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

  it('E-9 on tables: B-99da35485afc (A-402 by proxy) has seq 1 COUNTED and seq 2 REJECTED/PROXY_SUPERSEDED_BY_OWNER caused by B-9de508f918e5 (the co-owner\'s direct cast), at its castAt (D-31)', async () => {
    const b088 = await db.ballot.findFirstOrThrow({ where: { ballotId: 'B-99da35485afc' } });
    const b029 = await db.ballot.findFirstOrThrow({ where: { ballotId: 'B-9de508f918e5' } });
    const events = await db.ballotStatusEvent.findMany({ where: { ballotId: b088.id }, orderBy: { seq: 'asc' } });
    expect(events.map((e) => [e.seq, e.status, e.code, e.at, e.causeBallotId])).toEqual([
      [1, 'COUNTED', null, b088.castAt, null],
      [2, 'REJECTED', 'PROXY_SUPERSEDED_BY_OWNER', b029.castAt, b029.id],
    ]);
    expect(b088.viaProxy).toBe(true);
    expect(b088.unitHash).toBe(b029.unitHash); // same unit under the salt, which is how the cast path found it
    const cast029 = replay.casts.find((c) => c.ballotId === 'B-9de508f918e5')!;
    expect(cast029).toMatchObject({ status: 'COUNTED', code: '', supersededRowId: b088.id });
    // the label reader agrees
    const labels = await asApp((tx) => currentLabels(tx, replay.meetingRowId));
    expect(labels.get(b088.id)).toMatchObject({ seq: 2, status: 'REJECTED', code: 'PROXY_SUPERSEDED_BY_OWNER' });
    expect(labels.get(b029.id)).toMatchObject({ seq: 1, status: 'COUNTED', code: '' });
  });

  it('the sealed link holds the ids as cast, resolved where the roster has them (D-35 e)', async () => {
    const b061 = await db.ballot.findFirstOrThrow({ where: { ballotId: 'B-332c8f8b9d17' } }); // UNKNOWN_UNIT A-711
    const s = await db.ballotSecret.findUniqueOrThrow({ where: { ballotId: b061.id } });
    expect(s).toMatchObject({ unitRef: 'A-711', unitId: null, viaProxyRef: '', viaProxyId: null });
    expect(s.castByRef).toBe('O-999');
    expect(s.castById).toBeNull();
    const b044 = await db.ballot.findFirstOrThrow({ where: { ballotId: 'B-2832a2464507' } }); // PROXY_UNKNOWN P-999
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

  it('the product path mints a 32-hex nonce and a random B-<12 hex> id (D-40), and the receipt is C-2 over them', async () => {
    const r = await castBallot({ meetingRowId: replay.meetingRowId, unitId: 'A-101', castBy: 'O-001', viaProxyId: '', castAt: ts('2026-11-14T19:20:00'), choices: { R1: 'YES' } });
    expect(r.ballotId).toMatch(BALLOT_ID_RE);
    expect(r.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(r.receipt).toBe(receiptFor(r.ballotId, r.nonce, { R1: 'YES' }));
    expect(r).toMatchObject({ status: 'REJECTED', code: 'LATE' }); // 19:20 is after close_at; received, labelled, in the root
    const row = await db.ballot.findFirstOrThrow({ where: { ballotId: r.ballotId } });
    expect(row.nonceHash).not.toBe(r.nonce);
    expect(row.nonceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('at an instant where the SAME unit already has a ballot, a minted id sorts after it and a supplied id that does not is CAST_OUT_OF_ORDER (D-40 amends D-36)', async () => {
    const at = ts('2026-11-14T19:21:00');
    const first = await castBallot({ meetingRowId: replay.meetingRowId, ballotId: 'B-800000000000', unitId: 'A-102', castBy: 'O-002', viaProxyId: '', castAt: at, choices: {} });
    let prev = first.ballotId;
    for (let i = 0; i < 8; i++) {
      const next = await castBallot({ meetingRowId: replay.meetingRowId, unitId: 'A-102', castBy: 'O-002', viaProxyId: '', castAt: at, choices: {} });
      expect(next.ballotId > prev, `${next.ballotId} after ${prev}`).toBe(true);
      prev = next.ballotId;
    }
    // another unit at the same instant is unconstrained: its order against A-102's ballots changes no label
    await castBallot({ meetingRowId: replay.meetingRowId, ballotId: 'B-000000000001', unitId: 'A-103', castBy: 'O-003', viaProxyId: '', castAt: at, choices: {} });
    const before = await db.ballot.count();
    await expect(castBallot({ meetingRowId: replay.meetingRowId, ballotId: 'B-100000000000', unitId: 'A-102', castBy: 'O-002', viaProxyId: '', castAt: at, choices: {} })).rejects.toBeInstanceOf(CastOutOfOrder);
    expect(await db.ballot.count()).toBe(before);
    // and the stored labels still equal the engine over the stored set (B-4 order is (castAt, ballotId))
    const rows = await asApp((tx) => storedBallots(tx, replay.meetingRowId));
    const late = rows.filter((r) => r.cast_at === at);
    expect(late).toHaveLength(10);
    expect(late.every((r) => r.code === 'LATE')).toBe(true);
  });

  it('after closeMeeting a cast is MeetingClosed — from the lock, and from the trigger if the lock is bypassed', async () => {
    await closeMeeting(replay.meetingRowId, REPLAY_CLOSED_AT);
    const before = await db.ballot.count();
    await expect(castBallot({ meetingRowId: replay.meetingRowId, unitId: 'A-101', castBy: 'O-001', viaProxyId: '', castAt: ts('2026-11-14T19:40:00'), choices: {} })).rejects.toBeInstanceOf(MeetingClosed);
    // the owner role, straight at the function: the function's own check
    const direct = asOwner((tx) => tx.$queryRaw`SELECT quorum_cast_ballot(${replay.meetingRowId}::uuid, 'B-999', ${'a'.repeat(64)}, 0, '2026-11-14T19:40:00', false, '{}', ${'b'.repeat(64)}, ${'c'.repeat(64)}, NULL::"BallotCode", NULL::uuid, 'A-101', NULL::uuid, 'O-001', NULL::uuid, '', NULL::uuid, NULL::uuid)`);
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

describe('D-40 mintBallotId', () => {
  it('draws B-<12 hex>; with a bound, draws from the ids above it, never one below', () => {
    expect(mintBallotId(null, () => '0123456789ab')).toBe('B-0123456789ab');
    expect(mintBallotId(null)).toMatch(BALLOT_ID_RE);
    expect(mintBallotId('B-800000000000', () => '000000000000')).toBe('B-800000000001');
    expect(mintBallotId('B-800000000000', () => '7ffffffffffe')).toBe('B-ffffffffffff');
    expect(mintBallotId('B-fffffffffffe', () => 'abcdefabcdef')).toBe('B-ffffffffffff');
    for (let i = 0; i < 200; i++) expect(mintBallotId('B-f00000000000') > 'B-f00000000000').toBe(true);
  });
  it('refuses when no id sorts after the bound, and refuses a malformed draw', () => {
    expect(() => mintBallotId('B-ffffffffffff', () => '000000000000')).toThrow(CastOutOfOrder);
    expect(() => mintBallotId(null, () => 'XYZ')).toThrow(/B-<12 hex>/);
  });
});
