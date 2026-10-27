// Task 3.1: the board's side of a meeting — create it from meeting.json, take proxies (bulk and one at a time, with
// the proxy-level code the engine will apply shown at intake), read the live quorum from the current labels, and
// close it on the meeting's wall clock. All as the application role; every write checks the archive first (D-43).
import { randomBytes } from 'node:crypto';
import { notFound } from 'next/navigation';
import { Refused } from '@/core/errors';
import { audit } from '@/core/audit';
import { queueNotice, queuedFor } from '@/notices/notices';
import { isMember, ownersOfUnit, shareBps } from '@/tally/asof';
import type { BallotRejectCode } from '@/tally/codes';
import { quorumStatus, type QuorumStatus } from '@/tally/quorum';
import { parseMeeting, type Meeting } from '@/tally/rules';
import { resultsFromStored } from '@/tally/tally';
import { timestamp, type Timestamp } from '@/tally/time';
import type { Proxy } from '@/tally/types';
import { assertNotArchived } from './archive';
import { wallClock, isTimeZone } from './clock';
import { closeInTx, type CloseResult } from './close';
import { asApp, type Tx } from './db';
import { proxiesFromCsv } from './import';
import { storedBallots } from './labels';
import { ensureMeeting, loadProxies, type LoadReport } from './load';
import { readMeeting, readProxies, readRoster, type MeetingHead } from './roster';

/** The meeting row, only if it belongs to `orgId`; otherwise notFound — "not yours" is "not found" (INV-04). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A row id from a URL or a form that is not a uuid names no row: notFound, never a database error. */
export const assertUuid = (id: string) => {
  if (!UUID_RE.test(id)) notFound();
};

export async function meetingInOrg(tx: Tx, orgId: string, meetingRowId: string): Promise<MeetingHead> {
  assertUuid(meetingRowId);
  const m = await tx.meeting.findFirst({ where: { id: meetingRowId, orgId }, select: { id: true } });
  if (!m) notFound();
  return readMeeting(tx, m.id);
}

/** Parse pasted meeting.json: JSON, then the engine's closed schema, then a zone Intl knows. */
export function parseMeetingText(text: string): Meeting {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Refused('The meeting definition is not JSON.');
  }
  const m = parseMeeting(raw);
  if (!isTimeZone(m.rules.timezone_label)) throw new Refused(`rules.timezone_label "${m.rules.timezone_label}" is not a time zone this server knows (e.g. America/Chicago).`);
  return m;
}

export const createMeeting = (orgId: string, text: string) =>
  asApp(async (tx) => {
    const definition = parseMeetingText(text);
    const row = await ensureMeeting(tx, orgId, definition, randomBytes(16).toString('hex'));
    return row;
  });

export const importProxies = (orgId: string, meetingRowId: string, text: string): Promise<LoadReport> =>
  asApp(async (tx) => {
    const head = await meetingInOrg(tx, orgId, meetingRowId);
    if (head.closedAt) throw new Refused('This meeting is closed; proxies can no longer be recorded.');
    return loadProxies(tx, orgId, head.id, proxiesFromCsv(text));
  });

/**
 * The proxy-level part of the §4 precedence, judged at intake from the proxy alone: P-3 (the grantor is not an
 * owner of the unit as of the record date), P-4's first half (received at or after close), P-8 (the holder is not a
 * member). The rest (P-4 after the ballot, P-5, P-6, P-7) depend on the ballot and are judged at cast time.
 */
export function intakeCode(p: Proxy, rules: Meeting['rules'], ownerships: Parameters<typeof ownersOfUnit>[0]): BallotRejectCode | '' {
  if (!ownersOfUnit(ownerships, p.grantor_unit, rules.record_date).has(p.grantor_owner)) return 'PROXY_GRANTOR_NOT_OWNER';
  if (p.received_at >= rules.close_at) return 'PROXY_LATE';
  if (rules.proxy_holder_must_be_member && !isMember(ownerships, p.holder_owner, rules.record_date)) return 'PROXY_HOLDER_NOT_MEMBER';
  return '';
}

export type IntakeInput = { meetingRowId: string; grantorUnitRowId: string; grantorOwnerRowId: string; holderOwnerRowId: string; receivedAt?: string };

