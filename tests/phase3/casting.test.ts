// Tasks 3.1–3.3 and 3.7 below the pages: a meeting created from pasted JSON; a linked member's own ballot and a
// desk ballot judged exactly as the engine judges any ballot, with the receipt verifiable; the operator sealed in
// the link and absent from the audit log (D-39); the notice queued once and never sent; close on the wall clock;
// the results recount to the stored commitments and the receipt check works with and without the nonce.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { closeMeetingNow, createMeeting, liveQuorumInTx, meetingInOrg, queueMeetingNotice } from '@/meetings/admin';
import { castAtDesk, castOwn, choicesFromForm, type CastReceipt } from '@/meetings/casting';
import { asApp } from '@/meetings/db';
import { publishedCsvFor, resultsView, verifyOnList } from '@/meetings/results';
import { receiptFor } from '@/tally/commit';
import { parseMeeting } from '@/tally/rules';
import { emptyDatabase } from '../../scripts/tally-eval-db';
import { ensureOrg } from '../../scripts/quorum-load';
import { loadRosterFixtures } from '../../scripts/tally-fixtures';
import { loadRoster } from '@/meetings/load';

const fixtureMeeting = JSON.parse(readFileSync('fixtures/meeting.json', 'utf8'));
// the fixture's rules with a window that contains "now", so the app clock casts inside it; record date unchanged
const live = { ...fixtureMeeting, meeting_id: 'AM-LIVE', rules: { ...fixtureMeeting.rules, open_at: '2026-01-01T00:00:00', close_at: '2099-12-31T23:59:59' } };

let orgId = '';
let meetingRowId = '';
let member = '';
let desk = '';
const unitRow = async (unitId: string) => (await db.unit.findFirstOrThrow({ where: { orgId, unitId } })).id;
const ownerRow = async (ownerId: string) => (await db.owner.findFirstOrThrow({ where: { orgId, ownerId } })).id;
let mine: CastReceipt;

