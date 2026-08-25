import { TRPCError } from "@trpc/server";

import { type PrismaClient } from "../../../../generated/prisma";
import { z } from "zod";

import {
  createTRPCRouter,
  orgProcedure,
  roleProcedure,
} from "~/server/api/trpc";
import { withAudit } from "~/server/audit/with-audit";
import {
  computeDsoFromBalances,
  computeDsoFromInvoices,
  daysRemoved,
  InsufficientHistoryError,
  InvalidBalanceInputsError,
} from "~/server/domain/baseline/dso";
import {
  INVOICE_IMPORT_FIELDS,
  parseInvoiceRows,
} from "~/server/domain/baseline/invoice-import";

/**
 * Capturing the DSO a customer started at (TRK-013).
 *
 * The product is sold on removing 8 or more days, proven per customer. That
 * proof only exists if the starting figure was frozen before Trayek touched
 * anything, which is why every write here is once-only: the unique constraint
 * stops a second baseline per method, and a database trigger stops the first
 * from being edited.
 */

const baselineMethod = z.enum([
  "CLAIMED",
  "COMPUTED_FROM_INVOICES",
  "COMPUTED_FROM_BALANCES",
]);

const baselineOutput = z.object({
  id: z.string(),
  method: baselineMethod,
  dsoDays: z.number().int(),
  periodStart: z.date(),
  periodEnd: z.date(),
  invoicedRevenue: z.bigint().nullable(),
  averageReceivable: z.bigint().nullable(),
  invoiceCount: z.number().int().nullable(),
  statedUnprompted: z.boolean().nullable(),
  note: z.string().nullable(),
  createdAt: z.date(),
});

const baselineSelect = {
  id: true,
  method: true,
  dsoDays: true,
  periodStart: true,
  periodEnd: true,
  invoicedRevenue: true,
  averageReceivable: true,
  invoiceCount: true,
  statedUnprompted: true,
  note: true,
  createdAt: true,
} as const;

type BaselineRow = z.infer<typeof baselineOutput>;

/**
 * A baseline is written once. Re-capturing is a conflict rather than an
 * overwrite, because "we remeasured and it looks better now" is precisely the
 * move the immutability exists to prevent.
 */
async function assertNotAlreadyCaptured(
  db: PrismaClient,
  method: z.infer<typeof baselineMethod>,
) {
  const existing = await db.dsoBaseline.findFirst({
    where: { method },
    select: { id: true },
  });

  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Baseline dengan metode ini sudah tercatat dan tidak bisa diubah.",
    });
  }
}

