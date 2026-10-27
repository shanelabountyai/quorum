// quorum:load (task 2.3): the fixture roster and meeting into one org, write-once. Prints one line per table:
// wanted / existing / inserted. A second run inserts 0 everywhere; a changed fixture refuses before writing.
//   --org <slug>     the org (created if missing; default "larkspur")
//   --fixtures DIR   another fixture directory (default fixtures/)
//   --salt <hex32>   the meeting salt (default: random; the replay in tally:eval:db passes a fixed one)
import { pathToFileURL } from 'node:url';
import { db } from '@/core/db';
import { asApp } from '@/meetings/db';
import { ensureMeeting, loadProxies, loadRoster, type LoadReport } from '@/meetings/load';
import { FIXTURES_DIR, loadFixtures, loadRosterFixtures } from './tally-fixtures';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export async function ensureOrg(slug: string): Promise<string> {
  const have = await db.org.findUnique({ where: { slug } });
  return (have ?? (await db.org.create({ data: { slug, name: slug } }))).id;
}

/** Load everything for `orgId` from `dir`; returns the meeting row id and the per-table report. */
export async function loadAll(orgId: string, dir = FIXTURES_DIR, salt?: string): Promise<{ meetingRowId: string; created: boolean; report: LoadReport[] }> {
  const roster = loadRosterFixtures(dir);
  const f = loadFixtures(dir);
  return asApp(async (tx) => {
    const report = await loadRoster(tx, orgId, roster);
    const meeting = await ensureMeeting(tx, orgId, f.meeting, salt);
    report.push({ table: 'Meeting', wanted: 1, existing: meeting.created ? 0 : 1, inserted: meeting.created ? 1 : 0 });
    report.push(await loadProxies(tx, orgId, meeting.id, f.proxies));
    return { meetingRowId: meeting.id, created: meeting.created, report };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const orgId = await ensureOrg(arg('--org') ?? 'larkspur');
  const { report } = await loadAll(orgId, arg('--fixtures') ?? FIXTURES_DIR, arg('--salt'));
  for (const r of report) console.log(`${r.table.padEnd(12)} wanted ${String(r.wanted).padStart(5)}  existing ${String(r.existing).padStart(5)}  inserted ${String(r.inserted).padStart(5)}`);
  console.log(`quorum:load: ${report.reduce((n, r) => n + r.inserted, 0)} rows inserted`);
  await db.$disconnect();
}
