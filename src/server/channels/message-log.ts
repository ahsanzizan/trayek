export const MAX_MESSAGE_BODY_LENGTH = 4096;

export const messageStatusValues = [
  "PENDING",
  "SENT",
  "DELIVERED",
  "FAILED",
] as const;

export type MessageStatus = (typeof messageStatusValues)[number];

export const messageDirectionValues = ["INBOUND", "OUTBOUND"] as const;

export type MessageDirection = (typeof messageDirectionValues)[number];
