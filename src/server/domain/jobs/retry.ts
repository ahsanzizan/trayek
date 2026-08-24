import { type RetryPolicy } from "~/server/domain/jobs/port";

/**
 * Conservative default. Three attempts over roughly a minute is enough to ride
 * out a provider blip without leaving a POD sitting unprocessed for an hour.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelaySeconds: 5,
  maxDelaySeconds: 300,
};

export class InvalidRetryPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRetryPolicyError";
  }
}

export function assertValidRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new InvalidRetryPolicyError(
      "maxAttempts must be an integer of at least 1",
    );
  }

  if (policy.initialDelaySeconds < 0) {
    throw new InvalidRetryPolicyError("initialDelaySeconds cannot be negative");
  }

  if (policy.maxDelaySeconds < policy.initialDelaySeconds) {
    throw new InvalidRetryPolicyError(
      "maxDelaySeconds cannot be below initialDelaySeconds",
    );
  }
}

/**
 * Exponential backoff, capped. `attempt` is 1-based, so the delay before the
 * second attempt is the initial delay.
 */
export function backoffSeconds(policy: RetryPolicy, attempt: number): number {
  if (attempt < 1) {
    throw new InvalidRetryPolicyError("attempt must be at least 1");
  }

  const exponent = Math.min(attempt - 1, 16);
  const delay = policy.initialDelaySeconds * 2 ** exponent;

  return Math.min(delay, policy.maxDelaySeconds);
}

/** True when this attempt was the last one the policy allows. */
export function isTerminalAttempt(
  policy: RetryPolicy,
  attempt: number,
): boolean {
  return attempt >= policy.maxAttempts;
}
