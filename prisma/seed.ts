import { pathToFileURL } from "node:url";

type OrganizationType = "FORWARDER" | "SHIPPER";
type MembershipRole = "OWNER" | "ADMIN" | "FINANCE" | "VIEWER";

type OrganizationFixture = Readonly<{
  id: string;
  name: string;
  type: OrganizationType;
}>;

type UserFixture = Readonly<{
  id: string;
  name: string;
  email: string;
}>;

type MembershipFixture = Readonly<{
  id: string;
  userId: string;
  organizationId: string;
  role: MembershipRole;
}>;

export type SeedWriter = {
  organization: {
    upsert(args: {
      where: { id: string };
      create: OrganizationFixture;
      update: Readonly<Pick<OrganizationFixture, "name" | "type">>;
    }): Promise<unknown>;
  };
  user: {
    upsert(args: {
      where: { id: string };
      create: UserFixture;
      update: Readonly<Pick<UserFixture, "name" | "email">>;
    }): Promise<unknown>;
  };
  membership: {
    upsert(args: {
      where: {
        userId_organizationId: { userId: string; organizationId: string };
      };
      create: MembershipFixture;
      update: Readonly<Pick<MembershipFixture, "role">>;
    }): Promise<unknown>;
  };
};

export const seedFixturesData = {
  organizations: [
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
  ],
  users: [
    {
      id: "user-forwarder-a-owner",
      name: "Pak Anton",
      email: "forwarder-a.owner@example.test",
    },
    {
      id: "user-forwarder-a-admin",
      name: "Mbak Rina",
      email: "forwarder-a.admin@example.test",
    },
    {
      id: "user-forwarder-a-finance",
      name: "Bendahara Truk Jaya",
      email: "forwarder-a.finance@example.test",
    },
    {
      id: "user-forwarder-b-owner",
      name: "Pak Budi",
      email: "forwarder-b.owner@example.test",
    },
    {
      id: "user-shipper-c-owner",
      name: "Ibu Sri",
      email: "shipper-c.owner@example.test",
    },
  ],
  memberships: [
    {
      id: "membership-forwarder-a-owner",
      userId: "user-forwarder-a-owner",
      organizationId: "org-forwarder-a",
      role: "OWNER",
    },
    {
      id: "membership-forwarder-b-viewer",
      userId: "user-forwarder-a-owner",
      organizationId: "org-forwarder-b",
      role: "VIEWER",
    },
    {
      id: "membership-forwarder-a-admin",
      userId: "user-forwarder-a-admin",
      organizationId: "org-forwarder-a",
      role: "ADMIN",
    },
    {
      id: "membership-forwarder-a-finance",
      userId: "user-forwarder-a-finance",
      organizationId: "org-forwarder-a",
      role: "FINANCE",
    },
    {
      id: "membership-forwarder-b-owner",
      userId: "user-forwarder-b-owner",
      organizationId: "org-forwarder-b",
      role: "OWNER",
    },
    {
      id: "membership-shipper-c-owner",
      userId: "user-shipper-c-owner",
      organizationId: "org-shipper-c",
      role: "OWNER",
    },
  ],
} as const;

export async function seedFixtures(writer: SeedWriter): Promise<void> {
  for (const organization of seedFixturesData.organizations) {
    await writer.organization.upsert({
      where: { id: organization.id },
      create: organization,
      update: { name: organization.name, type: organization.type },
    });
  }

  for (const user of seedFixturesData.users) {
    await writer.user.upsert({
      where: { id: user.id },
      create: user,
      update: { name: user.name, email: user.email },
    });
  }

  for (const membership of seedFixturesData.memberships) {
    await writer.membership.upsert({
      where: {
        userId_organizationId: {
          userId: membership.userId,
          organizationId: membership.organizationId,
        },
      },
      create: membership,
      update: { role: membership.role },
    });
  }
}

export type SeedDatabase = SeedWriter & {
  $transaction<T>(
    callback: (transaction: SeedWriter) => Promise<T>,
  ): Promise<T>;
  $disconnect(): Promise<void>;
};

export async function runSeed(database: SeedDatabase): Promise<void> {
  await database.$transaction((transaction) => seedFixtures(transaction));
}

const isMainModule =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  void (async () => {
    const { db } = await import("../src/server/db.js");

    try {
      await runSeed(db as unknown as SeedDatabase);
    } catch (error: unknown) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      await db.$disconnect();
    }
  })();
}
