// D-43 (owner decision 2026-10-26; item 17): an org with append-only history is archived, never deleted. The
// template's delete-org refuses it with a user-facing message (beforeOrgDelete, clone-owned) and leaves every row;
// an archived org refuses new writes in every clone write path (OrgArchived) and, if a path forgets, at the trigger
// (ArchivedOrgWrite); the archive itself is append-only; and no application code ever disables a trigger.
import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { destroyOrg } from '@/app/o/[org]/settings/danger/actions';
import { beforeOrgDelete } from '@/app/org-hooks';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { deleteOrg } from '@/core/tenancy/delete';
import { ARCHIVED_REFUSAL, archiveOrg, HISTORY_REFUSAL, OrgArchived } from '@/meetings/archive';
import { castBallot } from '@/meetings/cast';
import { asApp, asOwner } from '@/meetings/db';
import { ArchivedOrgWrite, AppendOnlyViolation } from '@/meetings/errors';
import { loadRoster } from '@/meetings/load';
import type { Timestamp } from '@/tally/time';
import { loadRosterFixtures } from '../../scripts/tally-fixtures';
import { loadAll } from '../../scripts/quorum-load';
import { resetAuthTables } from '../helpers/auth';
import { actAs, addMember, makeOrg } from '../helpers/org';

const counts = async () => ({ orgs: await db.org.count(), units: await db.unit.count(), ledger: await db.ledgerEntry.count(), meetings: await db.meeting.count(), owners: await db.owner.count() });

describe('D-43 delete-org on an org with history', () => {
  beforeEach(async () => {
    await resetAuthTables();
    await db.$executeRawUnsafe('GRANT SELECT ON "BallotSecret" TO quorum_app');
  });

  it('refuses through the template\'s deleteOrg with the user-facing message and deletes nothing', async () => {
    const org = await makeOrg('larkspur');
    await loadAll(org.id);
    const ctx = await actAs((await addMember(org.id, 'owner', 'board@example.test')).id, org.slug);
    const before = await counts();
    expect(before).toMatchObject({ orgs: 1, units: 120, ledger: 2627, meetings: 1, owners: 138 });
    await expect(deleteOrg(ctx, org.slug, beforeOrgDelete)).rejects.toThrow(HISTORY_REFUSAL);
    await expect(deleteOrg(ctx, org.slug, beforeOrgDelete)).rejects.toBeInstanceOf(Refused);
    expect(await counts()).toEqual(before);
  });

  it('the Delete org form shows the message (the template action, unedited, returns { error })', async () => {
    const org = await makeOrg('larkspur');
    await loadAll(org.id);
    await actAs((await addMember(org.id, 'owner', 'board@example.test')).id, org.slug);
    const before = await counts();
    expect(await destroyOrg(org.slug, { confirm: org.slug })).toEqual({ error: HISTORY_REFUSAL });
    expect(await counts()).toEqual(before);
  });

  it('an org with no history still deletes (the hook refuses only what the triggers protect)', async () => {
    const org = await makeOrg('empty');
    const ctx = await actAs((await addMember(org.id, 'owner', 'board@example.test')).id, org.slug);
    await deleteOrg(ctx, org.slug, beforeOrgDelete);
    expect(await db.org.count()).toBe(0);
  });

  it('an archived org is refused too, with its own message, even with no history (the archive row is Restrict)', async () => {
    const org = await makeOrg('quiet');
    const ctx = await actAs((await addMember(org.id, 'owner', 'board@example.test')).id, org.slug);
    await archiveOrg(org.id, ctx.userId, 'dissolved 2026');
    await expect(deleteOrg(ctx, org.slug, beforeOrgDelete)).rejects.toThrow(ARCHIVED_REFUSAL);
    expect(await db.org.count()).toBe(1);
  });
});

describe('D-43 an archived org writes nothing new', () => {
  let orgId = '';
  let meetingRowId = '';
  beforeEach(async () => {
    await resetAuthTables();
    await db.$executeRawUnsafe('GRANT SELECT ON "BallotSecret" TO quorum_app');
    orgId = (await makeOrg('larkspur')).id;
    ({ meetingRowId } = await loadAll(orgId));
  });

  it('archiving is one append-only row; a second archive returns the first', async () => {
    const a = await archiveOrg(orgId, null, 'merged into another association');
    expect(a.archived).toBe(true);
    const b = await archiveOrg(orgId, null, 'again');
    expect(b).toMatchObject({ archived: false, archive: { reason: 'merged into another association' } });
    await expect(asOwner((tx) => tx.orgArchive.update({ where: { orgId }, data: { reason: 'x' } }))).rejects.toBeInstanceOf(AppendOnlyViolation);
    await expect(asOwner((tx) => tx.orgArchive.delete({ where: { orgId } }))).rejects.toBeInstanceOf(AppendOnlyViolation);
    expect(await archiveOrg(orgId, null, '   ').then((r) => r.archived)).toBe(false); // already archived: the blank reason is never read
  });

  it('every clone write path refuses with OrgArchived before writing: cast, roster import', async () => {
    await archiveOrg(orgId, null, 'test');
    const before = await counts();
    await expect(castBallot({ meetingRowId, unitId: 'A-101', castBy: 'O-001', viaProxyId: '', castAt: '2026-11-14T10:00:00' as Timestamp, choices: {} })).rejects.toBeInstanceOf(OrgArchived);
    await expect(asApp((tx) => loadRoster(tx, orgId, loadRosterFixtures()))).rejects.toBeInstanceOf(OrgArchived);
    expect(await counts()).toEqual(before);
    expect(await db.ballot.count()).toBe(0);
  });

  it('the trigger is the second door: a raw insert for an archived org is ArchivedOrgWrite', async () => {
    await archiveOrg(orgId, null, 'test');
    await expect(asOwner((tx) => tx.unit.create({ data: { orgId, unitId: 'Z-999' } }))).rejects.toBeInstanceOf(ArchivedOrgWrite);
    const unit = await db.unit.findFirstOrThrow({ where: { orgId } });
    await expect(asOwner((tx) => tx.ledgerEntry.create({ data: { unitId: unit.id, entryId: 'L-X', kind: 'CREDIT', amountCents: 1, date: '2026-11-20' } }))).rejects.toMatchObject({ name: 'ArchivedOrgWrite', detail: expect.stringContaining('is archived; nothing new is written (D-43)') });
  });

  it('reads still work: an archive hides nothing from the association that owns it', async () => {
    await archiveOrg(orgId, null, 'test');
    expect(await asApp((tx) => tx.unit.count({ where: { orgId } }))).toBe(120);
  });
});

describe('D-43 no application code disables a trigger', () => {
  it('src/ and scripts/ contain no DISABLE TRIGGER and no session_replication_role', () => {
    const hits = (pattern: string) => {
      try {
        return execFileSync('git', ['grep', '-n', '-i', '-E', pattern, '--', 'src', 'scripts'], { encoding: 'utf8' }).trim();
      } catch {
        return ''; // git grep exits 1 on no match
      }
    };
    expect(hits('DISABLE[[:space:]]+TRIGGER')).toBe('');
    expect(hits('session_replication_role')).toBe('');
  });
});
