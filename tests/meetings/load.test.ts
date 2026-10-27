// Task 2.3: the fixture roster into one org, write-once. Counts 120/124/138/141/2627/49 on the first run; the
// second run's diff is empty on EVERY COLUMN (Bookable A-045), not just the counts; a changed fixture refuses.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { asApp } from '@/meetings/db';
import { loadRoster, RosterDiffers } from '@/meetings/load';
import { loadRosterFixtures } from '../../scripts/tally-fixtures';
import { ensureOrg, loadAll } from '../../scripts/quorum-load';
import { resetAuthTables } from '../helpers/auth';

const SALT = '0123456789abcdef0123456789abcdef';

describe('2.3 quorum:load', () => {
  let orgId = '';
  beforeAll(async () => {
    await resetAuthTables();
    orgId = await ensureOrg('larkspur');
  });

  it('first run: 120 units, 124 shares, 138 owners, 141 ownerships, 2627 ledger entries, 1 meeting, 49 proxies', async () => {
    const { report, created } = await loadAll(orgId, 'fixtures', SALT);
    expect(created).toBe(true);
    expect(report.map((r) => [r.table, r.wanted, r.inserted])).toEqual([
      ['Unit', 120, 120], ['UnitShare', 124, 124], ['Owner', 138, 138], ['Ownership', 141, 141], ['LedgerEntry', 2627, 2627], ['Meeting', 1, 1], ['Proxy', 49, 49],
    ]);
    expect(await db.unit.count({ where: { orgId } })).toBe(120);
    expect(await db.proxy.count()).toBe(49);
    const m = await db.meeting.findUniqueOrThrow({ where: { orgId_meetingId: { orgId, meetingId: 'AM-2026' } } });
    expect(m.salt).toBe(SALT);
    expect(m.status).toBe('OPEN');
    expect(m.closedAt).toBeNull();
    // the three traps the roster carries: a mid-year share change, a future one, a sale
    const a301 = await db.unitShare.findMany({ where: { unit: { orgId, unitId: 'A-301' } }, orderBy: { effectiveFrom: 'asc' } });
    expect(a301.map((s) => [s.effectiveFrom, s.shareBps])).toEqual([['2019-01-01', 56], ['2026-07-01', 60]]);
    const a407 = await db.ownership.findMany({ where: { unit: { orgId, unitId: 'A-407' } }, include: { owner: true }, orderBy: { fromDate: 'asc' } });
    expect(a407.map((o) => [o.owner.ownerId, o.fromDate, o.toDate])).toEqual([['O-036', '2019-06-01', '2026-08-15'], ['O-138', '2026-08-15', null]]);
  });

  it('second run: every table matches column for column and nothing is inserted', async () => {
    const before = await snapshot();
    const { report, created } = await loadAll(orgId, 'fixtures', SALT);
    expect(created).toBe(false);
    expect(report.map((r) => [r.table, r.existing, r.inserted])).toEqual([
      ['Unit', 120, 0], ['UnitShare', 124, 0], ['Owner', 138, 0], ['Ownership', 141, 0], ['LedgerEntry', 2627, 0], ['Meeting', 1, 0], ['Proxy', 49, 0],
    ]);
    expect(await snapshot()).toEqual(before);
  });

  it('a changed row refuses, naming the table and the row, and writes nothing', async () => {
    const roster = loadRosterFixtures();
    roster.shares[0] = { ...roster.shares[0]!, share_bps: roster.shares[0]!.share_bps + 1 };
    const before = await snapshot();
    await expect(asApp((tx) => loadRoster(tx, orgId, roster))).rejects.toBeInstanceOf(RosterDiffers);
    await expect(asApp((tx) => loadRoster(tx, orgId, roster))).rejects.toMatchObject({ table: 'UnitShare', detail: expect.stringContaining('"unitId":"A-101"') });
    expect(await snapshot()).toEqual(before);
  });
});

/** Every column of every roster row, as the database holds them. */
async function snapshot() {
  return {
    units: await db.unit.findMany({ orderBy: { unitId: 'asc' } }),
    shares: await db.unitShare.findMany({ orderBy: [{ unitId: 'asc' }, { effectiveFrom: 'asc' }] }),
    owners: await db.owner.findMany({ orderBy: { ownerId: 'asc' } }),
    ownerships: await db.ownership.findMany({ orderBy: [{ unitId: 'asc' }, { ownerId: 'asc' }, { fromDate: 'asc' }] }),
    ledger: await db.ledgerEntry.findMany({ orderBy: [{ unitId: 'asc' }, { entryId: 'asc' }] }),
    meetings: await db.meeting.findMany(),
    proxies: await db.proxy.findMany({ orderBy: { proxyId: 'asc' } }),
  };
}
