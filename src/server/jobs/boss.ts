import { PgBoss } from "pg-boss";

import { env } from "~/env";

/**
 * pg-boss runs on the same Postgres as the application. That keeps job
 * payloads inside the residency boundary and avoids a second vendor DPA.
 *
 * These factories are the only job code that reads configuration, which keeps
 * `queue.ts` free of env so it stays testable without an environment.
 */
export function createBoss(): PgBoss {
  return new PgBoss({ connectionString: env.DATABASE_URL });
}

/**
 * Boss for a process that only enqueues. Maintenance and cron belong to the
 * worker, which is the single process that should be sweeping expired jobs —
 * running them from every web instance multiplies the same work.
 */
export function createEnqueueOnlyBoss(): PgBoss {
  return new PgBoss({
    connectionString: env.DATABASE_URL,
    supervise: false,
    schedule: false,
  });
}
