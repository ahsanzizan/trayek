import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({
  auth: vi.fn(),
}));

import { auditRouter } from "~/server/api/routers/audit";
import { createCallerFactory } from "~/server/api/trpc";
import { type db } from "~/server/db";

type Role = "OWNER" | "ADMIN" | "FINANCE" | "VIEWER";

function createCaller(role: Role, rows: unknown[] = []) {
  const findMany = vi.fn(() => Promise.resolve(rows));
  let database = {} as typeof db;
  database = {
    membership: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          id: "membership-a",
          organizationId: "org-a",
          role,
        }),
      ),
    },
    auditLog: { findMany },
    $extends: vi.fn(() => database),
  } as unknown as typeof db;

  const caller = createCallerFactory(auditRouter)(() =>
    Promise.resolve({
      db: database,
      headers: new Headers(),
      session: {
        user: { id: "user-a", activeOrganizationId: "org-a" },
        memberships: [],
        expires: "2099-01-01T00:00:00.000Z",
      },
      requestId: "test-request",
    }),
  );

  return { caller, findMany };
}

const entry = {
  id: "audit-1",
  actorType: "USER" as const,
  actorId: "user-a",
  action: "INVOICE_APPROVED",
  entityType: "Invoice",
  entityId: "inv-1",
  before: null,
  after: null,
  ip: null,
  userAgent: null,
  agentModel: null,
  agentPromptVersion: null,
  createdAt: new Date("2026-08-25T00:00:00.000Z"),
};

const input = { entityType: "Invoice", entityId: "inv-1" };

describe("audit.listByEntity access", () => {
  it.each(["OWNER", "FINANCE"] as const)("allows %s to read", async (role) => {
    const { caller } = createCaller(role);

    await expect(caller.listByEntity(input)).resolves.toEqual({
      entries: [],
      nextCursor: null,
    });
  });

  it.each(["ADMIN", "VIEWER"] as const)("denies %s", async (role) => {
    const { caller } = createCaller(role);

    await expect(caller.listByEntity(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("never reaches the database for a denied role", async () => {
    const { caller, findMany } = createCaller("VIEWER");

    await expect(caller.listByEntity(input)).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("audit.listByEntity behaviour", () => {
  it("filters to the requested entity, newest first", async () => {
    const { caller, findMany } = createCaller("FINANCE", [entry]);

    await caller.listByEntity(input);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityType: "Invoice", entityId: "inv-1" },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("reports no next cursor when the page is not full", async () => {
    const { caller } = createCaller("FINANCE", [entry]);

    await expect(caller.listByEntity({ ...input, limit: 5 })).resolves.toEqual({
      entries: [entry],
      nextCursor: null,
    });
  });

  it("returns a cursor and trims the probe row when more remain", async () => {
    const rows = [
      entry,
      { ...entry, id: "audit-2" },
      { ...entry, id: "audit-3" },
    ];
    const { caller } = createCaller("FINANCE", rows);

    const result = await caller.listByEntity({ ...input, limit: 2 });

    expect(result.entries).toHaveLength(2);
    expect(result.nextCursor).toBe("audit-2");
  });

  it("rejects a limit above the ceiling", async () => {
    const { caller } = createCaller("FINANCE");

    await expect(
      caller.listByEntity({ ...input, limit: 5000 }),
    ).rejects.toThrow();
  });

  it("exposes no mutation, because the log is written only via withAudit", () => {
    const procedures = (
      auditRouter as unknown as {
        _def: { procedures: Record<string, { _def?: { type?: string } }> };
      }
    )._def.procedures;

    const mutations = Object.entries(procedures).filter(
      ([, procedure]) => procedure._def?.type === "mutation",
    );

    expect(mutations).toEqual([]);
  });
});
