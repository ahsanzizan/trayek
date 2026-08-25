import { z } from "zod";

export const CHANNEL_HEARTBEAT_TIMEOUT_MS = 15_000;

export const MAX_MESSAGE_BODY_LENGTH = 4096;

export const channelTypeValues = ["WHATSAPP_BAILEYS", "EMAIL"] as const;

export type ChannelType = (typeof channelTypeValues)[number];

export const channelTypeSchema = z.enum(channelTypeValues);

export const channelConnectionStatusValues = [
  "CONNECTED",
  "DISCONNECTED",
  "NEEDS_PAIRING",
] as const;

export type ChannelConnectionStatus =
  (typeof channelConnectionStatusValues)[number];

export const channelConnectionStatusSchema = z.enum(
  channelConnectionStatusValues,
);

export const messageStatusValues = [
  "PENDING",
  "SENT",
  "DELIVERED",
  "FAILED",
] as const;

export type MessageStatus = (typeof messageStatusValues)[number];

export const messageStatusSchema = z.enum(messageStatusValues);

export const messageDirectionValues = ["INBOUND", "OUTBOUND"] as const;

export type MessageDirection = (typeof messageDirectionValues)[number];

export const messageDirectionSchema = z.enum(messageDirectionValues);

export interface InboundMessage {
  id: string;
  channel: ChannelType;
  from: string;
  to: string;
  body: string;
  mediaUrl?: string;
  timestamp: Date;
  raw: unknown;
}

export interface OutboundMessage {
  to: string;
  body: string;
  channel: ChannelType;
  template?: string;
  params?: Record<string, string>;
}

export interface ChannelAdapter {
  sendMessage(
    to: string,
    body: string,
    options?: { subject?: string; mediaUrl?: string },
  ): Promise<{ messageId: string }>;
  parseInbound(payload: unknown): InboundMessage;
  parseInboundBatch?(payload: unknown): InboundMessage[];
}

export interface WebhookVerifiable {
  verifySignature(request: Request): Promise<boolean>;
}

export interface ChannelRegistry {
  get(organizationId: string, channel: ChannelType): ChannelAdapter;
}
