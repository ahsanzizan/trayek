import { Prisma, type PrismaClient } from "../../../generated/prisma";
import {
  type HumanFallbackRequired,
  type JobRecordStore,
} from "~/server/domain/jobs/port";

const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_VIOLATION
  );
}

/**
 * Prisma-backed job bookkeeping. Every write here is idempotent on its unique
 * key, which is what lets the runner survive a redelivered terminal attempt
 * without producing a second notification.
 */
export class PrismaJobStore implements JobRecordStore {
  constructor(private readonly db: PrismaClient) {}

  async hasCompleted({
    organizationId,
    key,
  }: {
    organizationId: string;
    key: string;
  }): Promise<boolean> {
    const existing = await this.db.jobExecution.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId,
          idempotencyKey: key,
        },
      },
      select: { id: true },
    });

    return existing !== null;
  }

  async markCompleted({
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
    try {
      await this.db.jobExecution.create({
        data: { organizationId, name, idempotencyKey: key, attempts },
      });
    } catch (error) {
      // Two workers settled the same job. The first write is the record.
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }

  async recordDeadLetter({
    organizationId,
    name,
    key,
    payload,
    error,
    attempts,
  }: {
    organizationId: string;
    name: string;
    key: string;
    payload: unknown;
    error: string;
    attempts: number;
  }): Promise<void> {
    try {
      await this.db.deadLetterJob.create({
        data: {
          organizationId,
          name,
          idempotencyKey: key,
          payload: payload as Prisma.InputJsonValue,
          error,
          attempts,
        },
      });
    } catch (thrown) {
      if (!isUniqueViolation(thrown)) {
        throw thrown;
      }
    }
  }

  async recordHumanFallback(event: HumanFallbackRequired): Promise<boolean> {
    try {
      await this.db.humanFallbackEvent.create({
        data: {
          organizationId: event.organizationId,
          source: event.source,
          dedupeKey: event.dedupeKey,
          entityType: event.entityType,
          entityId: event.entityId,
          instruction: event.instruction,
          createdAt: event.occurredAt,
        },
      });

      return true;
    } catch (thrown) {
      if (isUniqueViolation(thrown)) {
        return false;
      }

      throw thrown;
    }
  }
}
