import { describe, expect, it } from "vitest";

import { readSource } from "./read-source";

async function readAuthConfig() {
  return readSource("src/server/auth/config.ts");
}

describe("Auth.js configuration", () => {
  it("uses the built-in Resend provider with a short-lived magic link", async () => {
    const source = await readAuthConfig();

    expect(source).toContain('from "next-auth/providers/resend"');
    expect(source).toContain("const MAGIC_LINK_MAX_AGE_SECONDS = 15 * 60");
    expect(source).toContain("maxAge: MAGIC_LINK_MAX_AGE_SECONDS");
    expect(source).not.toContain("CredentialsProvider");
  });

  it("keeps the Prisma adapter, JWT sessions, and the dedicated login page", async () => {
    const source = await readAuthConfig();

    expect(source).toContain("PrismaAdapter(db)");
    expect(source).toContain('strategy: "jwt"');
    expect(source).toContain('signIn: "/login"');
    expect(source).toContain("sessionIssuedAt");
    expect(source).toContain("lastActivityAt");
  });
});
