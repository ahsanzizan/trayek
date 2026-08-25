import { describe, expect, it } from "vitest";

import {
  channelTypeSchema,
  channelTypeValues,
} from "~/server/domain/ports/channel";
import { fromE164, toJid } from "~/server/channels/whatsapp/jid";

describe("channel type contract", () => {
  it("keeps the supported channel values in one ordered source", () => {
    expect(channelTypeValues).toEqual(["WHATSAPP_BAILEYS", "EMAIL"]);
  });

  it("accepts only the supported channel values", () => {
    expect(channelTypeSchema.safeParse("WHATSAPP_BAILEYS").success).toBe(true);
    expect(channelTypeSchema.safeParse("EMAIL").success).toBe(true);
    expect(channelTypeSchema.safeParse("WHATSAPP_CLOUD").success).toBe(false);
  });
});

describe("WhatsApp JID helpers", () => {
  it.each([
    ["national number", "0812 3456 789", "628123456789@s.whatsapp.net"],
    [
      "country code without plus",
      "628123456789",
      "628123456789@s.whatsapp.net",
    ],
    ["E.164", "+628123456789", "628123456789@s.whatsapp.net"],
    ["dotted national number", "0812.3456.789", "628123456789@s.whatsapp.net"],
  ] as const)("canonicalizes %s", (_label, input, expected) => {
    expect(toJid(input)).toBe(expected);
  });

  it("converts a user JID back to E.164", () => {
    expect(fromE164("628123456789@s.whatsapp.net")).toBe("+628123456789");
  });

  it("handles multi-device JID format with device suffixes", () => {
    expect(fromE164("628123456789:12@s.whatsapp.net")).toBe("+628123456789");
    expect(fromE164("628123456789:0@s.whatsapp.net")).toBe("+628123456789");
  });

  it("rejects invalid phone input instead of creating a malformed JID", () => {
    expect(() => toJid("0215551234")).toThrow("INVALID_E164");
  });

  it("rejects non-user JIDs", () => {
    expect(() => fromE164("628123456789@g.us")).toThrow("INVALID_JID");
  });
});
