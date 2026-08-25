import { afterAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";

const organization = seedFixturesData.organizations[0];
const seededDriver = seedFixturesData.drivers[0];
const foreignDriver = seedFixturesData.drivers[2];

if (!organization || !seededDriver || !foreignDriver) {
  throw new Error("Seed requires drivers in both forwarder organizations");
}

function callerFor(userId: string) {
  return createCaller(() =>
    Promise.resolve({
      db,
      headers: new Headers(),
      requestId: "driver-router-test",
      session: {
        user: { id: userId, activeOrganizationId: organization.id },
        memberships: [],
        expires: "2099-01-01T00:00:00.000Z",
      },
    }),
  );
}

const admin = callerFor("user-forwarder-a-admin");
const finance = callerFor("user-forwarder-a-finance");

const suffix = Date.now().toString().slice(-6);
const createdIds: string[] = [];

afterAll(async () => {
  await db.driver.deleteMany({ where: { id: { in: createdIds } } });
  await db.$disconnect();
});

async function createDriver(name: string, phone: string) {
  const driver = await admin.driver.create({
    name,
    phone,
    vehiclePlate: null,
    vendorId: null,
  });

  createdIds.push(driver.id);
  return driver;
}

describe("creating a driver", () => {
  it("stores the phone in E.164 whatever the caller typed", async () => {
    const driver = await createDriver(`Pak Uji ${suffix}`, `0812-${suffix}`);

    expect(driver.phone).toBe(`+62812${suffix}`);
    expect(driver.deduplicated).toBe(false);
  });

  it("rejects a number that is not an Indonesian mobile", async () => {
    await expect(
      admin.driver.create({
        name: "Pak Kantor",
        phone: "021-555-1234",
        vehiclePlate: null,
        vendorId: null,
      }),
    ).rejects.toThrow(/ponsel/i);
  });

  it("rejects a foreign number", async () => {
    await expect(
      admin.driver.create({
        name: "Mr Tan",
        phone: "+6591234567",
        vehiclePlate: null,
        vendorId: null,
      }),
    ).rejects.toThrow(/\+62/);
  });

  it("refuses a FINANCE member", async () => {
    await expect(admin.driver.list()).resolves.toBeInstanceOf(Array);

    await expect(
      finance.driver.create({
        name: "Pak Tidak Boleh",
        phone: "081298765432",
        vehiclePlate: null,
        vendorId: null,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("records a subcontractor code without pretending it is a join", async () => {
    const driver = await admin.driver.create({
      name: `Pak Vendor ${suffix}`,
      phone: `0813-${suffix}`,
      vehiclePlate: "B 1234 CD",
      vendorId: "VND-EXTERNAL-01",
    });

    createdIds.push(driver.id);
    expect(driver.vendorId).toBe("VND-EXTERNAL-01");
  });
});

describe("deduplication on the normalised phone", () => {
  it("returns the existing record for the same number written differently", async () => {
    const first = await createDriver(`Pak Dedup ${suffix}`, `0814${suffix}`);

    const again = await admin.driver.create({
      // Same number, four cosmetic differences.
      name: "Nama lain sama sekali",
      phone: `+62 814-${suffix}`,
      vehiclePlate: null,
      vendorId: null,
    });

    expect(again.id).toBe(first.id);
    expect(again.deduplicated).toBe(true);
    expect(again.name).toBe(`Pak Dedup ${suffix}`);
  });

  it("writes no second row", async () => {
    const rows = await db.driver.count({
      where: { organizationId: organization.id, phone: `+62814${suffix}` },
    });

    expect(rows).toBe(1);
  });

  it("writes no audit entry for a deduplicated call", async () => {
    const driver = await db.driver.findFirst({
      where: { organizationId: organization.id, phone: `+62814${suffix}` },
      select: { id: true },
    });

    // One row for the create that happened, and none for the one that did not.
    const entries = await db.auditLog.count({
      where: { entityType: "Driver", entityId: driver?.id },
    });

    expect(entries).toBe(1);
  });

  it("matches a seeded driver reached through a different spelling", async () => {
    const found = await admin.driver.create({
      name: "Herman lagi",
      phone: "0812.3456.7890",
      vehiclePlate: null,
      vendorId: null,
    });

    expect(found).toMatchObject({
      id: seededDriver.id,
      name: seededDriver.name,
      deduplicated: true,
    });
  });
});

describe("drivers stay inside their organization", () => {
  it("hides another organization's driver from a direct read", async () => {
    await expect(
      admin.driver.byId({ driverId: foreignDriver.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hides another organization's driver from the list", async () => {
    const ids = (await admin.driver.list()).map((driver) => driver.id);

    expect(ids).toContain(seededDriver.id);
    expect(ids).not.toContain(foreignDriver.id);
  });

  it("lets the same number exist in two organizations", async () => {
    // Deduplication is scoped per organization: two forwarders can each
    // subcontract the same driver, and neither may see the other's record.
    const created = await createDriver(
      `Pak Bersama ${suffix}`,
      foreignDriver.phone,
    );

    expect(created.deduplicated).toBe(false);
    expect(created.id).not.toBe(foreignDriver.id);
  });
});
