// tally:verify (task 1.11; C-7). Is this receipt a leaf of the Merkle root recomputed from the published list?
//   npm run tally:verify -- --receipt <hex> [--published fixtures/published_ballots.csv]
// Reads nothing but the published list: no unit, owner, ballot or expected file. Exit 0 when the receipt is in the
// list and the recomputed root is printed; exit 1 when it is not. What a match proves (D-2): the ballot with this
// receipt was included as cast. What it does not: anything about who cast it — and a voter who shows the receipt
// AND the nonce proves how they voted, so this scheme is not coercion-resistant or receipt-free.
import { pathToFileURL } from 'node:url';
import { merkleRoot } from '../src/tally/commit';
import { toPublished } from '../src/tally/published';
import { readCsv } from './tally-fixtures';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function verifyReceipt(receipt: string, published: ReturnType<typeof toPublished>) {
  const root = merkleRoot(published.map((p) => p.receipt));
  const row = published.find((p) => p.receipt === receipt);
  return { root, found: row !== undefined, row, leaves: published.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const receipt = (arg('--receipt') ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(receipt)) {
    console.error('usage: npm run tally:verify -- --receipt <64 hex chars> [--published <csv>]');
    process.exit(2);
  }
  const path = arg('--published') ?? 'fixtures/published_ballots.csv';
  const v = verifyReceipt(receipt, toPublished(readCsv(path)));
  console.log(`published list ${path}: ${v.leaves} receipts`);
  console.log(`merkle_root ${v.root} (recomputed: leaves SHA-256(receipt) sorted, parents SHA-256(left+right), odd node carried up)`);
  if (v.found) {
    console.log(`receipt ${receipt}: IN THE ROOT — ballot ${v.row!.ballot_id}, ${v.row!.status}${v.row!.code ? ` ${v.row!.code}` : ''}`);
    console.log('This proves the ballot was included as cast. It does not hide how you voted from anyone you show this receipt and your nonce to (D-2).');
    process.exit(0);
  }
  console.log(`receipt ${receipt}: NOT IN THE PUBLISHED LIST — no leaf matches`);
  process.exit(1);
}
