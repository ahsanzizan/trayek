export type LlmCallLogSummaryRow = {
  loadId: string;
  estimatedCost: bigint;
  latencyMs: number;
  success: boolean;
};

export type LlmCallSummary = {
  totalEstimatedCost: bigint;
  attemptCount: number;
  successfulAttemptCount: number;
  failedAttemptCount: number;
  processedLoadCount: number;
  costPerProcessedLoad: bigint | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
};

function nearestRankPercentile(
  values: readonly number[],
  percentile: number,
): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(percentile * sorted.length);

  return sorted[rank - 1] ?? null;
}

export function aggregateLlmCallSummary(
  rows: readonly LlmCallLogSummaryRow[],
): LlmCallSummary {
  let totalEstimatedCost = 0n;
  let successfulAttemptCount = 0;
  const loadIds = new Set<string>();
  const latencies: number[] = [];

  for (const row of rows) {
    totalEstimatedCost += row.estimatedCost;
    loadIds.add(row.loadId);
    latencies.push(row.latencyMs);

    if (row.success) {
      successfulAttemptCount += 1;
    }
  }

  const attemptCount = rows.length;
  const processedLoadCount = loadIds.size;

  return {
    totalEstimatedCost,
    attemptCount,
    successfulAttemptCount,
    failedAttemptCount: attemptCount - successfulAttemptCount,
    processedLoadCount,
    costPerProcessedLoad:
      processedLoadCount === 0
        ? null
        : totalEstimatedCost / BigInt(processedLoadCount),
    p50LatencyMs: nearestRankPercentile(latencies, 0.5),
    p95LatencyMs: nearestRankPercentile(latencies, 0.95),
  };
}
