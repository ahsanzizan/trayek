import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  scopeTenantOperation,
  TENANT_SCOPED_MODELS,
} from "~/server/api/tenant-extension";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function readSchema() {
  return readFile(path.join(repositoryRoot, "prisma/schema.prisma"), "utf8");
}

function modelBlock(schema: string, model: string) {
  return new RegExp(`model ${model}\\s*\\{[\\s\\S]*?\\n\\}`).exec(schema)?.[0];
}

describe("channel persistence schema", () => {
  it("defines one shared channel enum for persistence", async () => {
    const schema = await readSchema();

    expect(schema).toMatch(
      /enum ChannelType\s*\{\s*WHATSAPP_BAILEYS\s+EMAIL\s*\}/s,
    );
    expect(schema).toMatch(
      /enum MessageDirection\s*\{\s*INBOUND\s+OUTBOUND\s*\}/s,
    );
    expect(schema).toMatch(
      /enum MessageLogStatus\s*\{\s*PENDING\s+SENT\s+DELIVERED\s+FAILED\s*\}/s,
    );
    expect(schema).toMatch(
      /enum ChannelConnectionStatus\s*\{\s*CONNECTED\s+DISCONNECTED\s+NEEDS_PAIRING\s*\}/s,
    );
  });

  it("stores message delivery facts with tenant and reporting indexes", async () => {
    const schema = await readSchema();
    const messageLog = modelBlock(schema, "MessageLog");

    expect(messageLog).toBeDefined();
    expect(messageLog).toMatch(/organizationId\s+String/);
    expect(messageLog).toMatch(/channel\s+ChannelType/);
    expect(messageLog).toMatch(/direction\s+MessageDirection/);
    expect(messageLog).toMatch(
      /status\s+MessageLogStatus\s+@default\(PENDING\)/,
    );
    expect(messageLog).toMatch(/externalId\s+String\?/);
    expect(messageLog).toMatch(/truncated\s+Boolean\s+@default\(false\)/);
    expect(messageLog).toMatch(/@@unique\(\[organizationId, externalId\]\)/);
    expect(messageLog).toMatch(/@@index\(\[organizationId\]\)/);
    expect(messageLog).toMatch(/@@index\(\[organizationId, createdAt\]\)/);
    expect(messageLog).toMatch(
      /@@index\(\[organizationId, channel, createdAt\]\)/,
    );
  });

  it("stores one channel connection per organization and channel", async () => {
    const schema = await readSchema();
    const connection = modelBlock(schema, "ChannelConnection");

    expect(connection).toBeDefined();
    expect(connection).toMatch(/organizationId\s+String/);
    expect(connection).toMatch(/channel\s+ChannelType/);
    expect(connection).toMatch(/status\s+ChannelConnectionStatus/);
    expect(connection).toMatch(/authState\s+Json\?/);
    expect(connection).toMatch(/authStateVersion\s+Int\s+@default\(1\)/);
    expect(connection).toMatch(/@@unique\(\[organizationId, channel\]\)/);
  });
});

describe("channel tenant boundary", () => {
  it("classifies both channel models as organization-owned", () => {
    expect(TENANT_SCOPED_MODELS.has("MessageLog")).toBe(true);
    expect(TENANT_SCOPED_MODELS.has("ChannelConnection")).toBe(true);
  });

  it("forces the active organization into MessageLog reads and writes", () => {
    const read = scopeTenantOperation({
      model: "MessageLog",
      operation: "findMany",
      args: { where: { organizationId: "org-b", status: "SENT" } },
      organizationId: "org-a",
      tenantModels: TENANT_SCOPED_MODELS,
    });
    const create = scopeTenantOperation({
      model: "MessageLog",
      operation: "create",
      args: { data: { organizationId: "org-b", body: "hello" } },
      organizationId: "org-a",
      tenantModels: TENANT_SCOPED_MODELS,
    });

    expect(read.args).toEqual({
      where: { organizationId: "org-a", status: "SENT" },
    });
    expect(create.args).toEqual({
      data: { organizationId: "org-a", body: "hello" },
    });
  });
});
