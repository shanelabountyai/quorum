// tally:recount (task 1.11; C-6, D-18, D-28). Recomputes from the published list what the published list can
// support, and says so for what it cannot:
//   npm run tally:recount -- --published fixtures/published_ballots.csv --meeting fixtures/meeting.json
//                            [--totals fixtures/expected_totals.csv] [--results fixtures/expected_results.csv]
//                            [--quorum fixtures/expected_quorum.csv]
// Recomputed from the list alone: the Merkle root; received / counted / rejected by code; every UNITS total
// (S-1..S-5 re-run on the canonical choices of counted ballots); voted / blank / void per contest; the election
// result in UNITS mode and the resolution verdicts under the four unit bases (MAJORITY_OF_ALL_UNITS needs the unit
// count from the published quorum report, since the rules JSON carries total_share_bps but not total_units).
// NOT recomputable from C-6 as frozen: the WEIGHTED totals and bps_represented — the list has no share per
// ballot. They are taken from the published totals, and the commitments are recomputed from the root and those
// totals and compared with the published commitments. No unit, owner, proxy or ballots.csv file is read.
// Exit 1 on any recomputed value that differs from a published one.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { compareStrings } from '../src/tally/canonical';
import { recountFromPublished, toPublished, toPublishedTotals, type RecountCheck } from '../src/tally/published';
import { parseMeeting } from '../src/tally/rules';
import { readCsv } from './tally-fixtures';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const fmtCounts = (c: Readonly<Record<string, number>>) => Object.keys(c).sort(compareStrings).map((k) => `${k} ${c[k]}`).join(', ') || 'none';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const publishedPath = arg('--published') ?? 'fixtures/published_ballots.csv';
  const meetingPath = arg('--meeting') ?? 'fixtures/meeting.json';
  const totalsPath = arg('--totals') ?? 'fixtures/expected_totals.csv';
  const resultsPath = arg('--results') ?? 'fixtures/expected_results.csv';
  const quorumPath = arg('--quorum') ?? 'fixtures/expected_quorum.csv';

  const meeting = parseMeeting(JSON.parse(readFileSync(meetingPath, 'utf8')));
  const list = toPublished(readCsv(publishedPath));
  const totals = toPublishedTotals(readCsv(totalsPath));
  const results = Object.fromEntries(readCsv(resultsPath).map((r) => [r.contest_id!, r]));
  const quorum = Object.fromEntries(readCsv(quorumPath).map((r) => [r.field!, r.value!]));
  const totalUnits = quorum.total_units !== undefined && /^\d+$/.test(quorum.total_units) ? Number(quorum.total_units) : undefined;

  const rc = recountFromPublished(meeting, list, totals, totalUnits);
  const checks: RecountCheck[] = [...rc.checks];
  const compare = (name: string, recomputed: string, published: string | undefined): void => {
    checks.push({ name, recomputed, published, verdict: published === undefined ? 'unpublished' : recomputed === published ? 'ok' : 'differs' });
  };
  compare('merkle_root', rc.merkle_root, quorum.merkle_root);
  compare('units_represented (counted ballots)', String(rc.counted), quorum.units_represented);
  const m = results.MEETING;
  // the MEETING row of expected_results.csv puts received / counted / rejected in the counted / voted / blank columns
  compare('received / counted / rejected', `${rc.received} / ${rc.counted} / ${rc.rejected}`, m ? `${m.counted} / ${m.voted} / ${m.blank}` : undefined);
  for (const c of rc.contests) {
    const pub = results[c.contest_id];
    compare(`${c.contest_id} counted / voted / blank`, `${c.counted} / ${c.voted} / ${c.blank}`, pub ? `${pub.counted} / ${pub.voted} / ${pub.blank}` : undefined);
    compare(`${c.contest_id} void by code`, fmtCounts(c.void_by_code), pub?.void_or_rejected_by_code);
    if (c.commitment !== undefined) compare(`${c.contest_id} commitment (root + published totals)`, c.commitment, pub?.commitment);
    else checks.push({ name: `${c.contest_id} commitment`, recomputed: '(needs the WEIGHTED totals)', published: pub?.commitment, verdict: 'not-recomputable' });
  }
  if (rc.meeting_commitment !== undefined) compare('meeting_commitment', rc.meeting_commitment, m?.commitment);
  compare('rejected by code', fmtCounts(rc.rejected_by_code), m?.void_or_rejected_by_code);

  console.log(`recount from ${publishedPath} (${list.length} rows: receipt, ballot_id, status, code, choices_canonical — no unit, caster, timestamp or share)`);
  console.log(`contests from ${meetingPath}; published totals ${totalsPath}; published results ${resultsPath}; published quorum ${quorumPath}`);
  console.log('');
  for (const c of rc.contests) {
    const ur = c.units_result as { elected?: string[]; open_seats?: number; tied?: string[] };
    const unitsVerdict = c.kind === 'ELECTION' ? `UNITS mode: elected ${(ur.elected ?? []).join(', ') || '-'}; open ${ur.open_seats}; tied ${(ur.tied ?? []).join(', ') || '-'}` : `unit bases: ${Object.entries(c.units_result).map(([b, v]) => `${b} ${v ? 'PASS' : 'FAIL'}`).join(', ')}`;
    console.log(`${c.contest_id}: UNITS totals ${Object.keys(c.units_totals).sort(compareStrings).map((k) => `${k} ${c.units_totals[k]}`).join(', ')}; ${unitsVerdict}`);
  }
  console.log('');
  let bad = 0;
  for (const k of checks) {
    const tag = k.verdict === 'ok' ? 'ok ' : k.verdict === 'differs' ? 'BAD' : k.verdict === 'not-recomputable' ? 'n/a' : '---';
    if (k.verdict === 'differs') bad += 1;
    console.log(`${tag} ${k.name}: ${k.recomputed}${k.published !== undefined && k.verdict !== 'ok' ? ` | published ${k.published}` : ''}`);
  }
  const na = checks.filter((k) => k.verdict === 'not-recomputable').length;
  const ok = checks.filter((k) => k.verdict === 'ok').length;
  console.log('');
  console.log(`tally:recount: ${ok} recomputed values match the published ones, ${bad} differ, ${na} not recomputable from the published list (WEIGHTED totals: no bps per published row; D-28).`);
  console.log('A match proves the published totals and commitments follow from the published ballots in UNITS mode; it says nothing about who cast them (D-2).');
  process.exit(bad ? 1 : 0);
}
