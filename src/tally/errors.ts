// The engine's two refusals. Both are thrown, never returned as a ballot code: RULES_INVALID is a bad meeting
// definition (D-9, D-14, D-16), INPUT_INVALID is a malformed row (brief §4, review log). Each names the field.

export class RulesInvalid extends Error {
  readonly code = 'RULES_INVALID' as const;
  constructor(readonly field: string, detail: string) {
    super(`RULES_INVALID: ${field}: ${detail}`);
    this.name = 'RulesInvalid';
  }
}

export class InputInvalid extends Error {
  readonly code = 'INPUT_INVALID' as const;
  constructor(readonly field: string, detail: string) {
    super(`INPUT_INVALID: ${field}: ${detail}`);
    this.name = 'InputInvalid';
  }
}
