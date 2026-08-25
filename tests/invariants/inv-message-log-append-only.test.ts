import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { db } from "~/server/db";

const organization = seedFixturesData.organizations[0];

if (!organization) {
  throw new Error("Seed requires a forwarder organization");
}

const messageId = `message-log-immutable-${Date.now()}`;
const externalId = `external-message-${Date.now()}`;

beforeAll(async () => {
  await db.messageLog.create({
    data: {
      id: messageId,
      organizationId: organization.id,
      channel: "WHATSAPP_BAILEYS",
      direction: "OUTBOUND",
      from: "system",
      to: "+628123456789",
      body: "hello",
      status: "PENDING",
      truncated: false,
    },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("MessageLog mutation boundary", () => {
  it("allows only the delivery transition and external identifier update", async () => {
    await expect(
      db.messageLog.update({
        where: { id: messageId },
        data: { status: "SENT", externalId },
        select: { status: true, externalId: true },
      }),
    ).resolves.toEqual({ status: "SENT", externalId });
  });

  it("rejects edits to the recorded message body", async () => {
    await expect(
      db.messageLog.update({
        where: { id: messageId },
        data: { body: "tampered" },
      }),
    ).rejects.toThrow(/immutable|append-only/i);
  });

  it("rejects deletion of the recorded message", async () => {
    await expect(
      db.messageLog.delete({ where: { id: messageId } }),
    ).rejects.toThrow(/immutable|append-only/i);
  });
});
