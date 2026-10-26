// Task 3.5: the dues ledger on tables (D-21, D-41). Every row is append-only (D-19); a correction is a CREDIT that
// may name the entry it reverses. Balances are the engine's E-4 (balanceCents), never re-implemented and never
// stored. Runs as the application role; every write checks the archive first (D-43) and commits its audit row in
// the same transaction.
import { randomBytes } from 'node:crypto';
import { notFound } from 'next/navigation';
import { audit } from '@/core/audit';
import { Refused } from '@/core/errors';
import { assertNotArchived } from '@/meetings/archive';
import { asApp, type Tx } from '@/meetings/db';
import { readRoster } from '@/meetings/roster';
import { balanceCents, delinquentUnits } from '@/tally/asof';
import { calendarDay, type CalendarDay } from '@/tally/time';
import { allocateDues, firstOfMonth, SharesDoNotSum, type DuesAllocation } from './dues';
import { assertCents, formatCents, parseDollars } from './money';

export type Who = { orgId: string; userId: string | null };

export const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';

export type DuesRunResult = { runId: string; month: string; chargedOn: CalendarDay; allocation: DuesAllocation };

/** What a run posts: the monthly dues, or (D-56) one special assessment. */
export type RunSpec = { month: string; chargedOn: CalendarDay; budgetCents: number; entryId: string; memo: string; resolution?: string; assessmentId?: string; action: string };

/**
 * The one writer of a run (D-21): allocate by share as of the charge day, then one DuesRun row and one CHARGE per
 * unit in the same transaction, with the audit row. The caller has checked the archive and its own once-rule.
 */
export async function postRunInTx(tx: Tx, who: Who, spec: RunSpec): Promise<DuesRunResult> {
  const roster = await readRoster(tx, who.orgId);
  if (!roster.units.length) throw new Refused('There are no units on the roster yet.');
  let allocation: DuesAllocation;
  try {
    allocation = allocateDues(spec.budgetCents, roster.units, roster.shares, spec.chargedOn);
  } catch (e) {
    if (e instanceof SharesDoNotSum) throw new Refused(e.message);
    throw e;
  }
  const unitRows = new Map((await tx.unit.findMany({ where: { orgId: who.orgId }, select: { id: true, unitId: true } })).map((u) => [u.unitId, u.id]));
  const run = await tx.duesRun.create({
    data: { orgId: who.orgId, month: spec.month, chargedOn: spec.chargedOn, budgetCents: spec.budgetCents, totalBps: allocation.totalBps, postedCents: allocation.postedCents, roundingCents: allocation.roundingCents, units: allocation.charges.length, postedById: who.userId, resolution: spec.resolution ?? '', assessmentId: spec.assessmentId ?? null },
  });
  await tx.ledgerEntry.createMany({
    data: allocation.charges.map((c) => ({ unitId: unitRows.get(c.unit_id)!, entryId: spec.entryId, kind: 'CHARGE' as const, amountCents: c.cents, date: spec.chargedOn, memo: spec.memo, runId: run.id })),
  });
  await audit(who, spec.action, { targetType: 'duesRun', targetId: run.id, data: { month: spec.month, ...(spec.resolution ? { resolution: spec.resolution } : {}), budgetCents: spec.budgetCents, postedCents: allocation.postedCents, roundingCents: allocation.roundingCents } }, tx);
  return { runId: run.id, month: spec.month, chargedOn: spec.chargedOn, allocation };
}

/** One month's dues for every unit, once (DuesRun is unique per org, month and resolution ''; a second run is refused). */
export const runDues = (who: Who, month: string, budgetCents: number): Promise<DuesRunResult> =>
  asApp(async (tx) => {
    await assertNotArchived(tx, who.orgId);
    let chargedOn: CalendarDay;
    try {
      chargedOn = firstOfMonth(month);
    } catch {
      throw new Refused('Give the month as YYYY-MM.');
    }
    assertCents(budgetCents);
    if (budgetCents <= 0) throw new Refused('The monthly budget must be more than zero.');
    if (await tx.duesRun.findUnique({ where: { orgId_month_resolution: { orgId: who.orgId, month, resolution: '' } } })) throw new Refused(`Dues for ${month} were already posted. A month posts once; correct a unit with a credit.`);
    try {
      return await postRunInTx(tx, who, { month, chargedOn, budgetCents, entryId: `D-${month}`, memo: `${month} dues`, action: 'dues.run' });
    } catch (e) {
      if (isUnique(e)) throw new Refused(`Dues for ${month} were already posted.`);
      throw e;
    }
  });

/** `amount` is cents, or the dollars a form typed (parsed by string after the ids are checked, so a foreign id is notFound first). */
export type PostInput = { unitRowId: string; kind: 'PAYMENT' | 'CREDIT'; amount: number | string; date: string; memo: string; reason: string; reversesEntryRowId?: string | null };

