// Owner decision 2026-10-26 (D-54, reverses D-45 on this point): a signed-in member of the association without board
// rights who opens the desk page gets not-found — the same answer as a meeting that does not exist — not the 500 that
// the foundation's AuthzError renders. The role is checked before any data is read. Both outcomes are asserted, and
// the page's own data reads are watched so "before any data access" is a fact, not a claim.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/core/db';
import * as meetingsDb from '@/meetings/db';
import { createMeeting } from '@/meetings/admin';
import Desk from '@/app/o/[org]/meetings/[id]/desk/page';
import { NavSignal } from '../helpers/next';
import { addMember, actAs, makeOrg } from '../helpers/org';
import { emptyDatabase } from '../../scripts/tally-eval-db';

const SLUG = 'desk-access';
const fixtureMeeting = JSON.parse(readFileSync('fixtures/meeting.json', 'utf8'));
let orgId = '';
let meetingRowId = '';

const open = () => Desk({ params: Promise.resolve({ org: SLUG, id: meetingRowId }) });
/** The text a rendered server-component tree carries (strings and numbers in children), without rendering it. */
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: unknown } }).props.children);
  return '';
};

describe('D-54 the desk page: board sees it, everyone else is not-found', () => {
  beforeAll(async () => {
    await emptyDatabase();
    orgId = (await makeOrg(SLUG)).id;
    meetingRowId = (await createMeeting(orgId, JSON.stringify({ ...fixtureMeeting, meeting_id: 'AM-DESK' }))).id;
  }, 60_000);

  for (const role of ['member', 'scorekeeper'] as const) {
    it(`a ${role} (no org.update) gets notFound, and the page reads no meeting data first`, async () => {
      const u = await addMember(orgId, role, `${role}@example.test`);
      await actAs(u.id, SLUG);
      const reads = vi.spyOn(meetingsDb, 'asApp');
      try {
        const err = await open().then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(NavSignal);
        expect((err as NavSignal).kind).toBe('notFound');
        expect(reads).not.toHaveBeenCalled();
      } finally {
        reads.mockRestore();
      }
    });
  }

  for (const role of ['owner', 'admin'] as const) {
    it(`an ${role} (board) gets the desk for the meeting`, async () => {
      const u = await addMember(orgId, role, `${role}@example.test`);
      await actAs(u.id, SLUG);
      const reads = vi.spyOn(meetingsDb, 'asApp');
      try {
        const page = await open();
        expect(textOf(page)).toContain('Desk: AM-DESK');
        expect(reads).toHaveBeenCalledTimes(1); // the control: the spy does see the page's read when it happens
      } finally {
        reads.mockRestore();
      }
    });
  }

  it('a non-member is notFound too (the foundation guard, unchanged)', async () => {
    const stranger = await db.user.create({ data: { email: 'stranger@example.test' } });
    await actAs(stranger.id, 'not-this-org').catch(() => undefined);
    const err = await open().then(() => null, (e: unknown) => e);
    expect((err as NavSignal).kind).toBe('notFound');
  });
});
