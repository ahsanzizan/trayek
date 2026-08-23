import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("seed command", () => {
  it("exposes a reproducible Prisma seed command", async () => {
    const packageJson = await readFile("package.json", "utf8");

    expect(packageJson).toContain('"db:seed": "prisma db seed"');
    expect(packageJson).toContain('"seed": "tsx prisma/seed.ts"');
    expect(packageJson).toMatch(/"tsx":\s*"\^4\./);
  });
});
