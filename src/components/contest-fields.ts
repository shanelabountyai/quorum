// The meeting's contests as the ballot form's fields (server side; a plain shape the client form can take).
import type { Meeting } from '@/tally/rules';
import type { ContestField } from './cast-form';

export const contestFields = (def: Meeting): ContestField[] =>
  [...def.contests]
    .sort((a, b) => (a.contest_id < b.contest_id ? -1 : a.contest_id > b.contest_id ? 1 : 0))
    .map((c) => (c.kind === 'ELECTION' ? { kind: 'ELECTION', contestId: c.contest_id, title: c.title, seats: c.seats, candidates: c.candidates } : { kind: 'RESOLUTION', contestId: c.contest_id, title: c.title }));
