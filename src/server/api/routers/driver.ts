import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  orgProcedure,
  roleProcedure,
} from "~/server/api/trpc";
import { withAudit } from "~/server/audit/with-audit";
import {
  normalizeIndonesianPhone,
  PHONE_PARSE_MESSAGES,
} from "~/server/domain/driver/phone";

/**
 * The driver registry (TRK-012).
 *
 * There is deliberately no sign-in, no password, and no session here. A driver
 * is a data source reached through a signed upload link, and giving him an
 * account would add a credential to protect for no gain.
 */

/**
 * Normalises at the boundary, so nothing past this point handles a number that
 * is not E.164. A rejection surfaces as a normal Zod issue, which means the
 * form and the import report render it the same way as any other bad field.
 */
const indonesianPhone = z
  .string()
  .max(40)
  .transform((value, ctx) => {
    const result = normalizeIndonesianPhone(value);

    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: PHONE_PARSE_MESSAGES[result.reason],
      });
      return z.NEVER;
    }

    return result.e164;
  });

const driverOutput = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  vehiclePlate: z.string().nullable(),
  vendorId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** The row shape `driverSelect` returns; also what the procedures output. */
type DriverRow = z.infer<typeof driverOutput>;

const driverSelect = {
  id: true,
  name: true,
  phone: true,
  vehiclePlate: true,
  vendorId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Postgres unique violation, surfaced by Prisma as a known request error. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export const driverRouter = createTRPCRouter({
  list: orgProcedure
    .input(z.object({}).default({}))
    .output(z.array(driverOutput))
    .query(async ({ ctx }) => {
      return ctx.db.driver.findMany({
        select: driverSelect,
        orderBy: { name: "asc" },
      });
    }),

  byId: orgProcedure
    .input(z.object({ driverId: z.string().min(1) }))
    .output(driverOutput)
    .query(async ({ ctx, input }) => {
      const driver = await ctx.db.driver.findFirst({
        where: { id: input.driverId },
        select: driverSelect,
      });

      // A driver in another organization is absent, not forbidden.
      if (!driver) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return driver;
    }),

  create: roleProcedure("ADMIN")
    .input(
      z.object({
        name: z.string().min(1).max(200),
        phone: indonesianPhone,
        vehiclePlate: z.string().max(20).nullable().default(null),
        vendorId: z.string().max(60).nullable().default(null),
      }),
    )
    .output(
      driverOutput.extend({
        /** True when an existing record was returned instead of a new one. */
        deduplicated: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // `input.phone` is already E.164, so this compares canonical forms and
      // the same driver written six ways resolves to one record.
      const existing = await ctx.db.driver.findFirst({
        where: { phone: input.phone },
        select: driverSelect,
      });

      // Returning early rather than writing: nothing changed, and an audit row
      // for a mutation that did not happen is exactly the kind of false entry
      // the log exists to not contain.
      if (existing) {
        return { ...existing, deduplicated: true };
      }

      try {
        const created = await withAudit<DriverRow>(
          ctx.db,
          (driver) => ({
            organizationId: ctx.organizationId,
            actor: { type: "USER", id: ctx.session.user.id },
            action: "DRIVER_CREATED",
            entityType: "Driver",
            entityId: driver.id,
            after: driver,
          }),
          async (tx) =>
            tx.driver.create({
              data: { ...input, organizationId: ctx.organizationId },
              select: driverSelect,
            }),
        );

        return { ...created, deduplicated: false };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }

        // Two requests for the same new driver raced. The unique constraint
        // settled it; this one reports the record that won rather than failing
        // an import row that is, in fact, fine.
        const winner = await ctx.db.driver.findFirst({
          where: { phone: input.phone },
          select: driverSelect,
        });

        if (!winner) {
          throw error;
        }

        return { ...winner, deduplicated: true };
      }
    }),
});
