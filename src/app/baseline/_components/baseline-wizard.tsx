"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Papa from "papaparse";

import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import {
  INVOICE_IMPORT_FIELDS,
  missingInvoiceFields,
  suggestInvoiceMapping,
  type InvoiceColumnMapping,
  type InvoiceImportField,
} from "~/server/domain/baseline/invoice-import";
import { api } from "~/trpc/react";

const FIELD_LABELS: Record<InvoiceImportField, string> = {
  nomorInvoice: "Nomor invoice",
  shipperName: "Shipper",
  issueDate: "Tanggal invoice",
  paymentDate: "Tanggal bayar",
  amount: "Nilai invoice",
};

const inputClasses =
  "border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)]";

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

/** A date input gives `yyyy-mm-dd`; store it as midnight Jakarta. */
function jakartaDate(value: string): Date {
  return new Date(`${value}T00:00:00+07:00`);
}

export function BaselineWizard() {
  const router = useRouter();
  const utils = api.useUtils();
  const [current] = api.baseline.current.useSuspenseQuery({});

  const has = (method: string) =>
    current.baselines.some((baseline) => baseline.method === method);

  async function refresh() {
    await utils.baseline.current.invalidate();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      {!has("CLAIMED") && <ClaimedStep onDone={refresh} />}
      {!has("COMPUTED_FROM_BALANCES") && <BalancesStep onDone={refresh} />}
      {!has("COMPUTED_FROM_INVOICES") && <InvoiceImportStep onDone={refresh} />}

      {current.baselines.length === 3 && (
        <p className="text-muted-foreground text-sm">
          Semua metode baseline sudah tercatat. Angka ini dikunci dan tidak bisa
          diubah — itulah yang membuatnya bisa dipakai sebagai pembanding nanti.
        </p>
      )}
    </div>
  );
}

function StepShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border-subtle bg-card text-card-foreground flex flex-col gap-4 rounded-[var(--radius-card)] border p-6">
      <div>
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function ClaimedStep({ onDone }: { onDone: () => Promise<void> }) {
  const [dsoDays, setDsoDays] = useState("");
  const [statedUnprompted, setStatedUnprompted] = useState<boolean | null>(
    null,
  );
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [note, setNote] = useState("");

  const capture = api.baseline.captureClaimed.useMutation({
    onSuccess: onDone,
  });

  const ready =
    dsoDays.length > 0 &&
    statedUnprompted !== null &&
    periodStart.length > 0 &&
    periodEnd.length > 0;

  return (
    <StepShell
      title="1 · Angka menurut pemilik"
      description="Berapa DSO perusahaan ini menurut pemiliknya? Catat apa adanya, termasuk kalau ternyata meleset dari data — selisihnya sendiri adalah temuan."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="claimed-dso">DSO (hari)</FieldLabel>
          <Input
            id="claimed-dso"
            inputMode="numeric"
            value={dsoDays}
            onChange={(event) => setDsoDays(digitsOnly(event.target.value))}
            placeholder="75"
            className={inputClasses}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="claimed-start">Periode mulai</FieldLabel>
          <Input
            id="claimed-start"
            type="date"
            value={periodStart}
            onChange={(event) => setPeriodStart(event.target.value)}
            className={inputClasses}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="claimed-end">Periode selesai</FieldLabel>
          <Input
            id="claimed-end"
            type="date"
            value={periodEnd}
            onChange={(event) => setPeriodEnd(event.target.value)}
            className={inputClasses}
          />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">
          Apakah pemilik menyebut angka ini tanpa ditanya lebih dulu?
        </legend>
        <p className="text-muted-foreground text-xs">
          Sinyal go/no-go bulan 0-2: pemilik yang tidak tahu DSO-nya belum
          merasakan masalah yang produk ini jual.
        </p>
        <div className="flex gap-4">
          {[
            { label: "Ya, spontan", value: true },
            { label: "Tidak, setelah ditanya", value: false },
          ].map((option) => (
            <label
              key={option.label}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="radio"
                name="stated-unprompted"
                className="accent-primary size-4"
                checked={statedUnprompted === option.value}
                onChange={() => setStatedUnprompted(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <Field>
        <FieldLabel htmlFor="claimed-note">Catatan</FieldLabel>
        <Input
          id="claimed-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Konteks dari wawancara onboarding"
          className={inputClasses}
        />
      </Field>

      {capture.isError && (
        <p role="alert" className="text-destructive text-sm">
          {capture.error.data?.code === "CONFLICT"
            ? capture.error.message
            : "Gagal menyimpan. Periksa isian lalu coba lagi."}
        </p>
      )}

      <Button
        type="button"
        disabled={!ready || capture.isPending}
        className="min-h-11 w-fit rounded-[var(--radius-control)]"
        onClick={() =>
          capture.mutate({
            dsoDays: Number(dsoDays),
            periodStart: jakartaDate(periodStart),
            periodEnd: jakartaDate(periodEnd),
            statedUnprompted: statedUnprompted === true,
            note: note.trim().length === 0 ? null : note.trim(),
          })
        }
      >
        {capture.isPending ? (
          <>
            <Spinner aria-label="Menyimpan" />
            <span>Menyimpan…</span>
          </>
        ) : (
          "Kunci angka pemilik"
        )}
      </Button>
    </StepShell>
  );
}

function BalancesStep({ onDone }: { onDone: () => Promise<void> }) {
  const [revenue, setRevenue] = useState("");
  const [receivable, setReceivable] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  const capture = api.baseline.captureFromBalances.useMutation({
    onSuccess: onDone,
  });

  const ready =
    revenue.length > 0 &&
    receivable.length > 0 &&
    periodStart.length > 0 &&
    periodEnd.length > 0;

  return (
    <StepShell
      title="2 · Dari neraca"
      description="Dua angka dari trial balance: total tagihan yang diterbitkan, dan rata-rata saldo piutang di periode yang sama. Kebanyakan pemilik bisa memberi ini jauh sebelum bisa mengekspor setahun invoice."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="revenue">Total tagihan (Rp)</FieldLabel>
          <Input
            id="revenue"
            inputMode="numeric"
            value={revenue}
            onChange={(event) => setRevenue(digitsOnly(event.target.value))}
            placeholder="1000000000"
            className={inputClasses}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="receivable">Rata-rata piutang (Rp)</FieldLabel>
          <Input
            id="receivable"
            inputMode="numeric"
            value={receivable}
            onChange={(event) => setReceivable(digitsOnly(event.target.value))}
            placeholder="500000000"
            className={inputClasses}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="balance-start">Periode mulai</FieldLabel>
          <Input
            id="balance-start"
            type="date"
            value={periodStart}
            onChange={(event) => setPeriodStart(event.target.value)}
            className={inputClasses}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="balance-end">Periode selesai</FieldLabel>
          <Input
            id="balance-end"
            type="date"
            value={periodEnd}
            onChange={(event) => setPeriodEnd(event.target.value)}
            className={inputClasses}
          />
        </Field>
      </div>

      {capture.isError && (
        <p role="alert" className="text-destructive text-sm">
          {capture.error.message}
        </p>
      )}

      <Button
        type="button"
        disabled={!ready || capture.isPending}
        className="min-h-11 w-fit rounded-[var(--radius-control)]"
        onClick={() =>
          capture.mutate({
            invoicedRevenue: BigInt(revenue),
            averageReceivable: BigInt(receivable),
            periodStart: jakartaDate(periodStart),
            periodEnd: jakartaDate(periodEnd),
            note: null,
          })
        }
      >
        {capture.isPending ? (
          <>
            <Spinner aria-label="Menghitung" />
            <span>Menghitung…</span>
          </>
        ) : (
          "Hitung dan kunci"
        )}
      </Button>
    </StepShell>
  );
}

function InvoiceImportStep({ onDone }: { onDone: () => Promise<void> }) {
  const [sheet, setSheet] = useState<{
    headers: string[];
    rows: Record<string, unknown>[];
  } | null>(null);
  const [mapping, setMapping] = useState<InvoiceColumnMapping>({});
  const [fileError, setFileError] = useState<string | null>(null);

  const runImport = api.baseline.importHistoricalInvoices.useMutation({
    onSuccess: async (_result, variables) => {
      if (!variables.dryRun) {
        await onDone();
      }
    },
  });

  const unmapped = missingInvoiceFields(mapping);
  const preview = runImport.data;

  return (
    <StepShell
      title="3 · Dari riwayat invoice"
      description="Unggah invoice lama beserta tanggal terbit dan tanggal bayar. Ini menghasilkan angka yang paling bisa dipertahankan, karena berasal dari data, bukan ingatan."
    >
      <input
        type="file"
        accept=".csv,text/csv"
        className="file:border-border-strong file:bg-surface file:text-foreground text-sm file:mr-3 file:rounded-[var(--radius-control)] file:border file:px-3 file:py-2 file:text-sm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;

          setFileError(null);
          runImport.reset();

          Papa.parse<Record<string, unknown>>(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
              const headers = results.meta.fields ?? [];
              if (headers.length === 0 || results.data.length === 0) {
                setFileError("Berkas kosong atau tidak punya judul kolom.");
                return;
              }
              setSheet({ headers, rows: results.data });
              setMapping(suggestInvoiceMapping(headers));
            },
            error: () => setFileError("Berkas tidak bisa dibaca."),
          });
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

          <div className="grid gap-3 sm:grid-cols-2">
            {INVOICE_IMPORT_FIELDS.map((field) => (
              <label key={field} className="flex flex-col gap-1 text-sm">
                <span>{FIELD_LABELS[field]}</span>
                <select
                  value={mapping[field] ?? ""}
                  onChange={(event) =>
                    setMapping((currentMapping) => ({
                      ...currentMapping,
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
              onClick={() =>
                runImport.mutate({ rows: sheet.rows, mapping, dryRun: true })
              }
            >
              Pratinjau
            </Button>
            <Button
              type="button"
              disabled={
                preview === undefined ||
                preview.accepted === 0 ||
                runImport.isPending
              }
              className="min-h-11 rounded-[var(--radius-control)]"
              onClick={() =>
                runImport.mutate({ rows: sheet.rows, mapping, dryRun: false })
              }
            >
              Hitung dan kunci
            </Button>
          </div>
        </>
      )}

      {preview && (
        <div aria-live="polite" className="flex flex-col gap-2 text-sm">
          <p>
            {preview.accepted.toLocaleString("id-ID")} baris terbaca,{" "}
            {preview.rejected.toLocaleString("id-ID")} ditolak dari{" "}
            {preview.total.toLocaleString("id-ID")}.
          </p>

          {preview.excluded && (
            <p className="text-muted-foreground">
              Tidak dihitung: {preview.excluded.unpaid} belum dibayar,{" "}
              {preview.excluded.negativeDuration} tanggal bayar mendahului
              terbit, {preview.excluded.zeroAmount} bernilai nol.
            </p>
          )}

          {preview.rows.length > 0 && (
            <ul className="text-muted-foreground max-h-48 overflow-auto text-xs">
              {preview.rows.map((row) => (
                <li key={row.index}>
                  Baris {row.index + 2}:{" "}
                  {row.notes.map((note) => note.message).join(" ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </StepShell>
  );
}
