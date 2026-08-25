import { describe, expect, it } from "vitest";

import {
  missingRequiredFields,
  parseImportRow,
  parseImportRows,
  suggestMapping,
  type ColumnMapping,
} from "~/server/domain/order/import";

const mapping: ColumnMapping = {
  nomorOrder: "No Order",
  nomorSuratJalan: "No Surat Jalan",
  shipper: "Pengirim",
  driverPhone: "No HP Sopir",
  origin: "Asal",
  destination: "Tujuan",
  plannedDeliveryDate: "Tanggal Rencana",
  actualDeliveryDate: "Tanggal Kirim",
  jumlahKoli: "Koli",
  weightKg: "Berat",
  nilaiTagihan: "Nilai Tagihan",
  status: "Status",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    "No Order": "ORD-2026-0001",
    "No Surat Jalan": "SJ-2026-0001",
    Pengirim: "PT FMCG Indonesia",
    "No HP Sopir": "0812-3456-7890",
    Asal: "Gudang Cakung",
    Tujuan: "DC Bandung",
    "Tanggal Rencana": "05/03/2026",
    "Tanggal Kirim": "07/03/2026",
    Koli: "120",
    Berat: "2400",
    "Nilai Tagihan": "Rp 4.500.000",
    Status: "DELIVERED",
    ...overrides,
  };
}

describe("suggestMapping", () => {
  it("recognises Indonesian headers as a forwarder writes them", () => {
    expect(
      suggestMapping([
        "No Order",
        "No Surat Jalan",
        "Pengirim",
        "Asal",
        "Tujuan",
      ]),
    ).toMatchObject({
      nomorOrder: "No Order",
      nomorSuratJalan: "No Surat Jalan",
      shipper: "Pengirim",
      origin: "Asal",
      destination: "Tujuan",
    });
  });

  it("ignores punctuation, spacing, and case", () => {
    expect(suggestMapping(["nomor_surat_jalan", "NAMA SHIPPER"])).toMatchObject(
      {
        nomorSuratJalan: "nomor_surat_jalan",
        shipper: "NAMA SHIPPER",
      },
    );
  });

  it("never maps one column to two fields", () => {
    const suggested = suggestMapping(["Jumlah", "Total"]);
    const columns = Object.values(suggested);

    expect(new Set(columns).size).toBe(columns.length);
  });

  it("leaves a field unmapped rather than guessing wildly", () => {
    expect(suggestMapping(["kolom aneh"])).toEqual({});
  });
});

describe("missingRequiredFields", () => {
  it("names what still blocks the import", () => {
    expect(missingRequiredFields({ nomorOrder: "A" })).toEqual([
      "nomorSuratJalan",
      "shipper",
      "origin",
      "destination",
    ]);
  });

  it("is empty once the required columns are mapped", () => {
    expect(missingRequiredFields(mapping)).toEqual([]);
  });

  it("treats an empty column name as unmapped", () => {
    expect(missingRequiredFields({ ...mapping, shipper: "" })).toEqual([
      "shipper",
    ]);
  });
});

describe("parseImportRow: a well-formed row", () => {
  const parsed = parseImportRow(row(), mapping, 0);

  it("reads every field", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value).toMatchObject({
      nomorOrder: "ORD-2026-0001",
      nomorSuratJalan: "SJ-2026-0001",
      shipper: "PT FMCG Indonesia",
      driverPhone: "+6281234567890",
      origin: "Gudang Cakung",
      destination: "DC Bandung",
      jumlahKoli: 120,
      weightGram: 2_400_000,
      nilaiTagihan: 4_500_000n,
      status: "DELIVERED",
    });
  });

  it("reads a date as midnight Jakarta, not midnight UTC", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // 05/03/2026 00:00 WIB is 04/03/2026 17:00 UTC.
    expect(parsed.value.plannedDeliveryDate?.toISOString()).toBe(
      "2026-03-04T17:00:00.000Z",
    );
  });
});

