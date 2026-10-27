// Task 1.4: the closed rules schema. Every violation is RULES_INVALID naming the field; meeting.json loads.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RulesInvalid } from '../../src/tally/errors';
import { parseMeeting } from '../../src/tally/rules';
import { parseCsv } from '../../src/tally/csv';
import { InputInvalid } from '../../src/tally/errors';
import { toBallots } from '../../src/tally/load';
import { loadFixtures } from '../../scripts/tally-fixtures';

const base = () => JSON.parse(readFileSync('fixtures/meeting.json', 'utf8')) as Record<string, unknown> & { rules: Record<string, unknown>; contests: Record<string, unknown>[] };

const refuse = (mutate: (m: ReturnType<typeof base>) => void, field: RegExp) => {
  const m = base();
  mutate(m);
  let err: unknown;
  try {
    parseMeeting(m);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(RulesInvalid);
  expect((err as RulesInvalid).field).toMatch(field);
  expect((err as Error).message).toMatch(/^RULES_INVALID: /);
};

describe('rules schema (task 1.4)', () => {
  it('fixtures/meeting.json loads with 6 contests', () => {
    const m = parseMeeting(base());
    expect(m.contests.map((c) => c.contest_id)).toEqual(['E1', 'E2', 'R1', 'R2', 'R3', 'R4']);
    expect(m.rules.quorum).toEqual({ basis: 'UNITS', threshold_bps: 5000 });
  });
  it('proxy_max_depth 2 is refused (D-14)', () => refuse((m) => (m.rules.proxy_max_depth = 2), /proxy_max_depth/));
  it('unknown basis, mode, quorum basis and duplicate rule are refused', () => {
    refuse((m) => ((m.contests[2] as Record<string, unknown>).basis = 'PLURALITY'), /contests\.2\.basis/);
    refuse((m) => ((m.contests[0] as Record<string, unknown>).mode = 'CUMULATIVE'), /contests\.0\.mode/);
    refuse((m) => ((m.rules.quorum as Record<string, unknown>).basis = 'DIRECT'), /quorum\.basis/);
    refuse((m) => (m.rules.duplicate_unit_rule = 'LAST_CAST_WINS'), /duplicate_unit_rule/);
  });
  it('timestamps and dates must be fixed-width strings (D-8)', () => {
    refuse((m) => (m.rules.open_at = '2026-11-01 09:00'), /open_at/);
    refuse((m) => (m.rules.record_date = '11/14/2026'), /record_date/);
    refuse((m) => (m.rules.close_at = '2026-10-01T00:00:00'), /close_at/); // before open_at
  });
  it('unknown keys, missing keys and bad seats are refused', () => {
    refuse((m) => (m.rules.grace_days = 30), /rules/);
    refuse((m) => delete m.rules.total_share_bps, /total_share_bps/);
    refuse((m) => ((m.contests[0] as Record<string, unknown>).seats = 5), /contests\.0\.candidates/); // 5 candidates, 5 seats
    refuse((m) => ((m.contests[1] as Record<string, unknown>).seats = 0), /contests\.1\.seats/);
  });
});

describe('fixture loaders (task 1.4)', () => {
  it('loads every CSV and meeting.json with the brief §3 counts', () => {
    const f = loadFixtures();
    expect([f.units.length, f.shares.length, f.ownerships.length, f.ledger.length, f.proxies.length, f.ballots.length]).toEqual([120, 124, 141, 2627, 49, 113]);
  });
  it('parses quoted JSON choices with doubled quotes', () => {
    const rows = parseCsv('ballot_id,unit_id,cast_by,via_proxy_id,cast_at,nonce,choices\nB-1,U1,o1,,2026-11-14T10:00:00,00,"{""E1"":[""C-01""],""R1"":""YES""}"\n');
    expect(toBallots(rows)[0]!.choices).toEqual({ E1: ['C-01'], R1: 'YES' });
  });
  it('a malformed cast_at is INPUT_INVALID at the boundary', () => {
    const rows = parseCsv('ballot_id,unit_id,cast_by,via_proxy_id,cast_at,nonce,choices\nB-1,U1,o1,,2026-11-14 10:00,00,{}\n');
    expect(() => toBallots(rows)).toThrow(InputInvalid);
    expect(() => toBallots(rows)).toThrow(/ballots\[0\]\.cast_at/);
  });
});
