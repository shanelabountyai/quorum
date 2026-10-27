// tally:recount (task 1.11; C-6, D-18, amended by D-37). Recomputes the whole tally from the published list:
//   npm run tally:recount -- --published fixtures/published_ballots.csv --meeting fixtures/meeting.json
//                            [--totals fixtures/expected_totals.csv] [--results fixtures/expected_results.csv]
//                            [--quorum fixtures/expected_quorum.csv]
// From the list alone (plus the unit count from the published quorum report — the rules JSON carries
// total_share_bps but not total_units): the Merkle root; received / counted / rejected by code; every total in both
// modes (each ballot's bps_as_of is published since D-37); units and bps represented and the binding quorum;
// every result under the binding rule and all six bases; every contest commitment and the meeting commitment.
// The published totals, results and quorum are COMPARED with the recount, never used by it. Not recomputable: the
// direct/proxy split of the quorum report (no proxy flag is published). No unit, owner, proxy or ballots.csv file
// is read. Exit 1 on any recomputed value that differs from a published one.
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
  if (quorum.total_units === undefined || !/^\d+$/.test(quorum.total_units)) {
    console.error(`tally:recount: ${quorumPath} has no total_units; the unit count is needed for the unit bases and the units quorum`);
    process.exit(2);
  }
  const rc = recountFromPublished(meeting, list, Number(quorum.total_units), totals);
  const t = rc.tally;
  const checks: RecountCheck[] = [...rc.checks];
  const compare = (name: string, recomputed: string, published: string | undefined): void => {
    checks.push({ name, recomputed, published, verdict: published === undefined ? 'unpublished' : recomputed === published ? 'ok' : 'differs' });
  };
  const yesNo = (b: boolean) => (b ? 'True' : 'False');
  compare('merkle_root', t.merkle_root, quorum.merkle_root);
  compare('units_represented', String(t.quorum.units_represented), quorum.units_represented);
  compare('bps_represented', String(t.quorum.bps_represented), quorum.bps_represented);
  compare('quorum units_met / weighted_met / met', `${yesNo(t.quorum.units_met)} / ${yesNo(t.quorum.weighted_met)} / ${yesNo(t.quorum.met)}`, quorum.met !== undefined ? `${quorum.units_met} / ${quorum.weighted_met} / ${quorum.met}` : undefined);
  const m = results.MEETING;
  // the MEETING row of expected_results.csv puts received / counted / rejected in the counted / voted / blank columns
  compare('received / counted / rejected', `${t.ballots_received} / ${t.ballots_counted} / ${t.ballots_rejected}`, m ? `${m.counted} / ${m.voted} / ${m.blank}` : undefined);
  compare('rejected by code', fmtCounts(t.rejected_by_code), m?.void_or_rejected_by_code);
  for (const c of t.contests) {
    const pub = results[c.contest_id];
    compare(`${c.contest_id} counted / voted / blank`, `${c.counted_ballots} / ${c.voted} / ${c.blank}`, pub ? `${pub.counted} / ${pub.voted} / ${pub.blank}` : undefined);
    compare(`${c.contest_id} void by code`, fmtCounts(c.void_by_code), pub?.void_or_rejected_by_code);
    compare(`${c.contest_id} result`, c.result, pub?.result);
    if (c.kind === 'ELECTION') compare(`${c.contest_id} elected / open / tied`, `${c.elected.join(';')} / ${c.open_seats} / ${c.tied.join(';')}`, pub ? `${pub.elected} / ${pub.open_seats} / ${pub.tied}` : undefined);
    compare(`${c.contest_id} commitment`, c.commitment, pub?.commitment);
  }
  compare('meeting_commitment', t.meeting_commitment, m?.commitment);

  console.log(`recount from ${publishedPath} (${list.length} rows: receipt, ballot_id, status, code, bps_as_of, choices_canonical — no unit, caster, timestamp or proxy flag)`);
  console.log(`contests from ${meetingPath}; total_units ${quorum.total_units} from ${quorumPath}; compared with ${totalsPath}, ${resultsPath}, ${quorumPath}`);
  console.log('');
  for (const c of t.contests) {
    if (c.kind === 'ELECTION') console.log(`${c.contest_id}: ${c.mode} (binding) ${c.result}: elected ${c.elected.join(', ') || '-'}; open ${c.open_seats}; tied ${c.tied.join(', ') || '-'}; other mode ${c.informational_other_mode.mode} would elect ${c.informational_other_mode.elected.join(', ') || '-'}`);
    else console.log(`${c.contest_id}: ${c.result} under ${c.basis}; by basis ${Object.entries(c.passes_by_basis).map(([b, v]) => `${b} ${v ? 'PASS' : 'FAIL'}`).join(', ')}`);
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
  console.log(`tally:recount: ${ok} recomputed values match the published ones, ${bad} differ, ${na} not recomputable from the published list (the direct/proxy split: no proxy flag is published).`);
  console.log('A match proves the published totals, results and commitments follow from the published ballots; it says nothing about who cast them (D-2). bps_as_of is published per ballot (D-37): a rare share value partially identifies a unit.');
  process.exit(bad ? 1 : 0);
}
