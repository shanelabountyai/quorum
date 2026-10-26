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

/** D-40: a public ballot id is "B-" + 12 lowercase hex chars (48 bits from crypto). */
export const BALLOT_ID_RE = /^B-[0-9a-f]{12}$/;
const MINT_TRIES = 64;

/**
 * A fresh random id; when the instant already holds ballots, one that sorts after the highest of them (D-40 / D-36),
 * re-drawn until it does. Expected ≤ 2 draws; 64 failures would mean the generator is broken, and the cast refuses.
 */
export function mintBallotId(mustExceed: string | null, draw: () => string = () => randomBytes(6).toString('hex')): string {
  for (let i = 0; i < MINT_TRIES; i++) {
    const id = `B-${draw()}`;
    if (!BALLOT_ID_RE.test(id)) throw new Error(`minted ballot id ${id} is not B-<12 hex> (D-40)`);
    if (mustExceed === null || compareStrings(id, mustExceed) > 0) return id;
  }
  throw new Error(`could not mint a ballot id after ${mustExceed} in ${MINT_TRIES} draws (D-40)`);
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
  const rules = head.definition.rules;
  // D-36: castAt is monotone per meeting, so the stored set is in B-4 order and the labels written here are the
  // ones evaluateBallots would compute over the same set. A ballot from the past is refused before any read of it.
  const castAt = timestamp(input.castAt, 'castAt'); // validated before it is compared with anything
  const [latest] = await tx.$queryRaw<{ at: string | null }[]>`SELECT max("castAt") AS at FROM "Ballot" WHERE "meetingId" = ${head.id}::uuid`;
  if (latest?.at && castAt < latest.at) throw new CastOutOfOrder(castAt, latest.at);
  // D-40 amends D-36: ids are random, so at an instant that already has ballots the new id must sort after them
  // (B-4 orders equal instants by id). Compared in JS with the engine's own string order, not the database collation.
  const sameInstant = latest?.at === castAt ? (await tx.ballot.findMany({ where: { meetingId: head.id, castAt }, select: { ballotId: true } })).map((r) => r.ballotId) : [];
  const highest = sameInstant.reduce<string | null>((m, id) => (m === null || compareStrings(id, m) > 0 ? id : m), null);

  // 2. the roster as of the record date, and the unit's current counted ballot
  const roster = await readRoster(tx, head.orgId);
  const proxies = await readProxies(tx, head.id);
  const engineRoster = buildRoster(rules, roster.units, roster.ownerships, roster.ledger, proxies);
  const unitHash = unitHashFor(head.id, input.unitId, head.salt);
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
      ${input.unitId}, ${unitRow?.id ?? null}::uuid, ${input.castBy}, ${ownerRow?.id ?? null}::uuid, ${input.viaProxyId}, ${proxyRow?.row_id ?? null}::uuid
    ) AS id`;
  return { rowId: row!.id, ballotId, receipt, nonce, status: code === '' ? 'COUNTED' : 'REJECTED', code, supersededRowId: supersedes };
}
