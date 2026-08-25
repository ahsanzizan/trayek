import { normalizeIndonesianPhone } from "~/server/domain/driver/phone";

/**
 * Turning a forwarder's spreadsheet into orders (TRK-011).
 *
 * Pure: no database, no file reading. The caller hands in rows already split
 * into cells and gets back, per row, either a value or the reasons it could
 * not be used. That shape is the point — the acceptance criterion requires an
 * import of 5,000 rows to report per-row failures *without aborting the
 * batch*, so a parse failure has to be a value, never an exception.
 *
 * Everything user-facing here is Bahasa Indonesia: these messages are read by
 * the admin staring at a rejected row, not by us.
 */

export const ORDER_STATUSES = [
  "CREATED",
  "IN_TRANSIT",
  "DELIVERED",
  "POD_RECEIVED",
  "POD_VALIDATED",
  "PACKET_READY",
  "INVOICED",
  "PAID",
  "REJECTED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const IMPORT_FIELDS = [
  "nomorOrder",
  "nomorSuratJalan",
  "shipper",
  "driverPhone",
  "origin",
  "destination",
  "plannedDeliveryDate",
  "actualDeliveryDate",
  "jumlahKoli",
  "weightKg",
  "nilaiTagihan",
  "status",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

export const REQUIRED_FIELDS: readonly ImportField[] = [
  "nomorOrder",
  "nomorSuratJalan",
  "shipper",
  "origin",
  "destination",
];

/** Target field -> the CSV header it reads from. */
export type ColumnMapping = Partial<Record<ImportField, string>>;

export type RowNote = { field: ImportField; message: string };

/**
 * One order as read from a spreadsheet. `shipper` is left as written — the
 * caller resolves it against the registry, because that needs the database.
 */
export type ParsedOrderRow = {
  nomorOrder: string;
  nomorSuratJalan: string;
  shipper: string;
  driverPhone: string | null;
  origin: string;
  destination: string;
  plannedDeliveryDate: Date | null;
  actualDeliveryDate: Date | null;
  jumlahKoli: number | null;
  weightGram: number | null;
  nilaiTagihan: bigint | null;
  status: OrderStatus;
};

export type ParsedRow =
  | {
      ok: true;
      index: number;
      value: ParsedOrderRow;
      /** Recoverable: the row imports, but something was dropped or guessed. */
      warnings: RowNote[];
    }
  | { ok: false; index: number; errors: RowNote[] };

/** Header spellings seen in real forwarder exports, Indonesian and English. */
const FIELD_ALIASES: Record<ImportField, readonly string[]> = {
  nomorOrder: ["nomororder", "noorder", "order", "ordernumber", "nomorpesanan"],
  nomorSuratJalan: [
    "nomorsuratjalan",
    "nosuratjalan",
    "suratjalan",
    "nosj",
    "sj",
    "deliverynote",
  ],
  shipper: ["shipper", "pengirim", "customer", "pelanggan", "namashipper"],
  driverPhone: [
    "driverphone",
    "nohpdriver",
    "hpdriver",
    "nomordriver",
    "telepondriver",
    "nohpsopir",
    "sopir",
  ],
  origin: ["origin", "asal", "muat", "lokasimuat", "from"],
  destination: ["destination", "tujuan", "bongkar", "lokasibongkar", "to"],
  plannedDeliveryDate: [
    "planneddeliverydate",
    "tanggalrencana",
    "rencanakirim",
    "etatanggal",
    "eta",
  ],
  actualDeliveryDate: [
    "actualdeliverydate",
    "tanggalkirim",
    "tanggalterima",
    "realisasi",
    "tglkirim",
  ],
  jumlahKoli: ["jumlahkoli", "koli", "qty", "jumlah", "quantity"],
  weightKg: ["weightkg", "berat", "beratkg", "tonase", "weight"],
  nilaiTagihan: [
    "nilaitagihan",
    "nilai",
    "tagihan",
    "amount",
    "jumlahtagihan",
    "total",
  ],
  status: ["status", "statusorder"],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Guesses which column feeds which field, so the mapping screen opens
 * pre-filled rather than empty. Only a suggestion: the operator confirms it,
 * because a wrong guess on `nilaiTagihan` is expensive and silent.
 */
export function suggestMapping(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();

  for (const field of IMPORT_FIELDS) {
    const aliases = FIELD_ALIASES[field];

    const match = headers.find(
      (header) =>
        !taken.has(header) && aliases.includes(normalizeHeader(header)),
    );

    if (match !== undefined) {
      mapping[field] = match;
      taken.add(match);
    }
  }

  return mapping;
}

/** Fields the operator still has to map before the import can run. */
export function missingRequiredFields(mapping: ColumnMapping): ImportField[] {
  return REQUIRED_FIELDS.filter((field) => {
    const column = mapping[field];
    return column === undefined || column.length === 0;
  });
}

function cell(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  field: ImportField,
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

/**
 * Jakarta is UTC+7 and observes no daylight saving, so a calendar date from a
 * spreadsheet becomes midnight Jakarta rather than midnight UTC. Getting this
 * wrong shifts a delivery date by a day for anything near midnight, which
 * moves the due date the whole product is measured on.
 */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

function parseDate(raw: string): Date | "invalid" | null {
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

function parseInteger(raw: string): number | "invalid" | null {
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
function parseWeightGram(raw: string): number | "invalid" | null {
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
function parseRupiah(raw: string): bigint | "invalid" | "fractional" | null {
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

function parseStatus(raw: string): OrderStatus | "invalid" | null {
  if (raw.length === 0) {
    return null;
  }

  const candidate = raw.toUpperCase().replace(/[\s-]/g, "_");

  return (ORDER_STATUSES as readonly string[]).includes(candidate)
    ? (candidate as OrderStatus)
    : "invalid";
}

/**
 * Reads one spreadsheet row. Never throws: a bad row is a value describing
 * what is wrong with it, so the batch keeps going.
 */
export function parseImportRow(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  index: number,
): ParsedRow {
  const errors: RowNote[] = [];
  const warnings: RowNote[] = [];

  const read = (field: ImportField) => cell(row, mapping, field);

  for (const field of REQUIRED_FIELDS) {
    if (read(field).length === 0) {
      errors.push({ field, message: "Kolom wajib ini kosong." });
    }
  }

  const planned = parseDate(read("plannedDeliveryDate"));
  if (planned === "invalid") {
    errors.push({
      field: "plannedDeliveryDate",
      message: "Format tanggal tidak dikenali. Gunakan dd/mm/yyyy.",
    });
  }

  const actual = parseDate(read("actualDeliveryDate"));
  if (actual === "invalid") {
    errors.push({
      field: "actualDeliveryDate",
      message: "Format tanggal tidak dikenali. Gunakan dd/mm/yyyy.",
    });
  }

  const koli = parseInteger(read("jumlahKoli"));
  if (koli === "invalid") {
    errors.push({ field: "jumlahKoli", message: "Harus berupa angka bulat." });
  }

  const weight = parseWeightGram(read("weightKg"));
  if (weight === "invalid") {
    errors.push({ field: "weightKg", message: "Berat harus berupa angka." });
  }

  const amount = parseRupiah(read("nilaiTagihan"));
  if (amount === "invalid") {
    errors.push({
      field: "nilaiTagihan",
      message: "Nilai tagihan harus berupa angka, contoh: 4.500.000",
    });
  }
  if (amount === "fractional") {
    errors.push({
      field: "nilaiTagihan",
      message: "Gunakan rupiah bulat, tanpa angka di belakang koma.",
    });
  }

  const status = parseStatus(read("status"));
  if (status === "invalid") {
    errors.push({
      field: "status",
      message: `Status tidak dikenali. Pilihan: ${ORDER_STATUSES.join(", ")}`,
    });
  }

  // An unreadable phone number does not stop the order being imported. The
  // order is the record that matters; the driver can be attached afterwards.
  let driverPhone: string | null = null;
  const rawPhone = read("driverPhone");

  if (rawPhone.length > 0) {
    const normalized = normalizeIndonesianPhone(rawPhone);

    if (normalized.ok) {
      driverPhone = normalized.e164;
    } else {
      warnings.push({
        field: "driverPhone",
        message: `Nomor "${rawPhone}" tidak dikenali; order tetap diimpor tanpa driver.`,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, index, errors };
  }

  return {
    ok: true,
    index,
    warnings,
    value: {
      nomorOrder: read("nomorOrder"),
      nomorSuratJalan: read("nomorSuratJalan"),
      shipper: read("shipper"),
      driverPhone,
      origin: read("origin"),
      destination: read("destination"),
      plannedDeliveryDate: planned === "invalid" ? null : planned,
      actualDeliveryDate: actual === "invalid" ? null : actual,
      jumlahKoli: koli === "invalid" ? null : koli,
      weightGram: weight === "invalid" ? null : weight,
      nilaiTagihan:
        amount === "invalid" || amount === "fractional" ? null : amount,
      status: status === "invalid" || status === null ? "CREATED" : status,
    },
  };
}

/**
 * Reads a whole sheet, and flags surat jalan numbers repeated *within the
 * file*. Duplicates against the database are the caller's job; duplicates
 * inside one upload are a mistake in the file itself.
 */
export function parseImportRows(
  rows: readonly Record<string, unknown>[],
  mapping: ColumnMapping,
): ParsedRow[] {
  const parsed = rows.map((row, index) => parseImportRow(row, mapping, index));
  const seen = new Map<string, number>();

  return parsed.map((row) => {
    if (!row.ok) {
      return row;
    }

    const key = row.value.nomorSuratJalan;
    const first = seen.get(key);

    if (first !== undefined) {
      return {
        ok: false as const,
        index: row.index,
        errors: [
          {
            field: "nomorSuratJalan" as const,
            message: `Nomor surat jalan ${key} muncul dua kali dalam berkas ini (baris ${first + 1}).`,
          },
        ],
      };
    }

    seen.set(key, row.index);
    return row;
  });
}
