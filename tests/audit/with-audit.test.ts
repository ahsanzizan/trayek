import { describe, expect, it, vi } from "vitest";

import { type PrismaClient } from "../../generated/prisma";
import { InvalidAuditEntryError } from "~/server/domain/audit/entry";
import { withAudit } from "~/server/audit/with-audit";

/**
 * Stub client whose `$transaction` runs the callback against a recording
 * transaction, so the ordering and atomicity contract is assertable without a
 * database. The live behaviour is covered separately against real Postgres.
 */
function fakeDb(options: { failMutation?: boolean } = {}) {
  const created: unknown[] = [];
  const calls: string[] = [];
  const tx = {
    auditLog: {
      create: vi.fn((args: { data: unknown }) => {
        calls.push("audit");
        created.push(args.data);
        return Promise.resolve(args.data);
      }),
    },
  };

  const db = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      try {
        return await fn(tx);
      } catch (error) {
        // A real transaction discards every write on the way out.
        created.length = 0;
        throw error;
      }
    }),
  };

  const mutate = vi.fn(() => {
    calls.push("mutate");
    if (options.failMutation) {
      throw new Error("mutation failed");
    }
    return Promise.resolve("result");
  });

  return { db: db as unknown as PrismaClient, tx, mutate, created, calls };
}

const entry = {
  organizationId: "org_a",
  actor: { type: "USER" as const, id: "user_1", ip: "203.0.113.10" },
  action: "INVOICE_APPROVED",
  entityType: "Invoice",
  entityId: "inv_1",
};

describe("withAudit", () => {
  it("runs the mutation and the audit write in one transaction", async () => {
    const { db, mutate, calls } = fakeDb();

    await expect(withAudit(db, entry, mutate)).resolves.toBe("result");

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["mutate", "audit"]);
  });

  it("hands the mutation the transaction, not the outer client", async () => {
    const { db, tx, mutate } = fakeDb();

    await withAudit(db, entry, mutate);

    expect(mutate).toHaveBeenCalledWith(tx);
  });

  it("writes the flattened entry", async () => {
    const { db, mutate, created } = fakeDb();

    await withAudit(db, entry, mutate);

    expect(created[0]).toMatchObject({
      organizationId: "org_a",
      actorType: "USER",
      actorId: "user_1",
      action: "INVOICE_APPROVED",
      entityType: "Invoice",
      entityId: "inv_1",
      ip: "203.0.113.10",
    });
  });

  it("records nothing when the mutation fails", async () => {
    const { db, mutate, created } = fakeDb({ failMutation: true });

    await expect(withAudit(db, entry, mutate)).rejects.toThrow(
      "mutation failed",
    );
    expect(created).toHaveLength(0);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid entry before opening a transaction", async () => {
    const { db, mutate } = fakeDb();

    await expect(
      withAudit(db, { ...entry, action: "" }, mutate),
    ).rejects.toThrow(InvalidAuditEntryError);

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });
});
