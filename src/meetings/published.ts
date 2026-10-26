// Task 2.6 (second half): the published list from the tables, C-6 exactly — (receipt, ballot_id, status, code,
// choices_canonical) sorted by receipt, no unit, no caster, no timestamp, no bps (D-32). Written as CSV the way
// tools/reference_tally.py writes it (Python csv, QUOTE_MINIMAL, "\n"), so the export of the replayed fixture
// equals fixtures/published_ballots.csv byte for byte.
import { compareStrings } from '@/tally/canonical';
import { asApp, type Tx } from './db';
import { storedBallots } from './labels';

export type PublishedRow = { receipt: string; ballot_id: string; status: 'COUNTED' | 'REJECTED'; code: string; choices_canonical: string };

export async function publishedRows(tx: Tx, meetingRowId: string): Promise<PublishedRow[]> {
  const rows = await storedBallots(tx, meetingRowId);
  return rows
    .map((r) => ({ receipt: r.receipt, ballot_id: r.ballot_id, status: r.status, code: r.code, choices_canonical: r.choices_canonical }))
    .sort((a, b) => compareStrings(a.receipt, b.receipt));
}

const PUBLISHED_COLUMNS = ['receipt', 'ballot_id', 'status', 'code', 'choices_canonical'] as const;

/** Python csv.writer QUOTE_MINIMAL: a field is quoted iff it holds the delimiter, a quote, CR or LF; quotes are doubled. */
export const csvField = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function publishedCsv(rows: readonly PublishedRow[]): string {
  const lines = [PUBLISHED_COLUMNS.join(',')];
  for (const r of rows) lines.push(PUBLISHED_COLUMNS.map((c) => csvField(r[c])).join(','));
  return lines.join('\n') + '\n';
}

export const publishedList = (meetingRowId: string): Promise<{ rows: PublishedRow[]; csv: string }> =>
  asApp(async (tx) => {
    const rows = await publishedRows(tx, meetingRowId);
    return { rows, csv: publishedCsv(rows) };
  });
