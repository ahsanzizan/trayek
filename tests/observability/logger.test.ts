import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  createObservabilityLogger,
  type ObservabilityLogger,
} from "~/server/observability/logger";
import {
  createObservabilityContext,
  runWithObservabilityContext,
} from "~/server/observability/context";

function readRecords(output: PassThrough): Record<string, unknown>[] {
  const text = output.read()?.toString() ?? "";
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line: string) => JSON.parse(line) as Record<string, unknown>);
}

async function flushLogs(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("structured observability logger", () => {
  it("writes one redacted JSON record per call with stable correlation keys", async () => {
    const output = new PassThrough();
    const logger = createObservabilityLogger(output);

    await runWithObservabilityContext(
      createObservabilityContext("request-1", "org-a"),
      async () => {
        logger.info("load processed", {
          phone: "+6281234567890",
          nested: {
            signedUrl: "https://storage.example.com/signed?token=secret",
          },
        });
        logger.warn("load warning");
        logger.error("load failed", { error: new Error("081234567890") });
      },
    );
    await flushLogs();

    const records = readRecords(output);

    expect(records).toHaveLength(3);
    expect(records.map((record) => record.msg)).toEqual([
      "load processed",
      "load warning",
      "load failed",
    ]);
    for (const record of records) {
      expect(record).toMatchObject({
        requestId: "request-1",
        organizationId: "org-a",
      });
    }
    expect(records[0]).toMatchObject({
      phone: "[REDACTED_PHONE]",
      nested: { signedUrl: "[REDACTED_URL]" },
    });
    expect(JSON.stringify(records)).not.toContain("6281234567890");
    expect(JSON.stringify(records)).not.toContain("storage.example.com");
  });

  it("retains explicit null organization correlation outside a tenant boundary", async () => {
    const output = new PassThrough();
    const logger: ObservabilityLogger = createObservabilityLogger(output);

    await runWithObservabilityContext(
      createObservabilityContext("callback-1"),
      async () => logger.info("upload callback failed"),
    );
    await flushLogs();

    expect(readRecords(output)[0]).toMatchObject({
      requestId: "callback-1",
      organizationId: null,
    });
  });
});
