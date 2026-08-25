import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const sourceDirectory = fileURLToPath(new URL("./src", import.meta.url));
const generatedDirectory = fileURLToPath(
  new URL("./generated", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "~/generated": path.resolve(generatedDirectory),
      "~": path.resolve(sourceDirectory),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 15_000,
    server: {
      deps: {
        inline: ["next-auth"],
      },
    },
  },
});
