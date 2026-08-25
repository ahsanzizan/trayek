import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";
import { CreateOrderForm } from "./_components/create-order-form";
import { ImportPanel } from "./_components/import-panel";
import { OrderList } from "./_components/order-list";

export const metadata = {
  title: "Order · Trayek Settle",
};

export default async function OrdersPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/orders");
  }

  void api.order.list.prefetch({});
  void api.shipper.list.prefetch();
  void api.driver.list.prefetch();

  return (
    <main className="bg-background text-foreground min-h-screen antialiased">
      <div className="mx-auto w-full max-w-[1100px] px-6 py-12">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground font-mono text-xs tracking-[1.4px] uppercase"
        >
          Trayek
        </Link>

        <h1 className="mt-4 text-3xl font-normal tracking-[-0.8px]">Order</h1>
        <p className="text-muted-foreground mt-2 max-w-[640px] text-sm leading-6">
          Setiap order membawa nomor surat jalan yang nanti dicocokkan dengan
          POD dari driver. Nilai tagihan disalin apa adanya dari kesepakatan
          dengan shipper — Trayek tidak pernah menghitung atau menyarankan
          tarif.
        </p>

        <div className="mt-10">
          <ImportPanel />
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_340px]">
          <HydrateClient>
            <OrderList />
          </HydrateClient>

          <HydrateClient>
            <CreateOrderForm />
          </HydrateClient>
        </div>
      </div>
    </main>
  );
}
