// Task 2.8: the delinquent list as of the record date from LedgerEntry rows, through the engine's E-4/E-5.
import { beforeAll, describe, expect, it } from 'vitest';
import { delinquentSnapshot, eligibilityScope, forOwner } from '@/meetings/eligibility';
import { ensureOrg, loadAll } from '../../scripts/quorum-load';
import { emptyDatabase, REPLAY_SALT } from '../../scripts/tally-eval-db';

describe('2.8 eligibility snapshot', () => {
  let meetingRowId = '';
  beforeAll(async () => {
    await emptyDatabase();
    meetingRowId = (await loadAll(await ensureOrg('larkspur'), 'fixtures', REPLAY_SALT)).meetingRowId;
  }, 60_000);

  it('the fixture\'s five delinquent units as of 2026-11-14: B-307 caught up on the day, A-508 paid the day after', async () => {
    const s = await delinquentSnapshot(meetingRowId);
    expect(s.record_date).toBe('2026-11-14');
    expect(s.suspends_voting).toBe(true);
    expect(s.delinquent_units).toEqual(['A-110', 'A-204', 'A-508', 'B-108', 'B-509']);
    expect(s.rows).toHaveLength(120);
    expect(s.rows.find((r) => r.unit_id === 'B-307')).toMatchObject({ delinquent: false, balance_cents: 0 });
    expect(s.rows.find((r) => r.unit_id === 'A-508')!.balance_cents).toBeGreaterThan(0);
    expect(s.rows.find((r) => r.unit_id === 'A-407')!.owners).toEqual(['O-138']); // the new owner only (E-1)
  });

  it('O-8: owner and admin see all; a member sees their own units only', async () => {
    expect(eligibilityScope('owner')).toEqual({ kind: 'all' });
    expect(eligibilityScope('admin')).toEqual({ kind: 'all' });
    expect(eligibilityScope('member')).toEqual({ kind: 'own-units' });
    expect(eligibilityScope('scorekeeper')).toEqual({ kind: 'own-units' });
    const s = forOwner(await delinquentSnapshot(meetingRowId), 'O-138');
    expect(s.rows.map((r) => r.unit_id)).toEqual(['A-407']);
    expect(s.delinquent_units).toEqual([]);
  });
});
