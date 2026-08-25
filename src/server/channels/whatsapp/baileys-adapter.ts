import pTimeout from "p-timeout";
import { type WAMessage } from "@whiskeysockets/baileys";

import { type PrismaClient } from "../../../../generated/prisma";

import {
  type ChannelAdapter,
  type InboundMessage,
  fromE164,
  toJid,
} from "~/server/domain/ports/channel";
import { type HumanFallbackRequired } from "~/server/domain/jobs/port";
import {
  reporter as defaultReporter,
  type Reporter,
} from "~/server/observability/reporter";
import { MAX_MESSAGE_BODY_LENGTH } from "~/server/channels/message-log";

export interface BaileysSocket {
  sendMessage(
    jid: string,
    content: { text: string },
  ): Promise<{ key?: { id?: string | null } } | undefined>;
}

type PendingMessageData = {
  organizationId: string;
  channel: "WHATSAPP_BAILEYS";
  direction: "INBOUND" | "OUTBOUND";
  from: string;
  to: string;
  body: string;
  status: "PENDING";
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
  };
}

interface MessageUpsertPayload {
  type: string;
  messages: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  const content = message.message;

  return (
    content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.documentMessage?.caption ??
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
    async sendMessage(to, body) {
      const jid = toJid(to);
      const truncated = body.length > MAX_MESSAGE_BODY_LENGTH;
      const log = await messageLog.create({
        data: {
          organizationId,
          channel: "WHATSAPP_BAILEYS",
          direction: "OUTBOUND",
          from,
          to,
          body: body.slice(0, MAX_MESSAGE_BODY_LENGTH),
          status: "PENDING",
          truncated,
        },
      });

      try {
        const sent = await pTimeout(
          socket.sendMessage(jid, {
            text: body.slice(0, MAX_MESSAGE_BODY_LENGTH),
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
          dedupeKey: `${organizationId}:${jid}:${log.id}`,
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
          throw notificationError;
        }

        reporter.reportError(error, "Baileys message send failed", {
          organizationId,
          messageLogId: log.id,
        });
        throw error;
      }
    },

    parseInbound(payload): InboundMessage {
      if (!isMessageUpsertPayload(payload) || payload.type !== "notify") {
        throw ignoredMessage();
      }

      const first = payload.messages[0];

      if (!isRecord(first) || !isRecord(first.key)) {
        throw ignoredMessage();
      }

      if (
        first.key.fromMe === true ||
        typeof first.key.id !== "string" ||
        typeof first.key.remoteJid !== "string" ||
        !isRecord(first.message)
      ) {
        throw ignoredMessage();
      }

      const message = first as unknown as WAMessage;

      return {
        id: first.key.id,
        channel: "WHATSAPP_BAILEYS",
        from: fromE164(first.key.remoteJid),
        to: "system",
        body: getTextContent(message),
        timestamp: messageTimestampToDate(first.messageTimestamp),
        raw: message,
      };
    },
  };
}
