import { z } from "zod";

import { type ChannelType } from "~/server/domain/ports/channel";

export const messageCategoryValues = [
  "WHATSAPP_BAILEYS",
  "SERVICE",
  "UTILITY",
  "MARKETING",
] as const;

export type MessageCategory = (typeof messageCategoryValues)[number];

export const messageCategorySchema = z.enum(messageCategoryValues);

export const conversationWindowStateValues = ["N/A", "OPEN", "CLOSED"] as const;

export type ConversationWindowState =
  (typeof conversationWindowStateValues)[number];

export const conversationWindowStateSchema = z.enum(
  conversationWindowStateValues,
);

export interface MessageCostMetadata {
  category: MessageCategory;
  estimatedCost: number;
  conversationWindowState: ConversationWindowState;
}

export type MessageCostTable = Readonly<
  Partial<Record<MessageCategory, number>>
>;

export interface CostReportRow {
  category: string;
  messageCount: number;
  estimatedCost: number | string;
}

const DESIGN_RULE_MESSAGE_LIMIT = 3;

function assertValidCost(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Message cost must be a finite, non-negative number");
  }

  return value;
}

export function costFor(
  channel: ChannelType,
  category: MessageCategory,
  costTable: MessageCostTable = {},
): number {
  if (channel === "WHATSAPP_BAILEYS") {
    return 0;
  }

  const configuredCost = costTable[category];

  if (configuredCost === undefined) {
    throw new RangeError(`Missing message cost for category ${category}`);
  }

  return assertValidCost(configuredCost);
}

export function costMetadataFor(
  channel: ChannelType,
  costTable: MessageCostTable = {},
): MessageCostMetadata {
  if (channel === "WHATSAPP_BAILEYS") {
    return {
      category: "WHATSAPP_BAILEYS",
      estimatedCost: 0,
      conversationWindowState: "N/A",
    };
  }

  return {
    category: "UTILITY",
    estimatedCost: costFor(channel, "UTILITY", costTable),
    conversationWindowState: "N/A",
  };
}

export function designRuleViolation(messagesPerPod: number | null): boolean {
  return messagesPerPod !== null && messagesPerPod > DESIGN_RULE_MESSAGE_LIMIT;
}

function escapeCsvCell(value: number | string): string {
  const cell = String(value);

  if (!/[",\n\r]/.test(cell)) {
    return cell;
  }

  return `"${cell.replaceAll('"', '""')}"`;
}

export function toCsv(rows: readonly CostReportRow[]): string {
  if (rows.length === 0) {
    return "";
  }

  return [
    "category,messageCount,estimatedCost",
    ...rows.map((row) =>
      [
        escapeCsvCell(row.category),
        escapeCsvCell(row.messageCount),
        escapeCsvCell(row.estimatedCost),
      ].join(","),
    ),
  ].join("\n");
}
