"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { api } from "~/trpc/react";

const emptyForm = {
  nomorOrder: "",
  nomorSuratJalan: "",
  shipperId: "",
  driverId: "",
  origin: "",
  destination: "",
  jumlahKoli: "",
  nilaiTagihan: "",
};

const selectClasses =
  "border-border-strong bg-surface min-h-11 w-full rounded-[var(--radius-control)] border px-3 text-sm";
const inputClasses =
  "border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)]";

/** Digits only: the amount is entered as whole rupiah, never a decimal. */
function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

export function CreateOrderForm() {
  const router = useRouter();
  const utils = api.useUtils();
  const [shippers] = api.shipper.list.useSuspenseQuery();
  const [drivers] = api.driver.list.useSuspenseQuery();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const createOrder = api.order.create.useMutation({
    onSuccess: async () => {
      setForm(emptyForm);
      await utils.order.list.invalidate();
      router.refresh();
    },
    onError: (mutationError) => {
      setError(
        mutationError.data?.code === "CONFLICT"
          ? mutationError.message
          : mutationError.data?.code === "FORBIDDEN"
            ? "Hanya admin atau owner yang dapat menambah order."
            : mutationError.data?.code === "NOT_FOUND"
              ? mutationError.message
              : "Gagal menyimpan order. Periksa isian lalu coba lagi.",
      );
    },
  });

  function update(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  const canSubmit =
    form.nomorOrder.trim().length > 0 &&
    form.nomorSuratJalan.trim().length > 0 &&
    form.shipperId.length > 0 &&
    form.origin.trim().length > 0 &&
    form.destination.trim().length > 0;

  return (
    <form
      className="border-border-subtle bg-card text-card-foreground flex h-fit flex-col gap-4 rounded-[var(--radius-card)] border p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);

        createOrder.mutate({
          nomorOrder: form.nomorOrder.trim(),
          nomorSuratJalan: form.nomorSuratJalan.trim(),
          shipperId: form.shipperId,
          driverId: form.driverId.length === 0 ? null : form.driverId,
          origin: form.origin.trim(),
          destination: form.destination.trim(),
          plannedDeliveryDate: null,
          actualDeliveryDate: null,
          jumlahKoli:
            form.jumlahKoli.length === 0 ? null : Number(form.jumlahKoli),
          weightGram: null,
          // Sent as a BigInt; superjson carries it across the wire intact, so
          // a large amount never passes through a float.
          nilaiTagihan:
            form.nilaiTagihan.length === 0 ? null : BigInt(form.nilaiTagihan),
        });
      }}
    >
      <h2 className="text-base font-medium">Tambah order</h2>

      <Field>
        <FieldLabel htmlFor="nomor-order">Nomor order</FieldLabel>
        <Input
          id="nomor-order"
          required
          value={form.nomorOrder}
          onChange={(event) => update("nomorOrder", event.target.value)}
          placeholder="ORD-2026-0001"
          className={inputClasses}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="nomor-surat-jalan">Nomor surat jalan</FieldLabel>
        <Input
          id="nomor-surat-jalan"
          required
          value={form.nomorSuratJalan}
          onChange={(event) => update("nomorSuratJalan", event.target.value)}
          placeholder="SJ-2026-0001"
          className={inputClasses}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="shipper">Shipper</FieldLabel>
        <select
          id="shipper"
          required
          value={form.shipperId}
          onChange={(event) => update("shipperId", event.target.value)}
          className={selectClasses}
        >
          <option value="">Pilih shipper…</option>
          {shippers.map((shipper) => (
            <option key={shipper.id} value={shipper.id}>
              {shipper.name}
            </option>
          ))}
        </select>
      </Field>

      <Field>
        <FieldLabel htmlFor="driver">Driver</FieldLabel>
        <select
          id="driver"
          value={form.driverId}
          onChange={(event) => update("driverId", event.target.value)}
          className={selectClasses}
        >
          <option value="">Belum ditunjuk</option>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.name} · {driver.phone}
            </option>
          ))}
        </select>
      </Field>

      <Field>
        <FieldLabel htmlFor="origin">Asal</FieldLabel>
        <Input
          id="origin"
          required
          value={form.origin}
          onChange={(event) => update("origin", event.target.value)}
          placeholder="Gudang Cakung, Jakarta Timur"
          className={inputClasses}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="destination">Tujuan</FieldLabel>
        <Input
          id="destination"
          required
          value={form.destination}
          onChange={(event) => update("destination", event.target.value)}
          placeholder="DC Bandung, Jawa Barat"
          className={inputClasses}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="jumlah-koli">Jumlah koli</FieldLabel>
          <Input
            id="jumlah-koli"
            inputMode="numeric"
            value={form.jumlahKoli}
            onChange={(event) =>
              update("jumlahKoli", digitsOnly(event.target.value))
            }
            placeholder="120"
            className={inputClasses}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="nilai-tagihan">Nilai tagihan (Rp)</FieldLabel>
          <Input
            id="nilai-tagihan"
            inputMode="numeric"
            value={form.nilaiTagihan}
            onChange={(event) =>
              update("nilaiTagihan", digitsOnly(event.target.value))
            }
            placeholder="4500000"
            className={inputClasses}
          />
        </Field>
      </div>

      <p className="text-muted-foreground text-xs leading-5">
        Nilai tagihan disalin dari kesepakatan yang sudah ada. Trayek tidak
        menghitung, menyarankan, atau menyimpan tarif.
      </p>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={createOrder.isPending || !canSubmit}
        className="min-h-11 rounded-[var(--radius-control)]"
      >
        {createOrder.isPending ? (
          <>
            <Spinner aria-label="Menyimpan order" />
            <span>Menyimpan…</span>
          </>
        ) : (
          "Simpan order"
        )}
      </Button>
    </form>
  );
}
