import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function readSchema() {
  return readFile(path.join(repositoryRoot, "prisma/schema.prisma"), "utf8");
}

describe("identity schema", () => {
  it("defines the organization and membership enums exactly", async () => {
    const schema = await readSchema();

    expect(schema).toMatch(
      /enum OrganizationType\s*\{\s*FORWARDER\s+SHIPPER\s*\}/s,
    );
    expect(schema).toMatch(
      /enum MembershipRole\s*\{\s*OWNER\s+ADMIN\s+FINANCE\s+VIEWER\s*\}/s,
    );
  });

  it("defines a non-null indexed membership organization boundary", async () => {
    const schema = await readSchema();

    expect(schema).toMatch(
      /model Organization\s*\{[\s\S]*?memberships\s+Membership\[\]/,
    );
    expect(schema).toMatch(
      /model Membership\s*\{[\s\S]*?organizationId\s+String[\s\S]*?organization\s+Organization[\s\S]*?@@unique\(\[userId, organizationId\]\)[\s\S]*?@@index\(\[organizationId\]\)/,
    );
    expect(schema).toMatch(
      /model User\s*\{[\s\S]*?memberships\s+Membership\[\]/,
    );
    expect(schema).not.toMatch(/users\s+User\[\]\s+@relation\("UserOrg"\)/);
  });

  it("does not retain password auth and stores nullable org session settings", async () => {
    const schema = await readSchema();

    expect(schema).not.toMatch(/password\s+String\?/);
    expect(schema).toMatch(
      /model Organization\s*\{[\s\S]*?sessionMaxAgeSeconds\s+Int\?[\s\S]*?sessionIdleTimeoutSeconds\s+Int\?/,
    );
  });
});
