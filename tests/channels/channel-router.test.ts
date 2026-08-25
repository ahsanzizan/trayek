import { describe, expect, it, vi } from "vitest";

import { createCallerFactory } from "~/server/api/trpc";
import { channelRouter } from "~/server/api/routers/channel";
import { type db } from "~/server/db";

function createCaller() {
  const findUnique = vi.fn().mockResolvedValue({
    channel: "WHATSAPP_BAILEYS",
    status: "NEEDS_PAIRING",
    lastConnectedAt: null,
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
    channelConnection: { findUnique },
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

  return { caller, findUnique, findMany };
}

describe("channel router tenant boundary", () => {
  it("reads the active organization's connection status", async () => {
    const { caller, findUnique } = createCaller();

    await expect(
      caller.status({ channel: "WHATSAPP_BAILEYS" }),
    ).resolves.toMatchObject({ status: "NEEDS_PAIRING" });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_channel: {
          organizationId: "org-a",
          channel: "WHATSAPP_BAILEYS",
        },
      },
      select: {
        channel: true,
        status: true,
        lastConnectedAt: true,
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
