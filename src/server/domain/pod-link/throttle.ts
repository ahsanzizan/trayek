/**
 * Fixed-window throttling for the public POD upload route (TRK-024).
 *
 * Fixed window rather than sliding: the counter is a row in Postgres, and a
 * sliding window would mean storing every attempt. The route is protecting
 * against a scan for live tokens, not against a precisely paced attacker, and
 * a doubled burst at a window edge is an acceptable cost for one row per
 * bucket instead of one row per request.
 */

export type ThrottleWindow = {
  windowStartedAt: Date;
  count: number;
};

export type ThrottlePolicy = {
  limit: number;
  windowMs: number;
};

export type ThrottleDecision = {
  allowed: boolean;
  /** The window to persist, whether or not the request was allowed. */
  next: ThrottleWindow;
};

/**
 * Per token: a driver retaking photos reloads the page a handful of times.
 * Twenty views in five minutes is far above that and far below what walking
 * the token space would need.
 */
export const POD_LINK_TOKEN_THROTTLE: ThrottlePolicy = {
  limit: 20,
  windowMs: 5 * 60 * 1000,
};

/**
 * Per IP: a warehouse full of drivers shares one NAT, so this has to clear a
 * legitimate crowd. It exists to stop enumeration from one host, which shows
 * up as hundreds of misses, not dozens of hits.
 */
export const POD_LINK_IP_THROTTLE: ThrottlePolicy = {
  limit: 60,
  windowMs: 5 * 60 * 1000,
};

export function evaluateThrottle(
  window: ThrottleWindow | null,
  policy: ThrottlePolicy,
  now: Date,
): ThrottleDecision {
  const expired =
    window === null ||
    now.getTime() - window.windowStartedAt.getTime() >= policy.windowMs;

  if (expired) {
    return {
      allowed: policy.limit > 0,
      next: { windowStartedAt: now, count: 1 },
    };
  }

  const count = window.count + 1;

  return {
    // The request that reaches the limit is the last allowed one, so a limit
    // of 20 permits 20 requests rather than 19.
    allowed: count <= policy.limit,
    next: { windowStartedAt: window.windowStartedAt, count },
  };
}