describe("parseImportRow: amounts", () => {
  it.each([
    ["Rp 4.500.000", 4_500_000n],
    ["4.500.000", 4_500_000n],
    ["4500000", 4_500_000n],
    ["rp4500000", 4_500_000n],
    ["Rp 4 500 000", 4_500_000n],
  ])("reads %s as %s rupiah", (written, expected) => {
    const parsed = parseImportRow(
      row({ "Nilai Tagihan": written }),
      mapping,
      0,
    );

    expect(parsed.ok && parsed.value.nilaiTagihan).toBe(expected);
  });

  it("rejects a fractional amount rather than rounding it away", () => {
    // Silently dropping 50 sen is a quiet money change. Refuse instead.
    const parsed = parseImportRow(
      row({ "Nilai Tagihan": "4.500.000,50" }),
      mapping,
      0,
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0]?.message).toMatch(/rupiah bulat/i);
  });

  it("rejects an amount that is not a number", () => {
    const parsed = parseImportRow(
      row({ "Nilai Tagihan": "belum ditentukan" }),
      mapping,
      0,
    );

    expect(parsed.ok).toBe(false);
  });

  it("allows a blank amount, to be filled in later", () => {
    const parsed = parseImportRow(row({ "Nilai Tagihan": "" }), mapping, 0);

    expect(parsed.ok && parsed.value.nilaiTagihan).toBeNull();
  });

  it("keeps an amount beyond the safe float range exact", () => {
    const parsed = parseImportRow(
      row({ "Nilai Tagihan": "9007199254740993" }),
      mapping,
      0,
    );

    expect(parsed.ok && parsed.value.nilaiTagihan).toBe(9_007_199_254_740_993n);
  });
});

describe("parseImportRow: dates", () => {
  it.each([
    ["05/03/2026", "2026-03-04T17:00:00.000Z"],
    ["5-3-2026", "2026-03-04T17:00:00.000Z"],
    ["2026-03-05", "2026-03-04T17:00:00.000Z"],
  ])("reads %s", (written, expected) => {
    const parsed = parseImportRow(
      row({ "Tanggal Rencana": written }),
      mapping,
      0,
    );

    expect(parsed.ok && parsed.value.plannedDeliveryDate?.toISOString()).toBe(
      expected,
    );
  });

  it("rejects a date that does not exist", () => {
    // Date.UTC would roll this into March without complaint.
    const parsed = parseImportRow(
      row({ "Tanggal Rencana": "31/02/2026" }),
      mapping,
      0,
    );

    expect(parsed.ok).toBe(false);
  });

  it("rejects an unrecognised format rather than guessing", () => {
    const parsed = parseImportRow(
      row({ "Tanggal Rencana": "March 5th" }),
      mapping,
      0,
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0]?.message).toMatch(/dd\/mm\/yyyy/);
  });
});

describe("parseImportRow: weight", () => {
  it.each([
    ["2400", 2_400_000],
    ["2400.5", 2_400_500],
    ["2400,5", 2_400_500],
    ["2400 kg", 2_400_000],
  ])("reads %s kg as grams", (written, expected) => {
    const parsed = parseImportRow(row({ Berat: written }), mapping, 0);

    expect(parsed.ok && parsed.value.weightGram).toBe(expected);
  });
});

