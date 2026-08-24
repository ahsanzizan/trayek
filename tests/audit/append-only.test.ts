import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { db } from "~/server/db";

/**
 * Requires a real database, deliberately. The append-only guarantee lives in a
 * Postgres trigger precisely so application code cannot bypass it, which means
 * no fake or mock can demonstrate it — only SQL against the real table can.
 *
 * Follows the same convention as tests/invariants/inv-5-tenant-isolation.
 */

const organization = seedFixturesData.organizations[0];

if (!organization) {
  throw new Error("Seed requires a forwarder organization");
}

const entityId = `audit-append-only-${Date.now()}`;
let createdId: string;

beforeAll(async () => {
  const row = await db.auditLog.create({
    data: {
      organizationId: organization.id,
      actorType: "USER",
      actorId: "user-append-only",
      action: "PROBE_CREATED",
      entityType: "Probe",
      entityId,
    },
    select: { id: true },
  });

  createdId = row.id;
});

afterAll(async () => {
  // Nothing to clean: the row cannot be deleted, which is the point. The
  // entityId is unique per run so repeat runs do not collide.
  await db.$disconnect();
});

describe("AuditLog is append-only", () => {
  it("accepts an insert", async () => {
    const found = await db.auditLog.findUnique({
      where: { id: createdId },
      select: { action: true },
    });

    expect(found?.action).toBe("PROBE_CREATED");
  });

  it("raises a database error on UPDATE", async () => {
    await expect(
      db.auditLog.update({
        where: { id: createdId },
        data: { action: "TAMPERED" },
      }),
    ).rejects.toThrow(/append-only/i);
  });

  it("raises a database error on DELETE", async () => {
    await expect(
      db.auditLog.delete({ where: { id: createdId } }),
    ).rejects.toThrow(/append-only/i);
  });

  it("raises a database error on a bulk UPDATE", async () => {
    await expect(
      db.auditLog.updateMany({
        where: { entityId },
        data: { action: "TAMPERED" },
      }),
    ).rejects.toThrow(/append-only/i);
  });

  it("raises a database error on a bulk DELETE", async () => {
    await expect(
      db.auditLog.deleteMany({ where: { entityId } }),
    ).rejects.toThrow(/append-only/i);
  });

  it("raises a database error on TRUNCATE", async () => {
    // Row-level triggers never fire for TRUNCATE, so this is guarded by a
    // separate statement-level trigger. Raw SQL because Prisma has no API.
    await expect(db.$executeRawUnsafe('TRUNCATE "AuditLog"')).rejects.toThrow(
      /append-only/i,
    );
  });

  it("leaves the row untouched after every rejected attempt", async () => {
    const found = await db.auditLog.findUnique({
      where: { id: createdId },
      select: { action: true, actorId: true },
    });

    expect(found).toMatchObject({
      action: "PROBE_CREATED",
      actorId: "user-append-only",
    });
  });
});
