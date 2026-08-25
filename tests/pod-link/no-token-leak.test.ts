import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { readSource } from "../auth/read-source";
import { seedFixturesData, SEED_POD_LINK_TOKENS } from "../../prisma/seed";
import { db } from "~/server/db";
import {
  createObservabilityLogger,
  logger,
  type LogFields,
} from "~/server/observability/logger";
import { redactString, redactValue } from "~/server/observability/redact";
import {
  hashThrottleBucket,
  hashUploadToken,
} from "~/server/domain/pod-link/token";
import { resolveUploadLink } from "~/server/pod-link/resolve";

/**
 * TRK-024 acceptance criterion: tokens do not appear in server logs or in the
 * Referer header of outbound requests.
 */

const token = SEED_POD_LINK_TOKENS.forwarderA;
const usedBuckets = [
  hashThrottleBucket("token", hashUploadToken(token)),
  hashThrottleBucket("ip", "203.0.113.9"),
];

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.podUploadThrottle.deleteMany({
    where: { bucket: { in: usedBuckets } },
  });
  await db.$disconnect();
});

describe("what resolution logs", () => {
  it("logs the link id and never the token or its digest", async () => {
    const captured: LogFields[] = [];

    vi.spyOn(logger, "info").mockImplementation((_message, fields) => {
      captured.push(fields ?? {});
    });

    await resolveUploadLink({ db, token, ipAddress: "203.0.113.9" });

    expect(captured.length).toBeGreaterThan(0);

    const serialised = JSON.stringify(captured);

    expect(serialised).toContain("linkId");
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain(hashUploadToken(token));
  });
});

describe("the redaction layer, as a second line", () => {
  it("scrubs a URL carrying a token before it reaches a log line", () => {
    const line = redactString(`https://settle.trayek.id/pod/${token} opened`);

    expect(line).not.toContain(token);
    expect(line).toContain("[REDACTED_URL]");
  });

  it("scrubs any field named for a token", () => {
    const redacted = redactValue({ token, tokenHash: hashUploadToken(token) });

    expect(JSON.stringify(redacted)).not.toContain(token);
    expect(JSON.stringify(redacted)).not.toContain(hashUploadToken(token));
  });

  it("keeps a token out of a real log line written through the logger", () => {
    const lines: string[] = [];
    const capturing = createObservabilityLogger({
      write(chunk: string) {
        lines.push(chunk);
      },
    });

    capturing.info("POD upload link opened", {
      url: `https://settle.trayek.id/pod/${token}`,
      token,
    });

    expect(lines.join("")).not.toContain(token);
  });
});

describe("the public route", () => {
  it("declares no-referrer, so the token cannot ride a Referer header", async () => {
    const config = await readSource("next.config.js");

    expect(config).toContain('source: "/pod/:token*"');
    expect(config).toContain('key: "Referrer-Policy", value: "no-referrer"');
  });

  it("declares noindex, so a forwarded link does not reach a search index", async () => {
    const config = await readSource("next.config.js");

    expect(config).toContain('key: "X-Robots-Tag"');
    expect(config).toContain("noindex");
  });

  it("is never cached, since the token makes every request unique", async () => {
    const config = await readSource("next.config.js");

    expect(config).toContain('key: "Cache-Control"');
    expect(config).toContain("no-store");
  });
});

describe("the storage of a token", () => {
  it("keeps no column that could hold one in plaintext", async () => {
    const schema = await readSource("prisma/schema.prisma");
    const model = schema.slice(
      schema.indexOf("model PodUploadLink {"),
      schema.indexOf("model PodUploadThrottle {"),
    );

    expect(model).toContain("tokenHash");
    // A bare `token` column is the mistake this guards against.
    expect(model).not.toMatch(/^\s{4}token\s+String/m);
  });

  it("holds only digests in the seeded fixtures", async () => {
    const seeded = await db.podUploadLink.findMany({
      select: { tokenHash: true },
    });

    expect(seeded.length).toBeGreaterThan(0);

    for (const row of seeded) {
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("seeds a token that matches its stored digest", async () => {
    const order = seedFixturesData.orders[0];

    const link = await db.podUploadLink.findFirstOrThrow({
      where: { orderId: order?.id, tokenHash: hashUploadToken(token) },
      select: { id: true },
    });

    expect(link.id).toBe("pod-link-a-fmcg-1");
  });
});
