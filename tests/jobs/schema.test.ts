import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TENANT_SCOPED_MODELS } from "~/server/api/tenant-extension";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function readSchema() {
  return readFile(path.join(repositoryRoot, "prisma/schema.prisma"), "utf8");
}

const jobModels = ["JobExecution", "DeadLetterJob", "HumanFallbackEvent"];

describe("job queue schema", () => {
  it("scopes every job table to an organization", async () => {
    const schema = await readSchema();

    for (const model of jobModels) {
      expect(schema).toMatch(
        new RegExp(
          `model ${model}\\s*\\{[\\s\\S]*?organizationId\\s+String[\\s\\S]*?organization\\s+Organization`,
        ),
      );
    }
  });

  it("registers every job table for tenant scoping (INV-5)", () => {
    for (const model of jobModels) {
      expect(TENANT_SCOPED_MODELS.has(model)).toBe(true);
    }
  });

  it("makes the completion ledger unique per organization and key", async () => {
    const schema = await readSchema();

    expect(schema).toMatch(
      /model JobExecution\s*\{[\s\S]*?@@unique\(\[organizationId, idempotencyKey\]\)/,
    );
  });

  it("makes a fallback event unique per organization, source, and key", async () => {
    const schema = await readSchema();

    expect(schema).toMatch(
      /model HumanFallbackEvent\s*\{[\s\S]*?@@unique\(\[organizationId, source, dedupeKey\]\)/,
    );
  });

  it("keeps the failing payload and error on the dead-letter table", async () => {
    const schema = await readSchema();

    expect(schema).toMatch(
      /model DeadLetterJob\s*\{[\s\S]*?payload\s+Json[\s\S]*?error\s+String[\s\S]*?attempts\s+Int/,
    );
  });

  it("ships a forward-only migration for the job tables", async () => {
    const migration = await readFile(
      path.join(
        repositoryRoot,
        "prisma/migrations/20260824120000_add_job_queue_dead_letter_fallback/migration.sql",
      ),
      "utf8",
    );

    for (const model of jobModels) {
      expect(migration).toContain(`CREATE TABLE "${model}"`);
    }
    expect(migration).not.toMatch(/DROP TABLE/);
  });
});
