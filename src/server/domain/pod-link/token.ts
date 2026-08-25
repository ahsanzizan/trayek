import { createHash } from "node:crypto";

/**
 * The token that appears in a POD upload URL (TRK-024).
 *
 * The alphabet is Crockford base32 minus its check symbols: no `I`, `L`, `O`,
 * or `U`, so a driver reading a link aloud over the phone cannot turn a 1 into
 * an l, and no vowel arrangement can spell a word worth screenshotting. Case
 * is fixed to upper so a URL typed by hand still resolves.
 */
export const POD_TOKEN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * 20 characters of a 32-symbol alphabet is 100 bits of entropy, which is not
 * guessable and still fits a WhatsApp message body beside a domain without
 * wrapping to a second line.
 */
export const POD_TOKEN_LENGTH = 20;

const TOKEN_PATTERN = new RegExp(
  `^[${POD_TOKEN_ALPHABET}]{${POD_TOKEN_LENGTH}}$`,
);

/**
 * Encodes random bytes into the token alphabet.
 *
 * Takes the bytes rather than drawing them so the domain stays deterministic:
 * randomness is drawn by the caller in `~/server/pod-link/issue`, which lets
 * every property here be tested against a fixed input.
 */
export function encodeUploadToken(bytes: Uint8Array): string {
  if (bytes.length < POD_TOKEN_LENGTH) {
    throw new Error(
      `Need at least ${POD_TOKEN_LENGTH} bytes to encode a POD upload token`,
    );
  }

  let token = "";

  for (let index = 0; index < POD_TOKEN_LENGTH; index += 1) {
    const byte = bytes[index];

    // `noUncheckedIndexedAccess`: the length check above makes this reachable
    // only with a byte present, but the compiler cannot see that.
    if (byte === undefined) {
      throw new Error("Unexpected end of random bytes");
    }

    // 256 is not a multiple of 32, so a plain modulo would bias the first
    // eight symbols. Masking to the low five bits keeps every symbol equally
    // likely, and the byte's high bits are simply unused.
    token += POD_TOKEN_ALPHABET[byte & 0b11111];
  }

  return token;
}

/** Whether a value could be a token at all, checked before any database read. */
export function isWellFormedUploadToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/**
 * Normalises a token as typed. Drivers paste links with trailing spaces and
 * some Android keyboards lower-case the first character of a pasted string.
 */
export function normalizeUploadToken(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * The digest stored in place of the token.
 *
 * SHA-256 without a salt is deliberate: the input is 100 bits of uniform
 * randomness, so there is no dictionary to defend against, and an unsalted
 * digest is what lets the lookup be a single indexed read rather than a scan
 * over every live link.
 */
export function hashUploadToken(token: string): string {
  return createHash("sha256").update(normalizeUploadToken(token)).digest("hex");
}

/** Hashes a value used as a throttle bucket key, so no raw IP is stored. */
export function hashThrottleBucket(
  kind: "ip" | "token",
  value: string,
): string {
  return createHash("sha256").update(`${kind}:${value}`).digest("hex");
}
