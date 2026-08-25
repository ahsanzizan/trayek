import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  orgProcedure,
  roleProcedure,
} from "~/server/api/trpc";
import { withAudit } from "~/server/audit/with-audit";
import {
  IMPORT_FIELDS,
  parseImportRows,
  type ParsedOrderRow,
  type RowNote,
} from "~/server/domain/order/import";

/**
 * Orders — the thing a POD is matched against (TRK-011).
 *
 * `nilaiTagihan` arrives from the forwarder and is stored exactly as given.
 * Nothing here derives, adjusts, or suggests it (INV-3), and
 * `tests/invariants/inv-3-no-pricing` fails the build if that changes.
 *
 * The CSV import lands separately; this is the manual single-order path and
 * the reads the console needs.
 */

const orderStatus = z.enum([
  "CREATED",
  "IN_TRANSIT",
  "DELIVERED",
  "POD_RECEIVED",
  "POD_VALIDATED",
  "PACKET_READY",
  "INVOICED",
  "PAID",
  "REJECTED",
]);

const orderDetails = {
  nomorOrder: z.string().min(1).max(100),
  nomorSuratJalan: z.string().min(1).max(100),
  shipperId: z.string().min(1),
  driverId: z.string().min(1).nullable().default(null),
  origin: z.string().min(1).max(300),
  destination: z.string().min(1).max(300),
  plannedDeliveryDate: z.date().nullable().default(null),
  actualDeliveryDate: z.date().nullable().default(null),
  jumlahKoli: z.number().int().min(0).max(1_000_000).nullable().default(null),
  weightGram: z.number().int().min(0).nullable().default(null),
  /**
   * Whole rupiah. Non-negative because a negative invoiced amount is a credit
   * note, which is a different document with its own approval gate, not an
   * order with a minus sign.
   */
  nilaiTagihan: z.bigint().nonnegative().nullable().default(null),
  /**
   * Orders rarely enter the system at the start of their life: an import
   * typically carries trips already despatched or delivered. Defaults to
   * CREATED so the manual form does not have to think about it.
   */
  status: orderStatus.default("CREATED"),
};

const orderOutput = z.object({
  id: z.string(),
  nomorOrder: z.string(),
  nomorSuratJalan: z.string(),
  origin: z.string(),
  destination: z.string(),
  plannedDeliveryDate: z.date().nullable(),
  actualDeliveryDate: z.date().nullable(),
  jumlahKoli: z.number().int().nullable(),
  weightGram: z.number().int().nullable(),
  nilaiTagihan: z.bigint().nullable(),
  status: orderStatus,
  createdAt: z.date(),
  updatedAt: z.date(),
  shipper: z.object({ id: z.string(), name: z.string() }),
  driver: z.object({ id: z.string(), name: z.string() }).nullable(),
});

const orderSelect = {
  id: true,
  nomorOrder: true,
  nomorSuratJalan: true,
  origin: true,
  destination: true,
  plannedDeliveryDate: true,
  actualDeliveryDate: true,
  jumlahKoli: true,
  weightGram: true,
  nilaiTagihan: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  shipper: { select: { id: true, name: true } },
  driver: { select: { id: true, name: true } },
} as const;

type OrderRow = z.infer<typeof orderOutput>;

const importOutcome = z.enum(["CREATED", "SKIPPED", "REJECTED"]);

const importResult = z.object({
  /** Null for a dry run: nothing was written, so there is no batch to name. */
  batchId: z.string().nullable(),
  total: z.number().int(),
  created: z.number().int(),
  skipped: z.number().int(),
  rejected: z.number().int(),
  /**
   * Only rows that need a human to look at them. Returning all 5,000 would
   * make the response enormous to say "fine" five thousand times.
   */
  rows: z.array(
    z.object({
      /** Zero-based position in the uploaded file. */
      index: z.number().int(),
      nomorSuratJalan: z.string().nullable(),
      outcome: importOutcome,
      notes: z.array(z.object({ field: z.string(), message: z.string() })),
    }),
  ),
});

/** Postgres caps parameters per statement, so a huge insert is chunked. */
const INSERT_CHUNK = 1000;

function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }

  return chunks;
}

