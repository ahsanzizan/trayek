import { MAX_MESSAGE_BODY_LENGTH } from "~/server/domain/ports/channel";

export {
  CHANNEL_HEARTBEAT_TIMEOUT_MS,
  MAX_MESSAGE_BODY_LENGTH,
  messageStatusValues,
  type MessageStatus,
  messageStatusSchema,
  messageDirectionValues,
  type MessageDirection,
  messageDirectionSchema,
} from "~/server/domain/ports/channel";

export function truncateBody(body: string): {
  body: string;
  truncated: boolean;
} {
  if (body.length > MAX_MESSAGE_BODY_LENGTH) {
    return { body: body.slice(0, MAX_MESSAGE_BODY_LENGTH), truncated: true };
  }
  return { body, truncated: false };
}