describe('3.1–3.3, 3.7 casting, notice, close, results', () => {
  beforeAll(async () => {
    await emptyDatabase();
    orgId = await ensureOrg('casting');
    await asApp((tx) => loadRoster(tx, orgId, loadRosterFixtures()));
    meetingRowId = (await createMeeting(orgId, JSON.stringify(live))).id;
    member = (await db.user.create({ data: { email: 'member@example.test' } })).id;
    desk = (await db.user.create({ data: { email: 'desk@example.test' } })).id;
    await db.ownerLink.create({ data: { orgId, ownerId: await ownerRow('O-001'), userId: member } }); // as the Invite trigger would (owner-link.test.ts proves it)
  }, 60_000);

  it('createMeeting refuses bad JSON, an unknown basis and an unknown zone with the engine\'s words', async () => {
    await expect(createMeeting(orgId, '{nope')).rejects.toThrow('not JSON');
    await expect(createMeeting(orgId, JSON.stringify({ ...live, meeting_id: 'X', rules: { ...live.rules, quorum: { basis: 'SHARES', threshold_bps: 5000 } } }))).rejects.toThrow(/RULES_INVALID: rules.quorum.basis/);
    await expect(createMeeting(orgId, JSON.stringify({ ...live, meeting_id: 'Y', rules: { ...live.rules, timezone_label: 'Mars/Olympus' } }))).rejects.toThrow(/not a time zone/);
  });

  it('the ballot form becomes choices: checked candidates, a chosen answer, empty = absent (S-1)', () => {
    const def = parseMeeting(live);
    expect(choicesFromForm(def, { 'c:E1:C-02': 'on', 'c:E1:C-09': 'on', 'c:R1': 'YES', 'c:R2': '', meetingId: 'x' })).toEqual({ E1: ['C-02'], R1: 'YES' });
  });

  it('a linked member casts for their unit: COUNTED, and the receipt is C-2 over what they cast', async () => {
    mine = await castOwn({ orgId, userId: member }, { meetingRowId, unitRowId: await unitRow('A-101'), fields: { 'c:E1:C-01': 'on', 'c:E1:C-05': 'on', 'c:R1': 'YES' } });
    expect(mine).toMatchObject({ status: 'COUNTED', code: '', meetingId: 'AM-LIVE' });
    expect(mine.receipt).toBe(receiptFor(mine.ballotId, mine.nonce, { E1: ['C-01', 'C-05'], R1: 'YES' }));
    expect(mine.castAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it('a second ballot for the unit is received and rejected DUPLICATE_UNIT; an unlinked member is refused before anything is written', async () => {
    const again = await castOwn({ orgId, userId: member }, { meetingRowId, unitRowId: await unitRow('A-101'), fields: { 'c:R1': 'NO' } });
    expect(again).toMatchObject({ status: 'REJECTED', code: 'DUPLICATE_UNIT' });
    const n = await db.ballot.count();
    await expect(castOwn({ orgId, userId: desk }, { meetingRowId, unitRowId: await unitRow('A-102'), fields: {} })).rejects.toBeInstanceOf(Refused);
    expect(await db.ballot.count()).toBe(n);
  });

  it('the desk casts for an owner; the operator is in the sealed link, and the audit rows name only the meeting and the channel', async () => {
    const r = await castAtDesk({ orgId, userId: desk }, { meetingRowId, ownerRowId: await ownerRow('O-002'), unitRowId: await unitRow('A-102'), fields: { 'c:R1': 'NO' } });
    expect(r.status).toBe('COUNTED');
    const delinquent = await castAtDesk({ orgId, userId: desk }, { meetingRowId, ownerRowId: (await db.ownership.findFirstOrThrow({ where: { unit: { orgId, unitId: 'A-204' } }, include: { owner: true } })).owner.id, unitRowId: await unitRow('A-204'), fields: {} });
    expect(delinquent).toMatchObject({ status: 'REJECTED', code: 'INELIGIBLE_DELINQUENT' });
    const row = await db.ballot.findFirstOrThrow({ where: { ballotId: r.ballotId } });
    expect((await db.ballotSecret.findUniqueOrThrow({ where: { ballotId: row.id } })).enteredById).toBe(desk);
    const audits = await db.auditEvent.findMany({ where: { action: 'ballot.cast' } });
    expect(audits).toHaveLength(4);
    for (const a of audits) {
      expect(a.targetId).toBe(meetingRowId);
      expect(Object.keys(a.data as object)).toEqual(['channel']);
      expect(JSON.stringify({ ...a, id: String(a.id) })).not.toMatch(/A-10|O-00|B-[0-9a-f]{12}|[0-9a-f]{64}/);
    }
  });

  it('live quorum reads the current labels', async () => {
    const q = await asApp(async (tx) => liveQuorumInTx(tx, await meetingInOrg(tx, orgId, meetingRowId)));
    expect([q.received, q.counted, q.rejected, q.quorum.units_represented, q.quorum.total_units, q.quorum.met]).toEqual([4, 2, 2, 2, 120, false]);
  });

  it('the meeting notice is queued once to every owner of record on the record date, and nothing is sent', async () => {
    const first = await queueMeetingNotice({ orgId, userId: desk }, meetingRowId);
    expect(first.queued).toBe(137); // 138 owners, less A-407's seller (ownership ended 2026-08-15)
    expect(await queueMeetingNotice({ orgId, userId: desk }, meetingRowId)).toEqual({ queued: 0, already: 137 });
    expect(await db.outbox.count({ where: { sentAt: null, template: 'notice' } })).toBe(137);
    const one = await db.outbox.findFirstOrThrow();
    expect((one.data as { body: string }).body).toContain('Record date 2026-11-14');
  });

  it('close on the wall clock; the results recount to the stored commitments; the published CSV is C-6 with bps_as_of', async () => {
    const c = await closeMeetingNow(orgId, meetingRowId);
    expect(c.closed).toBe(true);
    expect((await closeMeetingNow(orgId, meetingRowId)).closed).toBe(false);
    const v = await resultsView(orgId, meetingRowId);
    expect(v.closed && [v.recountMatches, v.rows.length, v.counted, v.rejected]).toEqual([true, 4, 2, 2]);
    const csv = await publishedCsvFor(orgId, meetingRowId);
    expect(csv.split('\n')[0]).toBe('receipt,ballot_id,status,code,bps_as_of,choices_canonical');
    expect(csv).toContain(`${mine.receipt},${mine.ballotId},COUNTED,,56,`);
  });

  it('the receipt check: in the root; with the nonce it recomputes; a wrong nonce does not; an unknown receipt is not in it', async () => {
    expect(await verifyOnList(orgId, meetingRowId, mine.receipt, '')).toMatch(/^IN THE ROOT/);
    expect(await verifyOnList(orgId, meetingRowId, mine.receipt, mine.nonce)).toMatch(/recomputes from the published ballot id and choices/);
    expect(await verifyOnList(orgId, meetingRowId, mine.receipt, '0'.repeat(32))).toMatch(/does NOT recompute/);
    expect(await verifyOnList(orgId, meetingRowId, 'f'.repeat(64), '')).toMatch(/^NOT in the published list of 4/);
  });

  it('after close nothing more is cast, and the application cannot read the sealed link', async () => {
    await expect(castOwn({ orgId, userId: member }, { meetingRowId, unitRowId: await unitRow('A-103'), fields: {} })).rejects.toThrow(/closed/);
    await expect(asApp((tx) => tx.ballotSecret.count())).rejects.toMatchObject({ sqlState: '42501' });
  });
});