describe("parseImportRow: required fields", () => {
  it.each([
    ["No Order", "nomorOrder"],
    ["No Surat Jalan", "nomorSuratJalan"],
    ["Pengirim", "shipper"],
    ["Asal", "origin"],
    ["Tujuan", "destination"],
  ])("rejects a row missing %s", (column, field) => {
    const parsed = parseImportRow(row({ [column]: "" }), mapping, 0);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.map((error) => error.field)).toContain(field);
  });

  it("reports every problem in one pass, not just the first", () => {
    // An operator fixing a spreadsheet wants the whole list, not one error
    // per upload round-trip.
    const parsed = parseImportRow(
      row({ "No Order": "", Asal: "", Koli: "abc" }),
      mapping,
      0,
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("parseImportRow: driver phone is a warning, not an error", () => {
  it("imports the order and flags an unreadable number", () => {
    const parsed = parseImportRow(
      row({ "No HP Sopir": "tidak punya" }),
      mapping,
      0,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.driverPhone).toBeNull();
    expect(parsed.warnings[0]?.field).toBe("driverPhone");
  });

  it("normalises a number written any of the usual ways", () => {
    const parsed = parseImportRow(
      row({ "No HP Sopir": "+62 812 3456 7890" }),
      mapping,
      0,
    );

    expect(parsed.ok && parsed.value.driverPhone).toBe("+6281234567890");
  });

  it("leaves the driver empty when the column is blank", () => {
    const parsed = parseImportRow(row({ "No HP Sopir": "" }), mapping, 0);

    expect(parsed.ok && parsed.value.driverPhone).toBeNull();
    expect(parsed.ok && parsed.warnings).toEqual([]);
  });
});

describe("parseImportRow: status", () => {
  it("defaults to CREATED when the column is absent", () => {
    const parsed = parseImportRow(row({ Status: "" }), mapping, 0);

    expect(parsed.ok && parsed.value.status).toBe("CREATED");
  });

  it("accepts a status written with spaces or lower case", () => {
    const parsed = parseImportRow(row({ Status: "pod received" }), mapping, 0);

    expect(parsed.ok && parsed.value.status).toBe("POD_RECEIVED");
  });

  it("rejects a status outside the vocabulary", () => {
    const parsed = parseImportRow(row({ Status: "SELESAI" }), mapping, 0);

    expect(parsed.ok).toBe(false);
  });
});

describe("parseImportRows: the batch keeps going", () => {
  it("reports a bad row without discarding the good ones", () => {
    const rows = [
      row({ "No Surat Jalan": "SJ-1" }),
      row({ "No Surat Jalan": "SJ-2", Koli: "bukan angka" }),
      row({ "No Surat Jalan": "SJ-3" }),
    ];

    const parsed = parseImportRows(rows, mapping);

    expect(parsed.map((entry) => entry.ok)).toEqual([true, false, true]);
  });

  it("keeps each row's position so the report can name a line", () => {
    const parsed = parseImportRows(
      [row({ "No Surat Jalan": "SJ-1" }), row({ "No Surat Jalan": "SJ-2" })],
      mapping,
    );

    expect(parsed.map((entry) => entry.index)).toEqual([0, 1]);
  });

  it("rejects a surat jalan repeated inside the same file", () => {
    // Two rows claiming one surat jalan would make POD matching ambiguous,
    // and the database constraint would only catch the second one obscurely.
    const parsed = parseImportRows(
      [
        row({ "No Surat Jalan": "SJ-DUP" }),
        row({ "No Surat Jalan": "SJ-DUP" }),
      ],
      mapping,
    );

    expect(parsed[0]?.ok).toBe(true);
    expect(parsed[1]?.ok).toBe(false);

    const second = parsed[1];
    if (second?.ok === false) {
      expect(second.errors[0]?.message).toMatch(/muncul dua kali/);
      expect(second.errors[0]?.message).toMatch(/baris 1/);
    }
  });

  it("handles an empty sheet without complaint", () => {
    expect(parseImportRows([], mapping)).toEqual([]);
  });
});

describe("parseImportRows: scale", () => {
  it("parses 5,000 rows well inside the time budget", () => {
    // The acceptance criterion is about the whole import, but parsing is the
    // part that runs per row; if this were slow nothing else could be fast.
    const rows = Array.from({ length: 5000 }, (_, index) =>
      row({ "No Surat Jalan": `SJ-${index}` }),
    );

    const started = Date.now();
    const parsed = parseImportRows(rows, mapping);
    const elapsed = Date.now() - started;

    expect(parsed).toHaveLength(5000);
    expect(parsed.every((entry) => entry.ok)).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  });
});
