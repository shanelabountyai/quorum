// Clone-owned, like cron-jobs.ts: what must happen before an org is deleted. Throwing stops the
// deletion. Removing the billing module deletes the lines marked `// billing`.
// FR-05: a deleted org must not keep charging.
// D-43 (owner decision, 2026-10-26): an org with append-only history (meetings, units, ledger, violations) is
// archived, never deleted. The template's delete-org calls this hook before its transaction; a Refused here
// reaches the form as a user-facing message, and the template route is not edited.
import { refuseDeleteWithHistory } from '@/meetings/archive';

export async function beforeOrgDelete(orgId: string): Promise<void> {
  await refuseDeleteWithHistory(orgId);
}
