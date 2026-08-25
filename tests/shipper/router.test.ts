import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { type RequirementRules } from "~/server/domain/shipper/requirement-rules";

const organization = seedFixturesData.organizations[0];

if (!organization) {
  throw new Error("Seed requires a forwarder organization");
}

function callerFor(userId: string) {
  return createCaller(() =>
    Promise.resolve({
      db,
      headers: new Headers(),
      requestId: "shipper-router-test",
      session: {
        user: { id: userId, activeOrganizationId: organization.id },
        memberships: [],
        expires: "2099-01-01T00:00:00.000Z",
      },
    }),
  );
}

const owner = callerFor("user-forwarder-a-owner");
const admin = callerFor("user-forwarder-a-admin");
const finance = callerFor("user-forwarder-a-finance");

const baseRules: RequirementRules = {
  requiredPodFields: ["tandaTangan", "stempel"],
  requiredDocuments: ["SURAT_JALAN", "POD"],
  packetFormat: {
    fileNamingPattern: "{nomorSuratJalan}",
    ordering: ["SURAT_JALAN", "POD"],
    delivery: "MERGED_PDF",
  },
  submissionCadence: { type: "ROLLING" },
  terms: { netDays: 30, clockStart: "INVOICE_DATE" },
};

const suffix = Date.now();
const createdShipperIds: string[] = [];

async function newShipper(name: string) {
  const shipper = await admin.shipper.create({
    name,
    npwp: null,
    financeContactName: null,
    financeContactEmail: null,
    financeContactPhone: null,
    address: null,
  });

  createdShipperIds.push(shipper.id);
  return shipper;
}

afterAll(async () => {
  // Profiles cascade with the shipper. Audit rows deliberately survive: the
  // table is append-only, which is the guarantee TRK-006 exists for.
  await db.shipper.deleteMany({ where: { id: { in: createdShipperIds } } });
  await db.$disconnect();
});

