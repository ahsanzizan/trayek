import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { type InvoiceColumnMapping } from "~/server/domain/baseline/invoice-import";

/**
 * A baseline is written once per organization and can never be edited, so
 * these tests use their own throwaway organization rather than the seeded
 * ones: a shared fixture would let one test's capture decide another's
 * outcome, and nothing can clean up afterwards by editing.
 */

const organizationId = `org-baseline-${Date.now()}`;
const userId = seedFixturesData.users[1]?.id;

if (!userId) {
  throw new Error("Seed requires an admin user fixture");
}

function callerFor(activeOrganizationId: string) {
  return createCaller(() =>
    Promise.resolve({
      db,
      headers: new Headers(),
      requestId: "baseline-test",
      session: {
        user: { id: userId!, activeOrganizationId },
        memberships: [],
        expires: "2099-01-01T00:00:00.000Z",
      },
    }),
  );
}

const admin = callerFor(organizationId);

const mapping: InvoiceColumnMapping = {
  nomorInvoice: "No Invoice",
  shipperName: "Pengirim",
  issueDate: "Tanggal Invoice",
  paymentDate: "Tanggal Bayar",
  amount: "Nilai",
};

function invoiceRow(index: number, overrides = {}) {
  return {
    "No Invoice": `INV-${index}`,
    Pengirim: "PT FMCG Indonesia",
    "Tanggal Invoice": "01/01/2026",
    "Tanggal Bayar": "31/01/2026",
    Nilai: "Rp 1.000.000",
    ...overrides,
  };
}

beforeAll(async () => {
  await db.organization.create({
    data: {
      id: organizationId,
      name: `Uji Baseline ${organizationId}`,
      type: "FORWARDER",
      memberships: {
        create: { userId: userId!, role: "ADMIN" },
      },
    },
  });
});

afterAll(async () => {
  // The organization itself is left behind on purpose. Deleting it cascades
  // into AuditLog, whose append-only trigger refuses the DELETE — so an
  // organization that has recorded any audited action cannot be removed at
  // all. That is TRK-006 working as designed; noted here because it is the
  // first place the consequence shows up.
  await db.historicalInvoice.deleteMany({ where: { organizationId } });
  await db.dsoBaseline.deleteMany({ where: { organizationId } });
  await db.membership.deleteMany({ where: { organizationId } });
  await db.$disconnect();
});

