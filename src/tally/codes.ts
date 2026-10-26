// The closed vocabularies (docs/domain-brief.md §4, §6, §7; D-11, D-12, D-16, D-17). Every list the engine
// reads a status or code from is derived from these tuples, so adding a code is one edit here plus a
// decisions entry and a golden case — never a string literal somewhere else.

/** Ballot-level reject codes in precedence order (B-1..B-3, P-1..P-8, E-6..E-9). First hit wins. */
export const BALLOT_REJECT_CODES = [
  'UNKNOWN_UNIT', // B-1
  'EARLY', // B-2
  'LATE', // B-3
  'PROXY_UNKNOWN', // P-1
  'PROXY_UNIT_MISMATCH', // P-2
  'PROXY_GRANTOR_NOT_OWNER', // P-3
  'PROXY_LATE', // P-4
  'PROXY_REVOKED', // P-5
  'PROXY_CHAIN', // P-6
  'PROXY_HOLDER_MISMATCH', // P-7
  'PROXY_HOLDER_NOT_MEMBER', // P-8
  'NOT_OWNER', // E-6
  'INELIGIBLE_DELINQUENT', // E-7
  'DUPLICATE_UNIT', // E-8
  'PROXY_SUPERSEDED_BY_OWNER', // E-9: applied to the EARLIER counted proxy ballot when the owner later casts directly (D-26)
] as const;
export type BallotRejectCode = (typeof BALLOT_REJECT_CODES)[number];

export type BallotStatus = 'COUNTED' | 'REJECTED';

/** Selection-level codes (S-2..S-5): void one contest on one counted ballot, never the ballot. */
export const SELECTION_VOID_CODES = ['INVALID_CHOICE', 'UNKNOWN_CANDIDATE', 'DUPLICATE_CANDIDATE', 'OVERVOTE'] as const;
export type SelectionVoidCode = (typeof SELECTION_VOID_CODES)[number];
export type SelectionStatus = 'VOTED' | 'BLANK' | 'VOID';

/** T-1..T-6, in the brief's order; the by-basis table prints them in this order. */
export const RESOLUTION_BASES = [
  'MAJORITY_OF_VOTES_CAST', // T-1  yes*2 > yes+no (abstain excluded)
  'MAJORITY_OF_UNITS_REPRESENTED', // T-2  yes*2 > units represented (abstain counts against)
  'MAJORITY_OF_ALL_UNITS', // T-3  yes*2 > total units
  'TWO_THIRDS_OF_VOTES_CAST', // T-4  yes+no > 0 and yes*3 >= 2*(yes+no)
  'MAJORITY_OF_WEIGHTED_SHARES_CAST', // T-5  yes_bps*2 > yes_bps+no_bps
  'TWO_THIRDS_OF_ALL_WEIGHTED_SHARES', // T-6  yes_bps*3 >= 2*total_share_bps
] as const;
export type ResolutionBasis = (typeof RESOLUTION_BASES)[number];

export const ELECTION_MODES = ['UNITS', 'WEIGHTED'] as const;
export type ElectionMode = (typeof ELECTION_MODES)[number];

export const RESOLUTION_CHOICES = ['YES', 'NO', 'ABSTAIN'] as const;
export type ResolutionChoice = (typeof RESOLUTION_CHOICES)[number];

export const QUORUM_BASES = ['UNITS', 'WEIGHTED'] as const;
export type QuorumBasis = (typeof QUORUM_BASES)[number];

export const DUPLICATE_UNIT_RULES = ['FIRST_VALID_CAST_WINS'] as const;

export type ContestResult = 'ELECTED' | 'TIE_UNRESOLVED' | 'PASSED' | 'FAILED' | 'NO_QUORUM';

export const otherMode = (mode: ElectionMode): ElectionMode => (mode === 'UNITS' ? 'WEIGHTED' : 'UNITS');
