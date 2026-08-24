import { describe, expect, it } from "vitest";

import nextConfig, { sentryBuildOptions } from "../../next.config.js";
import {
  forwardedPinoLevels,
  serverSentryOptions,
} from "~/sentry.server.config";
import { onRequestError, register } from "~/instrumentation";

describe("Sentry server configuration", () => {
  it("enables only the privacy-safe server logging boundary", () => {
    expect(serverSentryOptions.enableLogs).toBe(true);
    expect(forwardedPinoLevels).toEqual(["info", "warn", "error"]);
    expect(serverSentryOptions.integrations).toHaveLength(1);
    expect(serverSentryOptions.dataCollection).toMatchObject({
      userInfo: false,
      httpBodies: [],
      cookies: false,
      httpHeaders: {
        request: { deny: ["authorization", "cookie"] },
        response: { deny: ["authorization", "cookie"] },
      },
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
    });
    expect(sentryBuildOptions).toMatchObject({
      sourcemaps: { disable: true },
    });
    expect(nextConfig).toBeDefined();
  });

  it("registers the Node server SDK and request error hook", () => {
    expect(register).toEqual(expect.any(Function));
    expect(onRequestError).toEqual(expect.any(Function));
  });

  it("redacts sensitive data in beforeSend hook", () => {
    const rawEvent = {
      message: "failure on +62 812 3456 7890",
      exception: {
        values: [
          {
            value:
              "error downloading https://storage.example.com/file?token=123",
          },
        ],
      },
      extra: {
        phone: "0812-3456-7890",
        secret: "super-secret-key",
      },
    };

    const sanitizedEvent = serverSentryOptions.beforeSend?.(
      rawEvent as unknown as Parameters<
        NonNullable<typeof serverSentryOptions.beforeSend>
      >[0],
    );

    expect(sanitizedEvent?.message).toBe("failure on [REDACTED_PHONE]");
    expect(sanitizedEvent?.exception?.values?.[0]?.value).toBe(
      "error downloading [REDACTED_URL]",
    );
    expect(sanitizedEvent?.extra?.phone).toBe("[REDACTED_PHONE]");
    expect(sanitizedEvent?.extra?.secret).toBe("[REDACTED]");
  });
});
