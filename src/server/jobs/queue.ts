import { type PgBoss, type Queue } from "pg-boss";
import {
  type JobEnvelope,
  type JobQueuePort,
  type JobTypeDefinition,
  type QueueMetrics,
} from "~/server/domain/jobs/port";
import { type JobTypeRegistry } from "~/server/domain/jobs/registry";

/**
 * Queue options derived from a job type's retry policy. pg-boss applies its own
 * jitter on top of the backoff, which is fine — the policy sets the shape.
 */
export function queueOptionsFor(definition: JobTypeDefinition<unknown>): Queue {
  return {
    name: definition.name,
    // maxAttempts counts the first run; retryLimit counts retries after it.
    retryLimit: definition.retry.maxAttempts - 1,
    retryDelay: definition.retry.initialDelaySeconds,
    retryBackoff: true,
    retryDelayMax: definition.retry.maxDelaySeconds,
  };
}

export class PgBossJobQueue implements JobQueuePort {
  private starting: Promise<void> | undefined;

  constructor(
    private readonly boss: PgBoss,
    private readonly registry: JobTypeRegistry,
  ) {}

  /**
   * Opens the connection and declares the queues. Idempotent and safe under
   * concurrency: every caller awaits the same promise.
   *
   * pg-boss refuses to run SQL before this, so `send` and `metrics` call it
   * themselves. The web process has no bootstrap hook to call it from, and an
   * enqueue that throws "Database not opened" is a job silently not queued.
   */
  start(): Promise<void> {
    this.starting ??= (async () => {
      await this.boss.start();
      await this.migrateQueues();
    })();

    return this.starting;
  }

  /** Creates one pg-boss queue per registered job type. Safe to re-run. */
  async migrateQueues(): Promise<void> {
    for (const name of this.registry.names()) {
      await this.boss.createQueue(
        name,
        queueOptionsFor(this.registry.get(name)),
      );
    }
  }

  async send<TPayload>(
    name: string,
    envelope: JobEnvelope<TPayload>,
  ): Promise<void> {
    // Throws UnknownJobTypeError for a type the worker could not run.
    this.registry.get(name);
    await this.start();

    await this.boss.send(name, envelope as unknown as object, {
      singletonKey: `${envelope.organizationId}:${envelope.key}`,
    });
  }

  /**
   * Counts are materialized columns on `pgboss.queue`, advanced by the
   * supervisor's monitor sweep rather than counted per call. They are
   * therefore eventually consistent: a queue reads zero until the worker has
   * swept it once. The worker owns that sweep, so metrics are only meaningful
   * while a worker is running.
   */
  async metrics(): Promise<QueueMetrics[]> {
    await this.start();
    const names = this.registry.names();
    const stats = await Promise.all(
      names.map(async (name) => {
        const queue = await this.boss.getQueue(name);

        return {
          name,
          // readyCount, not queuedCount: the latter includes future-dated
          // jobs that are not yet runnable, which overstates the backlog.
          depth: queue?.readyCount ?? 0,
          active: queue?.activeCount ?? 0,
          failed: queue?.failedCount ?? 0,
        };
      }),
    );

    return stats;
  }
}
