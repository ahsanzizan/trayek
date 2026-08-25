import { z } from "zod";

import {
  messageDirectionValues,
  messageStatusValues,
} from "~/server/channels/message-log";
import { createTRPCRouter, orgProcedure } from "~/server/api/trpc";
import {
  channelConnectionStatusSchema,
  channelTypeSchema,
  channelTypeValues,
} from "~/server/domain/ports/channel";

const messageLogStatus = z.enum(messageStatusValues);

const channelStatus = channelConnectionStatusSchema;

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
  direction: z.enum(messageDirectionValues),
  from: z.string(),
  to: z.string(),
  body: z.string().nullable(),
  status: messageLogStatus,
  externalId: z.string().nullable(),
  truncated: z.boolean(),
  createdAt: z.date(),
});

export const channelRouter = createTRPCRouter({
  status: orgProcedure
    .input(channelInput)
    .output(
      z
        .object({
          channel: channelTypeSchema,
          status: channelStatus,
          lastConnectedAt: z.date().nullable(),
        })
        .nullable(),
    )
    .query(async ({ ctx, input }) => {
      const connection = await ctx.db.channelConnection.findUnique({
        where: {
          organizationId_channel: {
            organizationId: ctx.organizationId,
            channel: input.channel,
          },
        },
        select: {
          channel: true,
          status: true,
          lastConnectedAt: true,
        },
      });

      return connection;
    }),

  intake: orgProcedure
    .input(
      z
        .object({
          channel: channelTypeSchema.default(channelTypeValues[0]),
          status: messageLogStatus.optional(),
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
        orderBy: { createdAt: "desc" },
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
});
