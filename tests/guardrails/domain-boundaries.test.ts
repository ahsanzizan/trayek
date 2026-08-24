import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function lintFixture(filePath: string, code: string) {
  const requestedFilePath = path.resolve(filePath);
  const extension = path.extname(requestedFilePath);
  const fixtureName = `${path.basename(
    requestedFilePath,
    extension,
  )}.${randomUUID()}${extension}`;
  const absoluteFilePath = path.join(
    path.dirname(requestedFilePath),
    fixtureName,
  );

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
    await rm(absoluteFilePath, { force: true });
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
  it("does not overwrite or delete an existing fixture path", async () => {
    const relativeFilePath = `src/server/domain/guardrail-existing-${randomUUID()}.ts`;
    const absoluteFilePath = path.resolve(relativeFilePath);
    const existingSource = "export const existingDomainSource = true;\n";

    await mkdir(path.dirname(absoluteFilePath), { recursive: true });
    await writeFile(absoluteFilePath, existingSource);

    try {
      await lintFixture(
        relativeFilePath,
        'import { db } from "~/server/db";\nvoid db;',
      );

      await expect(readFile(absoluteFilePath, "utf8")).resolves.toBe(
        existingSource,
      );
    } finally {
      await rm(absoluteFilePath, { force: true });
    }
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
