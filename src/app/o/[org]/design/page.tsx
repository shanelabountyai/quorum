// The living reference for docs/DESIGN_SYSTEM.md: every token and component, rendered by the real stylesheet. Members
// only (it sits under /o/[org]); the e2e sweep runs axe on it in both colour schemes, so a token that fails contrast
// fails the build.
import { requireOrg } from '@/core/authz/guards';
import { RECEIPT_LIMIT } from '@/components/honesty';
import { EmptyState, LinkButton, Notice, PageHeader, Pill, Section, Stat, Stats, type PillKind } from '@/components/ui';

export const metadata = { title: 'Design system' };

const KINDS: [PillKind, string, string][] = [
  ['good', 'PASSED', 'A result met its rule; quorum met; recount equals; good standing.'],
  ['risk', 'FAILED', 'A result missed its rule; quorum not met; delinquent; a fine.'],
  ['hold', 'TIE_UNRESOLVED', 'The machine stopped on purpose and a person decides.'],
  ['info', 'OPEN', 'Live or neutral: an open meeting, a role.'],
  ['done', 'CLOSED', 'Finished or archived; nothing more will be written.'],
];
const SPACE = [1, 2, 3, 4, 5, 6, 8, 10, 12];
const TYPE: [string, string][] = [['--t-2xl', 'Landing title'], ['--t-xl', 'Page title'], ['--t-lg', 'Section title'], ['--t-md', 'Lead, card title'], ['--t-base', 'Body'], ['--t-sm', 'Controls, captions'], ['--t-xs', 'Labels, code']];
const SURFACES: [string, string][] = [['--bg', 'page'], ['--sf', 'card, input'], ['--sf-2', 'well'], ['--ink', 'text'], ['--mu', 'secondary text'], ['--ln', 'rule'], ['--ln-strong', 'control border'], ['--ac', 'action']];

export default async function Design({ params }: { params: Promise<{ org: string }> }) {
  await requireOrg((await params).org);
  return (
    <main>
      <PageHeader eyebrow="Reference" title="Design system" lead="Every token and component, drawn by the stylesheet the application uses. Light and dark follow your system setting." actions={<LinkButton href="#components" variant="secondary">Components</LinkButton>} />

      <Section id="colour-h" title="Colour">
        <p className="muted">Semantic tokens. Dark mode remaps these; nothing else in the application names a colour.</p>
        <div className="grid">
          {SURFACES.map(([t, what]) => (
            <div key={t} className="stack">
              <div className="swatch" style={{ background: `var(${t})` }} />
              <div><code>{t}</code><p className="muted">{what}</p></div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="status-h" title="Status families">
        <p className="muted">Five families. Each is a glyph, a word and a colour together; colour is never the only signal.</p>
        <table>
          <thead><tr><th scope="col">Family</th><th scope="col">Pill</th><th scope="col">Means</th></tr></thead>
          <tbody>{KINDS.map(([k, word, what]) => <tr key={k}><td><code>{k}</code></td><td><Pill k={k}>{word}</Pill></td><td>{what}</td></tr>)}</tbody>
        </table>
      </Section>

      <Section id="type-h" title="Type and space">
        <table>
          <thead><tr><th scope="col">Token</th><th scope="col">Use</th><th scope="col">Sample</th></tr></thead>
          <tbody>{TYPE.map(([t, use]) => <tr key={t}><td><code>{t}</code></td><td>{use}</td><td style={{ fontSize: `var(${t})` }}>Quorum met</td></tr>)}</tbody>
        </table>
        <div className="stack">
          {SPACE.map((n) => (
            <div key={n} className="cluster"><code style={{ width: '5rem' }}>--s-{n}</code><div style={{ height: 12, width: `var(--s-${n})`, background: 'var(--ac)', borderRadius: 2 }} /></div>
          ))}
        </div>
      </Section>

      <h2 id="components">Components</h2>

      <Section id="buttons-h" title="Buttons and links">
        <div className="cluster">
          <button type="button">Primary</button>
          <LinkButton href="#components" variant="secondary">Secondary</LinkButton>
          <LinkButton href="#components" variant="ghost">Ghost</LinkButton>
          <a href="#components">A text link</a>
        </div>
        <p className="hint">One primary action per form. Everything else is secondary or ghost.</p>
      </Section>

      <Section id="forms-h" title="Form controls">
        <form>
          <label>Text <input defaultValue="2026-11-14" /></label>
          <label>Select <select defaultValue="b"><option value="a">A-101</option><option value="b">B-203</option></select></label>
          <fieldset><legend>E1 Board of Directors: choose up to 3</legend>
            <label className="choice"><input type="checkbox" defaultChecked /> C-01</label>
            <label className="choice"><input type="checkbox" /> C-02</label>
          </fieldset>
          <label>Textarea <textarea rows={3} defaultValue={'{ "meeting_id": "AM-2026" }'} /></label>
        </form>
      </Section>

      <Section id="messages-h" title="Messages and notices">
        <p role="alert">An action&apos;s error, as ActionForm renders it.</p>
        <p role="status">An action&apos;s notice.</p>
        <Notice k="hold" title="Closing is permanent">A notice carries a glyph, a title and one or two sentences.</Notice>
        <Notice k="good" title="Recount equals the stored result" />
        <Notice k="risk" title="3 delinquent" />
        <div className="scope"><strong>Learning project, synthetic data.</strong> The scope note: the most visible text on a page that carries numbers.</div>
        <p className="limit">{RECEIPT_LIMIT}</p>
      </Section>

      <Section id="stats-h" title="Stats">
        <Stats>
          <Stat label="Units represented" value="87/120" sub={<Pill k="good">MET</Pill>} />
          <Stat label="Direct only" value="51/120" sub={<Pill k="risk">NOT MET</Pill>} />
          <Stat label="Binding" value={<Pill k="good">MET</Pill>} sub="basis UNITS, 5000 bps" k="good" />
        </Stats>
      </Section>

      <Section id="table-h" title="Tables">
        <table>
          <thead><tr><th scope="col">Candidate</th><th scope="col" className="num">Units</th><th scope="col" className="num">Weighted (bps)</th></tr></thead>
          <tbody>
            <tr><td>C-02</td><td className="num">57</td><td className="num">4613</td></tr>
            <tr><td>C-04</td><td className="num">53</td><td className="num">4118</td></tr>
          </tbody>
        </table>
        <p>Receipt <code className="hash">019dc5278a69a43228a7a02d91d1faf9c3d9a50524a8145e04bf3a24181a8abf</code></p>
      </Section>

      <Section id="empty-h" title="Empty state">
        <EmptyState action={<LinkButton href="#components">Next step</LinkButton>}>Nothing here yet: say so in a sentence and offer the next step.</EmptyState>
      </Section>
    </main>
  );
}