/** A payment or a credit on one unit. A credit needs a reason and may reverse an earlier entry of the same unit. */
export const postEntry = (who: Who, input: PostInput) =>
  asApp(async (tx) => {
    const unit = await tx.unit.findFirst({ where: { id: input.unitRowId, orgId: who.orgId } });
    if (!unit) notFound();
    let reverses: { id: string; entryId: string; unitId: string } | null = null;
    if (input.reversesEntryRowId) {
      reverses = await tx.ledgerEntry.findFirst({ where: { id: input.reversesEntryRowId, unit: { orgId: who.orgId } }, select: { id: true, entryId: true, unitId: true } });
      if (!reverses) notFound();
      if (reverses.unitId !== unit.id) throw new Refused('A credit reverses an entry of its own unit.');
    }
    await assertNotArchived(tx, who.orgId);
    const amountCents = typeof input.amount === 'number' ? assertCents(input.amount) : parseDollars(input.amount);
    if (amountCents === null) throw new Refused('Give the amount in dollars, e.g. 350.00.');
    if (amountCents <= 0) throw new Refused('The amount must be more than zero.');
    let date: CalendarDay;
    try {
      date = calendarDay(input.date, 'date');
    } catch {
      throw new Refused('Give the date as YYYY-MM-DD.');
    }
    if (input.kind === 'CREDIT' && !input.reason.trim()) throw new Refused('A credit needs a reason (D-21).');
    if (reverses && input.kind !== 'CREDIT') throw new Refused('Only a credit reverses an entry (D-21).');
    const entryId = `${input.kind === 'PAYMENT' ? 'P' : 'C'}-${randomBytes(4).toString('hex')}`;
    const row = await tx.ledgerEntry.create({ data: { unitId: unit.id, entryId, kind: input.kind, amountCents, date, memo: input.memo.trim(), reason: input.reason.trim(), reversesEntryId: reverses?.id ?? null } });
    await audit(who, input.kind === 'PAYMENT' ? 'ledger.payment' : 'ledger.credit', { targetType: 'ledgerEntry', targetId: row.id, data: { unit: unit.unitId, amountCents } }, tx);
    return { entryRowId: row.id, entryId, amountCents };
  });

export type StatementLine = { rowId: string; entryId: string; kind: string; amountCents: number; date: string; memo: string; reason: string; reverses: string | null; balanceAfterDay: number };
export type Statement = { unitId: string; asOf: CalendarDay; balanceCents: number; delinquent: boolean; lines: StatementLine[]; later: StatementLine[] };

/** A unit's statement as of a day: every entry dated on or before it, the E-4 balance after each day, and the later entries listed apart. */
export async function statementInTx(tx: Tx, orgId: string, unitRowId: string, asOf: CalendarDay): Promise<Statement> {
  const unit = await tx.unit.findFirst({ where: { id: unitRowId, orgId } });
  if (!unit) notFound();
  const rows = await tx.ledgerEntry.findMany({ where: { unitId: unit.id }, orderBy: [{ date: 'asc' }, { entryId: 'asc' }], include: { reverses: { select: { entryId: true } } } });
  const engineRows = rows.map((e) => ({ unit_id: unit.unitId, kind: e.kind, amount_cents: e.amountCents, date: e.date as CalendarDay }));
  const line = (e: (typeof rows)[number]): StatementLine => ({ rowId: e.id, entryId: e.entryId, kind: e.kind, amountCents: e.amountCents, date: e.date, memo: e.memo, reason: e.reason, reverses: e.reverses?.entryId ?? null, balanceAfterDay: balanceCents(engineRows, unit.unitId, e.date as CalendarDay) });
  const balance = balanceCents(engineRows, unit.unitId, asOf);
  return { unitId: unit.unitId, asOf, balanceCents: balance, delinquent: balance > 0, lines: rows.filter((e) => e.date <= asOf).map(line), later: rows.filter((e) => e.date > asOf).map(line) };
}

export type BalanceRow = { unitRowId: string; unitId: string; balanceCents: number; delinquent: boolean };

/** Every unit's balance as of a day (board/manager only, O-8), from the engine's E-4/E-5. */
export async function balancesInTx(tx: Tx, orgId: string, asOf: CalendarDay): Promise<BalanceRow[]> {
  const roster = await readRoster(tx, orgId);
  const ids = roster.units.map((u) => u.unit_id);
  const delinquent = delinquentUnits(roster.ledger, ids, asOf);
  const rowIds = new Map((await tx.unit.findMany({ where: { orgId }, select: { id: true, unitId: true } })).map((u) => [u.unitId, u.id]));
  return ids.map((u) => ({ unitRowId: rowIds.get(u)!, unitId: u, balanceCents: balanceCents(roster.ledger, u, asOf), delinquent: delinquent.has(u) }));
}

export const describeRun = (r: { month: string; budgetCents: number; postedCents: number; roundingCents: number; units: number }) =>
  `${r.month}: ${r.units} charges totalling ${formatCents(r.postedCents)}; ROUNDING ${formatCents(r.roundingCents)}; budget ${formatCents(r.budgetCents)}`;
