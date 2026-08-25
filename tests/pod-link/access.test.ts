import { describe, expect, it } from "vitest";

import {
  evaluateLinkAccess,
  LINK_REFUSAL_MESSAGES,
  type LinkRefusalReason,
  type UploadLinkState,
} from "~/server/domain/pod-link/access";

const NOW = new Date("2026-08-25T10:00:00.000Z");

function link(overrides: Partial<UploadLinkState> = {}): UploadLinkState {
  return {
    expiresAt: new Date("2026-09-08T10:00:00.000Z"),
    revokedAt: null,
    useBudget: 10,
    useCount: 0,
    ...overrides,
  };
}

describe("a usable link", () => {
  it("is allowed and reports what is left of the budget", () => {
    const decision = evaluateLinkAccess(link({ useCount: 3 }), NOW);

    expect(decision).toEqual({ allowed: true, remainingUses: 7 });
  });

  it("is still allowed on its final use", () => {
    expect(evaluateLinkAccess(link({ useCount: 9 }), NOW)).toEqual({
      allowed: true,
      remainingUses: 1,
    });
  });
});

describe("an expired link", () => {
  it("is refused once the expiry has passed", () => {
    const decision = evaluateLinkAccess(
      link({ expiresAt: new Date("2026-08-25T09:59:59.999Z") }),
      NOW,
    );

    expect(decision).toEqual({ allowed: false, reason: "EXPIRED" });
  });

  it("is refused at the exact instant it expires, not a millisecond later", () => {
    expect(evaluateLinkAccess(link({ expiresAt: NOW }), NOW)).toEqual({
      allowed: false,
      reason: "EXPIRED",
    });
  });
});

describe("a revoked link", () => {
  it("is refused", () => {
    expect(
      evaluateLinkAccess(
        link({ revokedAt: new Date("2026-08-25T09:00:00.000Z") }),
        NOW,
      ),
    ).toEqual({ allowed: false, reason: "REVOKED" });
  });

  it("reports revocation rather than expiry when it is both", () => {
    // The admin revoked this link for a reason. That reason is what should
    // come back, not the fact that it would have lapsed anyway.
    const decision = evaluateLinkAccess(
      link({
        revokedAt: new Date("2026-08-24T10:00:00.000Z"),
        expiresAt: new Date("2026-08-24T11:00:00.000Z"),
      }),
      NOW,
    );

    expect(decision).toEqual({ allowed: false, reason: "REVOKED" });
  });

  it("is still live when the revocation timestamp is in the future", () => {
    const decision = evaluateLinkAccess(
      link({ revokedAt: new Date("2026-08-26T10:00:00.000Z") }),
      NOW,
    );

    expect(decision).toEqual({ allowed: true, remainingUses: 10 });
  });
});

describe("an exhausted link", () => {
  it("is refused once the budget is spent", () => {
    expect(
      evaluateLinkAccess(link({ useBudget: 3, useCount: 3 }), NOW),
    ).toEqual({ allowed: false, reason: "EXHAUSTED" });
  });

  it("stays refused if the count somehow ran past the budget", () => {
    expect(
      evaluateLinkAccess(link({ useBudget: 3, useCount: 9 }), NOW),
    ).toEqual({ allowed: false, reason: "EXHAUSTED" });
  });
});

describe("what the driver is told", () => {
  const reasons: LinkRefusalReason[] = [
    "NOT_FOUND",
    "EXPIRED",
    "REVOKED",
    "EXHAUSTED",
    "THROTTLED",
  ];

  it("has a message for every refusal reason", () => {
    for (const reason of reasons) {
      expect(LINK_REFUSAL_MESSAGES[reason]?.trim().length ?? 0).toBeGreaterThan(
        20,
      );
    }
  });

  it("points at the admin for every reason a new link would fix", () => {
    for (const reason of ["EXPIRED", "REVOKED", "EXHAUSTED"] as const) {
      expect(LINK_REFUSAL_MESSAGES[reason]).toContain("admin");
    }
  });

  it("says nothing in English", () => {
    // The acceptance criterion is that no text on this screen requires reading
    // English. "admin" is the same word in both languages and is allowed.
    const english =
      /\b(link|expired|revoked|invalid|error|please|contact|upload|again|try)\b/i;

    for (const reason of reasons) {
      expect(LINK_REFUSAL_MESSAGES[reason]).not.toMatch(english);
    }
  });

  it("never leaks a stack trace or an internal identifier", () => {
    for (const reason of reasons) {
      expect(LINK_REFUSAL_MESSAGES[reason]).not.toMatch(
        /at \w+|Error:|\bcuid\b|\bnull\b|undefined/,
      );
    }
  });
});
