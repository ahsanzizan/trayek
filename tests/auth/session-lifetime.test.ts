import { describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS,
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  resolveSessionLifetime,
} from "~/server/auth/membership";

describe("organization session lifetime", () => {
  it("uses the global defaults when an organization has no overrides", () => {
    expect(resolveSessionLifetime(null)).toEqual({
      maxAge: DEFAULT_SESSION_MAX_AGE_SECONDS,
      updateAge: DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS,
    });
  });

  it("uses each configured organization lifetime independently", () => {
    expect(
      resolveSessionLifetime({
        sessionMaxAgeSeconds: 7_200,
        sessionIdleTimeoutSeconds: 900,
      }),
    ).toEqual({ maxAge: 7_200, updateAge: 900 });
  });
});
