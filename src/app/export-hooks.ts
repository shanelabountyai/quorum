import { moduleExportTables } from '@/app/modules';
import type { ExportTable } from '@/core/tenancy/export';

// Clone-owned (v1.6.0), like org-hooks.ts: which tables a data export holds beyond the template's core ones
// (addendum §5). Add one entry per org-owned table, selecting only columns that are safe to hand over: never a
// sealed column, token hash or recovery code (INV-34 scans the output). Every query runs inside withOrg.
//   { name: 'Booking', rows: (tx, orgId) => tx.booking.findMany({ where: { orgId }, select: { id: true, startsAt: true } }) },
export const exportTables: readonly ExportTable[] = [
  ...moduleExportTables,
  // Quorum (D-60). Roster, dues and violations go out whole; meetings go out as rules and outcome only. Nothing that
  // could tie an owner or unit to a ballot choice leaves: no Ballot, BallotSecret or BallotStatusEvent row, no
  // Meeting.salt (with it, every unitHash brute-forces back to its unit), and no hash or commitment column.
  { name: 'Unit', rows: (tx, orgId) => tx.unit.findMany({ where: { orgId }, select: { id: true, unitId: true, unitType: true, building: true, floor: true } }) },
  { name: 'UnitShare', rows: (tx, orgId) => tx.unitShare.findMany({ where: { unit: { orgId } }, select: { id: true, unitId: true, shareBps: true, effectiveFrom: true } }) },
  { name: 'Owner', rows: (tx, orgId) => tx.owner.findMany({ where: { orgId }, select: { id: true, ownerId: true, name: true, email: true } }) },
  { name: 'Ownership', rows: (tx, orgId) => tx.ownership.findMany({ where: { unit: { orgId } }, select: { id: true, unitId: true, ownerId: true, fromDate: true, toDate: true } }) },
  { name: 'OwnerLink', rows: (tx, orgId) => tx.ownerLink.findMany({ where: { orgId }, select: { id: true, ownerId: true, userId: true, inviteId: true, linkedAt: true } }) },
  { name: 'DuesRun', rows: (tx, orgId) => tx.duesRun.findMany({ where: { orgId }, select: { id: true, month: true, chargedOn: true, budgetCents: true, totalBps: true, postedCents: true, roundingCents: true, units: true, postedById: true, createdAt: true } }) },
  { name: 'LedgerEntry', rows: (tx, orgId) => tx.ledgerEntry.findMany({ where: { unit: { orgId } }, select: { id: true, unitId: true, entryId: true, kind: true, amountCents: true, date: true, memo: true, reversesEntryId: true, reason: true, runId: true } }) },
  { name: 'Violation', rows: (tx, orgId) => tx.violation.findMany({ where: { orgId }, select: { id: true, unitId: true, number: true, title: true, openedOn: true, createdById: true, createdAt: true } }) },
  { name: 'ViolationEvent', rows: (tx, orgId) => tx.violationEvent.findMany({ where: { violation: { orgId } }, select: { id: true, violationId: true, seq: true, state: true, day: true, hearingOn: true, fineCents: true, ledgerEntryId: true, reason: true, actorId: true, createdAt: true } }) },
  { name: 'Meeting', rows: (tx, orgId) => tx.meeting.findMany({ where: { orgId }, select: { id: true, meetingId: true, title: true, definition: true, status: true, closedAt: true, sealedAt: true, totalUnits: true, totalShareBps: true, quorum: true, createdAt: true } }) },
  { name: 'Proxy', rows: (tx, orgId) => tx.proxy.findMany({ where: { meeting: { orgId } }, select: { id: true, meetingId: true, proxyId: true, grantorUnitId: true, grantorOwnerId: true, holderOwnerId: true, receivedAt: true, revokedAt: true } }) },
  // The aggregate tally as published, minus its commitment hash (a 64-hex value INV-34's scan rejects).
  {
    name: 'ContestResult',
    rows: async (tx, orgId) =>
      (await tx.contestResult.findMany({ where: { meeting: { orgId } }, select: { id: true, meetingId: true, contestId: true, tally: true } })).map((r) => {
        const { commitment: _c, ...tally } = r.tally as Record<string, unknown>;
        return { ...r, tally };
      }),
  },
  { name: 'OrgArchive', rows: (tx, orgId) => tx.orgArchive.findMany({ where: { orgId }, select: { orgId: true, archivedAt: true, archivedById: true, reason: true } }) },
];

// An org-owned table left out on purpose, with the reason. INV-34 fails on any model with an orgId column that is in
// neither list, so a new table cannot silently drop out of every export.
export const exportSkipped: Readonly<Record<string, string>> = {
  // Ballot secrecy (D-60): none has an orgId column, so INV-34 does not require them; listed so the choice is visible.
  Ballot: 'ballot secrecy: choices, castAt and unitHash could tie a unit to its vote; the published ballot list is the public record',
  BallotSecret: 'ballot secrecy: the voter-to-ballot link itself',
  BallotStatusEvent: 'ballot secrecy: per-ballot labels (e.g. INELIGIBLE_DELINQUENT) keyed by ballot',
};
