import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = {
  title: "Ringkasan Baseline DSO · Trayek Settle",
};

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const tanggal = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "long",
  timeZone: "Asia/Jakarta",
});

const METHOD_LABELS = {
  CLAIMED: "Menurut pemilik",
  COMPUTED_FROM_INVOICES: "Dihitung dari riwayat invoice",
  COMPUTED_FROM_BALANCES: "Dihitung dari neraca",
} as const;

/**
 * One page an owner reads in three minutes, and prints to PDF with Ctrl+P.
 *
 * No PDF library: the browser already has a good one, it needs no server CPU,
 * and it does not constrain where this eventually gets hosted. The `print:`
 * utilities drop the navigation chrome and force black on white, so it does
 * not come out of the printer as a dark rectangle.
 */
export default async function BaselinePrintPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/baseline/cetak");
  }

  const current = await api.baseline.current({});

  // Invoice-derived first: it is the figure that survives an argument.
  const preferred =
    current.baselines.find(
      (baseline) => baseline.method === "COMPUTED_FROM_INVOICES",
    ) ??
    current.baselines.find(
      (baseline) => baseline.method === "COMPUTED_FROM_BALANCES",
    ) ??
    current.baselines.find((baseline) => baseline.method === "CLAIMED");

  return (
    <main className="bg-background text-foreground print:bg-white print:text-black">
      <div className="mx-auto w-full max-w-[800px] px-6 py-12 print:max-w-none print:px-0 print:py-0">
        <div className="print:hidden">
          <Link
            href="/baseline"
            className="text-muted-foreground hover:text-foreground font-mono text-xs tracking-[1.4px] uppercase"
          >
            &larr; Kembali
          </Link>
          <p className="text-muted-foreground mt-4 text-sm">
            Tekan Ctrl+P (atau Cmd+P) lalu pilih &ldquo;Save as PDF&rdquo;.
          </p>
        </div>

        <header className="mt-8 print:mt-0">
          <p className="font-mono text-xs tracking-[1.4px] uppercase">Trayek</p>
          <h1 className="mt-2 text-2xl font-normal">Baseline DSO</h1>
          <p className="text-muted-foreground mt-1 text-sm print:text-black">
            Dicetak {tanggal.format(new Date())}
          </p>
        </header>

        {preferred === undefined ? (
          <p className="mt-10 text-sm">Belum ada baseline yang tercatat.</p>
        ) : (
          <>
            <section className="border-border-subtle mt-8 border-y py-8 print:border-black">
              <p className="text-muted-foreground text-sm print:text-black">
                DSO awal &mdash; {METHOD_LABELS[preferred.method]}
              </p>
              <p className="mt-1 text-6xl font-normal tracking-[-2px]">
                {preferred.dsoDays}{" "}
                <span className="text-2xl tracking-normal">hari</span>
              </p>
              <p className="text-muted-foreground mt-2 text-sm print:text-black">
                Periode {tanggal.format(preferred.periodStart)} &ndash;{" "}
                {tanggal.format(preferred.periodEnd)}
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-base font-medium">Semua pengukuran</h2>
              <table className="mt-3 w-full text-left text-sm">
                <thead className="border-border-subtle border-b print:border-black">
                  <tr>
                    <th scope="col" className="py-2 font-normal">
                      Metode
                    </th>
                    <th scope="col" className="py-2 font-normal">
                      DSO
                    </th>
                    <th scope="col" className="py-2 font-normal">
                      Dasar
                    </th>
                    <th scope="col" className="py-2 font-normal">
                      Dikunci
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {current.baselines.map((baseline) => (
                    <tr
                      key={baseline.id}
                      className="border-border-subtle border-b last:border-b-0 print:border-black"
                    >
                      <td className="py-2">{METHOD_LABELS[baseline.method]}</td>
                      <td className="py-2 font-mono">
                        {baseline.dsoDays} hari
                      </td>
                      <td className="py-2">
                        {baseline.invoiceCount !== null
                          ? `${baseline.invoiceCount} invoice`
                          : baseline.invoicedRevenue !== null
                            ? `${rupiah.format(baseline.invoicedRevenue)} ditagihkan`
                            : baseline.statedUnprompted === true
                              ? "Disebut tanpa ditanya"
                              : "Disebut setelah ditanya"}
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {tanggal.format(baseline.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {current.claimedVsComputedGapDays !== null && (
              <section className="mt-8">
                <h2 className="text-base font-medium">
                  Selisih perkiraan dan data
                </h2>
                <p className="text-muted-foreground mt-1 text-sm leading-6 print:text-black">
                  Data menunjukkan{" "}
                  <strong>
                    {Math.abs(current.claimedVsComputedGapDays)} hari
                  </strong>{" "}
                  {current.claimedVsComputedGapDays > 0
                    ? "lebih lama"
                    : current.claimedVsComputedGapDays < 0
                      ? "lebih cepat"
                      : "sama"}{" "}
                  dibanding perkiraan pemilik. Keduanya disimpan terpisah dan
                  tidak pernah digabung jadi satu angka.
                </p>
              </section>
            )}

            <footer className="border-border-subtle mt-8 border-t pt-4 text-xs print:border-black">
              <p className="text-muted-foreground print:text-black">
                Angka baseline dikunci di database dan tidak dapat diubah.
                Koreksi dilakukan dengan mencatat pengukuran baru, bukan dengan
                menyunting yang lama.
              </p>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
