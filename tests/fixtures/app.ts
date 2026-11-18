// CLONE-OWNED. The INV-01..04 harness seeds these rows in both fixture orgs, so it can drive
// actions whose inputs use ref('<model>') for the clone's own tables. Return { model: id } for
// one row of each model, owned by `org.orgId`. INV-29 (RLS enforce) calls it too, so every org-owned clone table has rows to scope. The template has no app tables, so it seeds none.
//
// Quorum: a two-unit association (4000 + 6000 bps = 10000, D-9) with two owners, one ledger charge, an OPEN
// meeting whose window spans the present (so a cast from the harness is received and labelled), one proxy, one
// violation in NOTICE_SENT — and the actor (the org's owner user) linked to the first owner (D-39), so a member
// cast runs the whole path instead of stopping at "not linked".
import { randomBytes } from 'node:crypto';
import { db } from '@/core/db';
import { canonicalJson, sha256Hex } from '@/tally/canonical';

const ID = (key: 'a' | 'b', n: number) => `00000000-0000-4000-9${key === 'a' ? '1' : '2'}00-${String(n).padStart(12, '0')}`;

export const harnessMeeting = (key: string) => ({
  meeting_id: `M-${key}`,
  title: `Harness meeting ${key}`,
  rules: {
    timezone_label: 'America/Chicago',
    record_date: '2026-01-01',
    open_at: '2026-01-01T00:00:00',
    close_at: '2099-12-31T23:59:59',
    quorum: { basis: 'UNITS', threshold_bps: 5000 },
    proxy_max_depth: 1,
    proxy_holder_must_be_member: true,
    delinquency_suspends_voting: true,
    duplicate_unit_rule: 'FIRST_VALID_CAST_WINS',
    total_share_bps: 10000,
  },
  contests: [
    { contest_id: 'E1', kind: 'ELECTION', title: 'Board', seats: 1, mode: 'WEIGHTED', candidates: [{ id: 'C-1', name: 'One' }, { id: 'C-2', name: 'Two' }] },
    { contest_id: 'R1', kind: 'RESOLUTION', title: 'Budget', basis: 'MAJORITY_OF_VOTES_CAST' },
  ],
});

export async function seedApp(org: { orgId: string; userId: string }, key: 'a' | 'b'): Promise<Record<string, string>> {
  const id = (n: number) => ID(key, n);
  await db.unit.createMany({ data: [{ id: id(1), orgId: org.orgId, unitId: 'U-1' }, { id: id(2), orgId: org.orgId, unitId: 'U-2' }] });
  await db.unitShare.createMany({ data: [{ unitId: id(1), shareBps: 4000, effectiveFrom: '2019-01-01' }, { unitId: id(2), shareBps: 6000, effectiveFrom: '2019-01-01' }] });
  await db.owner.createMany({ data: [{ id: id(3), orgId: org.orgId, ownerId: 'O-1', name: 'Owner One', email: `o1-${key}@example.test` }, { id: id(4), orgId: org.orgId, ownerId: 'O-2', name: 'Owner Two', email: `o2-${key}@example.test` }] });
  await db.ownership.createMany({ data: [{ unitId: id(1), ownerId: id(3), fromDate: '2019-01-01' }, { unitId: id(2), ownerId: id(4), fromDate: '2019-01-01' }] });
  await db.ledgerEntry.create({ data: { id: id(5), unitId: id(1), entryId: 'L-1', kind: 'CHARGE', amountCents: 1000, date: '2025-12-01' } });
  await db.ledgerEntry.create({ data: { unitId: id(1), entryId: 'L-2', kind: 'PAYMENT', amountCents: 1000, date: '2025-12-05' } });
  const def = harnessMeeting(key);
  await db.meeting.create({ data: { id: id(6), orgId: org.orgId, meetingId: def.meeting_id, title: def.title, definition: JSON.parse(canonicalJson(def)), definitionHash: sha256Hex(canonicalJson(def)), salt: randomBytes(16).toString('hex') } });
  await db.proxy.create({ data: { id: id(7), meetingId: id(6), proxyId: 'P-001', grantorUnitId: id(2), grantorOwnerId: id(4), holderOwnerId: id(3), receivedAt: '2026-01-02T09:00:00' } });
  await db.violation.create({ data: { id: id(8), orgId: org.orgId, unitId: id(2), number: 'V-2026-001', title: 'Unapproved satellite dish', openedOn: '2026-02-01' } });
  await db.violationEvent.create({ data: { violationId: id(8), seq: 1, state: 'NOTICE_SENT', day: '2026-02-01', reason: 'opened' } });
  await db.ownerLink.create({ data: { orgId: org.orgId, ownerId: id(3), userId: org.userId } });
  return { unit: id(1), owner: id(3), ledgerEntry: id(5), meeting: id(6), proxy: id(7), violation: id(8) };
}

// CLONE-OWNED. The clone's models with no orgId column, i.e. outside tenancy and RLS on purpose (INV-42, v1.7.0). Name
// each one with a comment saying why; a model without orgId that is not here (or in core's list) fails INV-42.
export const GLOBAL_MODELS: readonly string[] = [
  // v1.7.0 rollout: listed as found (INV-42). The reason is read from the schema; confirm or give the model an orgId.
  'UnitShare', // org-owned through Unit; outside RLS and the org export
  'Ownership', // org-owned through Owner, Unit; outside RLS and the org export
  'LedgerEntry', // org-owned through DuesRun, Unit; outside RLS and the org export
  'SpecialAssessment', // org-owned through Meeting; outside RLS and the org export
  'ViolationEvent', // org-owned through Violation; outside RLS and the org export
  'Proxy', // org-owned through Meeting, Owner, Unit; outside RLS and the org export
  'ProxyRevocation', // org-owned through Meeting; outside RLS and the org export
  'Ballot', // org-owned through Meeting; outside RLS and the org export
  'BallotStatusEvent', // no org relation; outside RLS and the org export
  'BallotSecret', // org-owned through Meeting, Owner, Unit; outside RLS and the org export
  'ContestResult', // org-owned through Meeting; outside RLS and the org export
];
