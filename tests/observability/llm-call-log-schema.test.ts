import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function readSchema(): Promise<string> {
  return readFile(path.join(repositoryRoot, "prisma/schema.prisma"), "utf8");
}

describe("LLM accounting schema", () => {
  it("stores immutable tenant-scoped per-attempt accounting facts", async () => {
    const schema = await readSchema();
    const model = schema.match(/model LlmCallLog\s*\{([\s\S]*?)\n\}/)?.[1];

    expect(model).toBeDefined();
    expect(model).toMatch(
      /organizationId\s+String[\s\S]*loadId\s+String[\s\S]*model\s+String[\s\S]*promptVersion\s+String[\s\S]*inputTokens\s+Int[\s\S]*outputTokens\s+Int[\s\S]*imageCount\s+Int[\s\S]*latencyMs\s+Int[\s\S]*estimatedCost\s+BigInt[\s\S]*success\s+Boolean[\s\S]*errorMessage\s+String\?/,
    );
    expect(model).not.toContain("entityType");
    expect(model).not.toContain("Json");
  });

  it("links the table to organizations and indexes summary access paths", async () => {
    const schema = await readSchema();

    expect(schema).toMatch(
      /model Organization\s*\{[\s\S]*?llmCallLogs\s+LlmCallLog\[\]/,
    );
    expect(schema).toMatch(
      /model LlmCallLog\s*\{[\s\S]*?organization\s+Organization\s+@relation\(fields: \[organizationId\], references: \[id\], onDelete: Cascade\)[\s\S]*?@@index\(\[organizationId, createdAt\]\)[\s\S]*?@@index\(\[organizationId, loadId\]\)[\s\S]*?@@map\("llm_call_logs"\)/,
    );
  });
});
