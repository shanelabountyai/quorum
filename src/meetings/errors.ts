// The database's refusals as typed errors (task 2.2, 2.10). Prisma 7 with a driver adapter wraps a Postgres
// error as PrismaClientKnownRequestError P2039 (model query) or P2010 (raw query), and in BOTH shapes the
// SQLSTATE and the server message sit at meta.driverAdapterError.cause.{code,message} — measured, not assumed
// (Gavel D-36: test the error shape you actually get). The mapper reads that one place.
//   P0001 + "… is append-only"        → AppendOnlyViolation (the trigger names the table)
//   P0001 + "… is closed"             → MeetingClosed (D-34, the close guard and quorum_cast_ballot)
//   P0001 + "… sealed"                → MeetingSealed (D-20, the Meeting guard after close)
//   42501                             → PrivilegeDenied (the app role reaching a sealed or forbidden table)
//   23514                             → CheckViolation (a D-8 string or an integer CHECK, naming the constraint)
//   anything else                     → the original error, untouched

export class QuorumDbError extends Error {
  constructor(
    readonly kind: 'APPEND_ONLY' | 'MEETING_CLOSED' | 'MEETING_SEALED' | 'PRIVILEGE_DENIED' | 'CHECK_VIOLATION' | 'DB_REFUSAL',
    readonly sqlState: string,
    readonly detail: string,
    readonly cause?: unknown,
  ) {
    super(`${kind}: ${detail} (SQLSTATE ${sqlState})`);
    this.name = 'QuorumDbError';
  }
}
export class AppendOnlyViolation extends QuorumDbError {
  constructor(sqlState: string, detail: string, cause?: unknown) {
    super('APPEND_ONLY', sqlState, detail, cause);
    this.name = 'AppendOnlyViolation';
  }
}
export class MeetingClosed extends QuorumDbError {
  constructor(sqlState: string, detail: string, cause?: unknown) {
    super('MEETING_CLOSED', sqlState, detail, cause);
    this.name = 'MeetingClosed';
  }
}
export class MeetingSealed extends QuorumDbError {
  constructor(sqlState: string, detail: string, cause?: unknown) {
    super('MEETING_SEALED', sqlState, detail, cause);
    this.name = 'MeetingSealed';
  }
}
export class PrivilegeDenied extends QuorumDbError {
  constructor(sqlState: string, detail: string, cause?: unknown) {
    super('PRIVILEGE_DENIED', sqlState, detail, cause);
    this.name = 'PrivilegeDenied';
  }
}
export class CheckViolation extends QuorumDbError {
  constructor(sqlState: string, detail: string, cause?: unknown) {
    super('CHECK_VIOLATION', sqlState, detail, cause);
    this.name = 'CheckViolation';
  }
}

type PgCause = { code?: unknown; message?: unknown };

/** The Postgres SQLSTATE and message behind a Prisma error, or null when it is not a database refusal. */
export function pgCause(e: unknown): { code: string; message: string } | null {
  if (!e || typeof e !== 'object') return null;
  const meta = (e as { meta?: { driverAdapterError?: { cause?: PgCause } } }).meta;
  const cause = meta?.driverAdapterError?.cause;
  if (!cause || typeof cause.code !== 'string') return null;
  return { code: cause.code, message: typeof cause.message === 'string' ? cause.message : '' };
}

export function mapDbError(e: unknown): unknown {
  const c = pgCause(e);
  if (!c) return e;
  if (c.code === '42501') return new PrivilegeDenied(c.code, c.message, e);
  if (c.code === '23514') return new CheckViolation(c.code, c.message, e);
  if (c.code === 'P0001') {
    if (/append-only/.test(c.message)) return new AppendOnlyViolation(c.code, c.message, e);
    if (/is closed/.test(c.message) || /closed meeting/.test(c.message)) return new MeetingClosed(c.code, c.message, e);
    if (/sealed/.test(c.message)) return new MeetingSealed(c.code, c.message, e);
    return new QuorumDbError('DB_REFUSAL', c.code, c.message, e);
  }
  return e;
}
