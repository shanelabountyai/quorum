import { requireOrg } from '@/core/authz/guards';
import { publishedCsvFor } from '@/meetings/results';

// Task 3.3: the published list (C-6 with bps_as_of, D-37) of a closed meeting, for any member of the association.
export const GET = async (_req: Request, { params }: { params: Promise<{ org: string; id: string }> }) => {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const csv = await publishedCsvFor(ctx.orgId, id);
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="published_ballots.csv"', 'cache-control': 'no-store' } });
};
