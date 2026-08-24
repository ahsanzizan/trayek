import Link from "next/link";

const features = [
  {
    title: "Tangkap POD",
    description:
      "Driver buka web link ringan dari WhatsApp, unggah foto POD. Satu pesan, bukan lima.",
  },
  {
    title: "Validasi Kelengkapan",
    description:
      "Agent memeriksa syarat spesifik tiap shipper dan menandai kekurangan sebelum staf sadar.",
  },
  {
    title: "Rakit & Tagih",
    description:
      "Berkas tagih dirakit otomatis; invoice & faktur pajak tetap lewat gate approval manusia.",
  },
] as const;

const focusVisibleClasses =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const containerClasses = "mx-auto w-full max-w-[1100px] px-6";

export default function Home() {
  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col antialiased">
      <nav className="border-border-subtle border-b">
        <div
          className={`${containerClasses} flex items-center justify-between py-3`}
        >
          <span className="font-mono text-sm tracking-[1.4px] uppercase">
            Trayek
          </span>
          <Link
            href="/dashboard"
            className={`border-border-strong text-foreground hover:border-border-strong/80 rounded-full border bg-transparent px-3 py-1.5 text-sm transition-colors duration-150 ${focusVisibleClasses}`}
          >
            Buka Dashboard
          </Link>
        </div>
      </nav>

      <section className={`${containerClasses} py-16`}>
        <p className="text-muted-foreground mb-4 font-mono text-xs tracking-[1.4px] uppercase">
          AI Coordination Layer · Siklus Kas Forwarder
        </p>
        <h1 className="text-foreground text-[2.5rem] leading-[1.02] font-normal tracking-[-1.8px] md:text-6xl lg:text-7xl">
          Trayek memendekkan jarak antara POD dan kas cair.
        </h1>
        <p className="text-muted-foreground mt-6 max-w-[640px] text-lg leading-7">
          Forwarder menengah Indonesia ditagih Net-60/90, tapi harus bayar
          trucker dalam 7–30 hari. Trayek menangkap POD, memvalidasi
          kelengkapan, merakit berkas tagih, dan mempercepat pencairan invoice —
          bukan lagi produk quoting.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            href="/dashboard"
            className={`border-primary bg-primary text-primary-foreground hover:bg-surface-raised rounded-full border px-6 py-2.5 text-sm font-medium transition-colors duration-150 ${focusVisibleClasses}`}
          >
            Buka Dashboard Ops
          </Link>
        </div>
      </section>

      <section
        className={`${containerClasses} grid flex-1 gap-4 pb-16 md:grid-cols-3`}
      >
        {features.map((feature) => (
          <article
            key={feature.title}
            className="border-border-subtle bg-card text-card-foreground rounded-[var(--radius-card)] border p-6"
          >
            <h2 className="mb-2 text-xl font-medium">{feature.title}</h2>
            <p className="text-muted-foreground text-sm leading-6">
              {feature.description}
            </p>
          </article>
        ))}
      </section>

      <footer className="border-border-subtle text-muted-foreground mt-auto border-t">
        <div className={`${containerClasses} py-12 text-sm`}>
          Trayek Settle — bukan asisten percakapan untuk quoting, tapi pemegang
          catatan berkas tagih.
        </div>
      </footer>
    </main>
  );
}
