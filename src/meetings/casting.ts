// Task 3.2: who casts, from a page (D-39). A member casts as the roster owner their account is linked to (OwnerLink,
// written on invite acceptance), directly for a unit or via a proxy they hold; a board/manager user casts at the
// desk for any owner on the roster. Either way the engine judges the ballot exactly as it judges a fixture ballot
// (castInTx), castAt is the meeting's wall clock (clock.ts), and the entering user goes into the sealed link only.
// The audit row says a ballot was cast in this meeting through this channel — never which owner, unit or ballot.
import { randomBytes } from 'node:crypto';
import { notFound } from 'next/navigation';
import { audit } from '@/core/audit';
import { Refused } from '@/core/errors';
import type { Json } from '@/tally/canonical';
import type { BallotRejectCode, BallotStatus } from '@/tally/codes';
import type { Meeting } from '@/tally/rules';
import { meetingInOrg } from './admin';
import { castInTx } from './cast';
import { wallClock } from './clock';
import { asApp, type Tx } from './db';
import { linkedOwner } from './owners';

export type CastChannel = 'self' | 'desk';

/**
 * The ballot form's fields as choices: `c:<election>:<candidate>` present = selected; `c:<resolution>` = YES | NO |
 * ABSTAIN, or empty for no selection. An empty election or resolution is simply absent (S-1 BLANK). Only the
 * contest's own candidates are read; the engine still judges the count (an overvote is OVERVOTE, S-5).
 */
export function choicesFromForm(def: Meeting, fields: Record<string, unknown>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const c of def.contests) {
    if (c.kind === 'ELECTION') {
      const picked = c.candidates.filter((cand) => fields[`c:${c.contest_id}:${cand.id}`] !== undefined && fields[`c:${c.contest_id}:${cand.id}`] !== '').map((cand) => cand.id);
      if (picked.length) out[c.contest_id] = picked;
    } else {
      const v = fields[`c:${c.contest_id}`];
      if (typeof v === 'string' && v !== '') out[c.contest_id] = v; // anything but YES/NO/ABSTAIN is INVALID_CHOICE (S-2), judged by the engine
    }
  }
  return out;
}

export type CastReceipt = { ballotId: string; receipt: string; nonce: string; status: BallotStatus; code: BallotRejectCode | ''; castAt: string; meetingId: string };

type Who = { orgId: string; userId: string };

async function castAs(tx: Tx, who: Who, meetingRowId: string, unitRef: string, castBy: string, viaProxyId: string, fields: Record<string, unknown>, channel: CastChannel): Promise<CastReceipt> {
  const head = await meetingInOrg(tx, who.orgId, meetingRowId);
  if (head.closedAt) throw new Refused('This meeting is closed; no ballot can be recorded.');
  const castAt = wallClock(head.definition.rules.timezone_label);
  const nonce = randomBytes(16).toString('hex');
  const r = await castInTx(tx, { meetingRowId: head.id, unitId: unitRef, castBy, viaProxyId, castAt, choices: choicesFromForm(head.definition, fields), enteredById: who.userId }, nonce);
  await audit({ orgId: who.orgId, userId: who.userId }, 'ballot.cast', { targetType: 'meeting', targetId: head.id, data: { channel } }, tx);
  return { ballotId: r.ballotId, receipt: r.receipt, nonce: r.nonce, status: r.status, code: r.code, castAt, meetingId: head.meetingId };
}

async function requireLink(tx: Tx, who: Who) {
  const owner = await linkedOwner(tx, who.orgId, who.userId);
  if (!owner) throw new Refused('Your account is not linked to an owner on the roster. Accept an invite sent to the email the association has on file for you, or vote at the desk.');
  return owner;
}

/** A member's own direct ballot for one unit (O-7: one ballot per unit). The engine decides NOT_OWNER if it is not theirs. */
export const castOwn = (who: Who, input: { meetingRowId: string; unitRowId: string; fields: Record<string, unknown> }) =>
  asApp(async (tx) => {
    await meetingInOrg(tx, who.orgId, input.meetingRowId);
    const unit = await tx.unit.findFirst({ where: { id: input.unitRowId, orgId: who.orgId } });
    if (!unit) notFound();
    const owner = await requireLink(tx, who);
    return castAs(tx, who, input.meetingRowId, unit.unitId, owner.ownerId, '', input.fields, 'self');
  });

/** A member's ballot as a proxy holder; the engine applies P-1..P-8 to it like any other. */
export const castByProxy = (who: Who, input: { meetingRowId: string; proxyRowId: string; fields: Record<string, unknown> }) =>
  asApp(async (tx) => {
    await meetingInOrg(tx, who.orgId, input.meetingRowId);
    const proxy = await tx.proxy.findFirst({ where: { id: input.proxyRowId, meetingId: input.meetingRowId, meeting: { orgId: who.orgId } }, include: { grantorUnit: true } });
    if (!proxy) notFound();
    const owner = await requireLink(tx, who);
    return castAs(tx, who, input.meetingRowId, proxy.grantorUnit.unitId, owner.ownerId, proxy.proxyId, input.fields, 'self');
  });

/** The desk (board/manager): a direct ballot for an owner chosen from the roster. The operator is sealed, not audited by name. */
export const castAtDesk = (who: Who, input: { meetingRowId: string; ownerRowId: string; unitRowId: string; fields: Record<string, unknown> }) =>
  asApp(async (tx) => {
    await meetingInOrg(tx, who.orgId, input.meetingRowId);
    const [owner, unit] = await Promise.all([tx.owner.findFirst({ where: { id: input.ownerRowId, orgId: who.orgId } }), tx.unit.findFirst({ where: { id: input.unitRowId, orgId: who.orgId } })]);
    if (!owner || !unit) notFound();
    return castAs(tx, who, input.meetingRowId, unit.unitId, owner.ownerId, '', input.fields, 'desk');
  });

/** The desk: a proxy ballot, cast for the proxy's holder (the person presenting the form). */
export const castAtDeskByProxy = (who: Who, input: { meetingRowId: string; proxyRowId: string; fields: Record<string, unknown> }) =>
  asApp(async (tx) => {
    await meetingInOrg(tx, who.orgId, input.meetingRowId);
    const proxy = await tx.proxy.findFirst({ where: { id: input.proxyRowId, meetingId: input.meetingRowId, meeting: { orgId: who.orgId } }, include: { grantorUnit: true, holderOwner: true } });
    if (!proxy) notFound();
    return castAs(tx, who, input.meetingRowId, proxy.grantorUnit.unitId, proxy.holderOwner.ownerId, proxy.proxyId, input.fields, 'desk');
  });
