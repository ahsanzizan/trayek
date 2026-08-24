import { db } from "~/server/db";
import { redactString } from "~/server/observability/redact";
import {
  aggregateLlmCallSummary,
  type LlmCallLogSummaryRow,
  type LlmCallSummary,
} from "~/server/observability/summary";

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  imageCount: number;
};

export type LlmCallLogInput = {
  organizationId: string;
  loadId: string;
  model: string;
  promptVersion: string;
  usage: LlmUsage;
  latencyMs: number;
  estimatedCost: bigint;
  success: boolean;
  errorMessage?: string | null;
  createdAt?: Date;
};

export type LlmCallLogCreateData = {
  organizationId: string;
  loadId: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  imageCount: number;
  latencyMs: number;
  estimatedCost: bigint;
  success: boolean;
  errorMessage: string | null;
  createdAt?: Date;
};

export type LlmCallLogFindManyArgs = {
  where: {
    organizationId: string;
    createdAt: { gte: Date; lt: Date };
  };
  select: {
    loadId: true;
    estimatedCost: true;
    latencyMs: true;
    success: true;
  };
};

export type LlmCallLogDatabase = {
  llmCallLog: {
    create(args: { data: LlmCallLogCreateData }): Promise<unknown>;
    findMany(args: LlmCallLogFindManyArgs): Promise<LlmCallLogSummaryRow[]>;
  };
};

const defaultDatabase = db as unknown as LlmCallLogDatabase;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const ROLLING_WINDOW_DAYS = 30;

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer`);
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must not be empty`);
  }
}

function validateLlmCallInput(input: LlmCallLogInput): void {
  assertNonEmpty(input.organizationId, "organizationId");
  assertNonEmpty(input.loadId, "loadId");
  assertNonEmpty(input.model, "model");
  assertNonEmpty(input.promptVersion, "promptVersion");
  assertNonNegativeInteger(input.usage.inputTokens, "inputTokens");
  assertNonNegativeInteger(input.usage.outputTokens, "outputTokens");
  assertNonNegativeInteger(input.usage.imageCount, "imageCount");
  assertNonNegativeInteger(input.latencyMs, "latencyMs");

  if (input.estimatedCost < 0n) {
    throw new RangeError("estimatedCost must be non-negative");
  }
}

export async function recordLlmCall(
  input: LlmCallLogInput,
  database: LlmCallLogDatabase = defaultDatabase,
): Promise<void> {
  validateLlmCallInput(input);

  const data: LlmCallLogCreateData = {
    organizationId: input.organizationId,
    loadId: input.loadId,
    model: input.model,
    promptVersion: input.promptVersion,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    imageCount: input.usage.imageCount,
    latencyMs: input.latencyMs,
    estimatedCost: input.estimatedCost,
    success: input.success,
    errorMessage:
      input.errorMessage === undefined || input.errorMessage === null
        ? null
        : redactString(input.errorMessage),
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
  };

  await database.llmCallLog.create({ data });
}

export type LlmCallSummaryInput = {
  organizationId: string;
  from?: Date;
  to?: Date;
  now?: () => Date;
};

export async function readLlmCallSummary(
  input: LlmCallSummaryInput,
  database: LlmCallLogDatabase = defaultDatabase,
): Promise<LlmCallSummary> {
  assertNonEmpty(input.organizationId, "organizationId");

  const to = input.to ?? (input.now ?? (() => new Date()))();
  const from =
    input.from ?? new Date(to.getTime() - ROLLING_WINDOW_DAYS * MILLIS_PER_DAY);

  const rows = await database.llmCallLog.findMany({
    where: {
      organizationId: input.organizationId,
      createdAt: { gte: from, lt: to },
    },
    select: {
      loadId: true,
      estimatedCost: true,
      latencyMs: true,
      success: true,
    },
  });

  return aggregateLlmCallSummary(rows);
}
