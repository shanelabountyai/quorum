// Task 2.4: the cast path. One transaction as the application role (D-33): lock the meeting row (D-35 g), run
// the Phase 1 ballot rules UNCHANGED against the live roster as of the record date and the unit's current
// counted ballot, generate the nonce (the only randomness, outside src/tally/), and hand every computed column
// to quorum_cast_ballot, the one function that may write a Ballot, its sealed link and its label (D-31, D-33).
// Returns the receipt and the nonce once; the nonce is never stored (C-2).
import { randomBytes } from 'node:crypto';
import { shareBps } from '@/tally/asof';
import { ballotRejectCode, buildRoster, type CountedUnits } from '@/tally/ballots';
import { canonicalJson, compareStrings, sha256Hex, type Json } from '@/tally/canonical';
import type { BallotRejectCode, BallotStatus } from '@/tally/codes';
import { canonicalChoices, receiptFor } from '@/tally/commit';
import { timestamp, type Timestamp } from '@/tally/time';
import type { Ballot } from '@/tally/types';
import { assertNotArchived } from './archive';
import { asApp, type Tx } from './db';
import { CastOutOfOrder, MeetingClosed } from './errors';
import { currentLabels } from './labels';
import { readMeeting, readProxies, readRoster } from './roster';

export type CastInput = {
  meetingRowId: string;
  /** the public ballot id; minted at random (D-40) under the meeting lock when absent — only the fixture replay supplies one */
  ballotId?: string;
  /** ids as cast: a unit that is not on the roster is still received (UNKNOWN_UNIT) and sealed by name */
  unitId: string;
  castBy: string;
  /** '' for a direct ballot */
  viaProxyId: string;
  castAt: Timestamp;
  choices: Record<string, Json>;
  /** D-39 (b): the user who entered it (the owner's linked user, or the desk operator); sealed with the link, never audited by name */
  enteredById?: string | null;
};

export type CastResult = {
  rowId: string;
  ballotId: string;
  receipt: string;
  nonce: string;
  status: BallotStatus;
  code: BallotRejectCode | '';
  /** E-9: the row id of the proxy ballot this direct cast superseded, when it did */
  supersededRowId: string | null;
};

/** D-40: a public ballot id is "B-" + 12 lowercase hex chars (48 bits from crypto). Lexical order = numeric order. */
export const BALLOT_ID_RE = /^B-[0-9a-f]{12}$/;
const ID_TOP = (1n << 48n) - 1n;

/**
 * A fresh random id (D-40). When the same unit already has a ballot at this instant, the id is drawn uniformly
 * (up to a negligible modulo bias) from the ids that sort after the highest of them, so B-4's (cast_at, ballot_id)
 * order stays the arrival order for that unit — the only order the labels depend on. Refuses only when no id is left.
 */
export function mintBallotId(mustExceed: string | null, draw: () => string = () => randomBytes(6).toString('hex')): string {
  const raw = draw();
  if (!/^[0-9a-f]{12}$/.test(raw)) throw new Error(`minted ballot id B-${raw} is not B-<12 hex> (D-40)`);
  const r = BigInt(`0x${raw}`);
  if (mustExceed === null) return `B-${raw}`;
  if (!BALLOT_ID_RE.test(mustExceed)) throw new CastOutOfOrder('(a minted id)', `${mustExceed}, which is not a B-<12 hex> id`);
  const lo = BigInt(`0x${mustExceed.slice(2)}`) + 1n;
  if (lo > ID_TOP) throw new CastOutOfOrder('(a minted id)', `${mustExceed}: no id sorts after it (D-40)`);
  return `B-${(lo + (r % (ID_TOP - lo + 1n))).toString(16).padStart(12, '0')}`;
}

/** D-20: the unit's name under the meeting's salt; deterministic, so duplicate detection needs no sealed link. */
export const unitHashFor = (meetingRowId: string, unitRef: string, salt: string) => sha256Hex(`${meetingRowId}|${unitRef}|${salt}`);

export const castBallot = (input: CastInput): Promise<CastResult> => asApp((tx) => castInTx(tx, input, randomBytes(16).toString('hex')));

/** The replay's entry: the fixture supplies the nonce so the receipts equal expected_ballots.csv. Not for product use. */
export const castBallotWithNonce = (input: CastInput, nonce: string): Promise<CastResult> => asApp((tx) => castInTx(tx, input, nonce));

