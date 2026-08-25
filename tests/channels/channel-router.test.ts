import { describe, expect, it, vi } from "vitest";

import { createCallerFactory } from "~/server/api/trpc";
import { channelRouter } from "~/server/api/routers/channel";
import { type db } from "~/server/db";

function createCaller() {
  const now = new Date();
  const findFirst = vi.fn().mockResolvedValue({
    channel: "WHATSAPP_BAILEYS",
    status: "NEEDS_PAIRING",
    lastConnectedAt: null,
    updatedAt: now,
  });
  const findMany = vi.fn().mockResolvedValue([]);
  let database = {} as typeof db;
  database = {
    membership: {
      findUnique: vi.fn().mockResolvedValue({
        id: "membership-a",
        organizationId: "org-a",
        role: "VIEWER",
      }),
    },
    channelConnection: { findFirst },
    messageLog: { findMany },
    $extends: vi.fn(() => database),
  } as unknown as typeof db;

  const caller = createCallerFactory(channelRouter)(() =>
    Promise.resolve({
      db: database,
      headers: new Headers(),
      requestId: "channel-test",
      session: {
        user: { id: "user-a", activeOrganizationId: "org-a" },
        memberships: [],
        expires: "2099-01-01T00:00:00.000Z",
      },
    }),
  );

  return { caller, findFirst, findMany };
}

describe("channel router tenant boundary", () => {
  it("reads the active organization's connection status", async () => {
    const { caller, findFirst } = createCaller();

    await expect(
      caller.status({ channel: "WHATSAPP_BAILEYS" }),
    ).resolves.toMatchObject({ status: "NEEDS_PAIRING" });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-a",
        channel: "WHATSAPP_BAILEYS",
      },
      select: {
        channel: true,
        status: true,
        lastConnectedAt: true,
        updatedAt: true,
      },
    });
  });

  it("scopes intake history to the active organization", async () => {
    const { caller, findMany } = createCaller();

    await caller.intake({ channel: "WHATSAPP_BAILEYS" });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-a",
          channel: "WHATSAPP_BAILEYS",
        },
      }),
    );
  });
});