export const orderRouter = createTRPCRouter({
  list: orgProcedure
    .input(
      z
        .object({
          status: orderStatus.optional(),
          shipperId: z.string().min(1).optional(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().nullish(),
        })
        .default({}),
    )
    .output(
      z.object({
        orders: z.array(orderOutput),
        nextCursor: z.string().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // One extra row tells us whether another page exists without a count,
      // which matters once an import has put thousands of rows in here.
      const rows = await ctx.db.order.findMany({
        where: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.shipperId ? { shipperId: input.shipperId } : {}),
        },
        select: orderSelect,
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });

      const orders = rows.slice(0, input.limit);

      return {
        orders,
        nextCursor:
          rows.length > input.limit ? (orders.at(-1)?.id ?? null) : null,
      };
    }),

  byId: orgProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .output(orderOutput)
    .query(async ({ ctx, input }) => {
      const order = await ctx.db.order.findFirst({
        where: { id: input.orderId },
        select: orderSelect,
      });

      // An order in another organization is absent, not forbidden.
      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return order;
    }),

  create: roleProcedure("ADMIN")
    .input(z.object(orderDetails))
    .output(orderOutput)
    .mutation(async ({ ctx, input }) => {
      // Both references are checked through the tenant-scoped client, so an id
      // belonging to another organization reads as absent and the foreign key
      // never sees it.
      const shipper = await ctx.db.shipper.findFirst({
        where: { id: input.shipperId },
        select: { id: true },
      });

      if (!shipper) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Shipper tidak ditemukan.",
        });
      }

      if (input.driverId) {
        const driver = await ctx.db.driver.findFirst({
          where: { id: input.driverId },
          select: { id: true },
        });

        if (!driver) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Driver tidak ditemukan.",
          });
        }
      }

      const duplicate = await ctx.db.order.findFirst({
        where: { nomorSuratJalan: input.nomorSuratJalan },
        select: { id: true },
      });

      // The surat jalan number is the natural key a POD is matched against.
      // Two orders sharing one would make that match ambiguous, so this is a
      // conflict rather than a silent second row.
      if (duplicate) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Nomor surat jalan ${input.nomorSuratJalan} sudah terdaftar.`,
        });
      }

      return withAudit<OrderRow>(
        ctx.db,
        (order) => ({
          organizationId: ctx.organizationId,
          actor: { type: "USER", id: ctx.session.user.id },
          action: "ORDER_CREATED",
          entityType: "Order",
          entityId: order.id,
          after: {
            nomorOrder: order.nomorOrder,
            nomorSuratJalan: order.nomorSuratJalan,
            status: order.status,
          },
        }),
        async (tx) =>
          tx.order.create({
            data: { ...input, organizationId: ctx.organizationId },
            select: orderSelect,
          }),
      );
    }),
  /**
   * Bulk import from a spreadsheet.
   *
   * A mutation even in dry-run form, because tRPC sends query input in the URL
   * and five thousand rows do not fit in one. `dryRun` runs exactly the same
   * resolution and validation and then writes nothing, so the preview an
   * operator approves is the same computation that later runs for real.
   */
  import: roleProcedure("ADMIN")
    .input(
      z.object({
        rows: z
          .array(z.record(z.string(), z.unknown()))
          .max(5000, "Maksimal 5.000 baris per impor."),
        mapping: z.record(z.enum(IMPORT_FIELDS), z.string()),
        dryRun: z.boolean(),
      }),
    )
    .output(importResult)
    .mutation(async ({ ctx, input }) => {
      const parsed = parseImportRows(input.rows, input.mapping);
      const usable = parsed.filter((row) => row.ok);

      // Three lookups for the whole file rather than three per row. At 5,000
      // rows the per-row version is 15,000 round trips and minutes of wall
      // clock; this is three.
      const [shippers, drivers, existing] = await Promise.all([
        ctx.db.shipper.findMany({ select: { id: true, name: true } }),
        ctx.db.driver.findMany({ select: { id: true, phone: true } }),
        ctx.db.order.findMany({
          where: {
            nomorSuratJalan: {
              in: usable.map((row) => row.value.nomorSuratJalan),
            },
          },
          select: { nomorSuratJalan: true },
        }),
      ]);

      const shipperByName = new Map(
        shippers.map((shipper) => [
          shipper.name.trim().toLowerCase(),
          shipper.id,
        ]),
      );
      const driverByPhone = new Map(
        drivers.map((driver) => [driver.phone, driver.id]),
      );
      const alreadyPresent = new Set(
        existing.map((order) => order.nomorSuratJalan),
      );

      const report: z.infer<typeof importResult>["rows"] = [];
      const toCreate: (ParsedOrderRow & {
        shipperId: string;
        driverId: string | null;
      })[] = [];

      let created = 0;
      let skipped = 0;
      let rejected = 0;

      for (const row of parsed) {
        if (!row.ok) {
          rejected += 1;
          report.push({
            index: row.index,
            nomorSuratJalan: null,
            outcome: "REJECTED",
            notes: row.errors,
          });
          continue;
        }

        const shipperId = shipperByName.get(
          row.value.shipper.trim().toLowerCase(),
        );

        // Resolved by name against this organization only, so a shipper
        // belonging to another tenant simply is not found.
        if (shipperId === undefined) {
          rejected += 1;
          report.push({
            index: row.index,
            nomorSuratJalan: row.value.nomorSuratJalan,
            outcome: "REJECTED",
            notes: [
              {
                field: "shipper",
                message: `Shipper "${row.value.shipper}" belum terdaftar. Tambahkan dulu di halaman Shipper.`,
              },
            ],
          });
          continue;
        }

        // Idempotency, keyed on nomor surat jalan: re-importing the same file
        // skips what is already there rather than creating a second row or
        // overwriting a status that has since moved on.
        if (alreadyPresent.has(row.value.nomorSuratJalan)) {
          skipped += 1;
          report.push({
            index: row.index,
            nomorSuratJalan: row.value.nomorSuratJalan,
            outcome: "SKIPPED",
            notes: [
              {
                field: "nomorSuratJalan",
                message: "Sudah ada di sistem; baris ini dilewati.",
              },
            ],
          });
          continue;
        }

        const notes: RowNote[] = [...row.warnings];
        const driverId =
          row.value.driverPhone === null
            ? null
            : (driverByPhone.get(row.value.driverPhone) ?? null);

        if (row.value.driverPhone !== null && driverId === null) {
          notes.push({
            field: "driverPhone",
            message: `Driver ${row.value.driverPhone} belum terdaftar; order diimpor tanpa driver.`,
          });
        }

        created += 1;
        toCreate.push({ ...row.value, shipperId, driverId });
        alreadyPresent.add(row.value.nomorSuratJalan);

        if (notes.length > 0) {
          report.push({
            index: row.index,
            nomorSuratJalan: row.value.nomorSuratJalan,
            outcome: "CREATED",
            notes,
          });
        }
      }

      const summary = {
        total: parsed.length,
        created,
        skipped,
        rejected,
        rows: report,
      };

      if (input.dryRun || toCreate.length === 0) {
        return { ...summary, batchId: null };
      }

      const batchId = randomUUID();

      await withAudit(
        ctx.db,
        {
          organizationId: ctx.organizationId,
          actor: { type: "USER", id: ctx.session.user.id },
          action: "ORDER_IMPORTED",
          entityType: "OrderImport",
          // The batch, not the orders: one row per import keeps the log
          // readable. Each order carries this id in the entry below.
          entityId: batchId,
          after: {
            total: summary.total,
            created,
            skipped,
            rejected,
            nomorSuratJalan: toCreate.map((row) => row.nomorSuratJalan),
          },
        },
        async (tx) => {
          for (const chunk of chunked(toCreate, INSERT_CHUNK)) {
            await tx.order.createMany({
              data: chunk.map((row) => ({
                organizationId: ctx.organizationId,
                nomorOrder: row.nomorOrder,
                nomorSuratJalan: row.nomorSuratJalan,
                shipperId: row.shipperId,
                driverId: row.driverId,
                origin: row.origin,
                destination: row.destination,
                plannedDeliveryDate: row.plannedDeliveryDate,
                actualDeliveryDate: row.actualDeliveryDate,
                jumlahKoli: row.jumlahKoli,
                weightGram: row.weightGram,
                nilaiTagihan: row.nilaiTagihan,
                status: row.status,
              })),
            });
          }

          return toCreate.length;
        },
        // Measured at roughly 2s for 5,000 rows locally; a loaded runner has
        // no reason to match that.
        { timeout: 60_000, maxWait: 10_000 },
      );

      return { ...summary, batchId };
    }),
});
