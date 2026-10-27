// tally:eval (task 1.9; D-23). Runs the pure engine over fixtures/, prints the brief §11 table in
// tools/reference_tally.py's field order, then diffs per-ballot status/code/receipt/selection_codes against
// expected_ballots.csv, totals against expected_totals.csv, results and commitments against expected_results.csv
// and quorum against expected_quorum.csv. Exits 1 naming the first difference. The only product-side reader of
// the expected files, with the vitest goldens (CLAUDE.md non-negotiable 8).
//   --fixtures DIR      another fixture directory (default fixtures/)
//   --ballots FILE      a ballots.csv to run instead of the fixture's (the task 1.9 one-ballot-edit check)
//   --meeting FILE      a meeting.json to run instead of the fixture's (the "before Phase 2" R3 basis check)
// With --ballots or --meeting the diff still runs against the fixture's expected files, so a changed input FAILS.
import { pathToFileURL } from 'node:url';
import type { MeetingTally } from '../src/tally/tally';
import { tally } from '../src/tally/tally';
import { compareStrings } from '../src/tally/canonical';
import { FIXTURES_DIR, loadFixtures, readExpected } from './tally-fixtures';

const py = (v: boolean) => (v ? 'True' : 'False');
export const fmtCounts = (c: Readonly<Record<string, number>>) => Object.keys(c).sort(compareStrings).map((k) => `${k} ${c[k]}`).join(', ') || 'none';
const byVotes = (t: Record<string, number>) =>
  Object.keys(t)
    .sort((a, b) => t[b]! - t[a]! || compareStrings(a, b))
    .map((k) => `${k} ${t[k]}`)
    .join(', ');
const list = (xs: readonly string[]) => xs.join(', ') || '-';

export function report(res: MeetingTally): string {
  const q = res.quorum;
  const out: string[] = [];
  out.push(`meeting ${res.meeting_id} record_date ${res.record_date}`);
  out.push(`ballots received ${res.ballots_received} / counted ${res.ballots_counted} / rejected ${res.ballots_rejected}`);
  out.push(`rejected by code: ${fmtCounts(res.rejected_by_code)}`);
  out.push(`unknown contest keys on counted ballots: ${res.unknown_contest_keys}`);
  out.push(
    `quorum basis ${q.basis} threshold ${q.threshold_bps} bps: units ${q.units_represented}/${q.total_units} ${q.units_met ? 'MET' : 'NOT MET'}; ` +
      `weighted ${q.bps_represented}/${q.total_bps} bps ${q.weighted_met ? 'MET' : 'NOT MET'}; direct only ${q.direct_units}/${q.total_units} ` +
      `${q.direct_only_met ? 'MET' : 'NOT MET'} (proxy units ${q.proxy_units}); binding: ${q.met ? 'MET' : 'NOT MET'}`,
  );
  out.push(`merkle_root ${res.merkle_root}`);
  for (const c of res.contests) {
    out.push('');
    out.push(`contest ${c.contest_id} "${c.title}" ${c.kind}` + (c.kind === 'ELECTION' ? ` seats=${c.seats} mode=${c.mode}` : ` basis=${c.basis}`));
    out.push(`  counted ${c.counted_ballots} / voted ${c.voted} / blank ${c.blank} / void: ${fmtCounts(c.void_by_code as Record<string, number>)}`);
    if (c.kind === 'ELECTION') {
      for (const mode of ['UNITS', 'WEIGHTED'] as const) out.push(`  totals ${mode} (${mode === c.mode ? 'binding' : 'informational'}): ${byVotes(c.totals[mode])}`);
      out.push(`  result ${c.result}: elected ${list(c.elected)}; open seats ${c.open_seats}; tied ${list(c.tied)}`);
      const o = c.informational_other_mode;
      out.push(`  other mode ${o.mode} would elect ${list(o.elected)} (tied ${list(o.tied)}); differs: ${py(o.differs)}`);
    } else {
      const u = c.totals.units;
      const w = c.totals.bps;
      out.push(`  totals units: YES ${u.YES}, NO ${u.NO}, ABSTAIN ${u.ABSTAIN}; bps: YES ${w.YES}, NO ${w.NO}, ABSTAIN ${w.ABSTAIN}`);
      out.push(`  result ${c.result} under ${c.basis}`);
      out.push(`  by basis: ${Object.entries(c.passes_by_basis).map(([b, v]) => `${b} ${v ? 'PASS' : 'FAIL'}`).join(', ')}`);
    }
    out.push(`  commitment ${c.commitment}`);
  }
  out.push('');
  out.push(`meeting_commitment ${res.meeting_commitment}`);
  return out.join('\n');
}

/**
 * The first difference between the engine and the four expected files, as "file: where: got X, expected Y"; null
 * when none. `stored` is the database half (task 2.9): the rows D-20 keeps carry no unit id, so that column is
 * not compared there — everything else (status, code, bps, receipt, selection codes, every total, result and
 * commitment, the quorum report) is.
 */
