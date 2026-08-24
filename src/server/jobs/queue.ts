import { PgBoss, type Queue } from "pg-boss";

import { env } from "~/env";
import {
  type JobEnvelope,
  type JobQueuePort,
  type JobTypeDefinition,
  type QueueMetrics,
} from "~/server/domain/jobs/port";
import { type JobTypeRegistry } from "~/server/domain/jobs/registry";

/**
 * pg-boss runs on the same Postgres as the application. That keeps job
 * payloads inside the residency boundary and avoids a second vendor DPA.
 */
export function createBoss(): PgBoss {
  return new PgBoss({ connectionString: env.DATABASE_URL });
}

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
  constructor(
    private readonly boss: PgBoss,
    private readonly registry: JobTypeRegistry,
  ) {}

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

    await this.boss.send(name, envelope as unknown as object, {
      singletonKey: `${envelope.organizationId}:${envelope.key}`,
    });
  }

  async metrics(): Promise<QueueMetrics[]> {
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
