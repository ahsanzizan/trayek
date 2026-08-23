import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({
  auth: vi.fn(),
}));

import { createDatabase, createCaller, testMembership } from "./helpers";

describe("orgProcedure", () => {
  it("rejects a session without an active organization", async () => {
    const caller = createCaller(createDatabase(null), null);

    await expect(caller.scopedIdentity()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects an active organization without a live membership", async () => {
    const caller = createCaller(createDatabase(null), "org-a");

    await expect(caller.scopedIdentity()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.publicIdentity()).resolves.toBe("public");
  });

  it("injects the live membership and organization scope", async () => {
    const caller = createCaller(createDatabase(testMembership), "org-a");

    await expect(caller.scopedIdentity()).resolves.toEqual({
      organizationId: "org-a",
      membershipRole: "VIEWER",
    });
  });
});
