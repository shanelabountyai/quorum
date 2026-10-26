// Task 1.10: order independence (D-7, GT-17 at fixture scale). 20 shuffles of the 113 fixture ballots under a
// fixed-seed PRNG (seed 20261025, mulberry32, recorded here and in docs/EVAL.md) give identical ballot results,
// totals, receipt set, Merkle root and meeting commitment. The randomness lives in the TEST; the engine has none.
import { describe, expect, it } from 'vitest';
import { tally } from '../../src/tally/tally';
import { loadFixtures } from '../../scripts/tally-fixtures';

export const SHUFFLE_SEED = 20261025;
export const SHUFFLE_COUNT = 20;

/** mulberry32: a 32-bit seeded generator, enough to order 113 rows reproducibly. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(xs: readonly T[], rnd: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('order independence (task 1.10)', () => {
  const f = loadFixtures();
  const base = tally(f.meeting, f.units, f.shares, f.ownerships, f.ledger, f.proxies, f.ballots);
  const rnd = mulberry32(SHUFFLE_SEED);
  const fingerprint = (r: typeof base) => ({
    ballots: r.ballot_results.map((b) => `${b.ballot_id}:${b.status}:${b.code}`),
    receipts: [...r.ballot_results.map((b) => b.receipt)].sort(),
    totals: r.contests.map((c) => c.totals),
    results: r.contests.map((c) => [c.contest_id, c.result, c.commitment]),
    root: r.merkle_root,
    commitment: r.meeting_commitment,
  });
  const want = fingerprint(base);

  it(`${SHUFFLE_COUNT} seeded shuffles (seed ${SHUFFLE_SEED}) give one answer`, () => {
    let moved = 0;
    for (let i = 0; i < SHUFFLE_COUNT; i++) {
      const order = shuffled(f.ballots, rnd);
      if (order.some((b, k) => b.ballot_id !== f.ballots[k]!.ballot_id)) moved += 1;
      expect(fingerprint(tally(f.meeting, f.units, f.shares, f.ownerships, f.ledger, f.proxies, order))).toEqual(want);
    }
    expect(moved).toBe(SHUFFLE_COUNT); // the premise: every shuffle actually changed the order
  });
  it('the fixed answer is the oracle\'s', () => {
    expect(base.meeting_commitment).toBe('a703d58b3c148c601c9eed219095cb0e4d3894c1d1b86f774d8ac077d6c5037a');
    expect(base.merkle_root).toBe('cbf6767e889c534353cdf2b7ad7b91845c98645b5207d36ab79cd54dc1665d49');
  });
});