export const baselineRouter = createTRPCRouter({
  current: orgProcedure
    .input(z.object({}).default({}))
    .output(
      z.object({
        baselines: z.array(baselineOutput),
        /**
         * Claimed and computed are reported side by side, never reconciled
         * into one number. A gap between them is itself the finding.
         */
        claimedVsComputedGapDays: z.number().int().nullable(),
        historicalInvoiceCount: z.number().int(),
      }),
    )
    .query(async ({ ctx }) => {
      const [baselines, historicalInvoiceCount] = await Promise.all([
        ctx.db.dsoBaseline.findMany({
          select: baselineSelect,
          orderBy: { method: "asc" },
        }),
        ctx.db.historicalInvoice.count(),
      ]);

      const claimed = baselines.find(
        (baseline) => baseline.method === "CLAIMED",
      );
      const computed = baselines.find(
        (baseline) => baseline.method === "COMPUTED_FROM_INVOICES",
      );

      return {
        baselines,
        claimedVsComputedGapDays:
          claimed && computed
            ? daysRemoved(computed.dsoDays, claimed.dsoDays)
            : null,
        historicalInvoiceCount,
      };
    }),

  captureClaimed: roleProcedure("ADMIN")
    .input(
      z.object({
        dsoDays: z.number().int().min(0).max(365),
        periodStart: z.date(),
        periodEnd: z.date(),
        /**
         * The PRD's month 0-2 go/no-go signal. Required, not optional: an
         * interviewer who can skip it will skip it, and then the question was
         * never really asked.
         */
        statedUnprompted: z.boolean(),
        note: z.string().max(500).nullable().default(null),
      }),
    )
    .output(baselineOutput)
    .mutation(async ({ ctx, input }) => {
      await assertNotAlreadyCaptured(ctx.db, "CLAIMED");

      return withAudit<BaselineRow>(
        ctx.db,
        (baseline) => ({
          organizationId: ctx.organizationId,
          actor: { type: "USER", id: ctx.session.user.id },
          action: "DSO_BASELINE_CLAIMED",
          entityType: "DsoBaseline",
          entityId: baseline.id,
          after: {
            dsoDays: baseline.dsoDays,
            statedUnprompted: baseline.statedUnprompted,
          },
        }),
        async (tx) =>
          tx.dsoBaseline.create({
            data: {
              organizationId: ctx.organizationId,
              method: "CLAIMED",
              dsoDays: input.dsoDays,
              periodStart: input.periodStart,
              periodEnd: input.periodEnd,
              statedUnprompted: input.statedUnprompted,
              note: input.note,
              createdById: ctx.session.user.id,
            },
            select: baselineSelect,
          }),
      );
    }),

  captureFromBalances: roleProcedure("ADMIN")
    .input(
      z.object({
        invoicedRevenue: z.bigint().positive(),
        averageReceivable: z.bigint().nonnegative(),
        periodStart: z.date(),
        periodEnd: z.date(),
        note: z.string().max(500).nullable().default(null),
      }),
    )
    .output(baselineOutput)
    .mutation(async ({ ctx, input }) => {
      await assertNotAlreadyCaptured(ctx.db, "COMPUTED_FROM_BALANCES");

      let dsoDays: number;

      try {
        dsoDays = computeDsoFromBalances(input);
      } catch (error) {
        if (error instanceof InvalidBalanceInputsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }

      return withAudit<BaselineRow>(
        ctx.db,
        (baseline) => ({
          organizationId: ctx.organizationId,
          actor: { type: "USER", id: ctx.session.user.id },
          action: "DSO_BASELINE_COMPUTED",
          entityType: "DsoBaseline",
          entityId: baseline.id,
          after: { method: "COMPUTED_FROM_BALANCES", dsoDays },
        }),
        async (tx) =>
          tx.dsoBaseline.create({
            data: {
              organizationId: ctx.organizationId,
              method: "COMPUTED_FROM_BALANCES",
              dsoDays,
              periodStart: input.periodStart,
              periodEnd: input.periodEnd,
              invoicedRevenue: input.invoicedRevenue,
              averageReceivable: input.averageReceivable,
              note: input.note,
              createdById: ctx.session.user.id,
            },
            select: baselineSelect,
          }),
      );
    }),

  importHistoricalInvoices: roleProcedure("ADMIN")
    .input(
      z.object({
        rows: z
          .array(z.record(z.string(), z.unknown()))
          .max(5000, "Maksimal 5.000 baris per impor."),
        mapping: z.record(z.enum(INVOICE_IMPORT_FIELDS), z.string()),
        dryRun: z.boolean(),
      }),
    )
    .output(
      z.object({
        total: z.number().int(),
        accepted: z.number().int(),
        rejected: z.number().int(),
        rows: z.array(
          z.object({
            index: z.number().int(),
            notes: z.array(
              z.object({ field: z.string(), message: z.string() }),
            ),
          }),
        ),
        /** Present once enough paid history exists to derive a figure. */
        baseline: baselineOutput.nullable(),
        /** Why rows were left out, so the figure can be defended later. */
        excluded: z
          .object({
            unpaid: z.number().int(),
            negativeDuration: z.number().int(),
            zeroAmount: z.number().int(),
          })
          .nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const parsed = parseInvoiceRows(input.rows, input.mapping);
      const usable = parsed.filter((row) => row.ok);

      const report = parsed
        .filter((row) => !row.ok)
        .map((row) => ({
          index: row.index,
          notes: row.ok ? [] : row.errors,
        }));

      const summary = {
        total: parsed.length,
        accepted: usable.length,
        rejected: report.length,
        rows: report,
      };

      if (usable.length === 0) {
        return { ...summary, baseline: null, excluded: null };
      }

      let computed;

      try {
        computed = computeDsoFromInvoices(usable.map((row) => row.value));
      } catch (error) {
        if (error instanceof InsufficientHistoryError) {
          // Not a failure of the upload: the rows parsed, there just is not
          // enough paid history in them to measure anything.
          return { ...summary, baseline: null, excluded: null };
        }
        throw error;
      }

      if (input.dryRun) {
        return { ...summary, baseline: null, excluded: computed.excluded };
      }

      await assertNotAlreadyCaptured(ctx.db, "COMPUTED_FROM_INVOICES");

      const baseline = await withAudit<BaselineRow>(
        ctx.db,
        (created) => ({
          organizationId: ctx.organizationId,
          actor: { type: "USER", id: ctx.session.user.id },
          action: "DSO_BASELINE_COMPUTED",
          entityType: "DsoBaseline",
          entityId: created.id,
          after: {
            method: "COMPUTED_FROM_INVOICES",
            dsoDays: created.dsoDays,
            invoiceCount: created.invoiceCount,
          },
        }),
        async (tx) => {
          await tx.historicalInvoice.createMany({
            data: usable.map((row) => ({
              organizationId: ctx.organizationId,
              nomorInvoice: row.value.nomorInvoice,
              shipperName: row.value.shipperName,
              issueDate: row.value.issueDate,
              paymentDate: row.value.paymentDate,
              amountRupiah: row.value.amountRupiah,
            })),
            skipDuplicates: true,
          });

          return tx.dsoBaseline.create({
            data: {
              organizationId: ctx.organizationId,
              method: "COMPUTED_FROM_INVOICES",
              dsoDays: computed.dsoDays,
              periodStart: computed.periodStart,
              periodEnd: computed.periodEnd,
              invoicedRevenue: computed.invoicedRevenue,
              invoiceCount: computed.invoiceCount,
              createdById: ctx.session.user.id,
            },
            select: baselineSelect,
          });
        },
        { timeout: 60_000, maxWait: 10_000 },
      );

      return { ...summary, baseline, excluded: computed.excluded };
    }),
});
