import {
  type JobEnvelope,
  type JobRecordStore,
  type JobTypeDefinition,
} from "~/server/domain/jobs/port";
import { backoffSeconds, isTerminalAttempt } from "~/server/domain/jobs/retry";

export type JobOutcome =
  /** The key already completed. The handler was not called. */
  | { status: "skipped" }
  | { status: "completed" }
  | { status: "retry"; error: Error; nextDelaySeconds: number }
  | { status: "dead-letter"; error: Error; fallbackEmitted: boolean };

export type JobHandler<TPayload> = (
  envelope: JobEnvelope<TPayload>,
) => Promise<void>;

interface RunJobParams<TPayload> {
  definition: JobTypeDefinition<TPayload>;
  envelope: JobEnvelope<TPayload>;
  /** 1-based attempt number supplied by the queue. */
  attempt: number;
  store: JobRecordStore;
  handler: JobHandler<TPayload>;
  now?: () => Date;
}

function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/**
 * Runs one attempt of one job and decides what happens next.
 *
 * Two guarantees this function exists to hold:
 *
 * 1. Replaying a completed key is a no-op — the handler is never called twice
 *    for the same `(organizationId, key)`.
 * 2. A job that exhausts its retries lands in the dead-letter store and emits
 *    exactly one `HumanFallbackRequired` event (INV-6). The store is idempotent
 *    on both writes, so a redelivered terminal attempt cannot produce a second
 *    event.
 *
 * A store failure while settling a terminal job is deliberately allowed to
 * propagate. Losing the notification is worse than working the job again, and
 * both settlement writes are idempotent.
 */
export async function runJob<TPayload>({
  definition,
  envelope,
  attempt,
  store,
  handler,
  now = () => new Date(),
}: RunJobParams<TPayload>): Promise<JobOutcome> {
  const alreadyCompleted = await store.hasCompleted({
    organizationId: envelope.organizationId,
    key: envelope.key,
  });

  if (alreadyCompleted) {
    return { status: "skipped" };
  }

  try {
    await handler(envelope);
  } catch (thrown) {
    const error = toError(thrown);

    if (!isTerminalAttempt(definition.retry, attempt)) {
      return {
        status: "retry",
        error,
        nextDelaySeconds: backoffSeconds(definition.retry, attempt),
      };
    }

    await store.recordDeadLetter({
      organizationId: envelope.organizationId,
      name: definition.name,
      key: envelope.key,
      payload: envelope.payload,
      error: error.message,
      attempts: attempt,
    });

    const instruction = definition.fallback(envelope);
    const fallbackEmitted = await store.recordHumanFallback({
      ...instruction,
      organizationId: envelope.organizationId,
      source: definition.name,
      dedupeKey: envelope.key,
      occurredAt: now(),
    });

    return { status: "dead-letter", error, fallbackEmitted };
  }

  await store.markCompleted({
    organizationId: envelope.organizationId,
    name: definition.name,
    key: envelope.key,
    attempts: attempt,
  });

  return { status: "completed" };
}
