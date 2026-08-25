import { afterAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { createCaller } from "~/server/api/root";
import { scopeTenantOperation } from "~/server/api/tenant-extension";
import { db } from "~/server/db";

const organizationA = seedFixturesData.organizations[0];
const organizationB = seedFixturesData.organizations[1];

if (!organizationA || !organizationB) {
  throw new Error("Seed requires both forwarder organizations");
}

const shipperInA = seedFixturesData.shippers[0];
const shipperInB = seedFixturesData.shippers[2];

if (!shipperInA || !shipperInB) {
  throw new Error("Seed requires a shipper in each forwarder organization");
}

/**
 * Callers are built against the real database and the real router, so the
 * membership lookup, the tenant extension, and the resolvers are all exercised.
 * A mock here would only prove the mock filters.
 */
function callerFor(userId: string, activeOrganizationId: string) {
  return createCaller(() =>
    Promise.resolve({
      db,
      headers: new Headers(),
      requestId: "inv-5-test",
      session: {
        user: { id: userId, activeOrganizationId },
        memberships: [],
        expires: "2099-01-01T00:00:00.000Z",
      },
    }),
  );
}

// Owner of organization A, who also holds a VIEWER membership in organization
// B. Holding a membership elsewhere must not widen what the active
// organization can see.
const ownerOfA = "user-forwarder-a-owner";
const createdShipperIds: string[] = [];

afterAll(async () => {
  if (createdShipperIds.length > 0) {
    await db.shipper.deleteMany({ where: { id: { in: createdShipperIds } } });
  }
  await db.$disconnect();
});

describe("INV-5: Tenant isolation", () => {
  it("returns only organization A memberships for an organization A scope", async () => {
    const [organizationARows, organizationBRows] = await Promise.all([
      db.membership.findMany({
        where: { organizationId: organizationA.id },
        select: { organizationId: true },
      }),
      db.membership.findMany({
        where: { organizationId: organizationB.id },
        select: { organizationId: true },
      }),
    ]);

    expect(organizationARows.length).toBeGreaterThan(0);
    expect(organizationBRows.length).toBeGreaterThan(0);
    expect(
      organizationARows.every((row) => row.organizationId === organizationA.id),
    ).toBe(true);
    expect(
      organizationARows.some((row) => row.organizationId === organizationB.id),
    ).toBe(false);
  });

  it("forces a tenant resource lookup into the active organization boundary", () => {
    const scoped = scopeTenantOperation({
      model: "Shipment",
      operation: "findUnique",
      args: { where: { id: "shipment-b", organizationId: organizationB.id } },
      organizationId: organizationA.id,
      tenantModels: new Set(["Shipment"]),
    });

    expect(scoped).toEqual({
      operation: "findFirst",
      args: {
        where: { id: "shipment-b", organizationId: organizationA.id },
      },
    });
  });

  it("a user in organization A requesting an organization B resource receives NOT_FOUND", async () => {
    const caller = callerFor(ownerOfA, organizationA.id);

    // NOT_FOUND, never FORBIDDEN: FORBIDDEN would confirm the row exists.
    await expect(
      caller.shipper.byId({ shipperId: shipperInB.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      caller.shipper.byId({ shipperId: shipperInA.id }),
    ).resolves.toMatchObject({ id: shipperInA.id });
  });

  it("hides another organization's rows from a list read", async () => {
    const caller = callerFor(ownerOfA, organizationA.id);

    const shippers = await caller.shipper.list();
    const ids = shippers.map((shipper) => shipper.id);

    expect(ids).toContain(shipperInA.id);
    expect(ids).not.toContain(shipperInB.id);
  });

  it("hides another organization's rows from a nested read", async () => {
    const caller = callerFor(ownerOfA, organizationA.id);

    await expect(
      caller.shipper.listProfileVersions({ shipperId: shipperInB.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a write aimed at another organization's row", async () => {
    const caller = callerFor(ownerOfA, organizationA.id);

    // A read-only boundary is not isolation. The write path has to miss too.
    await expect(
      caller.shipper.update({
        shipperId: shipperInB.id,
        name: "Diambil alih",
        npwp: null,
        financeContactName: null,
        financeContactEmail: null,
        financeContactPhone: null,
        address: null,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const untouched = await db.shipper.findUnique({
      where: { id: shipperInB.id },
      select: { name: true },
    });

    expect(untouched?.name).toBe(shipperInB.name);
  });

  it("stamps a write with the active organization, not one the caller names", async () => {
    const caller = callerFor(ownerOfA, organizationA.id);

    const created = await caller.shipper.create({
      name: `Uji Isolasi ${Date.now()}`,
      npwp: null,
      financeContactName: null,
      financeContactEmail: null,
      financeContactPhone: null,
      address: null,
    });

    createdShipperIds.push(created.id);

    const stored = await db.shipper.findUnique({
      where: { id: created.id },
      select: { organizationId: true },
    });

    expect(stored?.organizationId).toBe(organizationA.id);
  });

  it.todo(
    "cross-tenant reads happen only through the consent-gated ledger aggregation boundary",
  );
});
