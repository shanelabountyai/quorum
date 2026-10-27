'use client';
// The ballot form (task 3.2). Like the foundation's ActionForm, it shows a refused action's { error }; on success it
// shows the receipt, the ballot id and the nonce ONCE — they are not stored anywhere the voter can come back to
// (the nonce is never stored at all, C-2) — with the D-2 sentence. A rejected ballot shows its code and its receipt:
// it was received, it is in the root, and it is published with that code (D-11).
import { useActionState, useId } from 'react';

export type ContestField =
  | { kind: 'ELECTION'; contestId: string; title: string; seats: number; candidates: { id: string; name: string }[] }
  | { kind: 'RESOLUTION'; contestId: string; title: string };

type Receipt = { ballotId: string; receipt: string; nonce: string; status: string; code: string; castAt: string; meetingId: string };

export function CastForm({ action, contests, limit, children }: { action: (form: FormData) => Promise<unknown>; contests: ContestField[]; limit: string; children?: React.ReactNode }) {
  const [state, submit, pending] = useActionState(async (_: unknown, form: FormData) => action(form), null);
  const hid = useId();
  const error = state && typeof state === 'object' && 'error' in state ? String((state as { error: unknown }).error) : null;
  const r = state && typeof state === 'object' && 'receipt' in state ? ((state as { receipt: Receipt }).receipt) : null;
  if (r) {
    return (
      <section aria-labelledby={hid} role="status">
        <h2 id={hid}>{r.status === 'COUNTED' ? 'Ballot counted' : `Ballot received and rejected: ${r.code}`}</h2>
        <dl>
          <dt>Meeting</dt><dd>{r.meetingId}</dd>
          <dt>Cast at</dt><dd>{r.castAt}</dd>
          <dt>Ballot id</dt><dd><code>{r.ballotId}</code></dd>
          <dt>Receipt</dt><dd><code className="hash" data-testid="receipt">{r.receipt}</code></dd>
          <dt>Nonce</dt><dd><code className="hash" data-testid="nonce">{r.nonce}</code></dd>
        </dl>
        <p>Copy these now: they are shown once. After the meeting closes, look the receipt up on the results page.</p>
        <p className="limit">{limit}</p>
      </section>
    );
  }
  return (
    <form action={submit}>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={pending} className="plain">
        {children}
        {contests.map((c) =>
          c.kind === 'ELECTION' ? (
            <fieldset key={c.contestId}>
              <legend>{c.contestId} {c.title} — choose up to {c.seats}</legend>
              {c.candidates.map((cand) => (
                <label key={cand.id} className="choice">
                  <input type="checkbox" name={`c:${c.contestId}:${cand.id}`} value="on" /> {cand.name} ({cand.id})
                </label>
              ))}
            </fieldset>
          ) : (
            <fieldset key={c.contestId}>
              <legend>{c.contestId} {c.title}</legend>
              {['YES', 'NO', 'ABSTAIN'].map((v) => (
                <label key={v} className="choice">
                  <input type="radio" name={`c:${c.contestId}`} value={v} /> {v}
                </label>
              ))}
            </fieldset>
          ),
        )}
        <p className="limit">{limit}</p>
        <button type="submit">Cast ballot</button>
      </fieldset>
    </form>
  );
}
