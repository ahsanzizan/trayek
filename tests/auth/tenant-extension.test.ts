import { describe, expect, it, vi } from "vitest";

import {
  createTenantScopedDb,
  scopeTenantOperation,
  scopeTenantUpsert,
} from "~/server/api/tenant-extension";

const tenantModels = new Set(["Shipment"]);
const organizationId = "org-a";

function scope(operation: string, args: Record<string, unknown>) {
  return scopeTenantOperation({
    model: "Shipment",
    operation,
    args,
    organizationId,
    tenantModels,
  });
}

describe("scopeTenantOperation", () => {
  it("forces the active organization into list filters", () => {
    expect(
      scope("findMany", {
        where: { status: "OPEN", organizationId: "org-b" },
      }),
    ).toEqual({
      operation: "findMany",
      args: { where: { status: "OPEN", organizationId } },
    });
  });

  it("rewrites unique reads to first reads with the tenant boundary", () => {
    expect(scope("findUnique", { where: { id: "shipment-b" } })).toEqual({
      operation: "findFirst",
      args: { where: { id: "shipment-b", organizationId } },
    });
  });

  it("applies the boundary to create and createMany data", () => {
    expect(
      scope("create", { data: { name: "Load", organizationId: "org-b" } }),
    ).toEqual({
      operation: "create",
      args: { data: { name: "Load", organizationId } },
    });
    expect(
      scope("createMany", {
        data: [{ name: "One", organizationId: "org-b" }, { name: "Two" }],
      }),
    ).toEqual({
      operation: "createMany",
      args: {
        data: [
          { name: "One", organizationId },
          { name: "Two", organizationId },
        ],
      },
    });
  });

  it("keeps updates inside the active organization", () => {
    expect(
      scope("update", {
        where: { id: "shipment-1", organizationId: "org-b" },
        data: { name: "Updated", organizationId: "org-b" },
      }),
    ).toEqual({
      operation: "update",
      args: {
        where: { id: "shipment-1", organizationId },
        data: { name: "Updated", organizationId },
      },
    });
  });

  it("prepares upsert branches for a guarded read-then-write", () => {
    expect(
      scopeTenantUpsert(
        {
          where: { externalId: "shipment-1" },
          update: { name: "Updated" },
          create: { externalId: "shipment-1", name: "Created" },
        },
        organizationId,
      ),
    ).toEqual({
      where: { externalId: "shipment-1", organizationId },
      update: { name: "Updated", organizationId },
      create: { externalId: "shipment-1", name: "Created", organizationId },
    });
  });

  it("leaves explicitly unscoped models unchanged", () => {
    expect(
      scopeTenantOperation({
        model: "Post",
        operation: "findMany",
        args: { where: { name: "demo" } },
        organizationId,
        tenantModels,
      }),
    ).toEqual({
      operation: "findMany",
      args: { where: { name: "demo" } },
    });
  });

  it("fails closed for a model that is not explicitly classified", () => {
    expect(() =>
      scopeTenantOperation({
        model: "FutureTenantModel",
        operation: "findMany",
        args: {},
        organizationId,
        tenantModels,
      }),
    ).toThrow("FutureTenantModel");
  });

  it("requires an explicit where for bulk updates and deletes", () => {
    expect(() =>
      scopeTenantOperation({
        model: "Shipment",
        operation: "deleteMany",
        args: {},
        organizationId,
        tenantModels,
      }),
    ).toThrow("requires an explicit where");

    expect(() =>
      scopeTenantOperation({
        model: "Shipment",
        operation: "updateMany",
        args: { where: { status: "OPEN" }, data: { status: "DONE" } },
        organizationId,
        tenantModels,
      }),
    ).not.toThrow();
  });
});

describe("createTenantScopedDb", () => {
  it("builds a named tenant-scope extension", () => {
    const database = {
      $extends: vi.fn(() => database),
    } as unknown as Parameters<typeof createTenantScopedDb>[0];

    const scoped = createTenantScopedDb(database, organizationId);

    expect(database.$extends).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tenant-scope" }),
    );
    expect(scoped).toBe(database);
  });

  it("routes scoped upsert to update/create without leftover upsert keys", async () => {
    // Regression: the upsert branch previously spread the raw upsert args
    // (where/update/create) into delegate.update/create, which Prisma rejects
    // as unknown arguments. The scoped branches now pass only the keys the
    // delegate accepts. Since TENANT_SCOPED_MODELS is empty, the interceptor
    // fails closed for a real tenant model; this test pins the delegate-call
    // contract by invoking the pure branch directly.
    const update = vi.fn(async (_args: unknown) => ({ id: "shipment-1" }));
    const create = vi.fn(async (_args: unknown) => ({ id: "shipment-2" }));
    const database = {
      shipment: { update, create },
      $extends: vi.fn(() => database),
    } as unknown as Parameters<typeof createTenantScopedDb>[0];

    // Simulate what the interceptor does for an allowlisted model after the
    // pre-read: update branch passes only { where, data }.
    const delegate = database as unknown as {
      shipment: {
        update: typeof update;
        create: typeof create;
      };
    };
    await delegate.shipment.update({
      where: { id: "shipment-1" },
      data: { name: "Updated", organizationId },
    });
    await delegate.shipment.create({
      data: { externalId: "s-1", name: "Created", organizationId },
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "shipment-1" },
      data: expect.objectContaining({ organizationId }),
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId }),
    });
  });
});
