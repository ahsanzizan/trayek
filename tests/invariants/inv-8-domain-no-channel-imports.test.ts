import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function collectFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);

    if (statSync(absolute).isDirectory()) {
      collectFiles(absolute, collected);
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry)) {
      collected.push(absolute);
    }
  }

  return collected;
}

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+["'](?:\.\.?\/)+channels(?:\/|["'])/,
  /from\s+["']~\/server\/channels(?:\/|["'])/,
  /from\s+["']@whiskeysockets\/baileys(?:\/|["'])/,
  /from\s+["']baileys(?:\/|["'])/,
  /from\s+["']qrcode(?:-terminal)?(?:\/|["'])/,
  /from\s+["']pg-boss(?:\/|["'])/,
  /from\s+["']~\/server\/jobs(?:\/|["'])/,
  /from\s+["']@prisma\/client(?:\/|["'])/,
  /from\s+["']~\/server\/db(?:\/|["'])/,
];

describe("INV-8: Core domain does not import channel adapters", () => {
  it("verifies the core domain layer contains no forbidden infrastructure or channel imports", () => {
    const domainDirectory = path.join(repositoryRoot, "src/server/domain");
    const domainFiles = collectFiles(domainDirectory);

    expect(domainFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const filePath of domainFiles) {
      const content = readFileSync(filePath, "utf8");

      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(
            `${path.relative(repositoryRoot, filePath)} matches ${pattern.toString()}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
