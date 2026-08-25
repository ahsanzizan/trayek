"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Papa from "papaparse";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import {
  IMPORT_FIELDS,
  missingRequiredFields,
  REQUIRED_FIELDS,
  suggestMapping,
  type ColumnMapping,
  type ImportField,
} from "~/server/domain/order/import";
import { api } from "~/trpc/react";

const FIELD_LABELS: Record<ImportField, string> = {
  nomorOrder: "Nomor order",
  nomorSuratJalan: "Nomor surat jalan",
  shipper: "Shipper",
  driverPhone: "No. HP driver",
  origin: "Asal",
  destination: "Tujuan",
  plannedDeliveryDate: "Tanggal rencana",
  actualDeliveryDate: "Tanggal kirim",
  jumlahKoli: "Jumlah koli",
  weightKg: "Berat (kg)",
  nilaiTagihan: "Nilai tagihan",
  status: "Status",
};

const OUTCOME_LABELS = {
  CREATED: "Diimpor",
  SKIPPED: "Dilewati",
  REJECTED: "Ditolak",
} as const;

const MAX_ROWS = 5000;

type Sheet = { headers: string[]; rows: Record<string, unknown>[] };

export function ImportPanel() {
  const router = useRouter();
  const utils = api.useUtils();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [committed, setCommitted] = useState(false);

  const runImport = api.order.import.useMutation({
    onSuccess: async (_result, variables) => {
      if (variables.dryRun) {
        return;
      }

      setCommitted(true);
      await utils.order.list.invalidate();
      router.refresh();
    },
  });

  function readFile(file: File) {
    setFileError(null);
    setCommitted(false);
    runImport.reset();

    // Parsed in the browser so the mapping screen is instant and the file
    // itself never leaves the machine. Only the rows the operator approves
    // are sent, which keeps a spreadsheet of personal data out of our logs.
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? [];

        if (headers.length === 0) {
          setFileError("Berkas tidak punya baris judul kolom.");
          return;
        }

        if (results.data.length === 0) {
          setFileError("Berkas tidak berisi data.");
          return;
        }

        if (results.data.length > MAX_ROWS) {
          setFileError(
            `Berkas berisi ${results.data.length.toLocaleString("id-ID")} baris. Maksimal ${MAX_ROWS.toLocaleString("id-ID")} baris per impor.`,
          );
          return;
        }

        setSheet({ headers, rows: results.data });
        setMapping(suggestMapping(headers));
      },
      error: () => setFileError("Berkas tidak bisa dibaca."),
    });
  }

  const unmapped = missingRequiredFields(mapping);
  const preview = runImport.data;

  return (
    <section className="border-border-subtle bg-card text-card-foreground flex flex-col gap-5 rounded-[var(--radius-card)] border p-6">
      <div>
        <h2 className="text-base font-medium">Impor dari CSV</h2>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          Unggah berkas, cocokkan kolom, lihat pratinjau, baru simpan. Baris
          yang bermasalah dilaporkan satu per satu — sisanya tetap diimpor.
        </p>
      </div>

      <input
        type="file"
        accept=".csv,text/csv"
        className="file:border-border-strong file:bg-surface file:text-foreground text-sm file:mr-3 file:rounded-[var(--radius-control)] file:border file:px-3 file:py-2 file:text-sm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            readFile(file);
          }
        }}
      />

      {fileError && (
        <p role="alert" className="text-destructive text-sm">
          {fileError}
        </p>
      )}

      {sheet && (
        <>
          <p className="text-muted-foreground text-sm">
            {sheet.rows.length.toLocaleString("id-ID")} baris terbaca.
          </p>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">Cocokkan kolom</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => (
                <label key={field} className="flex flex-col gap-1 text-sm">
                  <span>
                    {FIELD_LABELS[field]}
                    {REQUIRED_FIELDS.includes(field) && (
                      <span className="text-destructive"> *</span>
                    )}
                  </span>
                  <select
                    value={mapping[field] ?? ""}
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                    className="border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)] border px-3 text-sm"
                  >
                    <option value="">— tidak dipakai —</option>
                    {sheet.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>

          {unmapped.length > 0 && (
            <p className="text-destructive text-sm">
              Kolom wajib belum dicocokkan:{" "}
              {unmapped.map((field) => FIELD_LABELS[field]).join(", ")}.
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={unmapped.length > 0 || runImport.isPending}
              className="min-h-11 rounded-[var(--radius-control)]"
              onClick={() => {
                setCommitted(false);
                runImport.mutate({
                  rows: sheet.rows,
                  mapping,
                  dryRun: true,
                });
              }}
            >
              {runImport.isPending ? (
                <>
                  <Spinner aria-label="Memeriksa berkas" />
                  <span>Memeriksa…</span>
                </>
              ) : (
                "Pratinjau"
              )}
            </Button>

            <Button
              type="button"
              disabled={
                preview === undefined ||
                committed ||
                preview.created === 0 ||
                runImport.isPending
              }
              className="min-h-11 rounded-[var(--radius-control)]"
              onClick={() =>
                runImport.mutate({
                  rows: sheet.rows,
                  mapping,
                  dryRun: false,
                })
              }
            >
              {preview
                ? `Impor ${preview.created.toLocaleString("id-ID")} order`
                : "Impor"}
            </Button>
          </div>
        </>
      )}

      {runImport.isError && (
        <p role="alert" className="text-destructive text-sm">
          {runImport.error.data?.code === "FORBIDDEN"
            ? "Hanya admin atau owner yang dapat mengimpor order."
            : "Impor gagal. Coba lagi."}
        </p>
      )}

      {preview && (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="text-sm">
            {committed ? "Selesai diimpor" : "Pratinjau"}:{" "}
            <strong>{preview.created.toLocaleString("id-ID")}</strong>{" "}
            {committed ? "diimpor" : "akan diimpor"},{" "}
            <strong>{preview.skipped.toLocaleString("id-ID")}</strong> dilewati,{" "}
            <strong>{preview.rejected.toLocaleString("id-ID")}</strong> ditolak,
            dari {preview.total.toLocaleString("id-ID")} baris.
          </p>

          {preview.rows.length > 0 && (
            <div className="border-border-subtle max-h-96 overflow-auto rounded-[var(--radius-card)] border">
              <table className="w-full text-left text-sm">
                <thead className="bg-card text-muted-foreground border-border-subtle sticky top-0 border-b">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-normal">
                      Baris
                    </th>
                    <th scope="col" className="px-4 py-2 font-normal">
                      Surat jalan
                    </th>
                    <th scope="col" className="px-4 py-2 font-normal">
                      Hasil
                    </th>
                    <th scope="col" className="px-4 py-2 font-normal">
                      Keterangan
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr
                      key={row.index}
                      className="border-border-subtle border-b last:border-b-0"
                    >
                      {/* Header row is line 1, so the operator can find it. */}
                      <td className="px-4 py-2 font-mono text-xs">
                        {row.index + 2}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {row.nomorSuratJalan ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        {OUTCOME_LABELS[row.outcome]}
                      </td>
                      <td className="text-muted-foreground px-4 py-2">
                        {row.notes.map((note) => note.message).join(" ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
