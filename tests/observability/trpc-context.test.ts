import { describe, expect, it, vi } from "vitest";

import {
  createCallerFactory,
  createTRPCRouter,
  orgProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { getObservabilityContext } from "~/server/observability/context";
import { logger } from "~/server/observability/logger";
import { createDatabase, testMembership, testUserId } from "../auth/helpers";

describe("tRPC observability context", () => {
  it("correlates public calls and enriches only verified tenant calls", async () => {
    const database = createDatabase(testMembership);
    const router = createTRPCRouter({
      publicIdentity: publicProcedure.query(({ ctx }) => ({
        requestId: ctx.requestId,
        context: getObservabilityContext(),
      })),
      scopedIdentity: orgProcedure.query(({ ctx }) => ({
        requestId: ctx.requestId,
        organizationId: ctx.organizationId,
        context: getObservabilityContext(),
      })),
    });
    const caller = createCallerFactory(router)(async () => ({
      db: database,
      headers: new Headers({ "x-request-id": "request-1" }),
      requestId: "request-1",
      session: {
        user: { id: testUserId, activeOrganizationId: "org-a" },
        memberships: [],
        expires: "2099-01-01T00:00:00.000Z",
      },
    }));

    await expect(caller.publicIdentity()).resolves.toEqual({
      requestId: "request-1",
      context: { requestId: "request-1", organizationId: null },
    });
    await expect(caller.scopedIdentity()).resolves.toEqual({
      requestId: "request-1",
      organizationId: "org-a",
      context: { requestId: "request-1", organizationId: "org-a" },
    });
  });

  it("replaces an unsafe inbound request ID with a generated one", async () => {
    const database = createDatabase(null);
    const router = createTRPCRouter({
      identity: publicProcedure.query(({ ctx }) => ctx.requestId),
    });
    const caller = createCallerFactory(router)(async () => ({
      db: database,
      headers: new Headers({ "x-request-id": "contains spaces" }),
      requestId: "contains spaces",
      session: null,
    }));

    await expect(caller.identity()).resolves.toMatch(/^[a-f0-9-]{36}$/);
  });

  it("keeps verified tenant context for the structured timing event", async () => {
    const database = createDatabase(testMembership);
    const router = createTRPCRouter({
      scopedIdentity: orgProcedure.query(() => "ok"),
    });
    const caller = createCallerFactory(router)(async () => ({
      db: database,
      headers: new Headers({ "x-request-id": "request-1" }),
      requestId: "request-1",
      session: {
        user: { id: testUserId, activeOrganizationId: "org-a" },
        memberships: [],
        expires: "2099-01-01T00:00:00.000Z",
      },
    }));
    let observedContext: ReturnType<typeof getObservabilityContext> | undefined;
    const info = vi.spyOn(logger, "info").mockImplementation(() => {
      observedContext = getObservabilityContext();
    });

    try {
      await caller.scopedIdentity();
    } finally {
      info.mockRestore();
    }

    expect(observedContext).toEqual({
      requestId: "request-1",
      organizationId: "org-a",
    });
  });
});
