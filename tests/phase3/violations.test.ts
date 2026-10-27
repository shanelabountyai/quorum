// Task 3.6 on tables (D-22): a record opens at NOTICE_SENT with its notice queued; every legal transition is one
// appended event; an illegal one is TRANSITION_INVALID and writes nothing; FINE_ASSESSED posts the FINE in the same
// transaction and it is on the unit's statement (and so in E-4: a fined unit can become delinquent); nothing is sent.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { statementInTx } from '@/ledger/ledger';
import { asApp, asOwner } from '@/meetings/db';
import { AppendOnlyViolation, CheckViolation } from '@/meetings/errors';
import { orgHistory } from '@/meetings/archive';
import { VIOLATION_STATES } from '@/violations/machine';
import { openViolation, transitionViolation } from '@/violations/violations';
import type { CalendarDay } from '@/tally/time';
import { emptyDatabase } from '../../scripts/tally-eval-db';
import { ensureOrg, loadAll } from '../../scripts/quorum-load';

let orgId = '';
const who = () => ({ orgId, userId: null });
const unitRow = async (unitId: string) => (await db.unit.findFirstOrThrow({ where: { orgId, unitId } })).id;
const writes = async () => [await db.violationEvent.count(), await db.ledgerEntry.count(), await db.outbox.count()];

describe('3.6 violations', () => {
  beforeAll(async () => {
    await emptyDatabase();
    orgId = await ensureOrg('violations');
    await loadAll(orgId);
  }, 60_000);

  it('the Postgres enum is the machine\'s vocabulary', async () => {
    const labels = (await db.$queryRaw<{ l: string }[]>`SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'ViolationState' ORDER BY e.enumsortorder`).map((r) => r.l);
    expect(labels).toEqual([...VIOLATION_STATES]);
  });

  it('notice → hearing → continued → hearing → fine: five events, the FINE on the ledger in the same transaction, a notice per owner per step', async () => {
    const b203 = await unitRow('B-203'); // co-owned: two owners, two notices per step
    const o = await openViolation(who(), { unitRowId: b203, title: 'Unapproved balcony screen', day: '2026-11-20' });
    expect(o).toMatchObject({ number: 'V-2026-001', queued: 2 });
    await transitionViolation(who(), { violationRowId: o.violationRowId, to: 'HEARING_SCHEDULED', day: '2026-11-21', hearingOn: '2026-12-02', reason: '' });
    await transitionViolation(who(), { violationRowId: o.violationRowId, to: 'CONTINUED', day: '2026-12-02', reason: 'owner asked for time' });
    await transitionViolation(who(), { violationRowId: o.violationRowId, to: 'HEARING_SCHEDULED', day: '2026-12-02', hearingOn: '2026-12-09', reason: '' });
    const fine = await transitionViolation(who(), { violationRowId: o.violationRowId, to: 'FINE_ASSESSED', day: '2026-12-09', fine: '150.00', reason: 'screen not removed' });
    expect(fine).toMatchObject({ state: 'FINE_ASSESSED', seq: 5, fineCents: 15000 });
    const events = await db.violationEvent.findMany({ where: { violationId: o.violationRowId }, orderBy: { seq: 'asc' } });
    expect(events.map((e) => e.state)).toEqual(['NOTICE_SENT', 'HEARING_SCHEDULED', 'CONTINUED', 'HEARING_SCHEDULED', 'FINE_ASSESSED']);
    expect(events[4]!.ledgerEntryId).toBe(fine.ledgerEntryId);
    const s = await asApp((tx) => statementInTx(tx, orgId, b203, '2026-12-09' as CalendarDay));
    expect(s.lines.find((l) => l.entryId === 'F-V-2026-001')).toMatchObject({ kind: 'FINE', amountCents: 15000, date: '2026-12-09' });
    expect(s).toMatchObject({ balanceCents: 15000, delinquent: true }); // the fine is unpaid: E-5 counts it
    expect(await db.outbox.count({ where: { orgId, sentAt: null } })).toBe(2 * 4); // opened, hearing, hearing again, fine; CONTINUED queues none
    expect(await db.outbox.count({ where: { sentAt: { not: null } } })).toBe(0); // nothing leaves
  });

  it('every illegal transition is TRANSITION_INVALID and writes nothing — from a final state, skipping a step, a made-up state', async () => {
    const v = await openViolation(who(), { unitRowId: await unitRow('A-101'), title: 'Bins left out', day: '2026-11-20' });
    const before = await writes();
    for (const to of ['FINE_ASSESSED', 'CONTINUED', 'NOTICE_SENT', 'CLOSED']) {
      await expect(transitionViolation(who(), { violationRowId: v.violationRowId, to, day: '2026-11-21', fine: '10.00', reason: '' })).rejects.toThrow(/TRANSITION_INVALID/);
    }
    await transitionViolation(who(), { violationRowId: v.violationRowId, to: 'DISMISSED', day: '2026-11-22', reason: 'cured' });
    const after = await writes();
    for (const to of VIOLATION_STATES) await expect(transitionViolation(who(), { violationRowId: v.violationRowId, to, day: '2026-11-23', hearingOn: '2026-11-30', fine: '1.00', reason: '' })).rejects.toThrow(/TRANSITION_INVALID/);
    expect(await writes()).toEqual(after);
    expect(after[0]! - before[0]!).toBe(1);
  });

  it('a hearing needs a date and a fine needs an amount; the database holds both rules and the append-only one', async () => {
    const v = await openViolation(who(), { unitRowId: await unitRow('A-102'), title: 'Noise', day: '2026-11-20' });
    await expect(transitionViolation(who(), { violationRowId: v.violationRowId, to: 'HEARING_SCHEDULED', day: '2026-11-21', reason: '' })).rejects.toThrow(/hearing date/);
    await transitionViolation(who(), { violationRowId: v.violationRowId, to: 'HEARING_SCHEDULED', day: '2026-11-21', hearingOn: '2026-11-28', reason: '' });
    await expect(transitionViolation(who(), { violationRowId: v.violationRowId, to: 'FINE_ASSESSED', day: '2026-11-28', fine: '0', reason: '' })).rejects.toThrow(/more than zero/);
    await expect(asOwner((tx) => tx.violationEvent.create({ data: { violationId: v.violationRowId, seq: 3, state: 'FINE_ASSESSED', day: '2026-11-28', fineCents: 100 } }))).rejects.toBeInstanceOf(CheckViolation);
    const e = await db.violationEvent.findFirstOrThrow({ where: { violationId: v.violationRowId, seq: 1 } });
    await expect(asOwner((tx) => tx.violationEvent.update({ where: { id: e.id }, data: { reason: 'x' } }))).rejects.toBeInstanceOf(AppendOnlyViolation);
    await expect(asOwner((tx) => tx.violation.delete({ where: { id: v.violationRowId } }))).rejects.toBeInstanceOf(AppendOnlyViolation);
  });

  it('violations and dues runs count as history for D-43', async () => {
    expect((await asApp((tx) => orgHistory(tx, orgId))).violations).toBe(3);
  });
});
