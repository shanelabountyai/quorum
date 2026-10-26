// D-39: who is casting. A signed-in member is an Owner only through an OwnerLink (written by the Invite trigger when
// the accepted invite's email equals Owner.email); the desk path lets a board/manager user pick any owner on the
// roster. Both read here, as the application role.
import type { Tx } from './db';

export type LinkedOwner = { ownerRowId: string; ownerId: string; name: string };

/** The roster owner this user is linked to in this org, or null. */
export async function linkedOwner(tx: Tx, orgId: string, userId: string): Promise<LinkedOwner | null> {
  const link = await tx.ownerLink.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { owner: { select: { id: true, ownerId: true, name: true } } } });
  return link ? { ownerRowId: link.owner.id, ownerId: link.owner.ownerId, name: link.owner.name } : null;
}
