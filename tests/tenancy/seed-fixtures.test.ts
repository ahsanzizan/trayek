import { describe, expect, it } from "vitest";

import {
  seedFixtures,
  type SeedWriter,
  trk002SeedFixtures,
} from "../../prisma/seed";

describe("TRK-002 seed fixtures", () => {
  it("contains two forwarders and one shipper with stable identifiers", () => {
    expect(trk002SeedFixtures.organizations).toEqual([
      {
        id: "trk-002-org-forwarder-a",
        name: "PT Truk Jaya",
        type: "FORWARDER",
      },
      {
        id: "trk-002-org-forwarder-b",
        name: "CV Logistik Sejahtera",
        type: "FORWARDER",
      },
      {
        id: "trk-002-org-shipper-c",
        name: "PT FMCG Indonesia",
        type: "SHIPPER",
      },
    ]);
  });

  it("gives every seeded user at least one membership", () => {
    for (const user of trk002SeedFixtures.users) {
      expect(
        trk002SeedFixtures.memberships.some(
          (membership) => membership.userId === user.id,
        ),
        `${user.email} must have a membership`,
      ).toBe(true);
    }
  });

  it("gives the owner fixture a second organization for switcher coverage", () => {
    const ownerId = "trk-002-user-forwarder-a-owner";

    expect(
      trk002SeedFixtures.memberships.filter(
        (membership) => membership.userId === ownerId,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: "trk-002-org-forwarder-a",
          role: "OWNER",
        }),
        expect.objectContaining({
          organizationId: "trk-002-org-forwarder-b",
          role: "VIEWER",
        }),
      ]),
    );
  });

  it("writes every fixture through the organization, user, and membership ports", async () => {
    const operations: string[] = [];
    const writer: SeedWriter = {
      organization: {
        upsert: async ({ create }) => {
          operations.push(`organization:${create.id}`);
        },
      },
      user: {
        upsert: async ({ create }) => {
          operations.push(`user:${create.id}`);
        },
      },
      membership: {
        upsert: async ({ create }) => {
          operations.push(`membership:${create.id}`);
        },
      },
    };

    await seedFixtures(writer);

    expect(operations).toEqual([
      ...trk002SeedFixtures.organizations.map(
        (organization) => `organization:${organization.id}`,
      ),
      ...trk002SeedFixtures.users.map((user) => `user:${user.id}`),
      ...trk002SeedFixtures.memberships.map(
        (membership) => `membership:${membership.id}`,
      ),
    ]);
  });
});
