import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({
  auth: vi.fn(),
}));

import { organizationRouter } from "~/server/api/routers/organization";
import { createCallerFactory } from "~/server/api/trpc";
import { db } from "~/server/db";

function createCaller(foundOrganizationId: string | null) {
  const database = {
    membership: {
      findUnique: vi.fn(async () =>
        foundOrganizationId
          ? {
              id: "membership-b",
              organizationId: foundOrganizationId,
              role: "VIEWER" as const,
            }
          : null,
      ),
      findMany: vi.fn(async () => []),
    },
  } as unknown as typeof db;

  return createCallerFactory(organizationRouter)(async () => ({
    db: database,
    headers: new Headers(),
    session: {
      user: { id: "user-a", activeOrganizationId: "org-a" },
      memberships: [],
      expires: "2099-01-01T00:00:00.000Z",
    },
  }));
}

describe("organization.switchOrganization", () => {
  it("returns the verified membership as the new active organization", async () => {
    await expect(
      createCaller("org-b").switchOrganization({ organizationId: "org-b" }),
    ).resolves.toEqual({
      activeOrganizationId: "org-b",
      membership: {
        id: "membership-b",
        organizationId: "org-b",
        role: "VIEWER",
      },
    });
  });

  it("does not switch to an organization without a membership", async () => {
    await expect(
      createCaller(null).switchOrganization({ organizationId: "org-b" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