export function firstDiff(res: MeetingTally, dir = FIXTURES_DIR, opts: { stored?: boolean } = {}): string | null {
  const diff = (file: string, where: string, got: string, want: string | undefined) => (got === (want ?? '') ? null : `${file}: ${where}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want ?? '')}`);
  // ballots
  const byId = new Map(res.ballot_results.map((r) => [r.ballot_id, r]));
  const expectedBallots = readExpected('expected_ballots', dir);
  if (expectedBallots.length !== res.ballot_results.length) return `expected_ballots.csv: ${expectedBallots.length} rows, engine produced ${res.ballot_results.length}`;
  for (const e of expectedBallots) {
    const r = byId.get(e.ballot_id!);
    if (!r) return `expected_ballots.csv: ${e.ballot_id}: not in the engine's results`;
    const codes = Object.keys(r.selections)
      .sort(compareStrings)
      .map((cid) => `${cid}:${r.selections[cid]!.status}${r.selections[cid]!.code ? ':' + r.selections[cid]!.code : ''}`)
      .join(';');
    for (const [col, got] of [['unit_id', r.unit_id], ['status', r.status], ['code', r.code], ['bps', String(r.bps)], ['receipt', r.receipt], ['selection_codes', codes]] as const) {
      if (col === 'unit_id' && opts.stored) continue;
      const d = diff('expected_ballots.csv', `${e.ballot_id}.${col}`, got, e[col]);
      if (d) return d;
    }
  }
  // totals
  const totals: string[] = [];
  for (const c of res.contests) {
    if (c.kind === 'ELECTION') for (const mode of ['UNITS', 'WEIGHTED'] as const) for (const k of Object.keys(c.totals[mode]).sort(compareStrings)) totals.push(`${c.contest_id},${mode},${k},${c.totals[mode][k]}`);
    else for (const [mode, key] of [['UNITS', 'units'], ['WEIGHTED', 'bps']] as const) for (const k of Object.keys(c.totals[key]).sort(compareStrings)) totals.push(`${c.contest_id},${mode},${k},${c.totals[key][k as 'YES']}`);
  }
  const expectedTotals = readExpected('expected_totals', dir).map((r) => `${r.contest_id},${r.mode},${r.option},${r.value}`);
  for (let i = 0; i < Math.max(totals.length, expectedTotals.length); i++) {
    const d = diff('expected_totals.csv', `row ${i + 2}`, totals[i] ?? '', expectedTotals[i]);
    if (d) return d;
  }
  // results
  const rows = res.contests.map((c) =>
    c.kind === 'ELECTION'
      ? [c.contest_id, c.kind, c.mode, c.result, c.elected.join(';'), String(c.open_seats), c.tied.join(';'), String(c.counted_ballots), String(c.voted), String(c.blank), fmtCounts(c.void_by_code as Record<string, number>), c.commitment]
      : [c.contest_id, c.kind, c.basis, c.result, '', '', '', String(c.counted_ballots), String(c.voted), String(c.blank), fmtCounts(c.void_by_code as Record<string, number>), c.commitment],
  );
  rows.push(['MEETING', '', '', '', '', '', '', String(res.ballots_received), String(res.ballots_counted), String(res.ballots_rejected), fmtCounts(res.rejected_by_code), res.meeting_commitment]);
  const cols = ['contest_id', 'kind', 'mode_or_basis', 'result', 'elected', 'open_seats', 'tied', 'counted', 'voted', 'blank', 'void_or_rejected_by_code', 'commitment'];
  const expectedResults = readExpected('expected_results', dir);
  if (expectedResults.length !== rows.length) return `expected_results.csv: ${expectedResults.length} rows, engine produced ${rows.length}`;
  for (let i = 0; i < rows.length; i++) {
    for (let k = 0; k < cols.length; k++) {
      const d = diff('expected_results.csv', `${rows[i]![0]}.${cols[k]}`, rows[i]![k]!, expectedResults[i]![cols[k]!]);
      if (d) return d;
    }
  }
  // quorum
  const q: Record<string, string> = { ...Object.fromEntries(Object.entries(res.quorum).map(([k, v]) => [k, typeof v === 'boolean' ? py(v) : String(v)])), merkle_root: res.merkle_root };
  for (const e of readExpected('expected_quorum', dir)) {
    const d = diff('expected_quorum.csv', e.field!, q[e.field!] ?? '', e.value);
    if (d) return d;
  }
  return null;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = arg('--fixtures') ?? FIXTURES_DIR;
  const f = loadFixtures(dir, { ballots: arg('--ballots'), meeting: arg('--meeting') });
  if (f.ballots.length === 0) {
    console.log('0 ballots');
    process.exit(0);
  }
  const res = tally(f.meeting, f.units, f.shares, f.ownerships, f.ledger, f.proxies, f.ballots);
  console.log(report(res));
  const d = firstDiff(res, dir);
  if (d) {
    console.error(`\ntally:eval: DIFFERS from the oracle — ${d}`);
    process.exit(1);
  }
  console.log(`\ntally:eval: ${res.ballots_received} ballots, ${res.ballots_counted} counted, ${res.ballots_rejected} rejected; every row of expected_ballots.csv, expected_totals.csv, expected_results.csv and expected_quorum.csv matches (D-24: the oracle's answers on the generator's own defects, by the same author)`);
}
