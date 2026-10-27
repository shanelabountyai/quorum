// Task 3.6: violations on tables (D-22). A violation's state is its latest ViolationEvent (one reader, like a
// ballot's label); every transition goes through machine.transition and is one appended event with its actor,
// reason and dates; FINE_ASSESSED posts the FINE to the unit's ledger in the same transaction and the event names
// it. Notices to the unit's owners are queued, never sent (3.7). Serialised per violation with a transaction-scoped
// advisory lock (quorum_app has no UPDATE, so no row lock), and the (violationId, seq) unique key backs it up.
import { notFound } from 'next/navigation';
import { audit } from '@/core/audit';
import { Refused } from '@/core/errors';
import { formatCents, parseDollars } from '@/ledger/money';
import { assertNotArchived } from '@/meetings/archive';
import { asApp, type Tx } from '@/meetings/db';
import { readRoster } from '@/meetings/roster';
import { queueNotice, type Recipient } from '@/notices/notices';
import { ownersOfUnit } from '@/tally/asof';
import { calendarDay, type CalendarDay } from '@/tally/time';
import { transition, TransitionInvalid, type ViolationState } from './machine';

type Who = { orgId: string; userId: string | null };

const lock = (tx: Tx, key: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`; // returns void: execute, not query

const day = (s: string, what: string): CalendarDay => {
  try {
    return calendarDay(s, what);
  } catch {
    throw new Refused(`Give the ${what} as YYYY-MM-DD.`);
  }
};

async function ownersToNotify(tx: Tx, orgId: string, unitId: string, on: CalendarDay): Promise<Recipient[]> {
  const roster = await readRoster(tx, orgId);
  const ids = [...ownersOfUnit(roster.ownerships, unitId, on)];
  const owners = await tx.owner.findMany({ where: { orgId, ownerId: { in: ids } }, orderBy: { ownerId: 'asc' } });
  return owners.map((o) => ({ ownerId: o.ownerId, name: o.name, email: o.email }));
}

export const currentState = async (tx: Tx, violationRowId: string): Promise<{ state: ViolationState; seq: number } | null> => {
  const e = await tx.violationEvent.findFirst({ where: { violationId: violationRowId }, orderBy: { seq: 'desc' } });
  return e ? { state: e.state, seq: e.seq } : null;
};

/** Open a violation: the record and its first event, NOTICE_SENT, with the notice queued to the unit's owners. */
export const openViolation = (who: Who, input: { unitRowId: string; title: string; day: string }) =>
  asApp(async (tx) => {
    const unit = await tx.unit.findFirst({ where: { id: input.unitRowId, orgId: who.orgId } });
    if (!unit) notFound();
    await assertNotArchived(tx, who.orgId);
    const title = input.title.trim();
    if (!title) throw new Refused('Describe the violation.');
    const on = day(input.day, 'notice date');
    await lock(tx, `violation-number:${who.orgId}`);
    const year = on.slice(0, 4);
    const n = await tx.violation.count({ where: { orgId: who.orgId, number: { startsWith: `V-${year}-` } } });
    const number = `V-${year}-${String(n + 1).padStart(3, '0')}`;
    const state = transition(null, 'NOTICE_SENT');
    const v = await tx.violation.create({ data: { orgId: who.orgId, unitId: unit.id, number, title, openedOn: on, createdById: who.userId } });
    await tx.violationEvent.create({ data: { violationId: v.id, seq: 1, state, day: on, actorId: who.userId, reason: 'opened' } });
    const queued = await queueNotice(tx, who.orgId, await ownersToNotify(tx, who.orgId, unit.unitId, on), `Violation notice ${number} — unit ${unit.unitId}`, `The association has recorded a violation for unit ${unit.unitId}: ${title}. Notice date ${on}. You will be told of any hearing.`, { violationId: v.id });
    await audit(who, 'violation.opened', { targetType: 'violation', targetId: v.id, data: { number } }, tx);
    return { violationRowId: v.id, number, queued };
  });

export type TransitionInput = { violationRowId: string; to: string; day: string; hearingOn?: string; fine?: number | string; reason: string };

/** One transition, or TRANSITION_INVALID. FINE_ASSESSED posts the FINE in the same transaction. */
export const transitionViolation = (who: Who, input: TransitionInput) =>
  asApp(async (tx) => {
    const v = await tx.violation.findFirst({ where: { id: input.violationRowId, orgId: who.orgId }, include: { unit: true } });
    if (!v) notFound();
    await assertNotArchived(tx, who.orgId);
    await lock(tx, `violation:${v.id}`);
    const cur = await currentState(tx, v.id);
    if (!cur) throw new Error(`violation ${v.number} has no event; openViolation writes seq 1 with it`);
    let to: ViolationState;
    try {
      to = transition(cur.state, input.to);
    } catch (e) {
      if (e instanceof TransitionInvalid) throw new Refused(`${e.message}. From ${cur.state} the record may move only as the workflow allows.`);
      throw e;
    }
    const on = day(input.day, 'date');
    const hearingOn = to === 'HEARING_SCHEDULED' ? day(input.hearingOn ?? '', 'hearing date') : null;
    let fineCents: number | null = null;
    let ledgerEntryId: string | null = null;
    if (to === 'FINE_ASSESSED') {
      fineCents = typeof input.fine === 'number' ? input.fine : parseDollars(input.fine ?? '');
      if (fineCents === null || !Number.isSafeInteger(fineCents) || fineCents <= 0) throw new Refused('A fine must be more than zero, in dollars, e.g. 150.00.');
      const fine = await tx.ledgerEntry.create({ data: { unitId: v.unitId, entryId: `F-${v.number}`, kind: 'FINE', amountCents: fineCents, date: on, memo: `${v.number} ${v.title}` } });
      ledgerEntryId = fine.id;
    }
    const reason = input.reason.trim();
    await tx.violationEvent.create({ data: { violationId: v.id, seq: cur.seq + 1, state: to, day: on, hearingOn, fineCents, ledgerEntryId, reason, actorId: who.userId } });
    let queued = 0;
    if (to === 'HEARING_SCHEDULED' || to === 'FINE_ASSESSED' || to === 'DISMISSED') {
      const what = to === 'HEARING_SCHEDULED' ? `A hearing is scheduled for ${hearingOn}.` : to === 'FINE_ASSESSED' ? `After the hearing a fine of ${formatCents(fineCents!)} was assessed and posted to the unit's ledger on ${on}.` : `The violation was dismissed on ${on}.`;
      queued = await queueNotice(tx, who.orgId, await ownersToNotify(tx, who.orgId, v.unit.unitId, on), `Violation ${v.number} — ${to.replace(/_/g, ' ').toLowerCase()}`, `${what}${reason ? ` Reason: ${reason}.` : ''}`, { violationId: v.id });
    }
    await audit(who, 'violation.transition', { targetType: 'violation', targetId: v.id, data: { from: cur.state, to } }, tx);
    return { state: to, seq: cur.seq + 1, ledgerEntryId, fineCents, queued };
  });

export const violationCount = (tx: Tx, orgId: string) => tx.violation.count({ where: { orgId } });
