import { EmptyState, LinkButton, MeetingTabs, PageHeader, Pill, Section, Stat, Stats, resultKind } from '@/components/ui';
import { can } from '@/core/authz/permissions';
import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { BPS_SIDE_CHANNEL, ReceiptLimit, ScopeNote } from '@/components/honesty';
import { resultsView } from '@/meetings/results';
import { RESOLUTION_BASES } from '@/tally/codes';
import type { ContestTally } from '@/tally/tally';
import { verifyReceiptAction } from './actions';

export const metadata = { title: 'Results' };

const met = (b: boolean) => (b ? 'MET' : 'NOT MET');
const Met = ({ b }: { b: boolean }) => <Pill k={resultKind(met(b))}>{met(b)}</Pill>;
const ranked = (t: Record<string, number>) => Object.entries(t).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)); // display order only; the result is the engine's
const counts = (c: Partial<Record<string, number>>) => Object.entries(c).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';

function Contest({ c }: { c: ContestTally }) {
  return (
    <section aria-labelledby={`h-${c.contest_id}`}>
      <h3 id={`h-${c.contest_id}`}>{c.contest_id} {c.title}</h3>
      <p>Counted {c.counted_ballots} · voted {c.voted} · blank {c.blank} · void {counts(c.void_by_code)}</p>
      {c.kind === 'ELECTION' ? (
        <>
          <p>
            <Pill k={resultKind(c.result)}>{c.result}</Pill> ({c.seats} seats, {c.mode} binding): elected {c.elected.join(', ') || 'none'}
            {c.result === 'TIE_UNRESOLVED' || c.tied.length ? <>; {c.open_seats} seat(s) open, tied {c.tied.join(', ')} — the machine never breaks a tie; the board runs a runoff (O-5)</> : null}.
            {' '}Under {c.informational_other_mode.mode} it would elect {c.informational_other_mode.elected.join(', ') || 'none'}{c.informational_other_mode.tied.length ? ` (tied ${c.informational_other_mode.tied.join(', ')})` : ''}{c.informational_other_mode.differs ? ' — different.' : ' — the same.'}
          </p>
          <table>
            <thead><tr><th scope="col">Candidate</th><th scope="col" className="num">Units</th><th scope="col" className="num">Weighted (bps)</th></tr></thead>
            <tbody>
              {ranked(c.mode === 'UNITS' ? c.totals.UNITS : c.totals.WEIGHTED).map(([id]) => (
                <tr key={id}><td>{id}</td><td className="num">{c.totals.UNITS[id]}</td><td className="num">{c.totals.WEIGHTED[id]}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <>
          <p><Pill k={resultKind(c.result)}>{c.result}</Pill> under {c.basis}.</p>
          <table>
            <thead><tr><th scope="col">Choice</th><th scope="col" className="num">Units</th><th scope="col" className="num">Weighted (bps)</th></tr></thead>
            <tbody>
              {(['YES', 'NO', 'ABSTAIN'] as const).map((k) => (
                <tr key={k}><td>{k}</td><td className="num">{c.totals.units[k]}</td><td className="num">{c.totals.bps[k]}</td></tr>
              ))}
            </tbody>
          </table>
          <p>Under every basis: {RESOLUTION_BASES.map((b) => `${b} ${c.passes_by_basis[b] ? 'PASS' : 'FAIL'}${b === c.basis ? ' (binding)' : ''}`).join(' · ')}</p>
        </>
      )}
      <p>Commitment <code className="hash">{c.commitment}</code></p>
    </section>
  );
}

export default async function Results({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const v = await resultsView(ctx.orgId, id);
  const back = `/o/${ctx.slug}/meetings/${id}`;
  if (!v.closed) {
    return (
      <main>
        <PageHeader eyebrow="Meeting" title={`Results: ${v.meetingId}`} status={<Pill k="info">Open</Pill>} />
        <MeetingTabs base={back} board={can(ctx.role, 'org.update')} />
        <EmptyState action={<LinkButton href={back} variant="secondary">Back to the meeting</LinkButton>}>The meeting is open. Results, commitments and the published list are computed once, when the board closes it.</EmptyState>
      </main>
    );
  }
  const q = v.quorum;
  return (
    <main>
      <PageHeader eyebrow="Meeting" title={`Results: ${v.meetingId}`} status={<Pill k="done">Closed at {v.closedAt}</Pill>} />
      <MeetingTabs base={back} board={can(ctx.role, 'org.update')} />
      <Stats>
        <Stat label="Received" value={v.rows.length} />
        <Stat label="Counted" value={v.counted} sub="one per unit" />
        <Stat label="Rejected" value={v.rejected} sub="published with their codes" />
        <Stat label="Quorum" value={<Pill k={resultKind(met(q.met))}>{met(q.met)}</Pill>} sub={`${q.units_represented}/${q.total_units} units`} k={resultKind(met(q.met))} />
      </Stats>
      <ScopeNote>The fixture these screens were built against proves agreement with the spec on 113 ballots by the same author (D-24); it says nothing about any real association&apos;s bylaws.</ScopeNote>
      <ReceiptLimit />
      <h2>Ballots and quorum</h2>
      <p>Received {v.rows.length}, counted {v.counted}, rejected {v.rejected} ({counts(v.byCode)}).</p>
      <p>
        Quorum ({q.basis}, {q.threshold_bps} bps): units {q.units_represented}/{q.total_units} <Met b={q.units_met} />; weighted {q.bps_represented}/{q.total_bps} bps <Met b={q.weighted_met} />; direct only {q.direct_units}/{q.total_units} <Met b={q.direct_only_met} />; proxy units {q.proxy_units}. <strong>Binding: <Met b={q.met} /></strong>.
      </p>
      <p>
        Recount from the stored ballots: <Pill k={v.recountMatches ? 'good' : 'risk'}>{v.recountMatches ? 'equals the stored result' : `DIFFERS on ${v.differences.join(', ')}`}</Pill>. Merkle root <code className="hash">{v.stored.merkleRoot}</code>; meeting commitment <code className="hash">{v.stored.commitment}</code>.
      </p>
      <h2>Contests</h2>
      {v.stored.contests.map((s) => <Contest key={s.contestId} c={s.tally} />)}
      <Section id="published-h" title="Published list">
      <p>{BPS_SIDE_CHANNEL}</p>
      <p><a href={`${back}/published.csv`}>Download published_ballots.csv</a> ({v.rows.length} rows: receipt, ballot id, status, code, bps_as_of, choices — no unit, no voter, no time). Anyone can recount it with <code>npm run tally:recount</code>.</p>
      </Section>
      <Section id="check-h" title="Check your ballot">
      <ActionForm action={verifyReceiptAction.bind(null, ctx.slug)}>
        <input type="hidden" name="meetingId" value={id} />
        <label>Receipt <input name="receipt" required size={70} autoComplete="off" /></label>
        <label>Nonce (optional) <input name="nonce" size={36} autoComplete="off" /></label>
        <button type="submit">Check</button>
      </ActionForm>
      </Section>
    </main>
  );
}
