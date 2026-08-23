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
    expect(layoutSource).toContain('<html lang="id"');
  });

  it("keeps organization switching and sign-out in the authenticated utility bar", async () => {
    const [layoutSource, utilitySource, switcherSource, signOutSource] =
      await Promise.all([
        readSource("src/app/layout.tsx"),
        readSource("src/app/_components/utility-bar.tsx"),
        readSource("src/app/_components/org-switcher.tsx"),
        readSource("src/app/_components/sign-out-form.tsx"),
      ]);

    expect(layoutSource).toContain("UtilityBar");
    expect(utilitySource).toContain("SignOutForm");
    expect(signOutSource).toContain("signOut");
    expect(signOutSource).toContain("Keluar");
    expect(switcherSource).toContain("useSession");
    expect(switcherSource).toContain("switchOrganization");
    expect(switcherSource).toContain("update({ activeOrganizationId");
  });

  it("keeps the home route quiet and gives users without an organization one exit", async () => {
    const [homeSource, emptyStateSource, signOutSource] = await Promise.all([
      readSource("src/app/page.tsx"),
      readSource("src/app/_components/no-organization.tsx"),
      readSource("src/app/_components/sign-out-form.tsx"),
    ]);

    expect(homeSource).toContain("NoOrganization");
    expect(homeSource).not.toContain("/register");
    expect(homeSource).not.toContain("bg-gradient");
    expect(emptyStateSource).toContain("Belum ada akses organisasi");
    expect(signOutSource).toContain("Keluar");
  });
});
