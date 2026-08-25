import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { readSource } from "../auth/read-source";

/**
 * TRK-030 acceptance criteria: the driver surface stays under 150 KB gzipped
 * and no text on it requires reading English.
 *
 * The payload is guarded twice. The source assertions below hold on every run
 * and describe *why* the surface is small — they are the decisions that keep
 * it that way. The manifest assertion measures the real thing, and runs
 * whenever a build is present.
 */

const DRIVER_LAYOUT = "src/app/(driver)/layout.tsx";
const DRIVER_PAGE = "src/app/(driver)/pod/[token]/page.tsx";
const DRIVER_CAPTURE =
  "src/app/(driver)/pod/[token]/_components/pod-capture.tsx";

const BUDGET_KB = 150;

/**
 * Comments here explain what the driver surface deliberately does *not*
 * import, and name those things to do it. Asserting against raw source would
 * therefore fail on its own documentation, so these read the code only.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
}

async function readCode(file: string): Promise<string> {
  return code(await readSource(file));
}

describe("the driver surface pays for nothing the console needs", () => {
  it("has its own root layout, so it does not inherit the console root", async () => {
    const layout = await readSource(DRIVER_LAYOUT);

    expect(layout).toContain("<html");
    expect(layout).toContain("<body");
  });

  it("mounts no tRPC provider, because there is no session to query with", async () => {
    const layout = await readCode(DRIVER_LAYOUT);

    expect(layout).not.toContain("TRPCReactProvider");
    expect(layout).not.toContain("~/trpc/");
  });

  it("downloads no web font, since the system stack is already on the phone", async () => {
    const layout = await readCode(DRIVER_LAYOUT);

    expect(layout).not.toContain("next/font");
  });

  it("uploads through the React-free client, not the dropzone helpers", async () => {
    const capture = await readCode(DRIVER_CAPTURE);

    expect(capture).toContain('from "uploadthing/client"');
    expect(capture).not.toContain("@uploadthing/react");
    expect(capture).not.toContain("~/lib/uploadthing");
  });

  it("pulls in no component library on the driver path", async () => {
    const sources = await Promise.all([
      readCode(DRIVER_LAYOUT),
      readCode(DRIVER_PAGE),
      readCode(DRIVER_CAPTURE),
    ]);

    for (const source of sources) {
      expect(source).not.toContain("~/components/ui/");
      expect(source).not.toContain("@base-ui/react");
    }
  });
});

describe("the built driver route", () => {
  const manifestPath = path.join(
    process.cwd(),
    ".next/app-build-manifest.json",
  );

  /**
   * `next dev` writes over `.next` in place, and a development bundle is
   * unminified with HMR and devtools attached — several times the production
   * size. Measuring one against a production budget reports a failure that
   * says nothing, so the dev output is detected and skipped rather than
   * measured. Running the e2e suite is enough to leave it behind.
   */
  function routeChunks(): string[] | null {
    if (!existsSync(manifestPath)) {
      return null;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      pages: Record<string, string[]>;
    };

    const files = manifest.pages["/(driver)/pod/[token]/page"] ?? [];
    const isDevelopmentBundle = files.some(
      (file) => file.includes("hmr-client") || file.includes("next-devtools"),
    );

    return isDevelopmentBundle ? null : files;
  }

  const chunks = routeChunks();

  it.runIf(chunks !== null)(
    `ships under ${BUDGET_KB} KB of gzipped JavaScript`,
    () => {
      expect(chunks, "no production build to measure").not.toBeNull();

      const gzippedBytes = (chunks ?? [])
        .filter((file) => file.endsWith(".js"))
        .reduce(
          (total, file) =>
            total + gzipSync(readFileSync(path.join(".next", file))).length,
          0,
        );

      const kilobytes = gzippedBytes / 1024;

      expect(
        kilobytes,
        `Driver route ships ${kilobytes.toFixed(1)} KB gzipped, over the ${BUDGET_KB} KB budget. ` +
          "Pak Herman is on 3G at a warehouse gate; the budget is the feature.",
      ).toBeLessThan(BUDGET_KB);
    },
  );
});

describe("no text on the driver screen requires reading English", () => {
  /**
   * Words that would leave a driver stuck. Deliberately not a spell check:
   * it catches the strings a library or a hurried commit would introduce.
   */
  const ENGLISH = [
    "Upload",
    "Submit",
    "Retry",
    "Error",
    "Failed",
    "Success",
    "Photo",
    "Take a",
    "Choose",
    "Cancel",
    "Delete",
    "Loading",
    "Please",
    "Try again",
  ];

  /** Extracts the text a driver actually reads, not identifiers or classes. */
  function visibleStrings(source: string): string[] {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const jsxText = [...withoutComments.matchAll(/>\s*([^<>{}\n][^<>{}]*)</g)]
      .map((match) => match[1]?.trim() ?? "")
      .filter((text) => text.length > 0);
    const labels = [
      ...withoutComments.matchAll(
        /(?:aria-label|alt|placeholder)=\{?["`]([^"`]+)["`]/g,
      ),
    ].map((match) => match[1] ?? "");
    const templates = [
      ...withoutComments.matchAll(/setMessage\(\s*[`"]([^`"]+)[`"]/g),
    ].map((match) => match[1] ?? "");

    return [...jsxText, ...labels, ...templates];
  }

  it.each([DRIVER_PAGE, DRIVER_CAPTURE])(
    "keeps %s in Bahasa Indonesia",
    async (file) => {
      const strings = visibleStrings(await readSource(file));

      expect(strings.length).toBeGreaterThan(3);

      for (const text of strings) {
        for (const word of ENGLISH) {
          expect(
            text,
            `"${text}" in ${file} contains the English word "${word}"`,
          ).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
        }
      }
    },
  );

  it("labels the capture actions in Indonesian", async () => {
    const capture = await readSource(DRIVER_CAPTURE);

    expect(capture).toContain("Ambil foto POD");
    expect(capture).toContain("Pilih dari galeri");
  });

  it("confirms success plainly, so a driver does not upload twice", async () => {
    const capture = await readSource(DRIVER_CAPTURE);

    expect(capture).toContain("POD sudah terkirim");
    expect(capture).toContain("tidak perlu mengirim ulang");
  });
});
