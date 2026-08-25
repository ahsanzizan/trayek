import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { ESLint } from "eslint";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });
const activeFixtureFiles = new Set<string>();

function purgeActiveFixtures() {
  for (const filePath of activeFixtureFiles) {
    try {
      rmSync(filePath, { force: true });
    } catch {
      // best-effort cleanup on process exit
    }
  }
  activeFixtureFiles.clear();
}

process.on("exit", purgeActiveFixtures);
process.on("SIGINT", purgeActiveFixtures);

async function lintFixture(filePath: string, code: string) {
  const requestedFilePath = path.resolve(filePath);
  const extension = path.extname(requestedFilePath);
  const fixtureName = `${path.basename(
    requestedFilePath,
    extension,
  )}.guardrail-temp-${randomUUID()}${extension}`;
  const absoluteFilePath = path.join(
    path.dirname(requestedFilePath),
    fixtureName,
  );

  activeFixtureFiles.add(absoluteFilePath);
  await mkdir(path.dirname(absoluteFilePath), { recursive: true });
  await writeFile(absoluteFilePath, code);

  try {
    const [result] = await eslint.lintText(code, {
      filePath: absoluteFilePath,
    });

    if (!result) {
      throw new Error(`ESLint returned no result for ${filePath}`);
    }

    return result.messages;
  } finally {
    activeFixtureFiles.delete(absoluteFilePath);
    await rm(absoluteFilePath, { force: true }).catch(() => undefined);
  }
}

function hasErrorContaining(
  messages: Awaited<ReturnType<typeof lintFixture>>,
  text: string,
) {
  return messages.some(
    (message) => message.severity === 2 && message.message.includes(text),
  );
}

describe("domain import guardrails", () => {
  // ESLint's first run pays config resolution and plugin loading. Warm it once
  // here so that cost is not charged to whichever test happens to run first,
  // which otherwise makes this file flaky under a loaded parallel suite.
  beforeAll(async () => {
    purgeActiveFixtures();
    await lintFixture(
      "src/server/domain/warmup.ts",
      "export const warm = true;\n",
    );
  }, 60_000);

  afterEach(() => {
    purgeActiveFixtures();
  });

  afterAll(() => {
    purgeActiveFixtures();
  });

  it("rejects the Prisma singleton from the domain layer", async () => {
    const messages = await lintFixture(
      "src/server/domain/invoice.ts",
      'import { db } from "~/server/db";\nvoid db;',
    );

    expect(hasErrorContaining(messages, "~/server/db")).toBe(true);
  });

  it("rejects Prisma client imports from the domain layer", async () => {
    const messages = await lintFixture(
      "src/server/domain/invoice.ts",
      'import { PrismaClient } from "@prisma/client";\nvoid PrismaClient;',
    );

    expect(hasErrorContaining(messages, "@prisma/client")).toBe(true);
  });

  it("rejects generated Prisma imports from the domain layer", async () => {
    const messages = await lintFixture(
      "src/server/domain/invoice.ts",
      'import { PrismaClient } from "../../../generated/prisma";\nvoid PrismaClient;',
    );

    expect(hasErrorContaining(messages, "../../../generated/prisma")).toBe(
      true,
    );
  });

  it("rejects aliased channel imports from the domain layer", async () => {
    const messages = await lintFixture(
      "src/server/domain/invoice.ts",
      'import { send } from "~/server/channels/whatsapp";\nvoid send;',
    );

    expect(hasErrorContaining(messages, "~/server/channels")).toBe(true);
  });

  it("rejects nested relative channel imports from the domain layer", async () => {
    const messages = await lintFixture(
      "src/server/domain/guardrail-fixtures/billing/invoice.ts",
      'import { send } from "../../../channels/email";\nvoid send;',
    );

    expect(hasErrorContaining(messages, "../../../channels/email")).toBe(true);
  });

  it("rejects the queue vendor from the domain layer", async () => {
    const messages = await lintFixture(
      "src/server/domain/jobs/queue-fixture.ts",
      'import { PgBoss } from "pg-boss";\nvoid PgBoss;',
    );

    expect(hasErrorContaining(messages, "pg-boss")).toBe(true);
  });

  it("rejects the queue implementation from the domain layer", async () => {
    const messages = await lintFixture(
      "src/server/domain/jobs/queue-fixture.ts",
      'import { jobQueue } from "~/server/jobs";\nvoid jobQueue;',
    );

    expect(hasErrorContaining(messages, "~/server/jobs")).toBe(true);
  });

  it("rejects the Baileys vendor from the domain layer", async () => {
    const scopedMessages = await lintFixture(
      "src/server/domain/ports/channel-fixture.ts",
      'import makeWASocket from "@whiskeysockets/baileys";\nvoid makeWASocket;',
    );
    const unscopedMessages = await lintFixture(
      "src/server/domain/ports/channel-fixture.ts",
      'import makeWASocket from "baileys";\nvoid makeWASocket;',
    );

    expect(hasErrorContaining(scopedMessages, "@whiskeysockets/baileys")).toBe(
      true,
    );
    expect(hasErrorContaining(unscopedMessages, "baileys")).toBe(true);
  });

  it("rejects QR rendering packages from the domain layer", async () => {
    const qrcodeMessages = await lintFixture(
      "src/server/domain/ports/channel-fixture.ts",
      'import QRCode from "qrcode";\nvoid QRCode;',
    );
    const qrcodeTerminalMessages = await lintFixture(
      "src/server/domain/ports/channel-fixture.ts",
      'import qrcodeTerminal from "qrcode-terminal";\nvoid qrcodeTerminal;',
    );

    expect(hasErrorContaining(qrcodeMessages, "qrcode")).toBe(true);
    expect(hasErrorContaining(qrcodeTerminalMessages, "qrcode-terminal")).toBe(
      true,
    );
  });

  it("allows pure domain imports in the domain layer", async () => {
    const messages = await lintFixture(
      "src/server/domain/invoice.ts",
      'import { z } from "zod";\nvoid z;',
    );

    expect(messages.filter((message) => message.severity === 2)).toHaveLength(
      0,
    );
  });

  it("does not apply the domain restriction to invariant fixtures", async () => {
    const messages = await lintFixture(
      "tests/invariants/inv-8-domain-no-channel-imports.test.ts",
      'import { db } from "~/server/db";\nimport { send } from "~/server/channels/email";\nvoid db;\nvoid send;',
    );

    expect(messages.filter((message) => message.severity === 2)).toHaveLength(
      0,
    );
  });
});
