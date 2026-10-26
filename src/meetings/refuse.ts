// The engine's and the write layer's typed refusals, as the foundation's Refused (a message a form shows). Every
// Quorum action body runs inside `refusing`, so a bad meeting.json, a malformed CSV cell, a differing roster, a cast
// from the past or a write into a closed meeting or an archived org reaches the user as a sentence — and the INV
// harness sees a refusal, not a crash. Anything not listed is a bug and is re-thrown.
import { Refused } from '@/core/errors';
import { InputInvalid, RulesInvalid } from '@/tally/errors';
import { CastOutOfOrder, QuorumDbError } from './errors';
import { RosterDiffers } from './load';

export function asRefusal(e: unknown): unknown {
  if (e instanceof Refused) return e;
  if (e instanceof RulesInvalid) return new Refused(`The meeting definition is invalid: ${e.message.replace(/^RULES_INVALID: /, '')} (RULES_INVALID).`);
  if (e instanceof InputInvalid) return new Refused(`A value is malformed: ${e.message.replace(/^INPUT_INVALID: /, '')} (INPUT_INVALID).`);
  if (e instanceof RosterDiffers) return new Refused(`Nothing was imported: the association already holds a different ${e.table} (${e.detail}). The roster is write-once.`);
  if (e instanceof CastOutOfOrder) return new Refused(`${e.message}. Casts are recorded in time order.`);
  if (e instanceof QuorumDbError) {
    if (e.kind === 'MEETING_CLOSED' || e.kind === 'MEETING_SEALED') return new Refused('This meeting is closed and sealed; nothing more can be recorded for it.');
    if (e.kind === 'ORG_ARCHIVED') return new Refused('This association is archived. Its history can be read; nothing new can be written.');
    if (e.kind === 'CHECK_VIOLATION') return new Refused(`The database refused a malformed value (${e.detail}).`);
    if (e.kind === 'APPEND_ONLY') return new Refused(`That record is append-only and cannot be changed (${e.detail}).`);
  }
  return e;
}

export async function refusing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw asRefusal(e);
  }
}
