import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({
  auth: vi.fn(),
}));

import {
  createCallerFactory,
  createTRPCRouter,
  roleProcedure,
} from "~/server/api/trpc";
import { db } from "~/server/db";

function createCaller(role: "OWNER" | "ADMIN" | "FINANCE" | "VIEWER") {
  let database = {} as typeof db;
  database = {
    membership: {
      findUnique: vi.fn(async () => ({
        id: "membership-a",
        organizationId: "org-a",
        role,
      })),
    },
    $extends: vi.fn(() => database),
  } as unknown as typeof db;

  const router = createTRPCRouter({
    financeAction: roleProcedure("FINANCE").mutation(() => ({ ok: true })),
  });

  return createCallerFactory(router)(async () => ({
    db: database,
    headers: new Headers(),
    session: {
      user: { id: "user-a", activeOrganizationId: "org-a" },
      memberships: [],
      expires: "2099-01-01T00:00:00.000Z",
    },
  }));
}

describe("roleProcedure", () => {
  it("allows OWNER to pass every role gate", async () => {
    await expect(createCaller("OWNER").financeAction()).resolves.toEqual({
      ok: true,
    });
  });

  it("allows the requested role", async () => {
    await expect(createCaller("FINANCE").financeAction()).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects a member with an insufficient role", async () => {
    await expect(createCaller("ADMIN").financeAction()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