/** One paper proxy recorded (append-only), with the code a ballot cast on it would get from the proxy alone. */
export const intakeProxy = (orgId: string, input: IntakeInput) =>
  asApp(async (tx) => {
    const head = await meetingInOrg(tx, orgId, input.meetingRowId);
    await tx.$queryRaw`SELECT 1 FROM quorum_lock_meeting(${head.id}::uuid)`; // proxy ids are numbered under the meeting lock
    if (head.closedAt) throw new Refused('This meeting is closed; proxies can no longer be recorded.');
    await assertNotArchived(tx, orgId);
    const [unit, grantor, holder] = await Promise.all([
      tx.unit.findFirst({ where: { id: input.grantorUnitRowId, orgId } }),
      tx.owner.findFirst({ where: { id: input.grantorOwnerRowId, orgId } }),
      tx.owner.findFirst({ where: { id: input.holderOwnerRowId, orgId } }),
    ]);
    if (!unit || !grantor || !holder) notFound();
    const rules = head.definition.rules;
    const receivedAt: Timestamp = input.receivedAt ? timestamp(input.receivedAt, 'receivedAt') : wallClock(rules.timezone_label);
    const n = await tx.proxy.count({ where: { meetingId: head.id } });
    const proxyId = `P-${String(n + 1).padStart(3, '0')}`;
    const proxy: Proxy = { proxy_id: proxyId, grantor_unit: unit.unitId, grantor_owner: grantor.ownerId, holder_owner: holder.ownerId, received_at: receivedAt, revoked_at: '' };
    const roster = await readRoster(tx, orgId);
    const code = intakeCode(proxy, rules, roster.ownerships);
    await tx.proxy.create({ data: { meetingId: head.id, proxyId, grantorUnitId: unit.id, grantorOwnerId: grantor.id, holderOwnerId: holder.id, receivedAt } });
    return { proxyId, code, receivedAt };
  });

export type LiveQuorum = { quorum: QuorumStatus; received: number; counted: number; rejected: number; totalUnits: number; totalBps: number };

/** Quorum as of now, from the current labels (D-31) and the roster's totals as of the record date. */
export async function liveQuorumInTx(tx: Tx, head: MeetingHead): Promise<LiveQuorum> {
  const roster = await readRoster(tx, head.orgId);
  const rules = head.definition.rules;
  let totalBps = 0;
  for (const u of roster.units) totalBps += shareBps(roster.shares, u.unit_id, rules.record_date);
  const results = resultsFromStored(head.definition, await storedBallots(tx, head.id));
  const counted = results.filter((r) => r.status === 'COUNTED').length;
  return { quorum: quorumStatus(rules, roster.units.length, totalBps, results), received: results.length, counted, rejected: results.length - counted, totalUnits: roster.units.length, totalBps };
}

/** Close now, on the meeting's wall clock. Idempotent (closeInTx). */
export const closeMeetingNow = (orgId: string, meetingRowId: string): Promise<CloseResult> =>
  asApp(async (tx) => {
    const head = await meetingInOrg(tx, orgId, meetingRowId);
    return closeInTx(tx, head.id, wallClock(head.definition.rules.timezone_label));
  });

export const proxiesOf = (tx: Tx, meetingRowId: string) => readProxies(tx, meetingRowId);

/** The association's zone for "today" on the ledger, roster and violation pages: its latest meeting's timezone_label. */
export const DEFAULT_ZONE = 'America/Chicago';
export async function associationZone(tx: Tx, orgId: string): Promise<string> {
  const m = await tx.meeting.findFirst({ where: { orgId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  return m ? (await readMeeting(tx, m.id)).definition.rules.timezone_label : DEFAULT_ZONE;
}

/**
 * Task 3.7: the meeting notice — window, record date, agenda — queued once to every owner of record as of the record
 * date who has an email (QUEUED, never sent). A second call queues nothing and says how many are already queued.
 */
export const queueMeetingNotice = (who: { orgId: string; userId: string }, meetingRowId: string) =>
  asApp(async (tx) => {
    const head = await meetingInOrg(tx, who.orgId, meetingRowId);
    await assertNotArchived(tx, who.orgId);
    await tx.$queryRaw`SELECT 1 FROM quorum_lock_meeting(${head.id}::uuid)`;
    const already = await queuedFor(tx, who.orgId, 'meetingId', head.id);
    if (already) return { queued: 0, already };
    const r = head.definition.rules;
    const roster = await readRoster(tx, who.orgId);
    const ids = new Set<string>();
    for (const u of roster.units) for (const o of ownersOfUnit(roster.ownerships, u.unit_id, r.record_date)) ids.add(o);
    const owners = await tx.owner.findMany({ where: { orgId: who.orgId, ownerId: { in: [...ids] } }, orderBy: { ownerId: 'asc' } });
    const agenda = head.definition.contests.map((c) => `- ${c.contest_id} ${c.title}${c.kind === 'ELECTION' ? ` (elect ${c.seats})` : ` (${c.basis})`}`).join('\n');
    const body = `${head.definition.title || head.meetingId}\n\nVoting opens ${r.open_at} and closes ${r.close_at} (${r.timezone_label}). Record date ${r.record_date}: owners of record on that day may vote, one ballot per unit.\n\nAgenda:\n${agenda}`;
    const queued = await queueNotice(tx, who.orgId, owners.map((o) => ({ ownerId: o.ownerId, name: o.name, email: o.email })), `Notice of meeting ${head.meetingId}`, body, { meetingId: head.id });
    await audit({ orgId: who.orgId, userId: who.userId }, 'meeting.notice_queued', { targetType: 'meeting', targetId: head.id, data: { queued } }, tx);
    return { queued, already: 0 };
  });
