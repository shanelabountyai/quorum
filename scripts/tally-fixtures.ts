// The one place that reads fixture files from disk, for the CLIs and the vitest goldens. The engine itself takes
// rows (src/tally/load.ts) and never touches the filesystem. Product code never reads answer_key_ballots.csv or
// expected_*.csv (CLAUDE.md non-negotiable 8); only tally:eval and the tests do, through readExpected below.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv, type CsvRow } from '../src/tally/csv';
import { toBallots, toLedger, toOwnerships, toProxies, toShares, toUnits } from '../src/tally/load';
import { parseMeeting, type Meeting } from '../src/tally/rules';
import type { Ballot, LedgerEntry, Ownership, Proxy, Unit, UnitShare } from '../src/tally/types';

export const FIXTURES_DIR = 'fixtures';

export type Fixtures = {
  meeting: Meeting;
  units: Unit[];
  shares: UnitShare[];
  ownerships: Ownership[];
  ledger: LedgerEntry[];
  proxies: Proxy[];
  ballots: Ballot[];
};

export const readCsv = (path: string): CsvRow[] => parseCsv(readFileSync(path, 'utf8'), path);

export function loadFixtures(dir = FIXTURES_DIR, overrides: Partial<{ meeting: string; ballots: string }> = {}): Fixtures {
  const at = (name: string) => join(dir, name);
  return {
    meeting: parseMeeting(JSON.parse(readFileSync(overrides.meeting ?? at('meeting.json'), 'utf8'))),
    units: toUnits(readCsv(at('units.csv'))),
    shares: toShares(readCsv(at('unit_shares.csv'))),
    ownerships: toOwnerships(readCsv(at('ownerships.csv'))),
    ledger: toLedger(readCsv(at('assessments.csv'))),
    proxies: toProxies(readCsv(at('proxies.csv'))),
    ballots: toBallots(readCsv(overrides.ballots ?? at('ballots.csv'))),
  };
}

/** The oracle's expected files. Test and eval only. */
export const readExpected = (name: 'expected_ballots' | 'expected_totals' | 'expected_results' | 'expected_quorum' | 'published_ballots', dir = FIXTURES_DIR): CsvRow[] =>
  readCsv(join(dir, `${name}.csv`));