describe("who may change a shipper", () => {
  it("lets an ADMIN create one", async () => {
    const shipper = await newShipper(`Uji Admin ${suffix}`);

    expect(shipper).toMatchObject({ name: `Uji Admin ${suffix}` });
  });

  it("lets an OWNER create one, because OWNER passes every role check", async () => {
    const shipper = await owner.shipper.create({
      name: `Uji Owner ${suffix}`,
      npwp: null,
      financeContactName: null,
      financeContactEmail: null,
      financeContactPhone: null,
      address: null,
    });

    createdShipperIds.push(shipper.id);
    expect(shipper).toMatchObject({ name: `Uji Owner ${suffix}` });
  });

  it("refuses a FINANCE member, whose job is reading the log, not writing rules", async () => {
    await expect(
      finance.shipper.create({
        name: `Uji Finance ${suffix}`,
        npwp: null,
        financeContactName: null,
        financeContactEmail: null,
        financeContactPhone: null,
        address: null,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("still lets a FINANCE member read", async () => {
    await expect(finance.shipper.list()).resolves.toBeInstanceOf(Array);
  });
});

describe("publishing a requirement profile version", () => {
  let shipperId: string;

  beforeAll(async () => {
    const shipper = await newShipper(`Uji Versi ${suffix}`);
    shipperId = shipper.id;
  });

  it("starts a shipper with no active profile", async () => {
    await expect(admin.shipper.byId({ shipperId })).resolves.toMatchObject({
      activeProfile: null,
    });
  });

  it("publishes version 1", async () => {
    const published = await admin.shipper.publishProfileVersion({
      shipperId,
      rules: baseRules,
      changeNote: "Profil awal.",
    });

    expect(published).toMatchObject({ version: 1, supersededAt: null });
  });

  it("publishes version 2 and supersedes version 1 in the same transaction", async () => {
    const published = await admin.shipper.publishProfileVersion({
      shipperId,
      rules: {
        ...baseRules,
        terms: { netDays: 60, clockStart: "INVOICE_DATE" },
      },
      changeNote: "Termin naik jadi 60 hari.",
    });

    expect(published).toMatchObject({ version: 2, supersededAt: null });

    const versions = await admin.shipper.listProfileVersions({ shipperId });

    expect(versions.map((version) => version.version)).toEqual([2, 1]);
    expect(versions[1]?.supersededAt).toBeInstanceOf(Date);
  });

  it("reports exactly one active version", async () => {
    const active = await db.requirementProfile.count({
      where: { shipperId, supersededAt: null },
    });

    expect(active).toBe(1);
  });

  it("surfaces the newest version as the active one", async () => {
    await expect(admin.shipper.byId({ shipperId })).resolves.toMatchObject({
      activeProfile: { version: 2 },
    });
  });

  it("diffs two versions through the pure domain function", async () => {
    await expect(
      admin.shipper.diffProfileVersions({
        shipperId,
        fromVersion: 1,
        toVersion: 2,
      }),
    ).resolves.toEqual([
      { path: "terms.netDays", kind: "CHANGED", before: 30, after: 60 },
    ]);
  });

  it("rejects a diff against a version that does not exist", async () => {
    await expect(
      admin.shipper.diffProfileVersions({
        shipperId,
        fromVersion: 1,
        toVersion: 99,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects rules carrying an unknown key before anything is written", async () => {
    const before = await db.requirementProfile.count({ where: { shipperId } });

    await expect(
      admin.shipper.publishProfileVersion({
        shipperId,
        // @ts-expect-error the input schema rejects unknown keys, which is the
        // point of the assertion
        rules: { ...baseRules, requiresStempelBasah: true },
        changeNote: null,
      }),
    ).rejects.toThrow();

    await expect(
      db.requirementProfile.count({ where: { shipperId } }),
    ).resolves.toBe(before);
  });

  it("refuses to publish against another organization's shipper", async () => {
    const foreign = seedFixturesData.shippers[2];

    if (!foreign) {
      throw new Error("Seed requires a shipper in the second organization");
    }

    await expect(
      admin.shipper.publishProfileVersion({
        shipperId: foreign.id,
        rules: baseRules,
        changeNote: null,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("every mutation leaves an audit trail", () => {
  it("records the creation against the row that was written", async () => {
    const shipper = await newShipper(`Uji Audit ${suffix}`);

    const entries = await db.auditLog.findMany({
      where: { entityType: "Shipper", entityId: shipper.id },
      select: { action: true, actorType: true, actorId: true },
    });

    expect(entries).toEqual([
      {
        action: "SHIPPER_CREATED",
        actorType: "USER",
        actorId: "user-forwarder-a-admin",
      },
    ]);
  });

  it("records an update with both sides of the change", async () => {
    const shipper = await newShipper(`Uji Audit Ubah ${suffix}`);

    await admin.shipper.update({
      shipperId: shipper.id,
      name: `Uji Audit Ubah ${suffix} (baru)`,
      npwp: "09.876.543.2-109.000",
      financeContactName: null,
      financeContactEmail: null,
      financeContactPhone: null,
      address: null,
    });

    const entry = await db.auditLog.findFirst({
      where: {
        entityType: "Shipper",
        entityId: shipper.id,
        action: "SHIPPER_UPDATED",
      },
      select: { before: true, after: true },
    });

    expect(entry?.before).toMatchObject({ npwp: null });
    expect(entry?.after).toMatchObject({ npwp: "09.876.543.2-109.000" });
  });

  it("records a published profile against the profile, not the shipper", async () => {
    const shipper = await newShipper(`Uji Audit Profil ${suffix}`);

    const published = await admin.shipper.publishProfileVersion({
      shipperId: shipper.id,
      rules: baseRules,
      changeNote: null,
    });

    const entry = await db.auditLog.findFirst({
      where: { entityType: "RequirementProfile", entityId: published.id },
      select: { action: true },
    });

    expect(entry).toMatchObject({ action: "REQUIREMENT_PROFILE_PUBLISHED" });
  });

  it("writes no audit row when the mutation is rejected", async () => {
    const foreign = seedFixturesData.shippers[2];

    if (!foreign) {
      throw new Error("Seed requires a shipper in the second organization");
    }

    await expect(
      admin.shipper.update({
        shipperId: foreign.id,
        name: "Tidak boleh",
        npwp: null,
        financeContactName: null,
        financeContactEmail: null,
        financeContactPhone: null,
        address: null,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      db.auditLog.count({
        where: { entityType: "Shipper", entityId: foreign.id },
      }),
    ).resolves.toBe(0);
  });
});