export async function castInTx(tx: Tx, input: CastInput, nonce: string): Promise<CastResult> {
  if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error('nonce must be 128 bits as 32 hex chars (C-2)');
  // 1. the lock: held until this transaction ends, so two casts for one unit are evaluated one after the other
  const [lock] = await tx.$queryRaw<{ closedAt: string | null }[]>`SELECT "closedAt" FROM quorum_lock_meeting(${input.meetingRowId}::uuid)`;
  if (lock?.closedAt) throw new MeetingClosed('P0001', `meeting ${input.meetingRowId} is closed; no ballot can be recorded (D-34)`);
  const head = await readMeeting(tx, input.meetingRowId);
  await assertNotArchived(tx, head.orgId); // D-43
  const rules = head.definition.rules;
  // D-36: castAt is monotone per meeting, so the stored set is in B-4 order and the labels written here are the
  // ones evaluateBallots would compute over the same set. A ballot from the past is refused before any read of it.
  const castAt = timestamp(input.castAt, 'castAt'); // validated before it is compared with anything
  const [latest] = await tx.$queryRaw<{ at: string | null }[]>`SELECT max("castAt") AS at FROM "Ballot" WHERE "meetingId" = ${head.id}::uuid`;
  if (latest?.at && castAt < latest.at) throw new CastOutOfOrder(castAt, latest.at);
  // D-40 amends D-36: ids are random. The labels depend on order only WITHIN a unit (counted_units is per unit; no
  // other rule reads another ballot), so the guard is: the same unit's ballots at this same instant must sort before
  // the new id (B-4 orders equal instants by id). Compared in JS with the engine's string order, not the collation.
  const unitHash = unitHashFor(head.id, input.unitId, head.salt);
  const sameInstant = latest?.at === castAt ? (await tx.ballot.findMany({ where: { meetingId: head.id, castAt, unitHash }, select: { ballotId: true } })).map((r) => r.ballotId) : [];
  const highest = sameInstant.reduce<string | null>((m, id) => (m === null || compareStrings(id, m) > 0 ? id : m), null);

  // 2. the roster as of the record date, and the unit's current counted ballot
  const roster = await readRoster(tx, head.orgId);
  const proxies = await readProxies(tx, head.id);
  const engineRoster = buildRoster(rules, roster.units, roster.ownerships, roster.ledger, proxies);
  const labels = await currentLabels(tx, head.id);
  const sameUnit = await tx.ballot.findMany({ where: { meetingId: head.id, unitHash } });
  const countedRows = sameUnit.filter((b) => labels.get(b.id)?.status === 'COUNTED');
  if (countedRows.length > 1) throw new Error(`unit hash ${unitHash} has ${countedRows.length} counted ballots; one unit, one ballot (D-10)`);
  const prior = countedRows[0];
  const counted: CountedUnits = prior ? new Map([[input.unitId, prior.viaProxy ? 'proxy' : '']]) : new Map();

  // 3. the public id (D-40): random, so arrival order cannot be read from it; never Math.random
  let ballotId: string;
  if (input.ballotId !== undefined) {
    if (highest !== null && compareStrings(input.ballotId, highest) <= 0) throw new CastOutOfOrder(`${castAt} ${input.ballotId}`, `${castAt} ${highest}`);
    ballotId = input.ballotId;
  } else ballotId = mintBallotId(highest);

  // 4. the Phase 1 rules, unchanged
  const b: Ballot = { ballot_id: ballotId, unit_id: input.unitId, cast_by: input.castBy, via_proxy_id: input.viaProxyId, cast_at: input.castAt, nonce, choices: input.choices };
  const code = ballotRejectCode(b, rules, engineRoster, counted);
  const supersedes = code === '' && prior && prior.viaProxy && input.viaProxyId === '' ? prior.id : null;
  const bps = engineRoster.unitIds.has(input.unitId) ? shareBps(roster.shares, input.unitId, rules.record_date) : 0;
  const receipt = receiptFor(ballotId, nonce, input.choices);
  const canonical = canonicalChoices(input.choices);
  canonicalJson(input.choices); // refuses a float or undefined before anything is written

  // 5. the sealed link's ids, resolved where the roster has them
  const unitRow = await tx.unit.findUnique({ where: { orgId_unitId: { orgId: head.orgId, unitId: input.unitId } }, select: { id: true } });
  const ownerRow = await tx.owner.findUnique({ where: { orgId_ownerId: { orgId: head.orgId, ownerId: input.castBy } }, select: { id: true } });
  const proxyRow = input.viaProxyId === '' ? null : (proxies.find((p) => p.proxy_id === input.viaProxyId) ?? null);

  // 6. the one write
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    SELECT quorum_cast_ballot(
      ${head.id}::uuid, ${ballotId}, ${unitHash}, ${bps}, ${input.castAt}, ${input.viaProxyId !== ''},
      ${canonical}, ${sha256Hex(nonce)}, ${receipt},
      ${code === '' ? null : code}::"BallotCode", ${supersedes}::uuid,
      ${input.unitId}, ${unitRow?.id ?? null}::uuid, ${input.castBy}, ${ownerRow?.id ?? null}::uuid, ${input.viaProxyId}, ${proxyRow?.row_id ?? null}::uuid,
      ${input.enteredById ?? null}::uuid
    ) AS id`;
  return { rowId: row!.id, ballotId, receipt, nonce, status: code === '' ? 'COUNTED' : 'REJECTED', code, supersededRowId: supersedes };
}
