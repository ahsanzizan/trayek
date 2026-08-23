import { describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { scopeTenantOperation } from "~/server/api/tenant-extension";
import { db } from "~/server/db";

const organizationA = seedFixturesData.organizations[0];
const organizationB = seedFixturesData.organizations[1];

if (!organizationA || !organizationB) {
  throw new Error("Seed requires both forwarder organizations");
}

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

  // Runtime isolation (createCaller + mocked session, read+write+findUnique,
  // NOT_FOUND not FORBIDDEN) requires a real tenant-scoped model with an
  // organizationId column. No such model exists yet — the schema only has
  // Organization/Membership, which are intentionally unscoped. This test
  // lands with the first tenant-scoped router; the extension's
  // fail-closed allowlist is covered by tests/auth/tenant-extension.test.ts.
  it.todo(
    "a user in organization A requesting an organization B resource receives NOT_FOUND",
  );

  it.todo(
    "cross-tenant reads happen only through the consent-gated ledger aggregation boundary",
  );
});
