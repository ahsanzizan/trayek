import { randomUUID } from "node:crypto";

import {
  channelTypeSchema,
  type ChannelAdapter,
  type ChannelType,
  type InboundMessage,
} from "~/server/domain/ports/channel";
import { MAX_MESSAGE_BODY_LENGTH } from "~/server/channels/message-log";

type PendingMessageData = {
  organizationId: string;
  channel: ChannelType;
  direction: "OUTBOUND";
  from: string;
  to: string;
  body: string;
  status: "PENDING";
  truncated: boolean;
};

type DeliveryUpdate = {
  status: "SENT" | "FAILED";
  externalId?: string;
};

export interface NoopMessageLogStore {
  create(args: { data: PendingMessageData }): Promise<{ id: string }>;
  update(args: {
    where: { id: string };
    data: DeliveryUpdate;
  }): Promise<unknown>;
}

export interface NoopAdapterOptions {
  organizationId: string;
  messageLog: NoopMessageLogStore;
  channel?: ChannelType;
  from?: string;
  idGenerator?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInboundMessage(value: unknown): value is InboundMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    channelTypeSchema.safeParse(value.channel).success &&
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    typeof value.body === "string" &&
    (value.mediaUrl === undefined || typeof value.mediaUrl === "string") &&
    value.timestamp instanceof Date &&
    "raw" in value
  );
}

export function createNoopAdapter({
  organizationId,
  messageLog,
  channel = "WHATSAPP_BAILEYS",
  from = "system",
  idGenerator = randomUUID,
}: NoopAdapterOptions): ChannelAdapter {
  return {
    async sendMessage(to, body) {
      const truncated = body.length > MAX_MESSAGE_BODY_LENGTH;
      const log = await messageLog.create({
        data: {
          organizationId,
          channel,
          direction: "OUTBOUND",
          from,
          to,
          body: body.slice(0, MAX_MESSAGE_BODY_LENGTH),
          status: "PENDING",
          truncated,
        },
      });
      const messageId = idGenerator();

      try {
        await messageLog.update({
          where: { id: log.id },
          data: { status: "SENT", externalId: messageId },
        });
      } catch (error) {
        await messageLog
          .update({
            where: { id: log.id },
            data: { status: "FAILED" },
          })
          .catch(() => undefined);
        throw error;
      }

      return { messageId };
    },

    parseInbound(payload) {
      if (!isInboundMessage(payload)) {
        throw new Error("INVALID_INBOUND_MESSAGE");
      }

      return payload;
    },
  };
}
