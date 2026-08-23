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

export const trk002SeedFixtures = {
  organizations: [
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
  ],
  users: [
    {
      id: "trk-002-user-forwarder-a-owner",
      name: "Pak Anton",
      email: "trk-002.forwarder-a.owner@example.test",
    },
    {
      id: "trk-002-user-forwarder-a-admin",
      name: "Mbak Rina",
      email: "trk-002.forwarder-a.admin@example.test",
    },
    {
      id: "trk-002-user-forwarder-a-finance",
      name: "Bendahara Truk Jaya",
      email: "trk-002.forwarder-a.finance@example.test",
    },
    {
      id: "trk-002-user-forwarder-b-owner",
      name: "Pak Budi",
      email: "trk-002.forwarder-b.owner@example.test",
    },
    {
      id: "trk-002-user-shipper-c-owner",
      name: "Ibu Sri",
      email: "trk-002.shipper-c.owner@example.test",
    },
  ],
  memberships: [
    {
      id: "trk-002-membership-forwarder-a-owner",
      userId: "trk-002-user-forwarder-a-owner",
      organizationId: "trk-002-org-forwarder-a",
      role: "OWNER",
    },
    {
      id: "trk-002-membership-forwarder-a-admin",
      userId: "trk-002-user-forwarder-a-admin",
      organizationId: "trk-002-org-forwarder-a",
      role: "ADMIN",
    },
    {
      id: "trk-002-membership-forwarder-a-finance",
      userId: "trk-002-user-forwarder-a-finance",
      organizationId: "trk-002-org-forwarder-a",
      role: "FINANCE",
    },
    {
      id: "trk-002-membership-forwarder-b-owner",
      userId: "trk-002-user-forwarder-b-owner",
      organizationId: "trk-002-org-forwarder-b",
      role: "OWNER",
    },
    {
      id: "trk-002-membership-shipper-c-owner",
      userId: "trk-002-user-shipper-c-owner",
      organizationId: "trk-002-org-shipper-c",
      role: "OWNER",
    },
  ],
} as const;

export async function seedFixtures(writer: SeedWriter): Promise<void> {
  for (const organization of trk002SeedFixtures.organizations) {
    await writer.organization.upsert({
      where: { id: organization.id },
      create: organization,
      update: { name: organization.name, type: organization.type },
    });
  }

  for (const user of trk002SeedFixtures.users) {
    await writer.user.upsert({
      where: { id: user.id },
      create: user,
      update: { name: user.name, email: user.email },
    });
  }

  for (const membership of trk002SeedFixtures.memberships) {
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
  $transaction<T>(callback: (transaction: SeedWriter) => Promise<T>): Promise<T>;
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
