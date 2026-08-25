import { pathToFileURL } from "node:url";

import { type RequirementRules } from "../src/server/domain/shipper/requirement-rules";

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

type ShipperFixture = Readonly<{
  id: string;
  organizationId: string;
  name: string;
  npwp: string | null;
  financeContactName: string | null;
  financeContactEmail: string | null;
  address: string | null;
}>;

type RequirementProfileFixture = Readonly<{
  id: string;
  organizationId: string;
  shipperId: string;
  version: number;
  rules: RequirementRules;
  changeNote: string;
}>;

type DriverFixture = Readonly<{
  id: string;
  organizationId: string;
  name: string;
  phone: string;
  vehiclePlate: string | null;
  vendorId: string | null;
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
  shipper: {
    upsert(args: {
      where: { id: string };
      create: ShipperFixture;
      update: Readonly<Omit<ShipperFixture, "id" | "organizationId">>;
    }): Promise<unknown>;
  };
  requirementProfile: {
    upsert(args: {
      where: { id: string };
      create: RequirementProfileFixture;
      update: Readonly<Pick<RequirementProfileFixture, "rules" | "changeNote">>;
    }): Promise<unknown>;
  };
  driver: {
    upsert(args: {
      where: { id: string };
      create: DriverFixture;
      update: Readonly<Omit<DriverFixture, "id" | "organizationId">>;
    }): Promise<unknown>;
  };
};

/**
 * Requirement profiles for the first two design partner shippers, which is the
 * pair TRK-010 names: one FMCG distributor that rejects on a missing stempel or
 * foto barang, and one that wants `nama terang` and a `berita acara`.
 *
 * Typed as RequirementRules so an invalid seed profile fails to compile rather
 * than failing at `pnpm db:seed`.
 */
const fmcgDistributorRules: RequirementRules = {
  requiredPodFields: [
    "tandaTangan",
    "stempel",
    "tanggalTerima",
    "nomorSuratJalan",
    "jumlahKoli",
  ],
  requiredDocuments: ["SURAT_JALAN", "POD", "INVOICE", "FOTO_BARANG"],
  packetFormat: {
    fileNamingPattern: "{nomorSuratJalan}-{documentType}",
    ordering: ["INVOICE", "SURAT_JALAN", "POD", "FOTO_BARANG"],
    delivery: "MERGED_PDF",
  },
  submissionCadence: { type: "WEEKLY", dayOfWeek: 5 },
  terms: { netDays: 60, clockStart: "PACKET_RECEIVED_DATE" },
};

const retailChainRules: RequirementRules = {
  requiredPodFields: [
    "tandaTangan",
    "namaTerang",
    "tanggalTerima",
    "nomorSuratJalan",
  ],
  requiredDocuments: [
    "SURAT_JALAN",
    "POD",
    "INVOICE",
    "FAKTUR_PAJAK",
    "BERITA_ACARA",
  ],
  packetFormat: {
    fileNamingPattern: "{nomorOrder}_{documentType}",
    ordering: ["INVOICE", "FAKTUR_PAJAK", "SURAT_JALAN", "POD", "BERITA_ACARA"],
    delivery: "SEPARATE_FILES",
  },
  submissionCadence: { type: "MONTHLY", dayOfMonth: 25 },
  terms: { netDays: 30, clockStart: "INVOICE_DATE" },
};

/** A second organization's shipper, so tenant isolation has something to miss. */
const chemicalDistributorRules: RequirementRules = {
  requiredPodFields: ["tandaTangan", "stempel"],
  requiredDocuments: ["SURAT_JALAN", "POD"],
  packetFormat: {
    fileNamingPattern: "{nomorSuratJalan}",
    ordering: ["SURAT_JALAN", "POD"],
    delivery: "MERGED_PDF",
  },
  submissionCadence: { type: "ROLLING" },
  terms: { netDays: 14, clockStart: "INVOICE_DATE" },
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
  shippers: [
    {
      id: "shipper-a-fmcg",
      organizationId: "org-forwarder-a",
      name: "PT FMCG Indonesia",
      npwp: "01.234.567.8-901.000",
      financeContactName: "Ibu Sri",
      financeContactEmail: "finance@fmcg.example.test",
      address: "Kawasan Industri Pulogadung, Jakarta Timur",
    },
    {
      id: "shipper-a-retail",
      organizationId: "org-forwarder-a",
      name: "PT Ritel Nusantara",
      npwp: "02.345.678.9-012.000",
      financeContactName: "Bapak Hendra",
      financeContactEmail: "ap@ritelnusantara.example.test",
      address: "Jl. Gatot Subroto No. 12, Jakarta Selatan",
    },
    {
      id: "shipper-b-chemical",
      organizationId: "org-forwarder-b",
      name: "PT Kimia Raya",
      npwp: null,
      financeContactName: null,
      financeContactEmail: null,
      address: "Cikarang, Bekasi",
    },
  ],
  requirementProfiles: [
    {
      id: "profile-a-fmcg-v1",
      organizationId: "org-forwarder-a",
      shipperId: "shipper-a-fmcg",
      version: 1,
      rules: fmcgDistributorRules,
      changeNote: "Profil awal dari hasil wawancara onboarding.",
    },
    {
      id: "profile-a-retail-v1",
      organizationId: "org-forwarder-a",
      shipperId: "shipper-a-retail",
      version: 1,
      rules: retailChainRules,
      changeNote: "Profil awal dari hasil wawancara onboarding.",
    },
    {
      id: "profile-b-chemical-v1",
      organizationId: "org-forwarder-b",
      shipperId: "shipper-b-chemical",
      version: 1,
      rules: chemicalDistributorRules,
      changeNote: "Profil awal dari hasil wawancara onboarding.",
    },
  ],
  drivers: [
    {
      id: "driver-a-herman",
      organizationId: "org-forwarder-a",
      name: "Pak Herman",
      phone: "+6281234567890",
      vehiclePlate: "B 9012 XYZ",
      vendorId: null,
    },
    {
      id: "driver-a-subcontracted",
      organizationId: "org-forwarder-a",
      name: "Pak Joko",
      phone: "+6285712345678",
      vehiclePlate: "B 3344 KLM",
      vendorId: "VND-TRUK-SEJAHTERA",
    },
    {
      id: "driver-b-only",
      organizationId: "org-forwarder-b",
      name: "Pak Slamet",
      phone: "+6281812345678",
      vehiclePlate: "L 5566 NOP",
      vendorId: null,
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

  for (const shipper of seedFixturesData.shippers) {
    await writer.shipper.upsert({
      where: { id: shipper.id },
      create: shipper,
      update: {
        name: shipper.name,
        npwp: shipper.npwp,
        financeContactName: shipper.financeContactName,
        financeContactEmail: shipper.financeContactEmail,
        address: shipper.address,
      },
    });
  }

  // Version 1 only. A seeded profile is never superseded, so re-running the
  // seed leaves the single active version per shipper intact.
  for (const profile of seedFixturesData.requirementProfiles) {
    await writer.requirementProfile.upsert({
      where: { id: profile.id },
      create: profile,
      update: { rules: profile.rules, changeNote: profile.changeNote },
    });
  }

  for (const driver of seedFixturesData.drivers) {
    await writer.driver.upsert({
      where: { id: driver.id },
      create: driver,
      update: {
        name: driver.name,
        phone: driver.phone,
        vehiclePlate: driver.vehiclePlate,
        vendorId: driver.vendorId,
      },
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
