"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import {
  CLOCK_START_EVENTS,
  DOCUMENT_TYPES,
  POD_FIELDS,
  type ClockStartEvent,
  type DocumentType,
  type PodField,
  type RequirementRules,
} from "~/server/domain/shipper/requirement-rules";
import { api } from "~/trpc/react";
import {
  CLOCK_START_LABELS,
  DOCUMENT_LABELS,
  POD_FIELD_LABELS,
  WEEKDAY_LABELS,
} from "./rule-labels";

const DEFAULT_RULES: RequirementRules = {
  requiredPodFields: ["tandaTangan", "stempel", "tanggalTerima"],
  requiredDocuments: ["SURAT_JALAN", "POD", "INVOICE"],
  packetFormat: {
    fileNamingPattern: "{nomorSuratJalan}-{documentType}",
    ordering: ["SURAT_JALAN", "POD", "INVOICE"],
    delivery: "MERGED_PDF",
  },
  submissionCadence: { type: "ROLLING" },
  terms: { netDays: 30, clockStart: "INVOICE_DATE" },
};

function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export function PublishProfileForm({
  shipperId,
  startFrom,
  onPublished,
}: {
  shipperId: string;
  startFrom: RequirementRules | null;
  onPublished: () => void;
}) {
  const [rules, setRules] = useState<RequirementRules>(
    startFrom ?? DEFAULT_RULES,
  );
  const [changeNote, setChangeNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const utils = api.useUtils();

  const publish = api.shipper.publishProfileVersion.useMutation({
    onSuccess: async () => {
      setChangeNote("");
      setError(null);
      await Promise.all([
        utils.shipper.listProfileVersions.invalidate({ shipperId }),
        utils.shipper.byId.invalidate({ shipperId }),
        utils.shipper.list.invalidate(),
      ]);
      onPublished();
    },
    onError: (mutationError) => {
      setError(
        mutationError.data?.code === "FORBIDDEN"
          ? "Hanya admin atau owner yang dapat menerbitkan versi profil."
          : "Gagal menerbitkan versi. Periksa isian lalu coba lagi.",
      );
    },
  });

  /**
   * Documents double as the packet ordering, in the order they were selected.
   * Keeping them in step means the ordering can never name a document the
   * packet does not contain, which the rule schema rejects.
   */
  function setDocuments(documentType: DocumentType) {
    setRules((current) => {
      const requiredDocuments = toggle(current.requiredDocuments, documentType);
      return {
        ...current,
        requiredDocuments,
        packetFormat: { ...current.packetFormat, ordering: requiredDocuments },
      };
    });
  }

  const cadence = rules.submissionCadence;

  return (
    <form
      className="border-border-subtle bg-card text-card-foreground flex flex-col gap-6 rounded-[var(--radius-card)] border p-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        publish.mutate({
          shipperId,
          rules,
          changeNote: changeNote.trim().length === 0 ? null : changeNote.trim(),
        });
      }}
    >
      <div>
        <h3 className="text-base font-medium">Terbitkan versi baru</h3>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          Versi yang sudah terbit tidak bisa diubah. Setiap perubahan syarat
          menerbitkan versi baru, sehingga berkas tagih yang sudah dirakit tetap
          bisa dijelaskan dengan syarat yang berlaku saat itu.
        </p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Field wajib di POD</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {POD_FIELDS.map((field: PodField) => (
            <label key={field} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={rules.requiredPodFields.includes(field)}
                onChange={() =>
                  setRules((current) => ({
                    ...current,
                    requiredPodFields: toggle(current.requiredPodFields, field),
                  }))
                }
              />
              {POD_FIELD_LABELS[field]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Dokumen dalam berkas</legend>
        <p className="text-muted-foreground text-xs">
          Urutan berkas mengikuti urutan pemilihan.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {DOCUMENT_TYPES.map((documentType: DocumentType) => (
            <label
              key={documentType}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={rules.requiredDocuments.includes(documentType)}
                onChange={() => setDocuments(documentType)}
              />
              {DOCUMENT_LABELS[documentType]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="net-days">Termin (hari)</FieldLabel>
          <Input
            id="net-days"
            type="number"
            min={0}
            max={365}
            value={rules.terms.netDays}
            onChange={(event) =>
              setRules((current) => ({
                ...current,
                terms: {
                  ...current.terms,
                  netDays: Number(event.target.value),
                },
              }))
            }
            className="border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)]"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="clock-start">Termin dihitung dari</FieldLabel>
          <select
            id="clock-start"
            value={rules.terms.clockStart}
            onChange={(event) =>
              setRules((current) => ({
                ...current,
                terms: {
                  ...current.terms,
                  clockStart: event.target.value as ClockStartEvent,
                },
              }))
            }
            className="border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)] border px-3 text-sm"
          >
            {CLOCK_START_EVENTS.map((event) => (
              <option key={event} value={event}>
                {CLOCK_START_LABELS[event]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="cadence">Jadwal penagihan</FieldLabel>
          <select
            id="cadence"
            value={cadence.type}
            onChange={(event) =>
              setRules((current) => ({
                ...current,
                submissionCadence:
                  event.target.value === "WEEKLY"
                    ? { type: "WEEKLY", dayOfWeek: 5 }
                    : event.target.value === "MONTHLY"
                      ? { type: "MONTHLY", dayOfMonth: 25 }
                      : { type: "ROLLING" },
              }))
            }
            className="border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)] border px-3 text-sm"
          >
            <option value="ROLLING">Kapan saja</option>
            <option value="WEEKLY">Mingguan</option>
            <option value="MONTHLY">Bulanan</option>
          </select>
        </Field>

        {cadence.type === "WEEKLY" && (
          <Field>
            <FieldLabel htmlFor="day-of-week">Hari cut-off</FieldLabel>
            <select
              id="day-of-week"
              value={cadence.dayOfWeek}
              onChange={(event) =>
                setRules((current) => ({
                  ...current,
                  submissionCadence: {
                    type: "WEEKLY",
                    dayOfWeek: Number(event.target.value),
                  },
                }))
              }
              className="border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)] border px-3 text-sm"
            >
              {WEEKDAY_LABELS.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}

        {cadence.type === "MONTHLY" && (
          <Field>
            <FieldLabel htmlFor="day-of-month">Tanggal cut-off</FieldLabel>
            <Input
              id="day-of-month"
              type="number"
              min={1}
              max={31}
              value={cadence.dayOfMonth}
              onChange={(event) =>
                setRules((current) => ({
                  ...current,
                  submissionCadence: {
                    type: "MONTHLY",
                    dayOfMonth: Number(event.target.value),
                  },
                }))
              }
              className="border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)]"
            />
          </Field>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="naming">Pola nama berkas</FieldLabel>
          <Input
            id="naming"
            value={rules.packetFormat.fileNamingPattern}
            onChange={(event) =>
              setRules((current) => ({
                ...current,
                packetFormat: {
                  ...current.packetFormat,
                  fileNamingPattern: event.target.value,
                },
              }))
            }
            className="border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)] font-mono"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="delivery">Bentuk pengiriman</FieldLabel>
          <select
            id="delivery"
            value={rules.packetFormat.delivery}
            onChange={(event) =>
              setRules((current) => ({
                ...current,
                packetFormat: {
                  ...current.packetFormat,
                  delivery:
                    event.target.value === "SEPARATE_FILES"
                      ? "SEPARATE_FILES"
                      : "MERGED_PDF",
                },
              }))
            }
            className="border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)] border px-3 text-sm"
          >
            <option value="MERGED_PDF">Satu PDF gabungan</option>
            <option value="SEPARATE_FILES">Berkas terpisah</option>
          </select>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="change-note">Catatan perubahan</FieldLabel>
        <Input
          id="change-note"
          value={changeNote}
          onChange={(event) => setChangeNote(event.target.value)}
          placeholder="Mis. termin naik jadi 60 hari per Agustus"
          className="border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)]"
        />
      </Field>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={publish.isPending || rules.requiredDocuments.length === 0}
        className="min-h-11 w-fit rounded-[var(--radius-control)]"
      >
        {publish.isPending ? (
          <>
            <Spinner aria-label="Menerbitkan versi" />
            <span>Menerbitkan…</span>
          </>
        ) : (
          "Terbitkan versi"
        )}
      </Button>
    </form>
  );
}
