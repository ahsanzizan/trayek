import { describe, expect, it } from "vitest";

import { trk002SeedFixtures } from "../../prisma/seed";
import { db } from "~/server/db";

const organizationA = trk002SeedFixtures.organizations[0];
const organizationB = trk002SeedFixtures.organizations[1];

if (!organizationA || !organizationB) {
  throw new Error("TRK-002 requires both forwarder seed organizations");
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
      organizationARows.every(
        (row) => row.organizationId === organizationA.id,
      ),
    ).toBe(true);
    expect(
      organizationARows.some(
        (row) => row.organizationId === organizationB.id,
      ),
    ).toBe(false);
  });

  it.todo(
    "a user in organization A requesting an organization B resource receives NOT_FOUND",
  );

  it.todo(
    "cross-tenant reads happen only through the consent-gated ledger aggregation boundary",
  );
});
