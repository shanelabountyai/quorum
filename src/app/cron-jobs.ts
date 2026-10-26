import { sweepOutbox } from '@/modules/notifications/outbox'; // notifications

// Clone-owned (plan §3.2): /api/cron calls this after its own core sweeps. A clone adds its jobs here,
// and removing the notifications module deletes the lines marked `// notifications`.
// D-44 (Quorum): nothing leaves (CLAUDE.md non-negotiable 10). Meeting and violation notices are QUEUED and stay
// queued, so the clone does not drain the outbox; it only sweeps sent rows (there are none). Re-adding
// drainOutbox() here is the one-line switch that would start sending, and it is a decision, not a fix.
export async function cronJobs(): Promise<Record<string, unknown>> {
  const jobs: Record<string, unknown> = {};
  jobs.outbox = { drained: false, swept: await sweepOutbox() }; // notifications
  return jobs;
}
