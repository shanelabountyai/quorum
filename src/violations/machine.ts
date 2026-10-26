// D-22: the violation workflow's rules, pure. The machine is data (transitions.json); this module validates it once
// against the closed vocabulary and answers one question: may a violation in state A move to state B? Anything
// the table does not list is TRANSITION_INVALID — there is no free-text status anywhere.
import table from './transitions.json';

export const VIOLATION_STATES = ['NOTICE_SENT', 'HEARING_SCHEDULED', 'CONTINUED', 'FINE_ASSESSED', 'DISMISSED'] as const;
export type ViolationState = (typeof VIOLATION_STATES)[number];

export class TransitionInvalid extends Error {
  readonly code = 'TRANSITION_INVALID' as const;
  constructor(readonly from: ViolationState | null, readonly to: string) {
    super(`TRANSITION_INVALID: ${from ?? '(new)'} → ${to}`);
    this.name = 'TransitionInvalid';
  }
}

const isState = (s: unknown): s is ViolationState => typeof s === 'string' && (VIOLATION_STATES as readonly string[]).includes(s);

/** The table, checked: its states are exactly VIOLATION_STATES and every edge names one. Throws at import on a bad table. */
export const MACHINE = (() => {
  const states = table.states;
  if (states.length !== VIOLATION_STATES.length || !states.every((s, i) => s === VIOLATION_STATES[i])) throw new Error('transitions.json states differ from VIOLATION_STATES');
  if (!isState(table.initial)) throw new Error(`transitions.json initial ${table.initial} is not a state`);
  const edges = new Map<ViolationState, ViolationState[]>();
  for (const s of VIOLATION_STATES) {
    const to = (table.transitions as Record<string, string[]>)[s];
    if (!to || !to.every(isState)) throw new Error(`transitions.json: bad edges from ${s}`);
    edges.set(s, to as ViolationState[]);
  }
  return { initial: table.initial as ViolationState, edges };
})();

export const isTerminal = (s: ViolationState) => MACHINE.edges.get(s)!.length === 0;
export const nextStates = (s: ViolationState): readonly ViolationState[] => MACHINE.edges.get(s)!;

/** The only door: `to` from `from` (null = a new violation), or TRANSITION_INVALID. */
export function transition(from: ViolationState | null, to: string): ViolationState {
  if (!isState(to)) throw new TransitionInvalid(from, to);
  if (from === null) {
    if (to !== MACHINE.initial) throw new TransitionInvalid(from, to);
    return to;
  }
  if (!MACHINE.edges.get(from)!.includes(to)) throw new TransitionInvalid(from, to);
  return to;
}
