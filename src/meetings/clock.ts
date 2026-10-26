// The ONE place an instant becomes a meeting-axis wall clock (D-8; the Phase 3 cast page). The engine never sees a
// clock; the write paths take a Timestamp. `rules.timezone_label` names the association's zone and is used here
// and nowhere else. Intl only — no date library (ask-before-add), no process timezone (no Date accessors).
// Limit, stated: in the repeated hour of a fall-back night the wall clock goes backwards, so a cast in that hour
// can read earlier than the last one and be refused CAST_OUT_OF_ORDER (D-36); meetings do not run at 01:30.
import { now } from '@/core/clock';
import { calendarDay, timestamp, type CalendarDay, type Timestamp } from '@/tally/time';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall clock in `timeZone` at `at` (default: the app clock) as "YYYY-MM-DDTHH:MM:SS". A bad zone throws RangeError. */
export function wallClock(timeZone: string, at: Date = now()): Timestamp {
  const p = Object.fromEntries(formatterFor(timeZone).formatToParts(at).map((x) => [x.type, x.value]));
  return timestamp(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`, 'wallClock');
}

/** The calendar day in `timeZone` at `at` (ledger and violation dates). */
export const wallDay = (timeZone: string, at: Date = now()): CalendarDay => calendarDay(wallClock(timeZone, at).slice(0, 10), 'wallDay');

/** Whether a zone label is one Intl knows (validated when a meeting or the association's settings name it). */
export function isTimeZone(label: string): boolean {
  try {
    formatterFor(label);
    return true;
  } catch {
    return false;
  }
}
