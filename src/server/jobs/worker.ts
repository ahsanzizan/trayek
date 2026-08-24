import { pathToFileURL } from "node:url";

import { type JobWithMetadata, type PgBoss } from "pg-boss";

import { db } from "~/server/db";
import { type JobEnvelope } from "~/server/domain/jobs/port";
import { runJob } from "~/server/domain/jobs/runner";
import {
  createObservabilityContext,
  runWithObservabilityContext,
} from "~/server/observability/context";
import {
  reporter as defaultReporter,
  type Reporter,
} from "~/server/observability/reporter";
import { PrismaJobStore } from "~/server/jobs/prisma-job-store";
import { createBoss } from "~/server/jobs/boss";
import { PgBossJobQueue } from "~/server/jobs/queue";
import {
  assertEveryJobTypeHasHandler,
  jobHandler,
  jobTypes,
} from "~/server/jobs/registry";

/**
 * Worker entrypoint. Runs as its own process (`pnpm worker`), separate from the
 * web process — a long extraction must never occupy a request handler, and the
 * two scale independently. See README.
 */

function isJobEnvelope(value: unknown): value is JobEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "organizationId" in value &&
    "key" in value &&
    typeof (value as JobEnvelope).organizationId === "string" &&
    typeof (value as JobEnvelope).key === "string"
  );
}

export type JobObservabilityParams<TPayload, TResult> = {
  jobId: string;
  name: string;
  envelope: JobEnvelope<TPayload>;
  operation: () => Promise<TResult>;
  reporter?: Reporter;
};

export async function runWithJobObservability<TPayload, TResult>({
  jobId,
  name,
  envelope,
  operation,
  reporter = defaultReporter,
}: JobObservabilityParams<TPayload, TResult>): Promise<TResult> {
  return runWithObservabilityContext(
    createObservabilityContext(`job-${jobId}`, envelope.organizationId),
    async () => {
      try {
        return await operation();
      } catch (error) {
        reporter.reportError(error, "Job attempt failed", {
          jobName: name,
          jobKey: envelope.key,
        });
        throw error;
      }
    },
  );
}

export async function startWorker(): Promise<PgBoss> {
  assertEveryJobTypeHasHandler();

  const boss = createBoss();
  const store = new PrismaJobStore(db);

  boss.on("error", (error: unknown) => {
    defaultReporter.reportError(error, "pg-boss error", { scope: "pg-boss" });
  });

  // Idempotent: opens the connection and declares one queue per job type.
  await new PgBossJobQueue(boss, jobTypes).start();

  for (const name of jobTypes.names()) {
    const definition = jobTypes.get(name);

    await boss.work(
      name,
      { includeMetadata: true, batchSize: 1 },
      async (jobs: JobWithMetadata<unknown>[]) => {
        for (const job of jobs) {
          if (!isJobEnvelope(job.data)) {
            const error = new Error(
              `Job ${job.id} on ${name} has no tenant envelope`,
            );
            runWithObservabilityContext(
              createObservabilityContext(`job-${job.id}`),
              () =>
                defaultReporter.reportError(error, "Job envelope invalid", {
                  jobName: name,
                  jobId: job.id,
                }),
            );
            throw error;
          }

          const envelope = job.data;
          const outcome = await runWithJobObservability({
            jobId: job.id,
            name,
            envelope,
            operation: () =>
              runJob({
                definition,
                envelope,
                // retryCount is 0 on the first run; attempt is 1-based.
                attempt: job.retryCount + 1,
                store,
                handler: jobHandler(name),
              }),
          });

          if (outcome.status === "retry") {
            // Rethrow so pg-boss schedules the retry it already knows about.
            throw outcome.error;
          }

          if (outcome.status === "dead-letter") {
            defaultReporter.reportError(outcome.error, "Job dead-lettered", {
              jobName: name,
              jobKey: job.data.key,
              fallbackEmitted: outcome.fallbackEmitted,
            });
          }
        }
      },
    );
  }

  return boss;
}

async function main(): Promise<void> {
  const boss = await startWorker();
  const shutdown = async () => {
    await boss.stop({ graceful: true });
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

// `pnpm worker` runs this file directly. Importing it must not start a worker.
const isMainModule =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  void main();
}
