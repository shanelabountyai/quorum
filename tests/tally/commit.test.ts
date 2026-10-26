// GT-01..GT-05 and GT-20 (brief §9): canonical JSON, receipt, Merkle root, commitments. The two hash constants
// were checked with `sha256sum` when the brief was written; nothing here is re-derived from the oracle.
import { describe, expect, it } from 'vitest';
import { CanonicalError, canonicalJson, quoteAscii, sha256Hex } from '../../src/tally/canonical';
import { canonicalChoices, contestCommitment, meetingCommitment, merkleRoot, receiptFor } from '../../src/tally/commit';

const R1 = 'd7c74b79b185da57e77d7125fe65cf1e87d4000b19758471dd5220069311a4b9';

describe('canonical JSON (C-1, task 1.3)', () => {
  it('GT-01 sorted keys, sorted candidate list, no whitespace', () => {
    expect(canonicalChoices({ R1: 'YES', E1: ['C-02', 'C-01'] })).toBe('{"E1":["C-01","C-02"],"R1":"YES"}');
  });
  it('matches Python json.dumps(ensure_ascii=True) escaping', () => {
    expect(quoteAscii('a"b\\c\n\t§—😀\u007f')).toBe('"a\\"b\\\\c\\n\\t\\u00a7\\u2014\\ud83d\\ude00\\u007f"');
    expect(canonicalJson({ b: [1, null, true, false], a: { z: 'x', y: [] } })).toBe('{"a":{"y":[],"z":"x"},"b":[1,null,true,false]}');
  });
  it('refuses floats, undefined and bigint', () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow(CanonicalError);
    expect(() => canonicalJson({ a: undefined })).toThrow(CanonicalError);
    expect(() => canonicalJson(10n)).toThrow(CanonicalError);
    expect(() => canonicalJson(NaN)).toThrow(CanonicalError);
  });
  it('does not sort a list unless every item is a string (C-1)', () => {
    expect(canonicalChoices({ E: ['b', 1] as never })).toBe('{"E":["b",1]}');
  });
});

describe('receipt and Merkle root (C-2, C-3)', () => {
  it('GT-02 receipt = SHA-256(ballot_id|nonce|canonical)', () => {
    expect(receiptFor('B-001', '0'.repeat(31) + '1', { R1: 'YES', E1: ['C-02', 'C-01'] })).toBe(R1);
  });
  it('GT-03 root of no receipts is SHA-256("")', () => {
    expect(merkleRoot([])).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('GT-04 root of one receipt is SHA-256(receipt)', () => {
    expect(merkleRoot([R1])).toBe('bbfa71fac1a53fab6bb8c92e6421f924e0364fa57f4f94eb1fa662dcb4fb1825');
    expect(merkleRoot([R1])).toBe(sha256Hex(R1));
  });
  it('GT-05 root of three receipts is SHA-256(SHA-256(l1+l2)+l3), order-independent', () => {
    const [l1, l2, l3] = ['aa', 'bb', 'cc'].map(sha256Hex).sort();
    expect(merkleRoot(['aa', 'bb', 'cc'])).toBe(sha256Hex(sha256Hex(l1! + l2!) + l3!));
    expect(merkleRoot(['cc', 'aa', 'bb'])).toBe(merkleRoot(['aa', 'bb', 'cc']));
  });
});

describe('commitments (C-4, C-5)', () => {
  it('GT-20 the commitment binds the totals; the meeting commitment joins in contest-id order', () => {
    const root = merkleRoot(['aa']);
    const tot = { units: { YES: 1, NO: 1, ABSTAIN: 1 }, bps: { YES: 1000, NO: 2000, ABSTAIN: 4000 } };
    const tot2 = { units: { YES: 2, NO: 1, ABSTAIN: 0 }, bps: tot.bps };
    expect(contestCommitment(root, 'R', tot)).toBe(contestCommitment(root, 'R', tot));
    expect(contestCommitment(root, 'R', tot2)).not.toBe(contestCommitment(root, 'R', tot));
    expect(contestCommitment(root, 'R', tot)).toBe(sha256Hex(`${root}|R|{"bps":{"ABSTAIN":4000,"NO":2000,"YES":1000},"units":{"ABSTAIN":1,"NO":1,"YES":1}}`));
    expect(meetingCommitment({ R: 'r', E: 'e' })).toBe(sha256Hex('e|r'));
  });
});
