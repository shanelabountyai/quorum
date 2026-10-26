// The sentences every number-bearing Quorum page carries (CLAUDE.md non-negotiable 10, D-2, D-24, D-37). Server
// components; one copy of each sentence so a page cannot paraphrase it into a stronger claim.

/** D-2: on every screen that shows a receipt or a commitment. */
export const RECEIPT_LIMIT = 'A receipt proves your ballot is included as cast; it does not hide how you voted from anyone you show it to. This scheme is not coercion-resistant and not receipt-free.';

/** D-37: on every screen that shows the published list. */
export const BPS_SIDE_CHANNEL = 'Each published ballot carries its unit’s share in basis points so anyone can recount the weighted totals. A rare share value (for example a penthouse’s) narrows which unit cast that ballot to a handful.';

export function ScopeNote({ children }: { children?: React.ReactNode }) {
  return (
    <aside className="scope" aria-label="Scope">
      <p>
        <strong>Learning project, synthetic data.</strong> Every number here is computed by the Quorum engine from this association&apos;s rows and the rules it was given; it is not a certified election result, legal advice or an accounting statement. {children}
      </p>
    </aside>
  );
}

export function ReceiptLimit() {
  return <p className="limit">{RECEIPT_LIMIT}</p>;
}
