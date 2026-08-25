import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectSourceFiles(entryPath);
      }

      return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [entryPath] : [];
    }),
  );

  return nested.flat();
}

describe("source naming guardrails", () => {
  it("keeps planning identifiers out of application source", async () => {
    const sourceFiles = await collectSourceFiles(
      path.join(repositoryRoot, "src"),
    );
    const violations: string[] = [];

    for (const filePath of sourceFiles) {
      const source = await readFile(filePath, "utf8");

      if (/\b(?:TRK-\d{3}|INV-\d+)\b/.test(source)) {
        violations.push(path.relative(repositoryRoot, filePath));
      }
    }

    expect(violations).toEqual([]);
  });
});
