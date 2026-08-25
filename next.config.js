/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import { withSentryConfig } from "@sentry/nextjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const config = {
  outputFileTracingRoot: projectRoot,
  serverExternalPackages: ["@whiskeysockets/baileys", "sharp"],

  async headers() {
    return [
      {
        // The POD upload token lives in this path (TRK-024). `no-referrer`
        // keeps it out of the Referer header of anything the page requests,
        // and `noindex` keeps a forwarded link out of a search index. Both are
        // acceptance criteria, not hardening.
        source: "/pod/:token*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
};

export const sentryBuildOptions = {
  silent: true,
  sourcemaps: { disable: true },
};

export default withSentryConfig(config, sentryBuildOptions);
