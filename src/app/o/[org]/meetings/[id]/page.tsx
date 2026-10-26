import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { ActionForm } from '@/core/ui/action-form';
import { ScopeNote } from '@/components/honesty';
import { intakeCode, liveQuorumInTx, meetingInOrg, proxiesOf } from '@/meetings/admin';
import { asApp } from '@/meetings/db';
import { delinquentSnapshot, eligibilityScope, forOwner } from '@/meetings/eligibility';
import { linkedOwner } from '@/meetings/owners';
import { readRoster } from '@/meetings/roster';
import { assessmentsOf, resolutionId } from '@/ledger/assessment';
import { formatCents } from '@/ledger/money';
import { closeMeetingAction, declareAssessmentAction, importProxiesAction, intakeProxyAction, postAssessmentAction, queueNoticeAction } from './actions';

export const metadata = { title: 'Meeting' };

const met = (b: boolean) => (b ? 'MET' : 'NOT MET');

export default async function MeetingPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const board = can(ctx.role, 'org.update');
  const v = await asApp(async (tx) => {
    const head = await meetingInOrg(tx, ctx.orgId, id);
    const roster = await readRoster(tx, ctx.orgId);
    const proxies = await proxiesOf(tx, head.id);
    return {
      head,
      live: await liveQuorumInTx(tx, head),
      proxies: proxies.map((p) => ({ ...p, intake: intakeCode(p, head.definition.rules, roster.ownerships) })),
      me: await linkedOwner(tx, ctx.orgId, ctx.userId),
      assessments: await assessmentsOf(tx, head.id),
      ballots: await tx.ballot.count({ where: { meetingId: head.id } }),
      units: board ? await tx.unit.findMany({ where: { orgId: ctx.orgId }, orderBy: { unitId: 'asc' }, select: { id: true, unitId: true } }) : [],
      owners: board ? await tx.owner.findMany({ where: { orgId: ctx.orgId }, orderBy: { ownerId: 'asc' }, select: { id: true, ownerId: true, name: true } }) : [],
    };
  });
  const snap = await delinquentSnapshot(v.head.id);
  const scope = eligibilityScope(ctx.role);
  const elig = scope.kind === 'all' ? snap : v.me ? forOwner(snap, v.me.ownerId) : { ...snap, rows: [], delinquent_units: [] };
  const r = v.head.definition.rules;
  const q = v.live.quorum;
  const base = `/o/${ctx.slug}/meetings/${v.head.id}`;
  const slug = ctx.slug;
  return (
    <main>
      <h1>{v.head.meetingId}: {v.head.definition.title}</h1>
      <ScopeNote>Live figures are the engine&apos;s labels on the ballots received so far.</ScopeNote>
      <p>
        <strong>{v.head.closedAt ? `Closed at ${v.head.closedAt}` : 'Open'}</strong> · window {r.open_at} to {r.close_at} ({r.timezone_label}) · record date {r.record_date}
        {' · '}<Link href={`${base}/vote`}>Vote</Link>
        {board && <> · <Link href={`${base}/desk`}>Desk</Link></>}
        {' · '}<Link href={`${base}/results`}>Results</Link>
      </p>

      <h2>Quorum now</h2>
      <p>
        Ballots received {v.live.received}, counted {v.live.counted}, rejected {v.live.rejected}. Quorum basis {q.basis}, threshold {q.threshold_bps} bps:
        units {q.units_represented}/{q.total_units} {met(q.units_met)}; weighted {q.bps_represented}/{q.total_bps} bps {met(q.weighted_met)}; direct only {q.direct_units}/{q.total_units} {met(q.direct_only_met)} (proxy units {q.proxy_units}). <strong>Binding: {met(q.met)}</strong>.
      </p>

      <h2>Rules and contests</h2>
      <p>
        Proxies: depth {r.proxy_max_depth}; holder must be a member: {String(r.proxy_holder_must_be_member)}. Delinquency suspends voting: {String(r.delinquency_suspends_voting)}. Duplicate rule {r.duplicate_unit_rule}. Total shares {r.total_share_bps} bps.
      </p>
      <table>
        <thead><tr><th scope="col">Contest</th><th scope="col">Kind</th><th scope="col">Rule</th><th scope="col">Choices</th></tr></thead>
        <tbody>
          {v.head.definition.contests.map((c) => (
            <tr key={c.contest_id}>
              <td>{c.contest_id} {c.title}</td>
              <td>{c.kind}</td>
              <td>{c.kind === 'ELECTION' ? `${c.seats} seats, ${c.mode}` : c.basis}</td>
              <td>{c.kind === 'ELECTION' ? c.candidates.map((x) => `${x.id} ${x.name}`).join('; ') : 'YES / NO / ABSTAIN'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section aria-labelledby="assess-h">
        <h2 id="assess-h">Special assessments</h2>
        <p>A resolution declared a special assessment before the first ballot posts once, after close, if it PASSED: each unit is charged its share of the amount (bps as of the charge day, rounded down to the cent) and the remainder goes on the run&apos;s ROUNDING line (D-21, D-58).</p>
        {v.assessments.length ? (
          <ul>
            {v.assessments.map((a) => (
              <li key={a.id}>
                {resolutionId(v.head.meetingId, a.contestId)} {a.title}: {formatCents(a.amountCents)} ({a.amountCents} cents).{' '}
                {a.run ? (
                  <>Posted on {a.run.chargedOn}: {a.run.units} charges totalling {formatCents(a.run.postedCents)}, ROUNDING {formatCents(a.run.roundingCents)}.</>
                ) : !v.head.closedAt ? (
                  <>Voting decides it; it posts after close only if it passes.</>
                ) : a.result === 'PASSED' ? (
                  board ? (
                    <ActionForm action={postAssessmentAction.bind(null, slug)}>
                      <input type="hidden" name="meetingId" value={v.head.id} />
                      <input type="hidden" name="contestId" value={a.contestId} />
                      <button type="submit">Post the {a.contestId} assessment to every unit</button>
                    </ActionForm>
                  ) : (
                    <>PASSED; the board posts it.</>
                  )
                ) : (
                  <>Result {a.result ?? 'none'}: nothing is posted.</>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>None declared.</p>
        )}
        {board && !v.head.closedAt && v.ballots === 0 && v.head.definition.contests.some((c) => c.kind === 'RESOLUTION' && !v.assessments.some((a) => a.contestId === c.contest_id)) && (
          <ActionForm action={declareAssessmentAction.bind(null, slug)}>
            <input type="hidden" name="meetingId" value={v.head.id} />
            <label>Resolution <select name="contestId" required>{v.head.definition.contests.filter((c) => c.kind === 'RESOLUTION' && !v.assessments.some((a) => a.contestId === c.contest_id)).map((c) => <option key={c.contest_id} value={c.contest_id}>{c.contest_id} {c.title}</option>)}</select></label>
            <label>Amount in dollars <input name="amount" required inputMode="decimal" placeholder="180000.00" /></label>
            <button type="submit">Declare special assessment</button>
          </ActionForm>
        )}
      </section>

      <h2>Eligibility as of {snap.record_date}</h2>
      {scope.kind === 'all' ? (
        <p>Delinquent (balance above zero, E-4/E-5): {snap.delinquent_units.join(', ') || 'none'}{snap.suspends_voting ? ' — their ballots are rejected INELIGIBLE_DELINQUENT.' : ' — the rules do not suspend their votes.'}</p>
      ) : elig.rows.length ? (
        <ul>{elig.rows.map((u) => <li key={u.unit_id}>{u.unit_id}: balance {formatCents(u.balance_cents)} {u.delinquent ? '(delinquent)' : '(in good standing)'}</li>)}</ul>
      ) : (
        <p>Only the board and the manager see the delinquent list (O-8). Your own units appear here once your account is linked to a roster owner.</p>
      )}

      <h2>Proxies ({v.proxies.length})</h2>
      {v.proxies.length > 0 && (
        <table>
          <thead><tr><th scope="col">Proxy</th><th scope="col">Unit</th><th scope="col">Grantor</th><th scope="col">Holder</th><th scope="col">Received</th><th scope="col">Revoked</th><th scope="col">At intake</th></tr></thead>
          <tbody>
            {v.proxies.map((p) => (
              <tr key={p.row_id}><td>{p.proxy_id}</td><td>{p.grantor_unit}</td><td>{p.grantor_owner}</td><td>{p.holder_owner}</td><td>{p.received_at}</td><td>{p.revoked_at || '—'}</td><td>{p.intake || 'no proxy-level code'}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      {board && !v.head.closedAt && (
        <>
          <h2>Record a proxy</h2>
          <ActionForm action={intakeProxyAction.bind(null, slug)}>
            <input type="hidden" name="meetingId" value={v.head.id} />
            <label>Unit <select name="unitId" required>{v.units.map((u) => <option key={u.id} value={u.id}>{u.unitId}</option>)}</select></label>
            <label>Grantor <select name="grantorId" required>{v.owners.map((o) => <option key={o.id} value={o.id}>{o.ownerId} {o.name}</option>)}</select></label>
            <label>Holder <select name="holderId" required>{v.owners.map((o) => <option key={o.id} value={o.id}>{o.ownerId} {o.name}</option>)}</select></label>
            <label>Received at (blank = now) <input name="receivedAt" placeholder="YYYY-MM-DDTHH:MM:SS" pattern="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}" /></label>
            <button type="submit">Record proxy</button>
          </ActionForm>
          <h2>Import proxies</h2>
          <ActionForm action={importProxiesAction.bind(null, slug)}>
            <input type="hidden" name="meetingId" value={v.head.id} />
            <label htmlFor="proxies">proxies.csv (proxy_id, grantor_unit, grantor_owner, holder_owner, received_at, revoked_at)</label>
            <textarea id="proxies" name="proxies" rows={6} required />
            <button type="submit">Import proxies</button>
          </ActionForm>
          <h2>Notice</h2>
          <ActionForm action={queueNoticeAction.bind(null, slug)}>
            <input type="hidden" name="meetingId" value={v.head.id} />
            <button type="submit">Queue the meeting notice to every owner of record</button>
          </ActionForm>
          <h2>Close</h2>
          <p>Closing records the result once, publishes the commitments and seals the voter link: after it, the application cannot read who cast which ballot (D-20). It needs a sign-in within the last five minutes.</p>
          <ActionForm action={closeMeetingAction.bind(null, slug)}>
            <input type="hidden" name="meetingId" value={v.head.id} />
            <button type="submit">Close and seal the meeting</button>
          </ActionForm>
        </>
      )}
    </main>
  );
}
