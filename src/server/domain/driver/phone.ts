/**
 * Indonesian mobile numbers, normalised to E.164 (TRK-012).
 *
 * Written by hand rather than pulled from a library because exactly one
 * country is in scope. `libphonenumber-js` carries metadata for every country
 * to solve a problem we do not have, and the rules below fit on a screen.
 *
 * Drivers are a data source, never an account: this number is how a POD upload
 * link reaches Pak Herman, and how the same driver typed six different ways
 * resolves to one record.
 */

/** Why a number could not be normalised. Distinguished so the UI can explain. */
export type PhoneParseError =
  | "EMPTY"
  | "CONTAINS_LETTERS"
  | "UNSUPPORTED_COUNTRY_CODE"
  | "NOT_A_MOBILE_NUMBER"
  | "TOO_SHORT"
  | "TOO_LONG";

export type PhoneParseResult =
  { ok: true; e164: string } | { ok: false; reason: PhoneParseError };

/**
 * Separators that appear in numbers people actually type: spaces (including
 * the non-breaking space pasted out of Excel and Word), dots, hyphens of
 * several widths, and the brackets around an area code.
 */
const SEPARATORS = /[\s ​.\-–—()[\]]/g;

/**
 * Every Indonesian mobile prefix is `8` followed by 1-9 — 811-819, 821-823,
 * 831-838, 851-859, 877-878, 881-889, 895-899. Nothing real begins `80`, which
 * is the toll and premium range (0800, 0804, 0809).
 *
 * Landlines (`21` Jakarta, `31` Surabaya) are rejected for the same reason a
 * premium number is: a driver reachable only at a desk phone cannot receive an
 * upload link, so either one here is a data-entry mistake worth catching at
 * the point of entry rather than at send time.
 */
const MOBILE_PREFIX = /^8[1-9]/;
const MIN_NATIONAL_DIGITS = 9;
const MAX_NATIONAL_DIGITS = 12;

/**
 * Reduces any accepted spelling to the national significant number — the form
 * beginning `8` — or reports why it could not.
 */
function toNationalNumber(
  digits: string,
  hadPlus: boolean,
): PhoneParseResult | string {
  // 00 is the international access prefix dialled from within Indonesia.
  const withoutIddPrefix = digits.startsWith("00") ? digits.slice(2) : digits;
  const isInternational = hadPlus || withoutIddPrefix !== digits;

  if (withoutIddPrefix.startsWith("62")) {
    return withoutIddPrefix.slice(2);
  }

  // An explicit international form that is not +62 belongs to another country.
  // Without that marker the number is national, so a leading 0 is the trunk
  // prefix rather than a country code.
  if (isInternational) {
    return { ok: false, reason: "UNSUPPORTED_COUNTRY_CODE" };
  }

  if (withoutIddPrefix.startsWith("0")) {
    return withoutIddPrefix.slice(1);
  }

  return withoutIddPrefix;
}

/**
 * Normalises one written number to E.164, or reports why it cannot.
 *
 * Returns a result rather than throwing: a bad number is an expected outcome
 * of a CSV import, not an exceptional one, and the import has to report which
 * row failed and why without unwinding the batch.
 */
export function normalizeIndonesianPhone(input: string): PhoneParseResult {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: "EMPTY" };
  }

  const hadPlus = trimmed.startsWith("+");
  const withoutPlus = hadPlus ? trimmed.slice(1) : trimmed;
  const digits = withoutPlus.replace(SEPARATORS, "");

  if (!/^\d+$/.test(digits)) {
    return { ok: false, reason: "CONTAINS_LETTERS" };
  }

  const national = toNationalNumber(digits, hadPlus);

  if (typeof national !== "string") {
    return national;
  }

  if (!MOBILE_PREFIX.test(national)) {
    return { ok: false, reason: "NOT_A_MOBILE_NUMBER" };
  }

  if (national.length < MIN_NATIONAL_DIGITS) {
    return { ok: false, reason: "TOO_SHORT" };
  }

  if (national.length > MAX_NATIONAL_DIGITS) {
    return { ok: false, reason: "TOO_LONG" };
  }

  return { ok: true, e164: `+62${national}` };
}

/** Bahasa Indonesia explanation for each failure, for a form or an import report. */
export const PHONE_PARSE_MESSAGES: Record<PhoneParseError, string> = {
  EMPTY: "Nomor telepon wajib diisi.",
  CONTAINS_LETTERS: "Nomor telepon hanya boleh berisi angka.",
  UNSUPPORTED_COUNTRY_CODE: "Hanya nomor Indonesia (+62) yang didukung.",
  NOT_A_MOBILE_NUMBER: "Gunakan nomor ponsel (08xx), bukan nomor kantor.",
  TOO_SHORT: "Nomor telepon terlalu pendek.",
  TOO_LONG: "Nomor telepon terlalu panjang.",
};
