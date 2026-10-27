// Clone-owned, like cron-jobs.ts and org-hooks.ts: modules this clone's own code depends on
// outside the marked lines (an import `foundation:check-modules` wouldn't otherwise see coming).
// foundation:check-modules leaves these in place and still removes the rest.
// notifications: Quorum queues meeting and violation notices to the outbox (task 3.7, src/notices/notices.ts).
export const REQUIRED_MODULES: string[] = ['notifications'];
