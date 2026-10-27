// Task 3.5 on tables (D-21, D-41): the dues run posts once per month, sums to the budget with the remainder on the
// ROUNDING line, and every balance a page shows is the engine's E-4. Credits need a reason, reverse only their own
// unit's entries, and nothing on the ledger can be changed afterwards.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { balancesInTx, postEntry, runDues, statementInTx } from '@/ledger/ledger';
import { asApp, asOwner } from '@/meetings/db';
import { AppendOnlyViolation, CheckViolation } from '@/meetings/errors';
import { balanceCents } from '@/tally/asof';
import type { CalendarDay } from '@/tally/time';
import { emptyDatabase } from '../../scripts/tally-eval-db';
import { ensureOrg, loadAll } from '../../scripts/quorum-load';
import { loadFixtures } from '../../scripts/tally-fixtures';

const d = (s: string) => s as CalendarDay;
let orgId = '';
const who = () => ({ orgId, userId: null });
const unitRow = async (unitId: string) => (await db.unit.findFirstOrThrow({ where: { orgId, unitId } })).id;

describe('3.5 dues ledger', () => {
  beforeAll(async () => {
    await emptyDatabase();
    orgId = await ensureOrg('ledger');
    await loadAll(orgId);
  }, 60_000);

  it('$35,000.00 for 2026-12: 120 charges summing to 3,500,000 cents, a 0-cent ROUNDING line, one DuesRun row', async () => {
    const r = await runDues(who(), '2026-12', 3_500_000);
    expect([r.allocation.charges.length, r.allocation.postedCents, r.allocation.roundingCents]).toEqual([120, 3_500_000, 0]);
    const rows = await db.ledgerEntry.findMany({ where: { runId: r.runId } });
    expect(rows).toHaveLength(120);
    expect(rows.reduce((n, e) => n + e.amountCents, 0)).toBe(3_500_000);
    expect(rows.every((e) => e.entryId === 'D-2026-12' && e.date === '2026-12-01' && e.kind === 'CHARGE')).toBe(true);
    expect(await db.duesRun.findFirstOrThrow({ where: { id: r.runId } })).toMatchObject({ budgetCents: 3_500_000, postedCents: 3_500_000, roundingCents: 0, units: 120, totalBps: 10000 });
  });

  it('a month posts once', async () => {
    await expect(runDues(who(), '2026-12', 3_500_000)).rejects.toThrow(/already posted/);
    expect(await db.duesRun.count()).toBe(1);
  });

  it('$35,000.01 for 2027-01 leaves a 1-cent ROUNDING line; the database refuses a run that does not sum to its budget', async () => {
    const r = await runDues(who(), '2027-01', 3_500_001);
    expect([r.allocation.postedCents, r.allocation.roundingCents]).toEqual([3_500_000, 1]);
    await expect(asOwner((tx) => tx.duesRun.create({ data: { orgId, month: '2027-02', chargedOn: '2027-02-01', budgetCents: 100, totalBps: 10000, postedCents: 98, roundingCents: 1, units: 120 } }))).rejects.toMatchObject({ name: 'CheckViolation', detail: expect.stringContaining('DuesRun_sums_to_budget') });
  });

  it('every balance on the statement and the overview is the engine\'s E-4 over the same rows', async () => {
    const f = loadFixtures();
    const asOf = d('2026-11-14');
    const all = await asApp((tx) => balancesInTx(tx, orgId, asOf));
    for (const b of all) expect(b.balanceCents, b.unitId).toBe(balanceCents(f.ledger, b.unitId, asOf));
    expect(all.filter((b) => b.delinquent).map((b) => b.unitId)).toEqual(['A-110', 'A-204', 'A-508', 'B-108', 'B-509']);
    // A-508 as of 2026-12-31: the fixture's November arrears were paid on 11-15, so what is owed is the December run's charge
    const s = await asApp(async (tx) => statementInTx(tx, orgId, await unitRow('A-508'), d('2026-12-31')));
    const dec = s.lines.find((l) => l.entryId === 'D-2026-12')!;
    expect(s.balanceCents).toBe(balanceCents(f.ledger, 'A-508', d('2026-12-31')) + dec.amountCents);
    expect(s.balanceCents).toBe(dec.amountCents);
  });

  it('a payment and a credit move the balance by E-4; a credit needs a reason; a reversal names its own unit\'s entry', async () => {
    const a101 = await unitRow('A-101');
    const before = (await asApp((tx) => statementInTx(tx, orgId, a101, d('2026-12-31')))).balanceCents;
    expect(before).toBe(56 * 350);
    await postEntry(who(), { unitRowId: a101, kind: 'PAYMENT', amount: '100.00', date: '2026-12-05', memo: 'part', reason: '' });
    const charge = await db.ledgerEntry.findFirstOrThrow({ where: { unitId: a101, entryId: 'D-2026-12' } });
    await postEntry(who(), { unitRowId: a101, kind: 'CREDIT', amount: 9600, date: '2026-12-06', memo: '', reason: 'board waived the rest', reversesEntryRowId: charge.id });
    expect((await asApp((tx) => statementInTx(tx, orgId, a101, d('2026-12-31')))).balanceCents).toBe(0);
    expect((await asApp((tx) => statementInTx(tx, orgId, a101, d('2026-12-05')))).balanceCents).toBe(9600); // the credit dated the 6th is not in the 5th
    await expect(postEntry(who(), { unitRowId: a101, kind: 'CREDIT', amount: 1, date: '2026-12-07', memo: '', reason: '  ' })).rejects.toBeInstanceOf(Refused);
    const other = await db.ledgerEntry.findFirstOrThrow({ where: { unit: { orgId, unitId: 'A-102' }, entryId: 'D-2026-12' } });
    await expect(postEntry(who(), { unitRowId: a101, kind: 'CREDIT', amount: 1, date: '2026-12-07', memo: '', reason: 'x', reversesEntryRowId: other.id })).rejects.toThrow(/its own unit/);
    await expect(postEntry(who(), { unitRowId: a101, kind: 'PAYMENT', amount: '12.345', date: '2026-12-07', memo: '', reason: '' })).rejects.toBeInstanceOf(Refused);
  });

  it('the database holds the D-21 rules too, and the ledger is append-only', async () => {
    const a101 = await unitRow('A-101');
    await expect(asOwner((tx) => tx.ledgerEntry.create({ data: { unitId: a101, entryId: 'C-x', kind: 'CREDIT', amountCents: 1, date: '2026-12-07' } }))).rejects.toBeInstanceOf(CheckViolation);
    const other = await db.ledgerEntry.findFirstOrThrow({ where: { unit: { orgId, unitId: 'A-102' }, entryId: 'D-2026-12' } });
    await expect(asOwner((tx) => tx.ledgerEntry.create({ data: { unitId: a101, entryId: 'C-y', kind: 'CREDIT', amountCents: 1, date: '2026-12-07', reason: 'x', reversesEntryId: other.id } }))).rejects.toMatchObject({ detail: expect.stringContaining('reverses an entry of its own unit') });
    const e = await db.ledgerEntry.findFirstOrThrow({ where: { unitId: a101, entryId: 'D-2026-12' } });
    await expect(asOwner((tx) => tx.ledgerEntry.update({ where: { id: e.id }, data: { amountCents: 0 } }))).rejects.toBeInstanceOf(AppendOnlyViolation);
    await expect(asOwner((tx) => tx.duesRun.deleteMany({ where: { orgId } }))).rejects.toBeInstanceOf(AppendOnlyViolation);
  });
});
