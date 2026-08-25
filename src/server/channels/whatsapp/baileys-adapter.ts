import pTimeout from "p-timeout";
import { type WAMessage } from "@whiskeysockets/baileys";

import { type PrismaClient } from "~/generated/prisma";
import {
  type ChannelAdapter,
  type ChannelType,
  type InboundMessage,
  type MessageDirection,
  type MessageStatus,
} from "~/server/domain/ports/channel";
import {
  costMetadataFor,
  type MessageCostMetadata,
} from "~/server/domain/channel/cost";
import { type HumanFallbackRequired } from "~/server/domain/jobs/port";
import { isRecord } from "~/lib/guards";
import { fromE164, isWhatsappUserJid, toJid } from "./jid";
import { truncateBody } from "~/server/channels/message-log";
import {
  reporter as defaultReporter,
  type Reporter,
} from "~/server/observability/reporter";

export interface BaileysSocket {
  sendMessage(
    jid: string,
    content: { text: string },
  ): Promise<{ key?: { id?: string | null } } | undefined>;
}

type PendingMessageData = MessageCostMetadata & {
  organizationId: string;
  channel: ChannelType;
  direction: MessageDirection;
  from: string;
  to: string;
  body: string;
  status: MessageStatus;
  truncated: boolean;
};

type DeliveryUpdate =
  { status: "SENT"; externalId: string } | { status: "FAILED" };

export interface BaileysMessageLogStore {
  create(args: { data: PendingMessageData }): Promise<{ id: string }>;
  update(args: {
    where: { id: string };
    data: DeliveryUpdate;
  }): Promise<unknown>;
  findByExternalId?(args: {
    organizationId: string;
    externalId: string;
  }): Promise<{ id: string } | null>;
}

export interface BaileysAdapterOptions {
  organizationId: string;
  socket: BaileysSocket;
  messageLog: BaileysMessageLogStore;
  notifyHumanFallback: (event: HumanFallbackRequired) => Promise<void>;
  reporter?: Reporter;
  from?: string;
  now?: () => Date;
}

export function createPrismaBaileysMessageLogStore(
  database: Pick<PrismaClient, "messageLog">,
): BaileysMessageLogStore {
  return {
    create: (args) => database.messageLog.create(args),
    update: (args) => database.messageLog.update(args),
    findByExternalId: async ({ organizationId, externalId }) =>
      database.messageLog.findFirst({
        where: { organizationId, externalId },
        select: { id: true },
      }),
  };
}

interface MessageUpsertPayload {
  type: string;
  messages: unknown[];
}

function isMessageUpsertPayload(value: unknown): value is MessageUpsertPayload {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  return Array.isArray(value.messages);
}

function hasToNumber(value: unknown): value is { toNumber: () => unknown } {
  return isRecord(value) && typeof value.toNumber === "function";
}

function getTextContent(message: WAMessage): string {
  let content = message.message;

  if (content?.ephemeralMessage?.message) {
    content = content.ephemeralMessage.message;
  }
  if (content?.viewOnceMessage?.message) {
    content = content.viewOnceMessage.message;
  }
  if (content?.viewOnceMessageV2?.message) {
    content = content.viewOnceMessageV2.message;
  }
  if (content?.documentWithCaptionMessage?.message) {
    content = content.documentWithCaptionMessage.message;
  }
  if (content?.editedMessage?.message) {
    content = content.editedMessage.message;
  }

  return (
    content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.documentMessage?.caption ??
    content?.videoMessage?.caption ??
    content?.buttonsResponseMessage?.selectedButtonId ??
    content?.listResponseMessage?.singleSelectReply?.selectedRowId ??
    content?.templateButtonReplyMessage?.selectedId ??
    ""
  );
}

function messageTimestampToDate(value: unknown): Date {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000);
  }

  if (hasToNumber(value)) {
    const seconds = value.toNumber();

    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      return new Date(seconds * 1000);
    }
  }

  return new Date();
}

function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

function ignoredMessage(): Error {
  return new Error("IGNORED_MESSAGE_UPSERT");
}

