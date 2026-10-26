// Task 1.7: receipts and commitments, C-1..C-5 (brief §8; D-2, D-18). Hashes a board member can recompute with
// `sha256sum`. What this proves and does not prove: a receipt in the root proves the ballot was included as
// cast; a recount from the published list proves the totals; nothing here hides how a voter voted from someone
// the voter shows the receipt and nonce to (not coercion-resistant, not receipt-free).
import { canonicalJson, type Json, sha256Hex, sortedStrings } from './canonical';

/** C-1: sorted keys, no whitespace, ASCII; a list value is sorted when every item is a string. */
export function canonicalChoices(choices: Record<string, Json>): string {
  const out: Record<string, Json> = {};
  for (const k of sortedStrings(Object.keys(choices))) {
    const v = choices[k]!;
    out[k] = Array.isArray(v) && v.every((x) => typeof x === 'string') ? sortedStrings(v as string[]) : v;
  }
  return canonicalJson(out);
}

/** C-2: SHA-256(ballot_id | nonce | canonical choices), lowercase hex. */
export const receiptFor = (ballotId: string, nonce: string, choices: Record<string, Json>): string =>
  sha256Hex(`${ballotId}|${nonce}|${canonicalChoices(choices)}`);

/**
 * C-3: leaves SHA-256(receipt) sorted ascending; parent SHA-256(left_hex + right_hex); an odd node is carried up
 * unchanged; the root of nothing is SHA-256(""). Sorting the leaves is what makes the root order-independent.
 */
export function merkleRoot(receipts: readonly string[]): string {
  let level = sortedStrings(receipts.map(sha256Hex));
  if (level.length === 0) return sha256Hex('');
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = level[i + 1];
      next.push(right === undefined ? level[i]! : sha256Hex(level[i]! + right));
    }
    level = next;
  }
  return level[0]!;
}

/** C-4: SHA-256(root | contest_id | canonical totals JSON). */
export const contestCommitment = (root: string, contestId: string, totals: Json): string =>
  sha256Hex(`${root}|${contestId}|${canonicalJson(totals)}`);

/** C-5: SHA-256 of the contest commitments joined by "|" in contest-id order. */
export const meetingCommitment = (commitments: Readonly<Record<string, string>>): string =>
  sha256Hex(
    sortedStrings(Object.keys(commitments))
      .map((c) => commitments[c]!)
      .join('|'),
  );
