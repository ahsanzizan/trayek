import { describe, expect, it, vi } from "vitest";

import { attachPrismaLogHandlers, prismaLogOptions } from "~/server/db";
import { type ObservabilityLogger } from "~/server/observability/logger";

type PrismaEvent = {
  message: string;
  target: string;
};

describe("Prisma observability logging", () => {
  it("subscribes only to warning and error events", () => {
    expect(prismaLogOptions).toEqual([
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" },
    ]);
  });

  it("forwards redacted warning and error details to the structured logger", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as ObservabilityLogger;
    const listeners = new Map<string, (event: PrismaEvent) => void>();
    const client = {
      $on: (level: string, listener: (event: PrismaEvent) => void) => {
        listeners.set(level, listener);
      },
    } as unknown as Parameters<typeof attachPrismaLogHandlers>[0];

    attachPrismaLogHandlers(client, logger);
    listeners.get("warn")?.({
      target: "postgres",
      message: "slow query for 081234567890",
    });
    listeners.get("error")?.({
      target: "postgres",
      message: "failed URL https://db.example.test/query?token=secret",
    });

    expect(logger.warn).toHaveBeenCalledWith("Prisma warning", {
      target: "postgres",
      message: "slow query for [REDACTED_PHONE]",
    });
    expect(logger.error).toHaveBeenCalledWith("Prisma error", {
      target: "postgres",
      message: "failed URL [REDACTED_URL]",
    });
  });
});