function parseSingleMessage(raw: unknown): InboundMessage {
  if (!isRecord(raw) || !isRecord(raw.key)) {
    throw ignoredMessage();
  }

  const key = raw.key;
  const candidates = [key.remoteJid, key.participant, raw.participant];
  const rawJid =
    candidates.find(isWhatsappUserJid) ??
    (typeof key.remoteJid === "string" ? key.remoteJid : "");

  if (
    key.fromMe === true ||
    typeof key.id !== "string" ||
    !isWhatsappUserJid(rawJid) ||
    !isRecord(raw.message)
  ) {
    throw ignoredMessage();
  }

  const message = raw as unknown as WAMessage;
  const extractedBody = getTextContent(message);

  return {
    id: key.id,
    channel: "WHATSAPP_BAILEYS",
    from: fromE164(rawJid),
    to: "system",
    body: extractedBody.length > 0 ? extractedBody : "[Pesan media/lampiran]",
    timestamp: messageTimestampToDate(message.messageTimestamp),
    raw: message,
  };
}

export function createBaileysAdapter({
  organizationId,
  socket,
  messageLog,
  notifyHumanFallback,
  reporter = defaultReporter,
  from = "system",
  now = () => new Date(),
}: BaileysAdapterOptions): ChannelAdapter {
  return {
    async sendMessage(to, body, _options) {
      const jid = toJid(to);
      const { body: truncatedBody, truncated } = truncateBody(body);
      const costMetadata = costMetadataFor("WHATSAPP_BAILEYS");
      const log = await messageLog.create({
        data: {
          organizationId,
          channel: "WHATSAPP_BAILEYS",
          direction: "OUTBOUND",
          from,
          to,
          body: truncatedBody,
          status: "PENDING",
          truncated,
          ...costMetadata,
        },
      });

      try {
        const sent = await pTimeout(
          socket.sendMessage(jid, {
            text: truncatedBody,
          }),
          { milliseconds: 10_000 },
        );
        const messageId = sent?.key?.id;

        if (!messageId) {
          throw new Error("BAILEYS_MESSAGE_ID_MISSING");
        }

        await messageLog.update({
          where: { id: log.id },
          data: { status: "SENT", externalId: messageId },
        });

        return { messageId };
      } catch (thrown) {
        const error = toError(thrown);

        try {
          await messageLog.update({
            where: { id: log.id },
            data: { status: "FAILED" },
          });
        } catch (statusError) {
          reporter.reportError(
            statusError,
            "Baileys message log update failed",
            {
              organizationId,
              messageLogId: log.id,
            },
          );
        }

        const fallback: HumanFallbackRequired = {
          organizationId,
          source: "baileys",
          dedupeKey: `${organizationId}:send-failed:${log.id}`,
          entityType: "MessageLog",
          entityId: log.id,
          instruction:
            "Pesan WhatsApp gagal terkirim — coba lagi manual dari console",
          occurredAt: now(),
        };

        try {
          await notifyHumanFallback(fallback);
        } catch (notificationError) {
          reporter.reportError(
            notificationError,
            "Baileys human fallback notification failed",
            { organizationId, messageLogId: log.id },
          );
        }

        reporter.reportError(error, "Baileys message send failed", {
          organizationId,
          messageLogId: log.id,
        });
        throw error;
      }
    },

    parseInbound(payload): InboundMessage {
      if (
        !isMessageUpsertPayload(payload) ||
        (payload.type !== "notify" && payload.type !== "append")
      ) {
        throw ignoredMessage();
      }

      return parseSingleMessage(payload.messages[0]);
    },

    parseInboundBatch(payload): InboundMessage[] {
      if (!isMessageUpsertPayload(payload)) {
        return [];
      }

      const messages: InboundMessage[] = [];

      for (const raw of payload.messages) {
        try {
          messages.push(parseSingleMessage(raw));
        } catch {
          // skip individual ignored/invalid messages
        }
      }

      return messages;
    },
  };
}
