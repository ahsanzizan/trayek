import { describe, expect, it } from "vitest";

import {
  evaluateThrottle,
  POD_LINK_IP_THROTTLE,
  POD_LINK_TOKEN_THROTTLE,
  type ThrottlePolicy,
} from "~/server/domain/pod-link/throttle";

const NOW = new Date("2026-08-25T10:00:00.000Z");
const POLICY: ThrottlePolicy = { limit: 3, windowMs: 60_000 };

describe("the first request in a window", () => {
  it("opens a window when none exists", () => {
    const decision = evaluateThrottle(null, POLICY, NOW);

    expect(decision).toEqual({
      allowed: true,
      next: { windowStartedAt: NOW, count: 1 },
    });
  });

  it("opens a fresh window once the previous one has elapsed", () => {
    const decision = evaluateThrottle(
      { windowStartedAt: new Date("2026-08-25T09:59:00.000Z"), count: 99 },
      POLICY,
      NOW,
    );

    expect(decision).toEqual({
      allowed: true,
      next: { windowStartedAt: NOW, count: 1 },
    });
  });
});

describe("requests inside a window", () => {
  const windowStartedAt = new Date("2026-08-25T09:59:30.000Z");

  it("counts up and keeps the original window start", () => {
    const decision = evaluateThrottle(
      { windowStartedAt, count: 1 },
      POLICY,
      NOW,
    );

    expect(decision).toEqual({
      allowed: true,
      next: { windowStartedAt, count: 2 },
    });
  });

  it("allows the request that reaches the limit", () => {
    const decision = evaluateThrottle(
      { windowStartedAt, count: 2 },
      POLICY,
      NOW,
    );

    expect(decision.allowed).toBe(true);
    expect(decision.next.count).toBe(3);
  });

  it("refuses the request after the limit", () => {
    const decision = evaluateThrottle(
      { windowStartedAt, count: 3 },
      POLICY,
      NOW,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.next.count).toBe(4);
  });

  it("keeps counting refused requests, so a burst does not reset itself", () => {
    const decision = evaluateThrottle(
      { windowStartedAt, count: 500 },
      POLICY,
      NOW,
    );

    expect(decision).toEqual({
      allowed: false,
      next: { windowStartedAt, count: 501 },
    });
  });
});

describe("the window boundary", () => {
  it("treats a window exactly as old as its length as elapsed", () => {
    const decision = evaluateThrottle(
      { windowStartedAt: new Date(NOW.getTime() - 60_000), count: 3 },
      POLICY,
      NOW,
    );

    expect(decision.allowed).toBe(true);
    expect(decision.next.windowStartedAt).toEqual(NOW);
  });

  it("treats one millisecond short of the length as still inside", () => {
    const decision = evaluateThrottle(
      { windowStartedAt: new Date(NOW.getTime() - 59_999), count: 3 },
      POLICY,
      NOW,
    );

    expect(decision.allowed).toBe(false);
  });
});

describe("the shipped policies", () => {
  it("limits a token more tightly than an IP, since a warehouse shares one", () => {
    expect(POD_LINK_TOKEN_THROTTLE.limit).toBeLessThan(
      POD_LINK_IP_THROTTLE.limit,
    );
  });

  it("leaves room for a driver retaking photos a handful of times", () => {
    expect(POD_LINK_TOKEN_THROTTLE.limit).toBeGreaterThanOrEqual(10);
  });
});
