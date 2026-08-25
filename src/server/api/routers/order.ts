import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  orgProcedure,
  roleProcedure,
} from "~/server/api/trpc";
import { withAudit } from "~/server/audit/with-audit";

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
});
