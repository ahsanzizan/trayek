import { describe, expect, it } from "vitest";

import {
  normalizeIndonesianPhone,
  PHONE_PARSE_MESSAGES,
  type PhoneParseError,
} from "~/server/domain/driver/phone";

/**
 * TRK-012 acceptance criterion: "Normalizer test table covers at least 20
 * real-world Indonesian input formats."
 *
 * These are spellings that actually arrive — from a WhatsApp contact card, a
 * spreadsheet column, a form typed on a phone, and a driver reciting the
 * number aloud. The count is asserted at the bottom so the table cannot quietly
 * shrink below the criterion.
 */
const ACCEPTED: ReadonlyArray<readonly [label: string, input: string]> = [
  ["plain national", "08123456789"],
  ["national, no trunk zero", "8123456789"],
  ["country code, no plus", "628123456789"],
  ["full E.164", "+628123456789"],
  ["E.164 with spaces", "+62 812 3456 789"],
  ["E.164 with hyphens", "+62-812-3456-789"],
  ["national with hyphens", "0812-3456-789"],
  ["national with dots", "0812.3456.789"],
  ["national with spaces", "0812 3456 789"],
  ["bracketed trunk prefix", "(0812) 3456-789"],
  ["IDD prefix instead of plus", "00628123456789"],
  ["leading and trailing spaces", "  08123456789  "],
  ["non-breaking spaces from a paste", "+62 812 3456 789"],
  ["zero-width space from a paste", "0812​3456​789"],
  ["en dash instead of hyphen", "0812–3456–789"],
  ["em dash instead of hyphen", "0812—3456—789"],
  ["mixed separators", "+62 (812) 3456.789"],
  ["Telkomsel prefix", "081234567890"],
  ["Indosat prefix", "085712345678"],
  ["XL prefix", "081812345678"],
  ["Tri prefix", "089612345678"],
  ["Smartfren prefix", "088112345678"],
  ["shortest accepted length", "0812345678"],
  ["longest accepted length", "0812345678901"],
] as const;

describe("normalizeIndonesianPhone: accepted spellings", () => {
  it.each(ACCEPTED)("normalises %s", (_label, input) => {
    const result = normalizeIndonesianPhone(input);

    expect(result.ok, `${input} should normalise`).toBe(true);
    if (result.ok) {
      expect(result.e164).toMatch(/^\+628\d{8,11}$/);
    }
  });

  it("covers at least the twenty formats the criterion requires", () => {
    expect(ACCEPTED.length).toBeGreaterThanOrEqual(20);
  });
});

describe("normalizeIndonesianPhone: one driver, many spellings", () => {
  // The point of normalising: these are the same person, and the unique
  // constraint on the normalised value is what stops six duplicate records.
  const sameDriver = [
    "081234567890",
    "81234567890",
    "6281234567890",
    "+6281234567890",
    "+62 812-3456-7890",
    "0812.3456.7890",
    "(0812) 3456 7890",
    "00" + "6281234567890",
  ];

  it.each(sameDriver)("resolves %s to one canonical number", (input) => {
    expect(normalizeIndonesianPhone(input)).toEqual({
      ok: true,
      e164: "+6281234567890",
    });
  });

  it("collapses every spelling to a single value", () => {
    const canonical = new Set(
      sameDriver.map((input) => {
        const result = normalizeIndonesianPhone(input);
        return result.ok ? result.e164 : `failed:${result.reason}`;
      }),
    );

    expect(canonical).toEqual(new Set(["+6281234567890"]));
  });
});

describe("normalizeIndonesianPhone: rejected input", () => {
  it.each([
    ["an empty string", "", "EMPTY"],
    ["only whitespace", "   ", "EMPTY"],
    ["letters", "0812ABCD789", "CONTAINS_LETTERS"],
    ["a written note", "tidak punya HP", "CONTAINS_LETTERS"],
    ["a Singapore number", "+6591234567", "UNSUPPORTED_COUNTRY_CODE"],
    ["a US number", "+12125550100", "UNSUPPORTED_COUNTRY_CODE"],
    ["a Malaysian number via IDD", "0060123456789", "UNSUPPORTED_COUNTRY_CODE"],
    ["a Jakarta landline", "0215551234", "NOT_A_MOBILE_NUMBER"],
    ["a Surabaya landline", "0315551234", "NOT_A_MOBILE_NUMBER"],
    ["a premium number", "+62 804 1 500 000", "NOT_A_MOBILE_NUMBER"],
    ["too few digits", "08123", "TOO_SHORT"],
    ["too many digits", "0812345678901234", "TOO_LONG"],
  ] as const)("rejects %s", (_label, input, reason: PhoneParseError) => {
    expect(normalizeIndonesianPhone(input)).toEqual({ ok: false, reason });
  });

  it("explains every failure in Bahasa Indonesia", () => {
    // A driver import reports these to an admin, so every reason needs copy.
    for (const [reason, message] of Object.entries(PHONE_PARSE_MESSAGES)) {
      expect(message.length, `${reason} needs a message`).toBeGreaterThan(10);
    }
  });
});

describe("normalizeIndonesianPhone: output shape", () => {
  it("always returns E.164 with no separators", () => {
    const result = normalizeIndonesianPhone("+62 812-3456-7890");

    expect(result.ok && result.e164).toBe("+6281234567890");
  });

  it("is idempotent, so re-normalising a stored number is safe", () => {
    const once = normalizeIndonesianPhone("0812-3456-7890");

    expect(once.ok).toBe(true);
    if (once.ok) {
      expect(normalizeIndonesianPhone(once.e164)).toEqual(once);
    }
  });
});
