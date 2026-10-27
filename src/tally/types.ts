// Input rows as the engine reads them (fixture column names, brief §12; the Phase 2 cast path maps its tables
// onto the same shapes). Shares are integer basis points, money is integer cents, times are branded strings (D-8).
import type { BallotRejectCode, BallotStatus, SelectionStatus, SelectionVoidCode } from './codes';
import type { Json } from './canonical';
import type { CalendarDay, Timestamp } from './time';

export type Unit = { unit_id: string };
export type UnitShare = { unit_id: string; share_bps: number; effective_from: CalendarDay };
/** E-1: covers [from_date, to_date); an empty to_date is open. */
export type Ownership = { unit_id: string; owner_id: string; from_date: CalendarDay; to_date: CalendarDay | '' };
import type { LedgerKind } from './codes';
export type { LedgerKind };
export type LedgerEntry = { unit_id: string; kind: LedgerKind; amount_cents: number; date: CalendarDay };
export type Proxy = {
  proxy_id: string;
  grantor_unit: string;
  grantor_owner: string;
  holder_owner: string;
  received_at: Timestamp;
  revoked_at: Timestamp | '';
};
/** `choices` is the parsed JSON object as cast; `via_proxy_id` empty means a direct ballot. */
export type Ballot = {
  ballot_id: string;
  unit_id: string;
  cast_by: string;
  via_proxy_id: string;
  cast_at: Timestamp;
  nonce: string;
  choices: Record<string, Json>;
};

export type Selection =
  | { status: 'VOTED'; code: ''; value: string | string[] }
  | { status: 'BLANK'; code: ''; value: null }
  | { status: 'VOID'; code: SelectionVoidCode; value: null };
export type { SelectionStatus };

export type BallotResult = {
  ballot_id: string;
  unit_id: string;
  cast_by: string;
  via_proxy_id: string;
  cast_at: Timestamp;
  status: BallotStatus;
  code: BallotRejectCode | '';
  receipt: string;
  /** share as of the record date; 0 when the unit is unknown */
  bps: number;
  /** contest_id → selection; empty unless COUNTED */
  selections: Record<string, Selection>;
  /** keys on the ballot that name no contest, sorted; empty unless COUNTED */
  unknown_contests: string[];
};
