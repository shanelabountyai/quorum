// D-22 (task 3.6): the state machine as data. Every legal transition is allowed; every other pair of states — and
// any name outside the vocabulary — is TRANSITION_INVALID. Pure: no database.
import { describe, expect, it } from 'vitest';
import { isTerminal, MACHINE, nextStates, transition, TransitionInvalid, VIOLATION_STATES, type ViolationState } from '@/violations/machine';

const LEGAL: [ViolationState, ViolationState][] = [
  ['NOTICE_SENT', 'HEARING_SCHEDULED'],
  ['NOTICE_SENT', 'DISMISSED'],
  ['HEARING_SCHEDULED', 'FINE_ASSESSED'],
  ['HEARING_SCHEDULED', 'DISMISSED'],
  ['HEARING_SCHEDULED', 'CONTINUED'],
  ['CONTINUED', 'HEARING_SCHEDULED'],
];

describe('violation transitions (D-22)', () => {
  it('a new record starts at NOTICE_SENT and nowhere else', () => {
    expect(MACHINE.initial).toBe('NOTICE_SENT');
    expect(transition(null, 'NOTICE_SENT')).toBe('NOTICE_SENT');
    for (const s of VIOLATION_STATES.filter((s) => s !== 'NOTICE_SENT')) expect(() => transition(null, s)).toThrow(TransitionInvalid);
  });
  it.each(LEGAL)('%s → %s is allowed', (from, to) => {
    expect(transition(from, to)).toBe(to);
  });
  const illegal = VIOLATION_STATES.flatMap((from) => VIOLATION_STATES.map((to) => [from, to] as const)).filter(([f, t]) => !LEGAL.some(([a, b]) => a === f && b === t));
  it.each(illegal)('%s → %s is TRANSITION_INVALID', (from, to) => {
    expect(() => transition(from, to)).toThrow(TransitionInvalid);
    expect(() => transition(from, to)).toThrow(/^TRANSITION_INVALID/);
  });
  it('the table has exactly the six legal edges, and FINE_ASSESSED and DISMISSED are final', () => {
    expect(illegal).toHaveLength(25 - 6);
    expect(VIOLATION_STATES.filter(isTerminal)).toEqual(['FINE_ASSESSED', 'DISMISSED']);
    expect(nextStates('HEARING_SCHEDULED')).toEqual(['FINE_ASSESSED', 'DISMISSED', 'CONTINUED']);
  });
  it('a free-text status is refused', () => {
    expect(() => transition('NOTICE_SENT', 'CLOSED')).toThrow(TransitionInvalid);
    expect(() => transition('NOTICE_SENT', 'hearing_scheduled')).toThrow(TransitionInvalid);
  });
});
