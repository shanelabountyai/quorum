// D-8: timestamps and dates are fixed-width strings on one named calendar axis, compared lexically.
// Branded after Bookable packages/core/time/types.ts (task 1.3): a `Timestamp` and a `CalendarDay` are
// structurally distinct from a bare string and from each other, and the only way to get one is through a
// validating constructor. There is no conversion to a JS Date anywhere in the engine; `rules.timezone_label`
// names the zone for people and is never used for arithmetic.
import { InputInvalid } from './errors';

/** "YYYY-MM-DDTHH:MM:SS" — an instant on the meeting's named wall clock. */
export type Timestamp = string & { readonly __timestamp: unique symbol };
/** "YYYY-MM-DD" — a day on the same calendar. */
export type CalendarDay = string & { readonly __calendarDay: unique symbol };

export const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
export const CALENDAR_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isTimestamp = (s: unknown): s is Timestamp => typeof s === 'string' && TIMESTAMP_RE.test(s);
export const isCalendarDay = (s: unknown): s is CalendarDay => typeof s === 'string' && CALENDAR_DAY_RE.test(s);

/** Validating constructor; `field` names the row and column in the INPUT_INVALID it throws. */
export function timestamp(s: unknown, field: string): Timestamp {
  if (!isTimestamp(s)) throw new InputInvalid(field, `expected YYYY-MM-DDTHH:MM:SS, got ${JSON.stringify(s)}`);
  return s;
}

export function calendarDay(s: unknown, field: string): CalendarDay {
  if (!isCalendarDay(s)) throw new InputInvalid(field, `expected YYYY-MM-DD, got ${JSON.stringify(s)}`);
  return s;
}

/**
 * Lexical order is chronological order for fixed-width ISO strings on one axis. A Timestamp and a CalendarDay
 * are never compared with each other: the day axis is for rules (record date, ownership, ledger dates) and the
 * instant axis is for occurrences (casts, proxy receipt, the window).
 */
export const before = <T extends Timestamp | CalendarDay>(a: T, b: T): boolean => a < b;
export const notAfter = <T extends Timestamp | CalendarDay>(a: T, b: T): boolean => a <= b;
