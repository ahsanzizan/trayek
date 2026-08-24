import { describe, expect, it, vi } from "vitest";

import { createReporter, type Reporter } from "~/server/observability/reporter";
import {
  createObservabilityContext,
  runWithObservabilityContext,
} from "~/server/observability/context";
import { type ObservabilityLogger } from "~/server/observability/logger";

describe("observability reporter", () => {
  it("logs first and sends only a redacted error and context to Sentry", () => {
    const calls: string[] = [];
    const logError = vi.fn(
      (_message: string, _fields?: Record<string, unknown>) => {
        calls.push("local");
      },
    );
    const captureException = vi.fn(
      (_error: unknown, _metadata: Record<string, unknown>) => {
        calls.push("sentry");
      },
    );
    const reporter = createReporter({
      logger: { error: logError } as unknown as ObservabilityLogger,
      captureException,
    });

    const originalError = new Error("failed for +6281234567890");

    runWithObservabilityContext(
      createObservabilityContext("request-1", "org-a"),
      () =>
        reporter.reportError(originalError, "provider call failed", {
          signedUrl: "https://storage.example.com/signed?token=secret",
          body: { phone: "081234567890" },
        }),
    );

    expect(calls).toEqual(["local", "sentry"]);
    expect(logError).toHaveBeenCalledWith(
      "provider call failed",
      expect.objectContaining({
        requestId: "request-1",
        organizationId: "org-a",
        error: expect.objectContaining({
          message: "failed for [REDACTED_PHONE]",
        }),
        signedUrl: "[REDACTED_URL]",
        body: "[REDACTED]",
      }),
    );
    expect(captureException).toHaveBeenCalledWith(
      originalError,
      expect.objectContaining({
        event: "provider call failed",
        requestId: "request-1",
        organizationId: "org-a",
        fields: expect.objectContaining({ signedUrl: "[REDACTED_URL]" }),
      }),
    );
    expect(JSON.stringify(captureException.mock.calls)).not.toContain(
      "storage.example.com",
    );
  });

  it("isolates sink failures and preserves the caller's control flow", () => {
    const reporter: Reporter = createReporter({
      logger: {
        error: () => {
          throw new Error("stdout unavailable");
        },
      } as unknown as ObservabilityLogger,
      captureException: () => {
        throw new Error("sentry unavailable");
      },
    });

    expect(() =>
      reporter.reportError(new Error("primary failure"), "operation failed"),
    ).not.toThrow();
  });
});
