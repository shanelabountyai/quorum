// D-43 (owner decision, 2026-10-26): an org with append-only history is ARCHIVED, never deleted. The archive is a
// clone-owned row (core.prisma is template-owned); every clone write path calls assertNotArchived before writing,
// and a trigger on the Quorum tables refuses an insert for an archived org as the second door. The template's
// delete-org goes through beforeOrgDelete (src/app/org-hooks.ts), which refuses an org with history with the
// message below. No application code disables a trigger (a grep test holds that).
import { Refused } from '@/core/errors';
import { asApp, type Tx } from './db';

/** Refused before any write in an archived org (a Refused, so a form shows it; the trigger's P0001 maps to the same text). */
export class OrgArchived extends Refused {
  readonly code = 'ORG_ARCHIVED' as const;
  constructor(readonly orgId: string) {
    super('This association is archived. Its history can be read; nothing new can be written.');
    this.name = 'OrgArchived';
  }
}

export const ARCHIVED_REFUSAL = 'This association is archived. An archived association is kept, not deleted.';
export const HISTORY_REFUSAL = 'This association has voting or ledger history, which is append-only and cannot be deleted. Archive it instead.';

/** History = any Meeting, Unit, LedgerEntry, DuesRun or Violation row: the rows the append-only triggers protect, or their parents. */
export async function orgHistory(tx: Tx, orgId: string): Promise<{ meetings: number; units: number; ledgerEntries: number; duesRuns: number; violations: number }> {
  const [meetings, units, ledgerEntries, duesRuns, violations] = await Promise.all([
    tx.meeting.count({ where: { orgId } }),
    tx.unit.count({ where: { orgId } }),
    tx.ledgerEntry.count({ where: { unit: { orgId } } }),
    tx.duesRun.count({ where: { orgId } }),
    tx.violation.count({ where: { orgId } }),
  ]);
  return { meetings, units, ledgerEntries, duesRuns, violations };
}

export const hasHistory = (h: Awaited<ReturnType<typeof orgHistory>>) => Object.values(h).some((n) => n > 0);

export async function isArchived(tx: Tx, orgId: string): Promise<boolean> {
  return (await tx.orgArchive.count({ where: { orgId } })) > 0;
}

/** The first statement of every clone write path (D-43). */
export async function assertNotArchived(tx: Tx, orgId: string): Promise<void> {
  if (await isArchived(tx, orgId)) throw new OrgArchived(orgId);
}

/** Archive an org: one append-only row. Idempotent — a second call returns the first archive. */
export const archiveOrg = (orgId: string, byUserId: string | null, reason: string) =>
  asApp(async (tx) => {
    const have = await tx.orgArchive.findUnique({ where: { orgId } });
    if (have) return { archived: false, archive: have };
    const trimmed = reason.trim();
    if (!trimmed) throw new Refused('Give a reason for archiving.');
    const archive = await tx.orgArchive.create({ data: { orgId, archivedById: byUserId, reason: trimmed } });
    return { archived: true, archive };
  });

/** For the template's delete-org (via beforeOrgDelete): refuse an org with history, with a message the user can act on. */
export const refuseDeleteWithHistory = (orgId: string) =>
  asApp(async (tx) => {
    if (await isArchived(tx, orgId)) throw new Refused(ARCHIVED_REFUSAL);
    if (hasHistory(await orgHistory(tx, orgId))) throw new Refused(HISTORY_REFUSAL);
  });
