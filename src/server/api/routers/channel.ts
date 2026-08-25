import { observable } from "@trpc/server/observable";
import { z } from "zod";

import { createQrSseStream, getQrPayload } from "~/server/channels/qr-service";
import { qrDataUrl } from "~/server/channels/qr-code";

import { createTRPCRouter, orgProcedure } from "~/server/api/trpc";
import {
  designRuleViolation,
  messageCategorySchema,
  toCsv,
} from "~/server/domain/channel/cost";
import { isRecord } from "~/lib/guards";
import {
  CHANNEL_HEARTBEAT_TIMEOUT_MS,
  channelConnectionStatusSchema,
  channelTypeSchema,
  channelTypeValues,
  messageDirectionSchema,
  messageStatusSchema,
} from "~/server/domain/ports/channel";

const QR_POLL_INTERVAL_MS = 2_000;

const monthlyReportInput = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

const monthlyReportOutput = z.object({
  month: z.string(),
  totalMessages: z.number().int().nonnegative(),
  byCategory: z.array(
    z.object({
      category: messageCategorySchema,
      messageCount: z.number().int().nonnegative(),
      estimatedCost: z.number().finite().nonnegative(),
    }),
  ),
  avgPerPod: z.number().finite().min(0).nullable(),
  designRuleViolation: z.boolean(),
  csv: z.string(),
});

const channelInput = z
  .object({ channel: channelTypeSchema.default(channelTypeValues[0]) })
  .default({});

const messageSelect = {
  id: true,
  channel: true,
  direction: true,
  from: true,
  to: true,
  body: true,
  status: true,
  externalId: true,
  truncated: true,
  createdAt: true,
} as const;

const messageOutput = z.object({
  id: z.string(),
  channel: channelTypeSchema,
  direction: messageDirectionSchema,
  from: z.string(),
  to: z.string(),
  body: z.string().nullable(),
  status: messageStatusSchema,
  externalId: z.string().nullable(),
  truncated: z.boolean(),
  createdAt: z.date(),
});

const qrStreamOutput = z.object({
  version: z.number(),
  dataUrl: z.string(),
  createdAt: z.string(),
});

type DecimalLike = { toNumber: () => unknown };

function hasToNumber(value: unknown): value is DecimalLike {
  return isRecord(value) && typeof value.toNumber === "function";
}

function monthBounds(month: string): { gte: Date; lt: Date } {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;

  return {
    gte: new Date(Date.UTC(year, monthIndex, 1)),
    lt: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

function trailingWindowBounds(
  end: Date,
  days: number,
): {
  gte: Date;
  lt: Date;
} {
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);

  return { gte: start, lt: end };
}

function toEstimatedCostNumber(value: unknown): number {
  const numberValue =
    typeof value === "number"
      ? value
      : hasToNumber(value)
        ? Number(value.toNumber())
        : Number(value ?? 0);

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new Error("Invalid message cost stored in database");
  }

  return numberValue;
}

export const channelRouter = createTRPCRouter({
  connect: orgProcedure.input(channelInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db.channelConnection.findFirst({
      where: { channel: input.channel },
      select: { id: true },
    });

    if (!existing) {
      await ctx.db.channelConnection.create({
        data: {
          organizationId: ctx.organizationId,
          channel: input.channel,
          status: "NEEDS_PAIRING",
          authState: {},
        },
      });
    }

    return { status: "NEEDS_PAIRING" as const };
  }),

  status: orgProcedure
    .input(channelInput)
    .output(
      z
        .object({
          channel: channelTypeSchema,
          status: channelConnectionStatusSchema,
          lastConnectedAt: z.date().nullable(),
        })
        .nullable(),
    )
    .query(async ({ ctx, input }) => {
      const connection = await ctx.db.channelConnection.findFirst({
        where: {
          organizationId: ctx.organizationId,
          channel: input.channel,
        },
        select: {
          channel: true,
          status: true,
          lastConnectedAt: true,
          updatedAt: true,
        },
      });

      if (!connection) {
        return null;
      }

      const isStale =
        connection.status === "CONNECTED" &&
        Date.now() - connection.updatedAt.getTime() >
          CHANNEL_HEARTBEAT_TIMEOUT_MS;

      return {
        channel: connection.channel,
        status: isStale ? ("DISCONNECTED" as const) : connection.status,
        lastConnectedAt: connection.lastConnectedAt,
      };
    }),

  monthlyReport: orgProcedure
    .input(monthlyReportInput)
    .output(monthlyReportOutput)
    .query(async ({ ctx, input }) => {
      const monthRange = monthBounds(input.month);
      const averageRange = trailingWindowBounds(monthRange.lt, 30);
      const [categoryRows, messageCount, podCount] = await Promise.all([
        ctx.db.messageLog.groupBy({
          by: ["category"],
          where: {
            organizationId: ctx.organizationId,
            createdAt: monthRange,
          },
          _count: { _all: true },
          _sum: { estimatedCost: true },
        }),
        ctx.db.messageLog.count({
          where: {
            organizationId: ctx.organizationId,
            createdAt: averageRange,
          },
        }),
        ctx.db.podSubmission.count({
          where: {
            organizationId: ctx.organizationId,
            receivedAt: averageRange,
          },
        }),
      ]);

      const byCategory = categoryRows.map((row) => ({
        category: messageCategorySchema.parse(row.category),
        messageCount: row._count._all,
        estimatedCost: toEstimatedCostNumber(row._sum.estimatedCost),
      }));
      const totalMessages = byCategory.reduce(
        (total, row) => total + row.messageCount,
        0,
      );
      const avgPerPod = podCount === 0 ? null : messageCount / podCount;

      return {
        month: input.month,
        totalMessages,
        byCategory,
        avgPerPod,
        designRuleViolation: designRuleViolation(avgPerPod),
        csv: toCsv(byCategory),
      };
    }),

  intake: orgProcedure
    .input(
      z
        .object({
          channel: channelTypeSchema.default(channelTypeValues[0]),
          status: messageStatusSchema.optional(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().nullish(),
        })
        .default({}),
    )
    .output(
      z.object({
        messages: z.array(messageOutput),
        nextCursor: z.string().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.messageLog.findMany({
        where: {
          organizationId: ctx.organizationId,
          channel: input.channel,
          ...(input.status ? { status: input.status } : {}),
        },
        select: messageSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const messages = rows.slice(0, input.limit);

      return {
        messages,
        nextCursor:
          rows.length > input.limit ? (messages.at(-1)?.id ?? null) : null,
      };
    }),

  qr: orgProcedure
    .input(channelInput)
    .output(qrStreamOutput.nullable())
    .query(async ({ ctx }) => {
      const payload = await getQrPayload(
        ctx.organizationId,
        ctx.db.channelConnection,
      );

      if (!payload) {
        return null;
      }

      return {
        version: payload.version,
        dataUrl: await qrDataUrl(payload.qr),
        createdAt: payload.createdAt.toISOString(),
      };
    }),

  qrStream: orgProcedure.input(channelInput).subscription(({ ctx }) => {
    return observable<z.infer<typeof qrStreamOutput>>((emit) => {
      const stream = createQrSseStream(
        ctx.organizationId,
        ctx.db.channelConnection,
        QR_POLL_INTERVAL_MS,
      );

      stream.start({
        next(payload) {
          emit.next(payload);
        },
        complete() {
          emit.complete();
        },
      });

      return () => {
        stream.stop();
      };
    });
  }),
});
