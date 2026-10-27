-- D-41 (owner decision, 2026-10-26): CREDIT is a ledger kind; E-4 subtracts it like PAYMENT (GQ-12).
-- ADD VALUE appends, so pg_enum's order stays the order of src/tally/codes.ts LEDGER_KINDS (tested).
ALTER TYPE "LedgerKind" ADD VALUE 'CREDIT';
