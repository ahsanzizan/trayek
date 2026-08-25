import { z } from "zod";

import { normalizeIndonesianPhone } from "~/server/domain/driver/phone";

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
}

export interface WebhookVerifiable {
  verifySignature(request: Request): Promise<boolean>;
}

export interface ChannelRegistry {
  get(organizationId: string, channel: ChannelType): ChannelAdapter;
}

export function toJid(phone: string): string {
  const result = normalizeIndonesianPhone(phone);

  if (!result.ok) {
    throw new Error("INVALID_E164");
  }

  return `${result.e164.slice(1)}@s.whatsapp.net`;
}

export function fromE164(jid: string): string {
  const suffix = "@s.whatsapp.net";

  if (!jid.endsWith(suffix)) {
    throw new Error("INVALID_JID");
  }

  const result = normalizeIndonesianPhone(`+${jid.slice(0, -suffix.length)}`);

  if (!result.ok) {
    throw new Error("INVALID_JID");
  }

  return result.e164;
}
