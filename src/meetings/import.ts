// Roster and proxy CSVs (brief §12 columns) as the loaders want them. The one parser for both callers: the board's
// import page (task 3.4) hands in the pasted text, and scripts/tally-fixtures.ts hands in the fixture files. Every
// cell is validated by the engine's own row parsers (src/tally/load.ts), so the first bad cell is INPUT_INVALID
// naming it — the same error the CLIs print.
import { parseCsv } from '@/tally/csv';
import { InputInvalid } from '@/tally/errors';
import { toLedger, toOwnerships, toProxies, toShares } from '@/tally/load';
import type { LedgerEntry, Ownership, Proxy, UnitShare } from '@/tally/types';
import type { OwnerRow, UnitRow } from './load';

export type RosterTexts = { units: string; unit_shares: string; owners: string; ownerships: string; assessments: string };

const intCell = (s: string | undefined, where: string): number => {
  if (s === undefined || s === '') return 0;
  if (!/^-?\d+$/.test(s)) throw new InputInvalid(where, `expected an integer, got ${JSON.stringify(s)}`);
  return Number(s);
};

const required = (s: string | undefined, where: string): string => {
  if (s === undefined || s === '') throw new InputInvalid(where, 'missing value');
  return s;
};

/** Mutable arrays (a RosterInput), so a test can alter one row before loading. */
export type RosterRows = { units: UnitRow[]; shares: UnitShare[]; owners: OwnerRow[]; ownerships: Ownership[]; ledger: (LedgerEntry & { entry_id: string; memo: string })[] };

export function rosterFromCsv(t: RosterTexts): RosterRows {
  const ledgerRows = parseCsv(t.assessments, 'assessments.csv');
  return {
    units: parseCsv(t.units, 'units.csv').map((r, i) => ({ unit_id: required(r.unit_id, `units[${i}].unit_id`), unit_type: r.unit_type ?? '', building: r.building ?? '', floor: intCell(r.floor, `units[${i}].floor`) })),
    shares: toShares(parseCsv(t.unit_shares, 'unit_shares.csv')),
    owners: parseCsv(t.owners, 'owners.csv').map((r, i) => ({ owner_id: required(r.owner_id, `owners[${i}].owner_id`), name: r.name ?? '', email: (r.email ?? '').trim() })),
    ownerships: toOwnerships(parseCsv(t.ownerships, 'ownerships.csv')),
    ledger: ledgerRows.map((r, i) => ({ ...toLedger([r])[0]!, entry_id: r.entry_id ?? `L-${String(i + 1).padStart(5, '0')}`, memo: r.memo ?? '' })),
  };
}

export const proxiesFromCsv = (text: string): Proxy[] => toProxies(parseCsv(text, 'proxies.csv'));
