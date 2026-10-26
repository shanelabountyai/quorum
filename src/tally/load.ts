// Task 1.4: typed rows from CSV records (brief §12 columns). Every timestamp and date is validated at this
// boundary (D-8), every integer is parsed as an integer, and the first bad cell is an INPUT_INVALID naming it.
// No I/O here: the scripts and tests read the files and hand the text in.
import type { Json } from './canonical';
import type { CsvRow } from './csv';
import { InputInvalid } from './errors';
import { calendarDay, timestamp } from './time';
import type { Ballot, LedgerEntry, LedgerKind, Ownership, Proxy, Unit, UnitShare } from './types';

const need = (row: CsvRow, col: string, where: string): string => {
  const v = row[col];
  if (v === undefined) throw new InputInvalid(`${where}.${col}`, 'missing column');
  return v;
};

const int = (s: string, where: string): number => {
  if (!/^-?\d+$/.test(s)) throw new InputInvalid(where, `expected an integer, got ${JSON.stringify(s)}`);
  const n = Number(s);
  if (!Number.isSafeInteger(n)) throw new InputInvalid(where, `integer out of range: ${s}`);
  return n;
};

const LEDGER_KINDS: readonly LedgerKind[] = ['CHARGE', 'PAYMENT', 'FINE'];

export const toUnits = (rows: CsvRow[]): Unit[] => rows.map((r, i) => ({ unit_id: need(r, 'unit_id', `units[${i}]`) }));

export const toShares = (rows: CsvRow[]): UnitShare[] =>
  rows.map((r, i) => {
    const w = `unit_shares[${i}]`;
    return { unit_id: need(r, 'unit_id', w), share_bps: int(need(r, 'share_bps', w), `${w}.share_bps`), effective_from: calendarDay(need(r, 'effective_from', w), `${w}.effective_from`) };
  });

export const toOwnerships = (rows: CsvRow[]): Ownership[] =>
  rows.map((r, i) => {
    const w = `ownerships[${i}]`;
    const to = need(r, 'to_date', w);
    return { unit_id: need(r, 'unit_id', w), owner_id: need(r, 'owner_id', w), from_date: calendarDay(need(r, 'from_date', w), `${w}.from_date`), to_date: to === '' ? '' : calendarDay(to, `${w}.to_date`) };
  });

export const toLedger = (rows: CsvRow[]): LedgerEntry[] =>
  rows.map((r, i) => {
    const w = `assessments[${i}]`;
    const kind = need(r, 'kind', w);
    if (!(LEDGER_KINDS as readonly string[]).includes(kind)) throw new InputInvalid(`${w}.kind`, `unknown ledger kind ${kind}`);
    return { unit_id: need(r, 'unit_id', w), kind: kind as LedgerKind, amount_cents: int(need(r, 'amount_cents', w), `${w}.amount_cents`), date: calendarDay(need(r, 'date', w), `${w}.date`) };
  });

export const toProxies = (rows: CsvRow[]): Proxy[] =>
  rows.map((r, i) => {
    const w = `proxies[${i}]`;
    const revoked = need(r, 'revoked_at', w);
    return {
      proxy_id: need(r, 'proxy_id', w),
      grantor_unit: need(r, 'grantor_unit', w),
      grantor_owner: need(r, 'grantor_owner', w),
      holder_owner: need(r, 'holder_owner', w),
      received_at: timestamp(need(r, 'received_at', w), `${w}.received_at`),
      revoked_at: revoked === '' ? '' : timestamp(revoked, `${w}.revoked_at`),
    };
  });

/** `choices` must be a JSON object; anything else is INPUT_INVALID (the brief lists malformed JSON as not generated). */
export function parseChoices(text: string, where: string): Record<string, Json> {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new InputInvalid(where, 'choices is not JSON');
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new InputInvalid(where, 'choices must be a JSON object');
  return v as Record<string, Json>;
}

export const toBallots = (rows: CsvRow[]): Ballot[] =>
  rows.map((r, i) => {
    const w = `ballots[${i}]`;
    return {
      ballot_id: need(r, 'ballot_id', w),
      unit_id: need(r, 'unit_id', w),
      cast_by: need(r, 'cast_by', w),
      via_proxy_id: need(r, 'via_proxy_id', w),
      cast_at: timestamp(need(r, 'cast_at', w), `${w}.cast_at`),
      nonce: need(r, 'nonce', w),
      choices: parseChoices(need(r, 'choices', w), `${w}.choices`),
    };
  });
