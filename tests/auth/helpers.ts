import { vi } from "vitest";

import {
  createCallerFactory,
  createTRPCRouter,
  orgProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { db } from "~/server/db";

export const testUserId = "user-a";

export const testMembership = {
  id: "membership-a",
  organizationId: "org-a",
  role: "VIEWER" as const,
};

export function createDatabase(foundMembership: typeof testMembership | null) {
  let database = {} as typeof db;
  database = {
    membership: {
      findUnique: vi.fn(async () => foundMembership),
      findMany: vi.fn(async () => (foundMembership ? [foundMembership] : [])),
    },
    $extends: vi.fn(() => database),
  } as unknown as typeof db;
  return database;
}

export function createCaller(
  database: typeof db,
  activeOrganizationId: string | null,
) {
  const router = createTRPCRouter({
    scopedIdentity: orgProcedure.query(({ ctx }) => ({
      organizationId: ctx.organizationId,
      membershipRole: ctx.membership.role,
    })),
    publicIdentity: publicProcedure.query(() => "public"),
  });
  const caller = createCallerFactory(router)(async () => ({
    db: database,
    headers: new Headers(),
    requestId: "test-request",
    session: {
      user: { id: testUserId, activeOrganizationId },
      memberships: [],
      expires: "2099-01-01T00:00:00.000Z",
    },
  }));

  return caller;
}