describe("capturing what the owner claims", () => {
  it("records the figure and whether it was stated unprompted", async () => {
    const baseline = await admin.baseline.captureClaimed({
      dsoDays: 75,
      periodStart: new Date("2025-07-01T00:00:00+07:00"),
      periodEnd: new Date("2025-12-31T00:00:00+07:00"),
      statedUnprompted: true,
      note: "Disebut sendiri saat wawancara onboarding.",
    });

    expect(baseline).toMatchObject({
      method: "CLAIMED",
      dsoDays: 75,
      statedUnprompted: true,
    });
  });

  it("refuses a second claimed baseline rather than overwriting", async () => {
    // "We remeasured and it looks better now" is the move immutability exists
    // to prevent.
    await expect(
      admin.baseline.captureClaimed({
        dsoDays: 40,
        periodStart: new Date("2025-07-01T00:00:00+07:00"),
        periodEnd: new Date("2025-12-31T00:00:00+07:00"),
        statedUnprompted: false,
        note: null,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("leaves the original figure untouched", async () => {
    const stored = await db.dsoBaseline.findFirst({
      where: { organizationId, method: "CLAIMED" },
      select: { dsoDays: true },
    });

    expect(stored?.dsoDays).toBe(75);
  });
});

describe("computing from imported invoice history", () => {
  it("previews without writing anything", async () => {
    const result = await admin.baseline.importHistoricalInvoices({
      rows: [invoiceRow(1), invoiceRow(2)],
      mapping,
      dryRun: true,
    });

    expect(result).toMatchObject({ total: 2, accepted: 2, rejected: 0 });
    expect(result.baseline).toBeNull();

    const written = await db.historicalInvoice.count({
      where: { organizationId },
    });
    expect(written).toBe(0);
  });

  it("reports a bad row without discarding the good ones", async () => {
    const result = await admin.baseline.importHistoricalInvoices({
      rows: [
        invoiceRow(1),
        invoiceRow(2, { Nilai: "bukan angka" }),
        invoiceRow(3, { "Tanggal Invoice": "" }),
      ],
      mapping,
      dryRun: true,
    });

    expect(result).toMatchObject({ total: 3, accepted: 1, rejected: 2 });
    expect(result.rows.map((row) => row.index)).toEqual([1, 2]);
  });

  it("computes a baseline weighted by amount and stores the history", async () => {
    const result = await admin.baseline.importHistoricalInvoices({
      rows: [
        // 1M paid in 30 days, 9M paid in 80 days -> 75 days weighted.
        invoiceRow(10, { "Tanggal Bayar": "31/01/2026", Nilai: "1.000.000" }),
        invoiceRow(11, { "Tanggal Bayar": "22/03/2026", Nilai: "9.000.000" }),
      ],
      mapping,
      dryRun: false,
    });

    expect(result.baseline).toMatchObject({
      method: "COMPUTED_FROM_INVOICES",
      dsoDays: 75,
      invoiceCount: 2,
      invoicedRevenue: 10_000_000n,
    });

    const stored = await db.historicalInvoice.count({
      where: { organizationId },
    });
    expect(stored).toBe(2);
  });

  it("refuses a second computed baseline", async () => {
    await expect(
      admin.baseline.importHistoricalInvoices({
        rows: [invoiceRow(20)],
        mapping,
        dryRun: false,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("claimed and computed are reported side by side", () => {
  it("never reconciles them into one number", async () => {
    const current = await admin.baseline.current();

    const methods = current.baselines.map((baseline) => baseline.method);
    expect(methods).toContain("CLAIMED");
    expect(methods).toContain("COMPUTED_FROM_INVOICES");
  });

  it("reports the gap between what was believed and what was true", async () => {
    // Claimed 75, computed 75 here, so the gap is zero — but the field exists
    // precisely because that is usually not the case.
    const current = await admin.baseline.current();

    expect(current.claimedVsComputedGapDays).toBe(0);
    expect(current.historicalInvoiceCount).toBe(2);
  });
});

describe("a baseline cannot be edited, only re-measured", () => {
  it("raises a database error on UPDATE", async () => {
    const baseline = await db.dsoBaseline.findFirst({
      where: { organizationId, method: "CLAIMED" },
      select: { id: true },
    });

    await expect(
      db.dsoBaseline.update({
        where: { id: baseline?.id },
        data: { dsoDays: 20 },
      }),
    ).rejects.toThrow(/immutable/i);
  });

  it("raises a database error on a bulk UPDATE", async () => {
    await expect(
      db.dsoBaseline.updateMany({
        where: { organizationId },
        data: { dsoDays: 20 },
      }),
    ).rejects.toThrow(/immutable/i);
  });

  it("leaves every figure untouched after the rejected attempts", async () => {
    const rows = await db.dsoBaseline.findMany({
      where: { organizationId },
      select: { method: true, dsoDays: true },
      orderBy: { method: "asc" },
    });

    expect(rows).toEqual([
      { method: "CLAIMED", dsoDays: 75 },
      { method: "COMPUTED_FROM_INVOICES", dsoDays: 75 },
    ]);
  });
});

describe("baselines stay inside their organization", () => {
  it("does not show one organization's baseline to another", async () => {
    const other = callerFor(seedFixturesData.organizations[0]!.id);

    const current = await other.baseline.current();
    const ids = current.baselines.map((baseline) => baseline.id);

    const mine = await db.dsoBaseline.findMany({
      where: { organizationId },
      select: { id: true },
    });

    for (const baseline of mine) {
      expect(ids).not.toContain(baseline.id);
    }
  });
});
