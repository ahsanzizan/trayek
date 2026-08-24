import { describe, expect, it, vi } from "vitest";

import {
  recordLlmCall,
  readLlmCallSummary,
  type LlmCallLogDatabase,
  type LlmCallLogFindManyArgs,
} from "~/server/observability/llm-call-log";

function createDatabase(
  rows: LlmCallLogDatabase["llmCallLog"]["findMany"] extends (
    args: LlmCallLogFindManyArgs,
  ) => Promise<infer T>
    ? T
    : never,
) {
  const create = vi.fn(async () => ({}));
  const findMany = vi.fn(async (_args: LlmCallLogFindManyArgs) => rows);

  return {
    database: { llmCallLog: { create, findMany } } as LlmCallLogDatabase,
    create,
    findMany,
  };
}

describe("LLM call log repository", () => {
  it("writes one tenant/load-attributed attempt with scrubbed error text", async () => {
    const { database, create } = createDatabase([]);

    await recordLlmCall(
      {
        organizationId: "org-a",
        loadId: "load-a",
        model: "model-v1",
        promptVersion: "prompt-v1",
        usage: { inputTokens: 12, outputTokens: 7, imageCount: 1 },
        latencyMs: 321,
        estimatedCost: 123n,
        success: false,
        errorMessage:
          "failed for +6281234567890 at https://storage.example.test/signed?token=secret",
        createdAt: new Date("2026-08-25T00:00:00.000Z"),
      },
      database,
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        organizationId: "org-a",
        loadId: "load-a",
        model: "model-v1",
        promptVersion: "prompt-v1",
        inputTokens: 12,
        outputTokens: 7,
        imageCount: 1,
        latencyMs: 321,
        estimatedCost: 123n,
        success: false,
        errorMessage: "failed for [REDACTED_PHONE] at [REDACTED_URL]",
        createdAt: new Date("2026-08-25T00:00:00.000Z"),
      },
    });
  });

  it("filters summary reads by one organization and defaults to 30 days", async () => {
    const now = new Date("2026-08-25T00:00:00.000Z");
    const { database, findMany } = createDatabase([
      {
        loadId: "load-a",
        estimatedCost: 100n,
        latencyMs: 100,
        success: true,
      },
    ]);

    const summary = await readLlmCallSummary(
      { organizationId: "org-a", now: () => now },
      database,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-a",
        createdAt: {
          gte: new Date("2026-07-26T00:00:00.000Z"),
          lt: now,
        },
      },
      select: {
        loadId: true,
        estimatedCost: true,
        latencyMs: true,
        success: true,
      },
    });
    expect(summary.totalEstimatedCost).toBe(100n);
  });
});
