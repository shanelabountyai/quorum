// Task 3.7: notices are QUEUED to the foundation's outbox and never sent (CLAUDE.md non-negotiable 10; D-44: the
// clone's cron does not drain the outbox). Each notice is the foundation's generic `notice` template with a plain
// subject and body — no secret, no ballot, nothing about anyone's vote. Enqueued inside the caller's transaction as
// the application role (INSERT on Outbox is granted to quorum_app for exactly this).
import { enqueue } from '@/modules/notifications/outbox';
import type { Tx } from '@/meetings/db';

export type Recipient = { ownerId: string; name: string; email: string };

/** One queued row per recipient with an email; returns how many were queued. */
export async function queueNotice(tx: Tx, orgId: string, recipients: readonly Recipient[], subject: string, body: string, ref: Record<string, string>): Promise<number> {
  let n = 0;
  for (const r of recipients) {
    if (!r.email) continue;
    await enqueue({ channel: 'email', to: r.email, template: 'notice', orgId, data: { subject, body: `Dear ${r.name || r.ownerId},\n\n${body}`, ...ref } }, tx);
    n++;
  }
  return n;
}

/** Notices already queued for a reference (e.g. { meetingId }), so a second click queues nothing. */
export async function queuedFor(tx: Tx, orgId: string, key: string, value: string): Promise<number> {
  return tx.outbox.count({ where: { orgId, data: { path: [key], equals: value } } });
}
