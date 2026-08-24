import { describe, expect, it } from "vitest";

import {
  aggregateLlmCallSummary,
  type LlmCallLogSummaryRow,
} from "~/server/observability/summary";

describe("LLM call summary aggregation", () => {
  it("totals BigInt cost, deduplicates loads, and uses nearest-rank percentiles", () => {
    const rows: LlmCallLogSummaryRow[] = [
      {
        loadId: "load-a",
        estimatedCost: 100n,
        latencyMs: 300,
        success: false,
      },
      {
        loadId: "load-b",
        estimatedCost: 250n,
        latencyMs: 100,
        success: true,
      },
      {
        loadId: "load-a",
        estimatedCost: 50n,
        latencyMs: 200,
        success: true,
      },
    ];

    expect(aggregateLlmCallSummary(rows)).toEqual({
      totalEstimatedCost: 400n,
      attemptCount: 3,
      successfulAttemptCount: 2,
      failedAttemptCount: 1,
      processedLoadCount: 2,
      costPerProcessedLoad: 200n,
      p50LatencyMs: 200,
      p95LatencyMs: 300,
    });
  });

  it("returns nullable derived values for an empty window", () => {
    expect(aggregateLlmCallSummary([])).toEqual({
      totalEstimatedCost: 0n,
      attemptCount: 0,
      successfulAttemptCount: 0,
      failedAttemptCount: 0,
      processedLoadCount: 0,
      costPerProcessedLoad: null,
      p50LatencyMs: null,
      p95LatencyMs: null,
    });
  });
});
