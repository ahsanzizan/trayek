import { env } from "~/env";
import { type JobQueuePort } from "~/server/domain/jobs/port";
import { createBoss, PgBossJobQueue } from "~/server/jobs/queue";
import { jobTypes } from "~/server/jobs/registry";

export {
  PgBossJobQueue,
  createBoss,
  queueOptionsFor,
} from "~/server/jobs/queue";
export { PrismaJobStore } from "~/server/jobs/prisma-job-store";
export {
  jobTypes,
  registerJobHandler,
  jobHandler,
  assertEveryJobTypeHasHandler,
} from "~/server/jobs/registry";

const createQueue = () => new PgBossJobQueue(createBoss(), jobTypes);

const globalForQueue = globalThis as unknown as {
  jobQueue: PgBossJobQueue | undefined;
};

/**
 * Enqueue-only handle for the web process. Workers are started separately by
 * `pnpm worker`, so nothing here calls `boss.work()`.
 */
export const jobQueue: JobQueuePort = globalForQueue.jobQueue ?? createQueue();

if (env.NODE_ENV !== "production")
  globalForQueue.jobQueue = jobQueue as PgBossJobQueue;
