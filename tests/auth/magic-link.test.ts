import { describe, expect, it } from "vitest";

import { readSource } from "./read-source";

describe("magic-link authentication contract", () => {
  it("keeps verification tokens short-lived and uniquely stored", async () => {
    const [authSource, schemaSource] = await Promise.all([
      readSource("src/server/auth/config.ts"),
      readSource("prisma/schema.prisma"),
    ]);

    expect(authSource).toContain("maxAge: MAGIC_LINK_MAX_AGE_SECONDS");
    expect(schemaSource).toMatch(
      /model VerificationToken\s*\{[\s\S]*token\s+String\s+@unique[\s\S]*@@unique\(\[identifier, token\]\)/,
    );
  });

  it("uses one success message for every email submission result", async () => {
    const source = await readSource(
      "src/app/(console)/_components/login-form.tsx",
    );

    expect(source).toContain("setSubmittedEmail(data.email)");
    expect(source).toContain("Cek email Anda");
    expect(source).toContain("Kami mengirim tautan masuk ke {submittedEmail}.");
    expect(source).not.toContain("userExists");
    expect(source).not.toContain("accountExists");
  });
});
