import {
  type HumanFallbackRequired,
  type JobRecordStore,
} from "~/server/domain/jobs/port";

/**
 * In-memory JobRecordStore with the same uniqueness guarantees the Prisma
 * implementation gets from its indexes, so the runner's idempotency and
 * exactly-once-notification behaviour is testable without a database.
 */
export class FakeJobStore implements JobRecordStore {
  readonly completed = new Map<string, { name: string; attempts: number }>();
  readonly deadLetters: {
    organizationId: string;
    name: string;
    key: string;
    payload: unknown;
    error: string;
    attempts: number;
  }[] = [];
  readonly fallbacks: HumanFallbackRequired[] = [];

  private completionKey(organizationId: string, key: string) {
    return `${organizationId}:${key}`;
  }

  hasCompleted({
    organizationId,
    key,
  }: {
    organizationId: string;
    key: string;
  }): Promise<boolean> {
    return Promise.resolve(
      this.completed.has(this.completionKey(organizationId, key)),
    );
  }

  markCompleted({
    organizationId,
    name,
    key,
    attempts,
  }: {
    organizationId: string;
    name: string;
    key: string;
    attempts: number;
  }): Promise<void> {
    this.completed.set(this.completionKey(organizationId, key), {
      name,
      attempts,
    });

    return Promise.resolve();
  }

  recordDeadLetter(params: {
    organizationId: string;
    name: string;
    key: string;
    payload: unknown;
    error: string;
    attempts: number;
  }): Promise<void> {
    const exists = this.deadLetters.some(
      (entry) =>
        entry.organizationId === params.organizationId &&
        entry.key === params.key,
    );

    if (!exists) {
      this.deadLetters.push(params);
    }

    return Promise.resolve();
  }

  recordHumanFallback(event: HumanFallbackRequired): Promise<boolean> {
    const exists = this.fallbacks.some(
      (entry) =>
        entry.organizationId === event.organizationId &&
        entry.source === event.source &&
        entry.dedupeKey === event.dedupeKey,
    );

    if (exists) {
      return Promise.resolve(false);
    }

    this.fallbacks.push(event);

    return Promise.resolve(true);
  }
}
