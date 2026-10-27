// The one home for money representation and rounding in Quorum (D-21). Ported from Gavel
// `src/auction/engine/money.ts` (commit e2ac339, read 2026-10-26), itself ported whole from LoanBook
// `src/ledger/money.ts` (LoanBook is private and was not readable from the cloud session; Gavel's copy is the donor).
// Kept: the integer guards and formatCents. Left behind: roundHalfUp — nothing in the dues ledger rounds half up;
// D-21's allocation is integer FLOOR division with the remainder posted to the ROUNDING line, added below as
// `floorShare`, the one bigint division here. Cents and basis points are integer `number`s.

export type MoneyErrorCode = 'non_integer_amount' | 'non_integer_rate' | 'invalid_share_input';

export class MoneyError extends Error {
  constructor(readonly code: MoneyErrorCode) {
    super(code);
  }
}

function assertInteger(value: unknown, code: MoneyErrorCode): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new MoneyError(code);
  return value;
}

/** Boundary guard for an amount in cents. Sign is the caller's rule, not this one's. */
export const assertCents = (value: unknown) => assertInteger(value, 'non_integer_amount');

/** Boundary guard for a share in basis points. */
export const assertBps = (value: unknown) => assertInteger(value, 'non_integer_rate');

/**
 * D-21: floor(amountCents × bps / totalBps), exactly, for non-negative inputs — bigint, never a float. The caller
 * posts what the floors leave over to the ROUNDING line, so the parts always sum to the whole.
 */
export function floorShare(amountCents: number, bps: number, totalBps: number): number {
  assertCents(amountCents);
  assertBps(bps);
  assertBps(totalBps);
  if (amountCents < 0 || bps < 0 || totalBps <= 0) throw new MoneyError('invalid_share_input');
  return assertCents(Number((BigInt(amountCents) * BigInt(bps)) / BigInt(totalBps)));
}

/** Display only: whole cents as dollars by string, never through a float ("-$12.05"). */
export function formatCents(value: number): string {
  const digits = String(Math.abs(assertCents(value))).padStart(3, '0');
  return `${value < 0 ? '-' : ''}$${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Form input: "1234.56", "1,234.56", "$1234" or "1234.5" as integer cents, by string — never parseFloat. */
export function parseDollars(text: string): number | null {
  const m = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const cents = Number(m[1]!.replace(/,/g, '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
