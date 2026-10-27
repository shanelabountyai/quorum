// Task 1.4: the rules JSON and contests as a closed schema (D-9, D-14, D-16, D-17; brief §7). Anything the
// vocabulary does not name is RULES_INVALID with the field path — a new basis, mode or depth is a decisions
// entry and a golden case, not a looser schema. Shares summing to total_share_bps is checked where the shares
// are (tally.ts), because it needs the roster as of the record date.
import { z } from 'zod';
import { DUPLICATE_UNIT_RULES, ELECTION_MODES, QUORUM_BASES, RESOLUTION_BASES } from './codes';
import { RulesInvalid } from './errors';
import { CALENDAR_DAY_RE, TIMESTAMP_RE, type CalendarDay, type Timestamp } from './time';

const timestampSchema = z.string().regex(TIMESTAMP_RE, 'expected YYYY-MM-DDTHH:MM:SS').transform((s) => s as Timestamp);
const calendarDaySchema = z.string().regex(CALENDAR_DAY_RE, 'expected YYYY-MM-DD').transform((s) => s as CalendarDay);
const positiveInt = z.number().int().positive();

export const rulesSchema = z
  .object({
    timezone_label: z.string().min(1),
    record_date: calendarDaySchema,
    open_at: timestampSchema,
    close_at: timestampSchema,
    quorum: z.object({ basis: z.enum(QUORUM_BASES), threshold_bps: z.number().int().min(0).max(10000) }).strict(),
    proxy_max_depth: z.literal(1), // D-14: the only implemented value
    proxy_holder_must_be_member: z.boolean(),
    delinquency_suspends_voting: z.boolean(),
    duplicate_unit_rule: z.enum(DUPLICATE_UNIT_RULES),
    total_share_bps: positiveInt,
  })
  .strict()
  .refine((r) => r.open_at < r.close_at, { message: 'open_at must be before close_at', path: ['close_at'] });

const candidateSchema = z.object({ id: z.string().min(1), name: z.string() }).strict();

export const electionSchema = z
  .object({
    contest_id: z.string().min(1),
    kind: z.literal('ELECTION'),
    title: z.string(),
    seats: positiveInt,
    mode: z.enum(ELECTION_MODES),
    candidates: z.array(candidateSchema).min(2),
  })
  .strict()
  .refine((c) => c.candidates.length > c.seats, { message: 'candidates must exceed seats', path: ['candidates'] })
  .refine((c) => new Set(c.candidates.map((x) => x.id)).size === c.candidates.length, { message: 'duplicate candidate id', path: ['candidates'] });

export const resolutionSchema = z
  .object({
    contest_id: z.string().min(1),
    kind: z.literal('RESOLUTION'),
    title: z.string(),
    basis: z.enum(RESOLUTION_BASES),
  })
  .strict();

export const contestSchema = z.discriminatedUnion('kind', [electionSchema, resolutionSchema]);

export const meetingSchema = z
  .object({
    meeting_id: z.string().min(1),
    title: z.string().default(''),
    rules: rulesSchema,
    contests: z.array(contestSchema).min(1),
  })
  .strict()
  .refine((m) => new Set(m.contests.map((c) => c.contest_id)).size === m.contests.length, { message: 'duplicate contest_id', path: ['contests'] });

export type Rules = z.infer<typeof rulesSchema>;
export type Election = z.infer<typeof electionSchema>;
export type Resolution = z.infer<typeof resolutionSchema>;
export type Contest = z.infer<typeof contestSchema>;
export type Meeting = z.infer<typeof meetingSchema>;

/** Parse `meeting.json`; the first schema miss is a RulesInvalid naming the dotted field path. */
export function parseMeeting(input: unknown): Meeting {
  const r = meetingSchema.safeParse(input);
  if (r.success) return r.data;
  const issue = r.error.issues[0]!;
  const field = issue.path.length ? issue.path.map(String).join('.') : '(root)';
  const detail = issue.code === 'unrecognized_keys' ? `unknown key ${(issue as { keys: string[] }).keys.join(', ')}` : issue.message;
  throw new RulesInvalid(field, detail);
}
