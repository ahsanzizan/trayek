import { describe, expect, it } from "vitest";

import {
  seedFixtures,
  type SeedWriter,
  seedFixturesData,
} from "../../prisma/seed";

describe("seed fixtures", () => {
  it("contains two forwarders and one shipper with stable identifiers", () => {
    expect(seedFixturesData.organizations).toEqual([
      {
        id: "org-forwarder-a",
        name: "PT Truk Jaya",
        type: "FORWARDER",
      },
      {
        id: "org-forwarder-b",
        name: "CV Logistik Sejahtera",
        type: "FORWARDER",
      },
      {
        id: "org-shipper-c",
        name: "PT FMCG Indonesia",
        type: "SHIPPER",
      },
    ]);
  });

  it("gives every seeded user at least one membership", () => {
    for (const user of seedFixturesData.users) {
      expect(
        seedFixturesData.memberships.some(
          (membership) => membership.userId === user.id,
        ),
        `${user.email} must have a membership`,
      ).toBe(true);
    }
  });

  it("gives the owner fixture a second organization for switcher coverage", () => {
    const ownerId = "user-forwarder-a-owner";

    expect(
      seedFixturesData.memberships.filter(
        (membership) => membership.userId === ownerId,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: "org-forwarder-a",
          role: "OWNER",
        }),
        expect.objectContaining({
          organizationId: "org-forwarder-b",
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
      ...seedFixturesData.organizations.map(
        (organization) => `organization:${organization.id}`,
      ),
      ...seedFixturesData.users.map((user) => `user:${user.id}`),
      ...seedFixturesData.memberships.map(
        (membership) => `membership:${membership.id}`,
      ),
    ]);
  });
});
