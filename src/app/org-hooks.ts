// Clone-owned, like cron-jobs.ts: what must happen before an org is deleted. Throwing stops the
// deletion. Removing the billing module deletes the lines marked `// billing`.
// FR-05: a deleted org must not keep charging.
// D-43 (owner decision, 2026-10-26): an org with append-only history (meetings, units, ledger, violations) is
// archived, never deleted. The template's delete-org calls this hook before its transaction; a Refused here
// reaches the form as a user-facing message, and the template route is not edited.
import { db } from '@/core/db';
import type { ListedOrg } from '@/core/tenancy/listed';
import { refuseDeleteWithHistory } from '@/meetings/archive';

export async function beforeOrgDelete(orgId: string): Promise<void> {
  await refuseDeleteWithHistory(orgId);
}

// Clone-owned (v1.4.0): which of a user's orgs the template's org lists show — `/onboarding`, where every
// sign-in lands, and each account on `/demo`. The template keeps only ids that were in `orgs`
// (core/tenancy/listed.ts), so this can hide an org but never add or rename one. Display only: it does not
// stop a member opening `/o/<slug>`, which the clone's own pages decide.
// D-58: archived associations are hidden, the same read `/associations` makes.
export async function filterListedOrgs(_userId: string, orgs: readonly ListedOrg[]): Promise<readonly ListedOrg[]> {
  const archived = new Set((await db.orgArchive.findMany({ where: { orgId: { in: orgs.map((o) => o.id) } }, select: { orgId: true } })).map((a) => a.orgId));
  return orgs.filter((o) => !archived.has(o.id));
}
