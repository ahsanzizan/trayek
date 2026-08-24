import { env } from "~/env";
import { type JobQueuePort } from "~/server/domain/jobs/port";
import { createEnqueueOnlyBoss } from "~/server/jobs/boss";
import { PgBossJobQueue } from "~/server/jobs/queue";
import { jobTypes } from "~/server/jobs/registry";

export { createBoss, createEnqueueOnlyBoss } from "~/server/jobs/boss";
export { PgBossJobQueue } from "~/server/jobs/queue";
export { PrismaJobStore } from "~/server/jobs/prisma-job-store";
export {
  jobTypes,
  registerJobHandler,
  jobHandler,
  assertEveryJobTypeHasHandler,
} from "~/server/jobs/registry";

const createQueue = () => new PgBossJobQueue(createEnqueueOnlyBoss(), jobTypes);

const globalForQueue = globalThis as unknown as {
  jobQueue: PgBossJobQueue | undefined;
};

/**
 * Enqueue-only handle for the web process. It opens its connection lazily on
 * first `send`, so no bootstrap hook is needed. Workers are started separately
 * by `pnpm worker`, so nothing here calls `boss.work()`.
 */
export const jobQueue: JobQueuePort = globalForQueue.jobQueue ?? createQueue();

if (env.NODE_ENV !== "production")
  globalForQueue.jobQueue = jobQueue as PgBossJobQueue;
