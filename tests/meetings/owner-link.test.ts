// D-39 (a) (owner decision 2026-10-26): OwnerLink(ownerId, userId) is written when an invite is ACCEPTED and its
// email equals an owner's email in that org. The template's acceptInvite runs unedited; the clone's trigger on
// "Invite" writes the link. Never by name, never for an email no owner has, never into an archived org, never moved.
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db';
import { requireUser } from '@/core/auth/session';
import { acceptInvite } from '@/core/tenancy/invites';
import { hashToken, newToken } from '@/core/tokens';
import { archiveOrg } from '@/meetings/archive';
import { asApp } from '@/meetings/db';
import { linkedOwner } from '@/meetings/owners';
import { loadAll } from '../../scripts/quorum-load';
import { makeUser, resetAuthTables, signInAs } from '../helpers/auth';
import { addMember, makeOrg } from '../helpers/org';

async function inviteAndAccept(orgId: string, issuerId: string, email: string) {
  const token = newToken();
  await db.invite.create({ data: { orgId, email, role: 'member', tokenHash: hashToken(token), invitedById: issuerId, expiresAt: new Date(Date.UTC(2099, 0, 1)) } });
  const user = (await db.user.findUnique({ where: { email } })) ?? (await makeUser(email));
  await signInAs(user.id);
  await acceptInvite(await requireUser(), token);
  return user;
}

describe('D-39 (a) OwnerLink on invite acceptance', () => {
  let orgId = '';
  let boardId = '';
  beforeEach(async () => {
    await resetAuthTables();
    await db.$executeRawUnsafe('GRANT SELECT ON "BallotSecret" TO quorum_app');
    orgId = (await makeOrg('larkspur')).id;
    await loadAll(orgId);
    boardId = (await addMember(orgId, 'owner', 'board@example.test')).id;
  });

  it('an accepted invite to an owner\'s email links that user to that owner, and only then', async () => {
    const o1 = await db.owner.findFirstOrThrow({ where: { orgId, ownerId: 'O-001' } });
    expect(o1.email).toMatch(/@example\.com$/);
    // an invite that is merely sent links nothing
    await db.invite.create({ data: { orgId, email: o1.email, role: 'member', tokenHash: hashToken(newToken()), invitedById: boardId, expiresAt: new Date(Date.UTC(2099, 0, 1)) } });
    expect(await db.ownerLink.count()).toBe(0);
    const user = await inviteAndAccept(orgId, boardId, o1.email);
    const links = await db.ownerLink.findMany();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ orgId, ownerId: o1.id, userId: user.id });
    expect(await asApp((tx) => linkedOwner(tx, orgId, user.id))).toMatchObject({ ownerId: 'O-001' });
  });

  it('an email that no owner has links nothing; the membership is still created (the template\'s behaviour is untouched)', async () => {
    const user = await inviteAndAccept(orgId, boardId, 'tenant@example.test');
    expect(await db.ownerLink.count()).toBe(0);
    expect(await db.membership.count({ where: { orgId, userId: user.id } })).toBe(1);
    expect(await asApp((tx) => linkedOwner(tx, orgId, user.id))).toBeNull();
  });

  it('matches case-insensitively, never by name', async () => {
    await db.owner.create({ data: { orgId, ownerId: 'O-900', name: 'Board Member', email: 'Mixed.Case@Example.com' } });
    const user = await inviteAndAccept(orgId, boardId, 'mixed.case@example.com');
    expect((await db.ownerLink.findFirstOrThrow({ where: { userId: user.id }, include: { owner: true } })).owner.ownerId).toBe('O-900');
    // a user whose NAME matches an owner but whose email does not is not linked
    const o2 = await db.owner.findFirstOrThrow({ where: { orgId, ownerId: 'O-002' } });
    await inviteAndAccept(orgId, boardId, `${o2.name.toLowerCase().replace(/ /g, '.')}@elsewhere.test`);
    expect(await db.ownerLink.count()).toBe(1);
  });

  it('a link is never moved by a later invite, and an archived org gets no new link', async () => {
    const o3 = await db.owner.findFirstOrThrow({ where: { orgId, ownerId: 'O-003' } });
    const first = await inviteAndAccept(orgId, boardId, o3.email);
    await inviteAndAccept(orgId, boardId, o3.email); // the same user accepts a second invite
    expect(await db.ownerLink.findMany({ where: { ownerId: o3.id } })).toEqual([expect.objectContaining({ userId: first.id })]);
    await archiveOrg(orgId, boardId, 'test');
    const o4 = await db.owner.findFirstOrThrow({ where: { orgId, ownerId: 'O-004' } });
    await inviteAndAccept(orgId, boardId, o4.email);
    expect(await db.ownerLink.count({ where: { ownerId: o4.id } })).toBe(0);
  });
});
