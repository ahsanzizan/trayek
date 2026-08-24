import { describe, expect, it } from "vitest";

import { readSource } from "./read-source";

describe("magic-link login surface", () => {
  it("uses the email-only magic-link flow and exposes recoverable states", async () => {
    const source = await readSource("src/app/_components/login-form.tsx");

    expect(source).toContain('signIn("resend"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain("Cek email Anda");
    expect(source).toContain("Terlalu banyak permintaan");
    expect(source).toContain("Minta tautan baru");
    expect(source).not.toContain('signIn("credentials"');
    expect(source).not.toContain("password");
    expect(source).not.toContain("/register");
  });

  it("uses the dark-first login shell and Indonesian document language", async () => {
    const [pageSource, layoutSource] = await Promise.all([
      readSource("src/app/login/page.tsx"),
      readSource("src/app/layout.tsx"),
    ]);

    expect(pageSource).toContain('title: "Masuk — Trayek"');
    expect(pageSource).toContain("bg-background");
    expect(pageSource).toContain("text-title-lg");
    expect(layoutSource).toContain('lang="id"');
  });

  it("keeps organization switching and sign-out available for the operations shell", async () => {
    const [layoutSource, utilitySource, switcherSource, signOutSource] =
      await Promise.all([
        readSource("src/app/layout.tsx"),
        readSource("src/app/_components/utility-bar.tsx"),
        readSource("src/app/_components/org-switcher.tsx"),
        readSource("src/app/_components/sign-out-form.tsx"),
      ]);

    expect(layoutSource).not.toContain("UtilityBar");
    expect(utilitySource).toContain("SignOutForm");
    expect(signOutSource).toContain("signOut");
    expect(signOutSource).toContain("Keluar");
    expect(switcherSource).toContain("useSession");
    expect(switcherSource).toContain("switchOrganization");
    expect(switcherSource).toContain("update({ activeOrganizationId");
  });

  it("renders a static landing page with the public dashboard route", async () => {
    const [homeSource, layoutSource] = await Promise.all([
      readSource("src/app/page.tsx"),
      readSource("src/app/layout.tsx"),
    ]);

    expect(homeSource).toContain("export default function Home()");
    expect(homeSource.match(/href="\/dashboard"/g)).toHaveLength(2);
    expect(homeSource).toContain(
      "AI Coordination Layer · Siklus Kas Forwarder",
    );
    expect(homeSource).toContain(
      "Trayek memendekkan jarak antara POD dan kas cair.",
    );
    expect(homeSource).toContain("Tangkap POD");
    expect(homeSource).toContain("Validasi Kelengkapan");
    expect(homeSource).toContain("Rakit & Tagih");
    expect(homeSource).toContain(
      "Trayek Settle — bukan asisten percakapan untuk quoting",
    );
    expect(homeSource).toContain("catatan berkas tagih.");
    expect(homeSource).toContain("md:grid-cols-3");
    expect(homeSource).toContain(
      'const containerClasses = "mx-auto w-full max-w-[1100px] px-6"',
    );
    expect(homeSource).toContain(
      "${containerClasses} grid flex-none gap-4 pb-16",
    );
    expect(homeSource).not.toContain("${containerClasses} grid flex-1");
    expect(homeSource).not.toContain("max-w-[900px]");
    expect(homeSource).toContain("font-mono");
    expect(homeSource).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(homeSource).not.toContain("auth");
    expect(homeSource).not.toContain("api.");
    expect(homeSource).not.toContain('"use client"');
    expect(homeSource).not.toContain("bg-gradient");

    expect(layoutSource).toContain("JetBrains_Mono");
    expect(layoutSource).toContain('title: "Trayek Settle"');
    expect(layoutSource).toContain(
      "AI coordination layer untuk siklus kas forwarder Indonesia — POD, berkas tagih, invoice.",
    );
    expect(layoutSource).not.toContain("UtilityBar");
    expect(layoutSource).not.toContain("auth()");
  });
});
