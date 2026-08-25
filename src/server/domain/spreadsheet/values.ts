/**
 * Reading values out of a spreadsheet cell.
 *
 * Shared by the order import (TRK-011) and the historical invoice import
 * (TRK-013), which is why it lives here rather than inside either. Duplicating
 * the date rules in particular would let the two drift, and a delivery date
 * and an invoice date that disagree about what "05/03/2026" means is the kind
 * of bug that shows up as an unexplained week of DSO.
 */

/**
 * Jakarta is UTC+7 and observes no daylight saving, so a calendar date from a
 * spreadsheet becomes midnight Jakarta rather than midnight UTC. Getting this
 * wrong shifts a date by a day for anything near midnight, which moves the due
 * date the whole product is measured on.
 */
export const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Reads one mapped column, generic over whatever field set the caller uses. */
export function cell<Field extends string>(
  row: Record<string, unknown>,
  mapping: Partial<Record<Field, string>>,
  field: Field,
): string {
  const column = mapping[field];

  if (column === undefined) {
    return "";
  }

  const value = row[column];

  // A spreadsheet cell is a scalar. Anything else is not a value we can read,
  // and it surfaces as an empty cell, which the required-field check reports.
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

export function parseDate(raw: string): Date | "invalid" | null {
  if (raw.length === 0) {
    return null;
  }

  // dd/mm/yyyy and dd-mm-yyyy, the formats Indonesian Excel produces.
  const local = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(raw);
  // yyyy-mm-dd, what a TMS export usually produces.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);

  const parts = local
    ? { year: local[3], month: local[2], day: local[1] }
    : iso
      ? { year: iso[1], month: iso[2], day: iso[3] }
      : null;

  if (!parts) {
    return "invalid";
  }

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return "invalid";
  }

  const utcMidnight = Date.UTC(year, month - 1, day);
  const date = new Date(utcMidnight - JAKARTA_OFFSET_MS);

  // Rejects 31 February, which Date.UTC would silently roll into March.
  if (new Date(utcMidnight).getUTCDate() !== day) {
    return "invalid";
  }

  return date;
}

export function parseInteger(raw: string): number | "invalid" | null {
  if (raw.length === 0) {
    return null;
  }

  const digits = raw.replace(/[.\s]/g, "");

  if (!/^\d+$/.test(digits)) {
    return "invalid";
  }

  return Number(digits);
}

/**
 * Kilograms in, grams out. Weight is stored as an integer so summing it across
 * a packet cannot drift the way a float would.
 */
export function parseWeightGram(raw: string): number | "invalid" | null {
  if (raw.length === 0) {
    return null;
  }

  const cleaned = raw.replace(/\s|kg/gi, "").replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return "invalid";
  }

  return Math.round(Number(cleaned) * 1000);
}

/**
 * Reads an amount as written on an Indonesian invoice: `Rp 4.500.000`.
 *
 * A decimal comma is rejected rather than rounded. Amounts are whole rupiah,
 * and silently discarding a fraction is the kind of quiet money change this
 * product must never make.
 */
export function parseRupiah(
  raw: string,
): bigint | "invalid" | "fractional" | null {
  if (raw.length === 0) {
    return null;
  }

  const withoutCurrency = raw.replace(/rp\.?/gi, "").replace(/\s/g, "");

  if (/,\d/.test(withoutCurrency)) {
    return "fractional";
  }

  const digits = withoutCurrency.replace(/[.,]/g, "");

  if (!/^\d+$/.test(digits)) {
    return "invalid";
  }

  return BigInt(digits);
}
