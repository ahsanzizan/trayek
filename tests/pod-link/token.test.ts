import { describe, expect, it } from "vitest";

import {
  encodeUploadToken,
  hashThrottleBucket,
  hashUploadToken,
  isWellFormedUploadToken,
  normalizeUploadToken,
  POD_TOKEN_ALPHABET,
  POD_TOKEN_LENGTH,
} from "~/server/domain/pod-link/token";

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function filledBytes(value: number, length = POD_TOKEN_LENGTH): Uint8Array {
  return Uint8Array.from(new Array<number>(length).fill(value));
}

describe("the token alphabet", () => {
  it("excludes the characters a driver would misread aloud", () => {
    for (const character of ["I", "L", "O", "U"]) {
      expect(POD_TOKEN_ALPHABET).not.toContain(character);
    }
  });

  it("has 32 distinct symbols, so five bits map exactly onto one character", () => {
    expect(POD_TOKEN_ALPHABET).toHaveLength(32);
    expect(new Set(POD_TOKEN_ALPHABET).size).toBe(32);
  });
});

describe("encoding a token", () => {
  it("produces a token of the declared length", () => {
    expect(encodeUploadToken(filledBytes(0))).toHaveLength(POD_TOKEN_LENGTH);
  });

  it("maps a byte through its low five bits", () => {
    // 0b100000 is 32: the high bit is discarded and the symbol is index 0.
    expect(encodeUploadToken(filledBytes(0b100000))).toBe("0".repeat(20));
    expect(encodeUploadToken(filledBytes(0b11111))).toBe("Z".repeat(20));
  });

  it("draws every symbol equally often across the byte range", () => {
    // The bias this guards against is a modulo over a 256-value range, which
    // would make the first eight symbols half again as likely as the rest.
    const counts = new Map<string, number>();

    for (let byte = 0; byte < 256; byte += 1) {
      const symbol = encodeUploadToken(
        filledBytes(byte, POD_TOKEN_LENGTH),
      ).slice(0, 1);
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }

    expect(counts.size).toBe(32);
    expect([...counts.values()].every((count) => count === 8)).toBe(true);
  });

  it("refuses to encode from too few bytes rather than padding", () => {
    expect(() => encodeUploadToken(bytes(1, 2, 3))).toThrow(
      /at least 20 bytes/,
    );
  });
});

describe("recognising a token", () => {
  it("accepts a freshly encoded token", () => {
    expect(isWellFormedUploadToken(encodeUploadToken(filledBytes(7)))).toBe(
      true,
    );
  });

  it.each([
    ["empty", ""],
    ["too short", "TRAYEK"],
    ["too long", "TRAYEKSEEDA0000000012"],
    ["excluded letter I", "TRAYEKSEEDI000000001"],
    ["excluded letter O", "TRAYEKSEEDO000000001"],
    ["lower case", "trayekseeda000000001"],
    ["punctuation", "TRAYEKSEEDA-00000001"],
  ])("rejects a token that is %s", (_label, candidate) => {
    expect(isWellFormedUploadToken(candidate)).toBe(false);
  });

  it("normalises what a phone keyboard did to a pasted link", () => {
    expect(normalizeUploadToken("  trayekseeda000000001 ")).toBe(
      "TRAYEKSEEDA000000001",
    );
    expect(
      isWellFormedUploadToken(normalizeUploadToken(" tRaYeKsEeDa000000001 ")),
    ).toBe(true);
  });
});

describe("hashing a token", () => {
  it("is stable for the same token", () => {
    expect(hashUploadToken("TRAYEKSEEDA000000001")).toBe(
      hashUploadToken("TRAYEKSEEDA000000001"),
    );
  });

  it("hashes the normalised form, so a lower-cased paste still resolves", () => {
    expect(hashUploadToken("trayekseeda000000001 ")).toBe(
      hashUploadToken("TRAYEKSEEDA000000001"),
    );
  });

  it("differs between tokens that differ by one character", () => {
    expect(hashUploadToken("TRAYEKSEEDA000000001")).not.toBe(
      hashUploadToken("TRAYEKSEEDA000000002"),
    );
  });

  it("returns a hex digest that does not contain the token", () => {
    const digest = hashUploadToken("TRAYEKSEEDA000000001");

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain("TRAYEKSEEDA000000001");
  });
});

describe("throttle buckets", () => {
  it("separates an IP bucket from a token bucket with the same value", () => {
    expect(hashThrottleBucket("ip", "same")).not.toBe(
      hashThrottleBucket("token", "same"),
    );
  });

  it("does not carry the raw value it was built from", () => {
    expect(hashThrottleBucket("ip", "203.0.113.7")).not.toContain(
      "203.0.113.7",
    );
  });
});
