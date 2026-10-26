'use server';
import { z } from 'zod';
import { orgAction } from '@/core/authz/action';
import { audit } from '@/core/audit';
import { asApp } from '@/meetings/db';
import { rosterFromCsv } from '@/meetings/import';
import { loadRoster } from '@/meetings/load';
import { refusing } from '@/meetings/refuse';

// Task 3.4: the roster from pasted CSVs (brief §12 columns), write-once (loadRoster): a first import inserts, a
// matching one inserts 0 and says every column matched, a differing one refuses before writing anything.
const csv = z.string().max(1_000_000);
export const importRosterAction = orgAction('org.update', z.object({ units: csv, unit_shares: csv, owners: csv, ownerships: csv, assessments: csv }), async (ctx, t) => {
  const report = await refusing(() => asApp((tx) => loadRoster(tx, ctx.orgId, rosterFromCsv(t))));
  const inserted = report.reduce((n, r) => n + r.inserted, 0);
  if (inserted) await audit(ctx, 'roster.imported', { targetType: 'org', targetId: ctx.orgId, data: Object.fromEntries(report.map((r) => [r.table, r.inserted])) });
  return { notice: inserted ? `Imported: ${report.map((r) => `${r.table} ${r.inserted}`).join(', ')}.` : `0 inserted, every column matches: ${report.map((r) => `${r.table} ${r.existing}`).join(', ')}.` };
});
