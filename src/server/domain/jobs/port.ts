/**
 * Queue contract owned by the domain. The pg-boss implementation lives in
 * `src/server/jobs/` and is the only code that knows the vendor.
 */

/**
 * Retry configuration for one job type. `maxAttempts` counts the first run, so
 * a value of 1 means no retry and a terminal failure on the first throw.
 */
export interface RetryPolicy {
  maxAttempts: number;
  initialDelaySeconds: number;
  maxDelaySeconds: number;
}

/**
 * What a person has to do by hand once a job has failed terminally. Written in
 * Bahasa Indonesia because the reader is an ops admin, not an engineer.
 */
export interface HumanFallbackInstruction {
  entityType: string;
  entityId: string | null;
  instruction: string;
}

/**
 * INV-6. Emitted exactly once per job that exhausts its retries, so no agent
 * failure ends in silence.
 */
export interface HumanFallbackRequired extends HumanFallbackInstruction {
  organizationId: string;
  source: string;
  dedupeKey: string;
  occurredAt: Date;
}

/**
 * Every job belongs to a tenant. Carrying the organization on the envelope is
 * what lets a terminal failure name the org that has to act on it.
 */
export interface JobEnvelope<TPayload = unknown> {
  organizationId: string;
  /**
   * Client-supplied idempotency key, unique per organization. Replaying a key
   * that already completed is a no-op.
   */
  key: string;
  payload: TPayload;
}

export interface JobTypeDefinition<TPayload = unknown> {
  name: string;
  retry: RetryPolicy;
  /**
   * Required. A job type with no fallback would be able to fail silently,
   * which INV-6 forbids — the registry rejects one at registration time.
   */
  fallback: (envelope: JobEnvelope<TPayload>) => HumanFallbackInstruction;
}

export interface QueueMetrics {
  name: string;
  /** Jobs waiting to be worked. */
  depth: number;
  active: number;
  /** Jobs that exhausted their retries. */
  failed: number;
}

export interface JobQueuePort {
  send<TPayload>(name: string, envelope: JobEnvelope<TPayload>): Promise<void>;
  metrics(): Promise<QueueMetrics[]>;
}

/**
 * Persistence the runner needs. Implemented over Prisma in
 * `src/server/jobs/prisma-job-store.ts`; the domain only sees this shape.
 */
export interface JobRecordStore {
  hasCompleted(params: {
    organizationId: string;
    key: string;
  }): Promise<boolean>;
  markCompleted(params: {
    organizationId: string;
    name: string;
    key: string;
    attempts: number;
  }): Promise<void>;
  recordDeadLetter(params: {
    organizationId: string;
    name: string;
    key: string;
    payload: unknown;
    error: string;
    attempts: number;
  }): Promise<void>;
  /**
   * Must be unique on (organizationId, source, dedupeKey). Returns false when
   * an event for that key already existed, which keeps the "exactly one event"
   * guarantee true even if a worker is replayed.
   */
  recordHumanFallback(event: HumanFallbackRequired): Promise<boolean>;
}
