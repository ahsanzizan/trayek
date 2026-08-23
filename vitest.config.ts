import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const sourceDirectory = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(sourceDirectory),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 15_000,
  },
});
