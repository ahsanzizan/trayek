import { describe, expect, it } from "vitest";

import { type RetryPolicy } from "~/server/domain/jobs/port";
import {
  assertValidRetryPolicy,
  backoffSeconds,
  DEFAULT_RETRY_POLICY,
  InvalidRetryPolicyError,
  isTerminalAttempt,
} from "~/server/domain/jobs/retry";

const policy: RetryPolicy = {
  maxAttempts: 5,
  initialDelaySeconds: 5,
  maxDelaySeconds: 60,
};

describe("backoffSeconds", () => {
  it("doubles the delay per attempt", () => {
    expect(backoffSeconds(policy, 1)).toBe(5);
    expect(backoffSeconds(policy, 2)).toBe(10);
    expect(backoffSeconds(policy, 3)).toBe(20);
  });

  it("caps at the policy maximum", () => {
    expect(backoffSeconds(policy, 10)).toBe(60);
  });

  it("rejects an attempt below one", () => {
    expect(() => backoffSeconds(policy, 0)).toThrow(InvalidRetryPolicyError);
  });
});

describe("isTerminalAttempt", () => {
  it("is terminal on the last attempt the policy allows", () => {
    expect(isTerminalAttempt(policy, 4)).toBe(false);
    expect(isTerminalAttempt(policy, 5)).toBe(true);
    expect(isTerminalAttempt(policy, 6)).toBe(true);
  });

  it("is terminal on the first throw when only one attempt is allowed", () => {
    expect(
      isTerminalAttempt(
        { maxAttempts: 1, initialDelaySeconds: 0, maxDelaySeconds: 0 },
        1,
      ),
    ).toBe(true);
  });
});

describe("assertValidRetryPolicy", () => {
  it("accepts the default policy", () => {
    expect(() => assertValidRetryPolicy(DEFAULT_RETRY_POLICY)).not.toThrow();
  });

  it("rejects a policy that would never run", () => {
    expect(() =>
      assertValidRetryPolicy({
        maxAttempts: 0,
        initialDelaySeconds: 5,
        maxDelaySeconds: 60,
      }),
    ).toThrow(InvalidRetryPolicyError);
  });

  it("rejects a maximum delay below the initial delay", () => {
    expect(() =>
      assertValidRetryPolicy({
        maxAttempts: 3,
        initialDelaySeconds: 60,
        maxDelaySeconds: 5,
      }),
    ).toThrow(InvalidRetryPolicyError);
  });

  it("rejects a negative initial delay", () => {
    expect(() =>
      assertValidRetryPolicy({
        maxAttempts: 3,
        initialDelaySeconds: -1,
        maxDelaySeconds: 60,
      }),
    ).toThrow(InvalidRetryPolicyError);
  });
});
