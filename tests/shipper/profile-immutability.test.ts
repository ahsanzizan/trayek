import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { db } from "~/server/db";

/**
 * Requires a real database, deliberately. TRK-010's immutability criterion is
 * held by a Postgres trigger and a partial unique index precisely so no
 * resolver can bypass them, which means only SQL against the real table can
 * demonstrate it.
 *
 * Follows the convention of tests/audit/append-only.test.ts.
 */

const organization = seedFixturesData.organizations[0];

if (!organization) {
  throw new Error("Seed requires a forwarder organization");
}

const rules = seedFixturesData.requirementProfiles[0]?.rules;

if (!rules) {
  throw new Error("Seed requires a requirement profile fixture");
}

const shipperId = `shipper-immutability-${Date.now()}`;
let activeProfileId: string;

beforeAll(async () => {
  await db.shipper.create({
    data: {
      id: shipperId,
      organizationId: organization.id,
      name: `Uji Imutabilitas ${shipperId}`,
    },
  });

  const profile = await db.requirementProfile.create({
    data: {
      organizationId: organization.id,
      shipperId,
      version: 1,
      rules,
      changeNote: "Versi awal.",
    },
    select: { id: true },
  });

  activeProfileId = profile.id;
});

afterAll(async () => {
  // Deleting is permitted — only editing is not — so the fixture cleans up
  // after itself and the cascade takes the profiles with it.
  await db.shipper.delete({ where: { id: shipperId } });
  await db.$disconnect();
});

describe("a requirement profile version cannot be edited", () => {
  it("rejects a change to the rules", async () => {
    await expect(
      db.requirementProfile.update({
        where: { id: activeProfileId },
        data: { rules: { tampered: true } },
      }),
    ).rejects.toThrow(/immutable/i);
  });

  it("rejects a change to the version number", async () => {
    await expect(
      db.requirementProfile.update({
        where: { id: activeProfileId },
        data: { version: 99 },
      }),
    ).rejects.toThrow(/immutable/i);
  });

  it("rejects a change to the change note", async () => {
    await expect(
      db.requirementProfile.update({
        where: { id: activeProfileId },
        data: { changeNote: "diam-diam diubah" },
      }),
    ).rejects.toThrow(/immutable/i);
  });

  it("rejects moving a version to another shipper", async () => {
    await expect(
      db.requirementProfile.update({
        where: { id: activeProfileId },
        data: { shipperId: "shipper-a-fmcg" },
      }),
    ).rejects.toThrow(/immutable/i);
  });

  it("rejects a bulk edit, which is the same hole with a different API", async () => {
    await expect(
      db.requirementProfile.updateMany({
        where: { shipperId },
        data: { changeNote: "diubah massal" },
      }),
    ).rejects.toThrow(/immutable/i);
  });

  it("leaves the row untouched after every rejected attempt", async () => {
    const found = await db.requirementProfile.findUnique({
      where: { id: activeProfileId },
      select: { version: true, changeNote: true, shipperId: true },
    });

    expect(found).toMatchObject({
      version: 1,
      changeNote: "Versi awal.",
      shipperId,
    });
  });
});

describe("only one version is active per shipper", () => {
  it("rejects a second active version while the first is active", async () => {
    await expect(
      db.requirementProfile.create({
        data: {
          organizationId: organization.id,
          shipperId,
          version: 2,
          rules,
          changeNote: "Versi kedua tanpa mengganti versi pertama.",
        },
      }),
    ).rejects.toThrow();
  });

  it("permits superseding the active version", async () => {
    const superseded = await db.requirementProfile.update({
      where: { id: activeProfileId },
      data: { supersededAt: new Date() },
      select: { supersededAt: true },
    });

    expect(superseded.supersededAt).toBeInstanceOf(Date);
  });

  it("permits a new active version once the previous one is superseded", async () => {
    const next = await db.requirementProfile.create({
      data: {
        organizationId: organization.id,
        shipperId,
        version: 2,
        rules,
        changeNote: "Versi kedua.",
      },
      select: { version: true, supersededAt: true },
    });

    expect(next).toMatchObject({ version: 2, supersededAt: null });
  });

  it("rejects re-superseding a version that is already superseded", async () => {
    // A supersededAt that can be moved would make an archived version
    // editable by the back door.
    await expect(
      db.requirementProfile.update({
        where: { id: activeProfileId },
        data: { supersededAt: new Date("2020-01-01") },
      }),
    ).rejects.toThrow(/already superseded/i);
  });

  it("rejects reviving a superseded version by clearing the stamp", async () => {
    await expect(
      db.requirementProfile.update({
        where: { id: activeProfileId },
        data: { supersededAt: null },
      }),
    ).rejects.toThrow(/already superseded/i);
  });
});
