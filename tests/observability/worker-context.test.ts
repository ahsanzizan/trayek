import { describe, expect, it, vi } from "vitest";

import { getObservabilityContext } from "~/server/observability/context";
import { runWithJobObservability } from "~/server/jobs/worker";
import { type Reporter } from "~/server/observability/reporter";

describe("worker observability context", () => {
  it("correlates an execution and reports failures before rethrowing", async () => {
    const reportError = vi.fn();
    const reporter = { reportError } as Reporter;

    await expect(
      runWithJobObservability({
        jobId: "job-1",
        name: "extract-pod",
        envelope: {
          organizationId: "org-a",
          key: "load-1",
          payload: { loadId: "load-1" },
        },
        reporter,
        operation: async () => {
          expect(getObservabilityContext()).toMatchObject({
            organizationId: "org-a",
          });
          throw new Error("provider unavailable");
        },
      }),
    ).rejects.toThrow("provider unavailable");

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "provider unavailable" }),
      "Job attempt failed",
      { jobName: "extract-pod", jobKey: "load-1" },
    );
  });
});
