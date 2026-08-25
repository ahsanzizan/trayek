import { describe, expect, it } from "vitest";

import { readSource } from "../auth/read-source";

/**
 * TRK-012 acceptance criterion: "No auth surface exists for drivers."
 *
 * Asserted against source rather than behaviour, because the criterion is
 * about something that must never be built. A behavioural test can only probe
 * endpoints that exist; this fails the moment someone adds the first one.
 *
 * Pak Herman pays nothing and installs nothing. Every credential he would hold
 * is one more thing to leak, rotate, and support, in exchange for a login he
 * would use once per trip at the roadside.
 */

/**
 * Comments are prose about the code, not the code. A doc comment explaining
 * that drivers hold no password would otherwise fail the assertion it exists
 * to document.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const AUTH_TERMS = [
  "password",
  "passwordHash",
  "credential",
  "Credentials",
  "emailVerified",
  "sessionToken",
];

describe("the Driver model carries no credentials", () => {
  it("declares no authentication field", async () => {
    const schema = await readSource("prisma/schema.prisma");
    const driverModel = /model Driver \{[^}]*\}/.exec(schema)?.[0];

    expect(driverModel, "Driver model not found in schema").toBeDefined();

    for (const term of AUTH_TERMS) {
      expect(
        driverModel?.toLowerCase().includes(term.toLowerCase()),
        `Driver must not declare ${term}`,
      ).toBe(false);
    }
  });

  it("holds no relation to User, Account, or Session", async () => {
    const schema = await readSource("prisma/schema.prisma");
    const driverModel = /model Driver \{[^}]*\}/.exec(schema)?.[0];

    for (const model of ["User", "Account", "Session"]) {
      expect(
        new RegExp(`\\b${model}\\b`).test(driverModel ?? ""),
        `Driver must not relate to ${model}`,
      ).toBe(false);
    }
  });

  it("is not referenced by the Auth.js configuration", async () => {
    const config = stripComments(await readSource("src/server/auth/config.ts"));

    expect(config.toLowerCase()).not.toContain("driver");
  });

  it("is not referenced by membership resolution", async () => {
    // A driver with a membership would be a user by another name.
    const membership = stripComments(
      await readSource("src/server/auth/membership.ts"),
    );

    expect(membership.toLowerCase()).not.toContain("driver");
  });
});

describe("the driver router exposes no sign-in path", () => {
  it("names no authentication concept", async () => {
    const router = stripComments(
      await readSource("src/server/api/routers/driver.ts"),
    );

    for (const term of ["signIn", "signOut", "password", "session.create"]) {
      expect(
        router.includes(term),
        `driver router must not reference ${term}`,
      ).toBe(false);
    }
  });

  it("gates every procedure behind an organization member", async () => {
    const router = stripComments(
      await readSource("src/server/api/routers/driver.ts"),
    );

    // publicProcedure here would be the actual hole: an unauthenticated route
    // that reads or writes drivers.
    expect(router).not.toContain("publicProcedure");
    expect(router).toContain("orgProcedure");
  });
});
