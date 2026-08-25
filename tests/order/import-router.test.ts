import { afterAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { type ColumnMapping } from "~/server/domain/order/import";

const organization = seedFixturesData.organizations[0];
const shipper = seedFixturesData.shippers[0];
const driver = seedFixturesData.drivers[0];
const foreignShipper = seedFixturesData.shippers[2];

if (!organization || !shipper || !driver || !foreignShipper) {
  throw new Error("Seed requires a shipper and driver in organization A");
}

function callerFor(userId: string) {
  return createCaller(() =>
    Promise.resolve({
      db,
      headers: new Headers(),
      requestId: "order-import-test",
      session: {
        user: { id: userId, activeOrganizationId: organization.id },
        memberships: [],
        expires: "2099-01-01T00:00:00.000Z",
      },
    }),
  );
}

const admin = callerFor("user-forwarder-a-admin");
const finance = callerFor("user-forwarder-a-finance");

const mapping: ColumnMapping = {
  nomorOrder: "No Order",
  nomorSuratJalan: "No Surat Jalan",
  shipper: "Pengirim",
  driverPhone: "No HP Sopir",
  origin: "Asal",
  destination: "Tujuan",
  jumlahKoli: "Koli",
  nilaiTagihan: "Nilai Tagihan",
};

const run = Date.now().toString().slice(-8);
const tags: string[] = [];

function tagged(name: string) {
  const tag = `IMP-${run}-${name}`;
  tags.push(tag);
  return tag;
}

function sheetRow(tag: string, index: number, overrides = {}) {
  return {
    "No Order": `${tag}-O-${index}`,
    "No Surat Jalan": `${tag}-SJ-${index}`,
    Pengirim: shipper!.name,
    "No HP Sopir": driver!.phone,
    Asal: "Gudang Cakung",
    Tujuan: "DC Bandung",
    Koli: "120",
    "Nilai Tagihan": "Rp 4.500.000",
    ...overrides,
  };
}

afterAll(async () => {
  for (const tag of tags) {
    await db.order.deleteMany({ where: { nomorOrder: { startsWith: tag } } });
  }
  await db.$disconnect();
});

describe("dry run writes nothing", () => {
  const tag = tagged("dry");

  it("reports what would happen", async () => {
    const result = await admin.order.import({
      rows: [sheetRow(tag, 0), sheetRow(tag, 1)],
      mapping,
      dryRun: true,
    });

    expect(result).toMatchObject({
      batchId: null,
      total: 2,
      created: 2,
      skipped: 0,
      rejected: 0,
    });
  });

  it("leaves the database untouched", async () => {
    const count = await db.order.count({
      where: { nomorOrder: { startsWith: tag } },
    });

    expect(count).toBe(0);
  });

  it("produces the same verdict as the commit that follows", async () => {
    // The preview an operator approves must be the computation that runs for
    // real, or approval means nothing.
    const rows = [sheetRow(tag, 0), sheetRow(tag, 1)];

    const preview = await admin.order.import({ rows, mapping, dryRun: true });
    const committed = await admin.order.import({
      rows,
      mapping,
      dryRun: false,
    });

    expect({
      total: committed.total,
      created: committed.created,
      skipped: committed.skipped,
      rejected: committed.rejected,
    }).toEqual({
      total: preview.total,
      created: preview.created,
      skipped: preview.skipped,
      rejected: preview.rejected,
    });
    expect(committed.batchId).not.toBeNull();
  });
});

describe("a bad row does not abort the batch", () => {
  const tag = tagged("partial");

  it("imports the good rows and reports the bad one", async () => {
    const result = await admin.order.import({
      rows: [
        sheetRow(tag, 0),
        sheetRow(tag, 1, { "Nilai Tagihan": "bukan angka" }),
        sheetRow(tag, 2),
        sheetRow(tag, 3, { Pengirim: "" }),
        sheetRow(tag, 4),
      ],
      mapping,
      dryRun: false,
    });

    expect(result).toMatchObject({ total: 5, created: 3, rejected: 2 });
  });

  it("writes exactly the rows that passed", async () => {
    const stored = await db.order.count({
      where: { nomorOrder: { startsWith: tag } },
    });

    expect(stored).toBe(3);
  });

  it("names the failing row by its position in the file", async () => {
    const result = await admin.order.import({
      rows: [sheetRow(tag, 90), sheetRow(tag, 91, { Koli: "abc" })],
      mapping,
      dryRun: true,
    });

    const failure = result.rows.find((row) => row.outcome === "REJECTED");

    expect(failure?.index).toBe(1);
    expect(failure?.notes[0]?.field).toBe("jumlahKoli");
  });
});

describe("re-importing the same file is idempotent", () => {
  const tag = tagged("idem");
  const rows = [sheetRow(tag, 0), sheetRow(tag, 1), sheetRow(tag, 2)];

  it("creates on the first run", async () => {
    const result = await admin.order.import({ rows, mapping, dryRun: false });

    expect(result).toMatchObject({ created: 3, skipped: 0 });
  });

  it("skips everything on the second run", async () => {
    const result = await admin.order.import({ rows, mapping, dryRun: false });

    expect(result).toMatchObject({ created: 0, skipped: 3, rejected: 0 });
  });

  it("leaves exactly one row per surat jalan", async () => {
    const stored = await db.order.count({
      where: { nomorOrder: { startsWith: tag } },
    });

    expect(stored).toBe(3);
  });

  it("does not overwrite a status that has since moved on", async () => {
    // The order progressed after the first import. Re-uploading the original
    // spreadsheet must not drag it back to CREATED.
    await db.order.updateMany({
      where: { nomorSuratJalan: `${tag}-SJ-0` },
      data: { status: "POD_RECEIVED" },
    });

    await admin.order.import({ rows, mapping, dryRun: false });

    const order = await db.order.findFirst({
      where: { nomorSuratJalan: `${tag}-SJ-0` },
      select: { status: true },
    });

    expect(order?.status).toBe("POD_RECEIVED");
  });

  it("rejects a surat jalan duplicated inside one file", async () => {
    const duplicated = [sheetRow(tag, 50), sheetRow(tag, 50)];

    const result = await admin.order.import({
      rows: duplicated,
      mapping,
      dryRun: true,
    });

    expect(result).toMatchObject({ created: 1, rejected: 1 });
  });
});

describe("references are resolved inside the organization only", () => {
  const tag = tagged("tenant");

  it("rejects a shipper belonging to another organization", async () => {
    const result = await admin.order.import({
      rows: [sheetRow(tag, 0, { Pengirim: foreignShipper!.name })],
      mapping,
      dryRun: true,
    });

    expect(result).toMatchObject({ created: 0, rejected: 1 });
    expect(result.rows[0]?.notes[0]?.message).toMatch(/belum terdaftar/);
  });

  it("imports without a driver when the number is unknown, and says so", async () => {
    const result = await admin.order.import({
      rows: [sheetRow(tag, 1, { "No HP Sopir": "0899-000-0001" })],
      mapping,
      dryRun: false,
    });

    expect(result).toMatchObject({ created: 1 });

    const order = await db.order.findFirst({
      where: { nomorSuratJalan: `${tag}-SJ-1` },
      select: { driverId: true },
    });

    expect(order?.driverId).toBeNull();
    expect(result.rows[0]?.notes[0]?.field).toBe("driverPhone");
  });

  it("attaches a driver matched on the normalised number", async () => {
    const result = await admin.order.import({
      // Written differently from the stored form; normalisation resolves it.
      rows: [sheetRow(tag, 2, { "No HP Sopir": "0812.3456.7890" })],
      mapping,
      dryRun: false,
    });

    expect(result).toMatchObject({ created: 1 });

    const order = await db.order.findFirst({
      where: { nomorSuratJalan: `${tag}-SJ-2` },
      select: { driverId: true },
    });

    expect(order?.driverId).toBe(driver!.id);
  });

  it("refuses a FINANCE member", async () => {
    await expect(
      finance.order.import({
        rows: [sheetRow(tag, 3)],
        mapping,
        dryRun: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the import is audited once, not once per row", () => {
  const tag = tagged("audit");

  it("writes a single entry naming the batch", async () => {
    const result = await admin.order.import({
      rows: [sheetRow(tag, 0), sheetRow(tag, 1), sheetRow(tag, 2)],
      mapping,
      dryRun: false,
    });

    const entries = await db.auditLog.findMany({
      where: { entityType: "OrderImport", entityId: result.batchId ?? "" },
      select: { action: true, actorId: true, after: true },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "ORDER_IMPORTED",
      actorId: "user-forwarder-a-admin",
    });
    expect(entries[0]?.after).toMatchObject({ created: 3 });
  });

  it("writes no audit entry for a dry run", async () => {
    const before = await db.auditLog.count({
      where: { entityType: "OrderImport" },
    });

    await admin.order.import({
      rows: [sheetRow(tag, 80)],
      mapping,
      dryRun: true,
    });

    const after = await db.auditLog.count({
      where: { entityType: "OrderImport" },
    });

    expect(after).toBe(before);
  });
});

describe("5,000 rows", () => {
  const tag = tagged("bulk");

  it("completes and reports without aborting the batch", async () => {
    const rows = Array.from({ length: 5000 }, (_, index) =>
      // Every hundredth row is broken, so the run proves it reports failures
      // rather than simply succeeding at scale.
      index % 100 === 0
        ? sheetRow(tag, index, { "Nilai Tagihan": "rusak" })
        : sheetRow(tag, index),
    );

    const started = Date.now();
    const result = await admin.order.import({ rows, mapping, dryRun: false });
    const elapsed = Date.now() - started;

    expect(result).toMatchObject({ total: 5000, created: 4950, rejected: 50 });
    expect(result.rows).toHaveLength(50);
    expect(elapsed).toBeLessThan(60_000);
  }, 120_000);

  it("stored every accepted row", async () => {
    const stored = await db.order.count({
      where: { nomorOrder: { startsWith: tag } },
    });

    expect(stored).toBe(4950);
  }, 60_000);
});
