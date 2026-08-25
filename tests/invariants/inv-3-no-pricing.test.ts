import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * INV-3: Trayek never computes, suggests, or stores a rate, margin, or price.
 * Rates are copied from the order as given.
 *
 * TRK-011 makes this testable for the first time, because `Order.nilaiTagihan`
 * is the first money field in the schema. Its acceptance criterion asks for a
 * test asserting no arithmetic on `nilaiTagihan` outside currency formatting.
 *
 * Asserted against source rather than behaviour, for the same reason as the
 * driver auth-surface test: the invariant forbids something being built. A
 * behavioural test can only probe a calculation that already exists.
 *
 * Why this matters commercially, not just architecturally: margins are the
 * forwarder's trade secret. A system that computes them is a system they must
 * be talked into trusting, and the PRD is blunt that this is the single
 * heaviest sales obstacle available to us.
 */

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Vocabulary that would mean we had started pricing. Indonesian and English. */
const PRICING_WORDS = new Set([
  "rate",
  "rates",
  "margin",
  "margins",
  "price",
  "prices",
  "pricing",
  "markup",
  "tarif",
  "harga",
  "diskon",
  "komisi",
  "profit",
]);

function sourceFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);

    if (statSync(absolute).isDirectory()) {
      sourceFiles(absolute, collected);
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry)) {
      collected.push(absolute);
    }
  }

  return collected;
}

/** Comments are prose about the code. This file's own subject is pricing. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** `nilaiTagihanBaru` -> ["nilai", "tagihan", "baru"], so "generatedAt" is safe. */
function words(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function schemaFieldNames(): string[] {
  const schema = readFileSync(
    path.join(repositoryRoot, "prisma/schema.prisma"),
    "utf8",
  );

  return [...schema.matchAll(/^\s{2,}(\w+)\s+\w/gm)].map(
    (match) => match[1] ?? "",
  );
}

describe("INV-3: no rate, margin, or price is stored", () => {
  it("declares no pricing field anywhere in the schema", () => {
    const offending = schemaFieldNames().filter((field) =>
      words(field).some((word) => PRICING_WORDS.has(word)),
    );

    expect(
      offending,
      `Schema field(s) name a pricing concept: ${offending.join(", ")}. ` +
        "Trayek copies an agreed amount; it never stores what that amount was derived from.",
    ).toEqual([]);
  });

  it("keeps the one money field it does have", () => {
    // Guards against the test passing vacuously if nilaiTagihan is renamed or
    // dropped: there would be nothing left for the arithmetic rule to protect.
    expect(schemaFieldNames()).toContain("nilaiTagihan");
  });
});

describe("INV-3: no arithmetic is performed on an invoiced amount", () => {
  const files = sourceFiles(path.join(repositoryRoot, "src"));

  it("finds source files to scan, so the scan is not vacuous", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("never applies an arithmetic operator to nilaiTagihan", () => {
    // Matches `total + order.nilaiTagihan`, `nilaiTagihan * qty`,
    // `nilaiTagihan / 100`, and the compound-assignment forms.
    const arithmetic =
      /(?:[-+*/%]\s*(?:\w+\.)*nilaiTagihan)|(?:nilaiTagihan\s*(?:[-+*/%]=?|\*\*)(?!=))/;

    const offending = files
      .map((file) => ({
        file,
        source: stripComments(readFileSync(file, "utf8")),
      }))
      .filter(({ source }) => arithmetic.test(source))
      .map(({ file }) => path.relative(repositoryRoot, file));

    expect(
      offending,
      `Arithmetic on nilaiTagihan in: ${offending.join(", ")}. ` +
        "The amount is copied from what the forwarder already agreed; deriving " +
        "or adjusting it here is the pricing behaviour INV-3 forbids.",
    ).toEqual([]);
  });

  it("names no pricing concept in the pure domain layer", () => {
    const domainFiles = sourceFiles(
      path.join(repositoryRoot, "src/server/domain"),
    );

    const offending = domainFiles
      .map((file) => ({
        file,
        identifiers: [
          ...stripComments(readFileSync(file, "utf8")).matchAll(
            /\b[A-Za-z_][A-Za-z0-9_]*\b/g,
          ),
        ].map((match) => match[0]),
      }))
      .filter(({ identifiers }) =>
        identifiers.some((identifier) =>
          words(identifier).some((word) => PRICING_WORDS.has(word)),
        ),
      )
      .map(({ file }) => path.relative(repositoryRoot, file));

    expect(
      offending,
      `Pricing vocabulary in the domain layer: ${offending.join(", ")}`,
    ).toEqual([]);
  });
});

describe("INV-3: the boundary this test deliberately allows", () => {
  it("permits formatting, because rendering an amount is not deriving one", () => {
    // Storing whole rupiah rather than sen is what keeps this honest: there is
    // no divide on the display path, so no exemption has to be carved out of
    // the rule above. If money ever moves to a minor unit, this test needs a
    // named, reviewed formatter to whitelist — not a quiet relaxation.
    const schema = readFileSync(
      path.join(repositoryRoot, "prisma/schema.prisma"),
      "utf8",
    );

    expect(schema).toMatch(/nilaiTagihan\s+BigInt\?/);
  });
});
