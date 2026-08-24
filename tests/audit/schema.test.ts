import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TENANT_SCOPED_MODELS } from "~/server/api/tenant-extension";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const migrationPath =
  "prisma/migrations/20260825090000_add_audit_log/migration.sql";

async function readMigration() {
  return readFile(path.join(repositoryRoot, migrationPath), "utf8");
}

describe("AuditLog schema", () => {
  it("scopes the table to an organization", async () => {
    const schema = await readFile(
      path.join(repositoryRoot, "prisma/schema.prisma"),
      "utf8",
    );

    expect(schema).toMatch(
      /model AuditLog\s*\{[\s\S]*?organizationId\s+String[\s\S]*?organization\s+Organization/,
    );
  });

  it("registers the table for tenant scoping (INV-5)", () => {
    expect(TENANT_SCOPED_MODELS.has("AuditLog")).toBe(true);
  });

  it("records the actor kinds the invariants distinguish", async () => {
    const schema = await readFile(
      path.join(repositoryRoot, "prisma/schema.prisma"),
      "utf8",
    );

    expect(schema).toMatch(
      /enum AuditActorType\s*\{\s*USER\s+AGENT\s+SYSTEM\s*\}/s,
    );
  });
});

describe("AuditLog append-only migration", () => {
  it("blocks UPDATE, DELETE, and TRUNCATE with triggers", async () => {
    const migration = await readMigration();

    for (const operation of ["UPDATE", "DELETE", "TRUNCATE"]) {
      expect(migration).toMatch(
        new RegExp(`BEFORE ${operation}[\\s\\S]*?audit_log_append_only`),
      );
    }
  });

  it("enforces with a trigger rather than grants", async () => {
    const migration = await readMigration();

    // REVOKE does not stop a table owner, and Prisma connects as the owner in
    // some environments. A trigger fires for every role, superusers included.
    expect(migration).toMatch(/RAISE EXCEPTION/);
    expect(migration).not.toMatch(/^\s*REVOKE\s/m);
  });

  it("is forward-only", async () => {
    const migration = await readMigration();

    expect(migration).toContain('CREATE TABLE "AuditLog"');
    expect(migration).not.toMatch(/DROP TABLE/);
  });
});
