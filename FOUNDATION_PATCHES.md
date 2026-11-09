# Foundation patches

Template-owned files that differ from the cloned foundation tag, and why. Delete a row when the clone moves to a foundation release that contains the change.

`src/core/db/cross-org.ts` `37520f2c4861` — drops the stale `src/modules/billing/webhook.ts` entry: v1.6.0 leaves it without a `// billing` marker, so removing billing (20261026000000_quorum_init) left INV-32 red on a file that no longer exists (D-60). Delete this row once the template marks the line.
