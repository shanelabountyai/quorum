// A status as a glyph and a word, so colour is never the only signal (docs/DESIGN_BRIEF.md). The glyph is CSS.
export type PillKind = 'good' | 'risk' | 'hold' | 'info' | 'done';

export function Pill({ k, children }: { k: PillKind; children: React.ReactNode }) {
  return <span className="pill" data-k={k}>{children}</span>;
}

/** Which family an engine outcome word belongs to. A tie is `hold`, not `risk`: the machine stopped on purpose. */
export const resultKind = (word: string): PillKind =>
  word === 'PASSED' || word === 'ELECTED' || word === 'MET' ? 'good' : word === 'TIE_UNRESOLVED' ? 'hold' : word === 'FAILED' || word === 'NOT MET' ? 'risk' : 'info';
