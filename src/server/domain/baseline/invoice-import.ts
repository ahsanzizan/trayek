import {
  cell,
  parseDate,
  parseRupiah,
} from "~/server/domain/spreadsheet/values";

/**
 * Reading a customer's invoice history so a baseline can be computed from it
 * (TRK-013).
 *
 * Deliberately narrow. This is not a general invoice model — it is the four
 * facts needed to measure how long that customer waited to get paid, imported
 * once during onboarding and never used to bill anyone.
 */

export const INVOICE_IMPORT_FIELDS = [
  "nomorInvoice",
  "shipperName",
  "issueDate",
  "paymentDate",
  "amount",
] as const;

export type InvoiceImportField = (typeof INVOICE_IMPORT_FIELDS)[number];

export const INVOICE_REQUIRED_FIELDS: readonly InvoiceImportField[] = [
  "nomorInvoice",
  "issueDate",
  "amount",
];

export type InvoiceColumnMapping = Partial<Record<InvoiceImportField, string>>;

export type InvoiceRowNote = { field: InvoiceImportField; message: string };

export type ParsedHistoricalInvoice = {
  nomorInvoice: string;
  shipperName: string | null;
  issueDate: Date;
  paymentDate: Date | null;
  amountRupiah: bigint;
};

export type ParsedInvoiceRow =
  | { ok: true; index: number; value: ParsedHistoricalInvoice }
  | { ok: false; index: number; errors: InvoiceRowNote[] };

const FIELD_ALIASES: Record<InvoiceImportField, readonly string[]> = {
  nomorInvoice: [
    "nomorinvoice",
    "noinvoice",
    "invoice",
    "nofaktur",
    "invoiceno",
  ],
  shipperName: ["shipper", "pengirim", "customer", "pelanggan", "namashipper"],
  issueDate: [
    "issuedate",
    "tanggalinvoice",
    "tglinvoice",
    "tanggalterbit",
    "tanggal",
  ],
  paymentDate: [
    "paymentdate",
    "tanggalbayar",
    "tglbayar",
    "tanggalpelunasan",
    "dibayar",
  ],
  amount: ["amount", "nilai", "jumlah", "total", "nilaiinvoice"],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function suggestInvoiceMapping(
  headers: readonly string[],
): InvoiceColumnMapping {
  const mapping: InvoiceColumnMapping = {};
  const taken = new Set<string>();

  for (const field of INVOICE_IMPORT_FIELDS) {
    const match = headers.find(
      (header) =>
        !taken.has(header) &&
        FIELD_ALIASES[field].includes(normalizeHeader(header)),
    );

    if (match !== undefined) {
      mapping[field] = match;
      taken.add(match);
    }
  }

  return mapping;
}

export function missingInvoiceFields(
  mapping: InvoiceColumnMapping,
): InvoiceImportField[] {
  return INVOICE_REQUIRED_FIELDS.filter((field) => {
    const column = mapping[field];
    return column === undefined || column.length === 0;
  });
}

export function parseInvoiceRow(
  row: Record<string, unknown>,
  mapping: InvoiceColumnMapping,
  index: number,
): ParsedInvoiceRow {
  const errors: InvoiceRowNote[] = [];
  const read = (field: InvoiceImportField) => cell(row, mapping, field);

  const nomorInvoice = read("nomorInvoice");
  if (nomorInvoice.length === 0) {
    errors.push({ field: "nomorInvoice", message: "Kolom wajib ini kosong." });
  }

  const issueDate = parseDate(read("issueDate"));
  if (issueDate === null) {
    errors.push({
      field: "issueDate",
      message: "Tanggal invoice wajib diisi.",
    });
  } else if (issueDate === "invalid") {
    errors.push({
      field: "issueDate",
      message: "Format tanggal tidak dikenali. Gunakan dd/mm/yyyy.",
    });
  }

  // Blank is meaningful: the invoice was still unpaid when the history was
  // captured, and the computation excludes it rather than guessing.
  const paymentDate = parseDate(read("paymentDate"));
  if (paymentDate === "invalid") {
    errors.push({
      field: "paymentDate",
      message: "Format tanggal tidak dikenali. Kosongkan jika belum dibayar.",
    });
  }

  const amount = parseRupiah(read("amount"));
  if (amount === null) {
    errors.push({ field: "amount", message: "Nilai invoice wajib diisi." });
  } else if (amount === "invalid") {
    errors.push({
      field: "amount",
      message: "Nilai invoice harus berupa angka, contoh: 4.500.000",
    });
  } else if (amount === "fractional") {
    errors.push({
      field: "amount",
      message: "Gunakan rupiah bulat, tanpa angka di belakang koma.",
    });
  }

  if (
    errors.length > 0 ||
    issueDate === null ||
    issueDate === "invalid" ||
    amount === null ||
    amount === "invalid" ||
    amount === "fractional"
  ) {
    return { ok: false, index, errors };
  }

  const shipperName = read("shipperName");

  return {
    ok: true,
    index,
    value: {
      nomorInvoice,
      shipperName: shipperName.length === 0 ? null : shipperName,
      issueDate,
      paymentDate: paymentDate === "invalid" ? null : paymentDate,
      amountRupiah: amount,
    },
  };
}

/** Reads a sheet, rejecting invoice numbers repeated within the file. */
export function parseInvoiceRows(
  rows: readonly Record<string, unknown>[],
  mapping: InvoiceColumnMapping,
): ParsedInvoiceRow[] {
  const parsed = rows.map((row, index) => parseInvoiceRow(row, mapping, index));
  const seen = new Map<string, number>();

  return parsed.map((row) => {
    if (!row.ok) {
      return row;
    }

    const first = seen.get(row.value.nomorInvoice);

    if (first !== undefined) {
      return {
        ok: false as const,
        index: row.index,
        errors: [
          {
            field: "nomorInvoice" as const,
            message: `Nomor invoice ${row.value.nomorInvoice} muncul dua kali dalam berkas ini (baris ${first + 1}).`,
          },
        ],
      };
    }

    seen.set(row.value.nomorInvoice, row.index);
    return row;
  });
}
