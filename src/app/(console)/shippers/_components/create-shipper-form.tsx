"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { api } from "~/trpc/react";

const emptyForm = {
  name: "",
  npwp: "",
  financeContactName: "",
  financeContactEmail: "",
  financeContactPhone: "",
  address: "",
};

/** Blank inputs mean "not recorded", which the API models as null, not "". */
function orNull(value: string) {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function CreateShipperForm() {
  const router = useRouter();
  const utils = api.useUtils();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const createShipper = api.shipper.create.useMutation({
    onSuccess: async () => {
      setForm(emptyForm);
      await utils.shipper.list.invalidate();
      router.refresh();
    },
    onError: (mutationError) => {
      setError(
        mutationError.data?.code === "FORBIDDEN"
          ? "Hanya admin atau owner yang dapat menambah shipper."
          : "Gagal menyimpan shipper. Periksa isian lalu coba lagi.",
      );
    },
  });

  function update(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  return (
    <form
      className="border-border-subtle bg-card text-card-foreground flex h-fit flex-col gap-4 rounded-[var(--radius-card)] border p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        createShipper.mutate({
          name: form.name.trim(),
          npwp: orNull(form.npwp),
          financeContactName: orNull(form.financeContactName),
          financeContactEmail: orNull(form.financeContactEmail),
          financeContactPhone: orNull(form.financeContactPhone),
          address: orNull(form.address),
        });
      }}
    >
      <h2 className="text-base font-medium">Tambah shipper</h2>

      <Field>
        <FieldLabel htmlFor="shipper-name">Nama</FieldLabel>
        <Input
          id="shipper-name"
          required
          value={form.name}
          onChange={(event) => update("name", event.target.value)}
          placeholder="PT Sumber Makmur"
          className="border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)]"
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="shipper-npwp">NPWP</FieldLabel>
        <Input
          id="shipper-npwp"
          value={form.npwp}
          onChange={(event) => update("npwp", event.target.value)}
          placeholder="01.234.567.8-901.000"
          className="border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)]"
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="shipper-contact">Kontak finance</FieldLabel>
        <Input
          id="shipper-contact"
          value={form.financeContactName}
          onChange={(event) => update("financeContactName", event.target.value)}
          placeholder="Ibu Sri"
          className="border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)]"
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="shipper-email">Email finance</FieldLabel>
        <Input
          id="shipper-email"
          type="email"
          value={form.financeContactEmail}
          onChange={(event) =>
            update("financeContactEmail", event.target.value)
          }
          placeholder="finance@shipper.co.id"
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
        disabled={createShipper.isPending || form.name.trim().length === 0}
        className="min-h-11 rounded-[var(--radius-control)]"
      >
        {createShipper.isPending ? (
          <>
            <Spinner aria-label="Menyimpan shipper" />
            <span>Menyimpan…</span>
          </>
        ) : (
          "Simpan shipper"
        )}
      </Button>
    </form>
  );
}
