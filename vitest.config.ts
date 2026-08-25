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
  // `tsconfig.json` sets `jsx: "preserve"` for Next.js, which leaves the
  // transform emitting JSX the test runner cannot execute. Overriding it here
  // is what lets a Server Component be rendered in a unit test; it changes
  // nothing about how Next.js builds the app.
  oxc: {
    jsx: { runtime: "automatic" },
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
