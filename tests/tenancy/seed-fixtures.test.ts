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

  it("writes every fixture through its writer port, dependencies first", async () => {
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
      shipper: {
        upsert: async ({ create }) => {
          operations.push(`shipper:${create.id}`);
        },
      },
      requirementProfile: {
        upsert: async ({ create }) => {
          operations.push(`requirementProfile:${create.id}`);
        },
      },
      driver: {
        upsert: async ({ create }) => {
          operations.push(`driver:${create.id}`);
        },
      },
      order: {
        upsert: async ({ create }) => {
          operations.push(`order:${create.id}`);
        },
      },
      podUploadLink: {
        upsert: async ({ create }) => {
          operations.push(`podUploadLink:${create.id}`);
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
      // Shippers before profiles: a profile references a shipper that must
      // already exist.
      ...seedFixturesData.shippers.map((shipper) => `shipper:${shipper.id}`),
      ...seedFixturesData.requirementProfiles.map(
        (profile) => `requirementProfile:${profile.id}`,
      ),
      ...seedFixturesData.drivers.map((driver) => `driver:${driver.id}`),
      ...seedFixturesData.orders.map((order) => `order:${order.id}`),
      // Links last: one references an order that must already exist.
      ...seedFixturesData.podUploadLinks.map(
        (link) => `podUploadLink:${link.id}`,
      ),
    ]);
  });
});
