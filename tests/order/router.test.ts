import { afterAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";

const organization = seedFixturesData.organizations[0];
const shipper = seedFixturesData.shippers[0];
const driver = seedFixturesData.drivers[0];
const foreignShipper = seedFixturesData.shippers[2];
const foreignDriver = seedFixturesData.drivers[2];
const foreignOrder = seedFixturesData.orders[2];

if (
  !organization ||
  !shipper ||
  !driver ||
  !foreignShipper ||
  !foreignDriver ||
  !foreignOrder
) {
  throw new Error("Seed requires orders and references in both organizations");
}

function callerFor(userId: string) {
  return createCaller(() =>
    Promise.resolve({
      db,
      headers: new Headers(),
      requestId: "order-router-test",
      session: {
        user: { id: userId, activeOrganizationId: organization.id },
        memberships: [],
        expires: "2099-01-01T00:00:00.000Z",
      },
    }),
  );
}

const admin = callerFor("user-forwarder-a-admin");
const finance = callerFor("user-forwarder-a-finance");

const suffix = Date.now().toString().slice(-8);
const createdIds: string[] = [];

afterAll(async () => {
  await db.order.deleteMany({ where: { id: { in: createdIds } } });
  await db.$disconnect();
});

function orderInput(nomor: string) {
  return {
    nomorOrder: `ORD-${nomor}`,
    nomorSuratJalan: `SJ-${nomor}`,
    shipperId: shipper!.id,
    driverId: driver!.id,
    origin: "Gudang Cakung, Jakarta Timur",
    destination: "DC Bandung, Jawa Barat",
    plannedDeliveryDate: null,
    actualDeliveryDate: null,
    jumlahKoli: 30,
    weightGram: 600_000,
    nilaiTagihan: 3_250_000n,
    status: undefined,
  };
}

async function createOrder(nomor: string) {
  const { status: _status, ...input } = orderInput(nomor);
  const order = await admin.order.create(input);

  createdIds.push(order.id);
  return order;
}

describe("creating an order", () => {
  it("stores the invoiced amount exactly as given", async () => {
    const order = await createOrder(suffix);

    // INV-3: copied, never computed. The value that comes back is the value
    // the forwarder supplied, to the rupiah.
    expect(order.nilaiTagihan).toBe(3_250_000n);
    expect(order.status).toBe("CREATED");
    expect(order.shipper).toMatchObject({ id: shipper!.id });
    expect(order.driver).toMatchObject({ id: driver!.id });
  });

  it("carries a BigInt across the wire without losing precision", async () => {
    // Beyond Number.MAX_SAFE_INTEGER: a float would round this silently, which
    // is exactly why money is BigInt.
    const order = await admin.order.create({
      ...orderInput(`${suffix}-big`),
      status: undefined,
      nilaiTagihan: 9_007_199_254_740_993n,
    });

    createdIds.push(order.id);
    expect(order.nilaiTagihan).toBe(9_007_199_254_740_993n);
  });

  it("accepts an order with no driver assigned yet", async () => {
    const order = await admin.order.create({
      ...orderInput(`${suffix}-nodriver`),
      status: undefined,
      driverId: null,
    });

    createdIds.push(order.id);
    expect(order.driver).toBeNull();
  });

  it("rejects a negative amount, which would be a credit note", async () => {
    await expect(
      admin.order.create({
        ...orderInput(`${suffix}-neg`),
        status: undefined,
        nilaiTagihan: -1n,
      }),
    ).rejects.toThrow();
  });

  it("refuses a FINANCE member", async () => {
    await expect(
      admin.order.create({
        ...orderInput(`${suffix}-fin`),
        status: undefined,
      }),
    ).resolves.toBeTruthy();

    await expect(
      finance.order.create({
        ...orderInput(`${suffix}-fin2`),
        status: undefined,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the surat jalan number is the natural key", () => {
  it("rejects a second order with the same nomor surat jalan", async () => {
    const nomor = `${suffix}-dup`;
    await createOrder(nomor);

    // Two orders sharing a surat jalan would make POD matching ambiguous.
    await expect(
      admin.order.create({ ...orderInput(nomor), status: undefined }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("writes no second row after the conflict", async () => {
    const rows = await db.order.count({
      where: {
        organizationId: organization!.id,
        nomorSuratJalan: `SJ-${suffix}-dup`,
      },
    });

    expect(rows).toBe(1);
  });
});

describe("references must belong to the caller's organization", () => {
  it("refuses an order pointing at another organization's shipper", async () => {
    await expect(
      admin.order.create({
        ...orderInput(`${suffix}-fs`),
        status: undefined,
        shipperId: foreignShipper!.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses an order pointing at another organization's driver", async () => {
    await expect(
      admin.order.create({
        ...orderInput(`${suffix}-fd`),
        status: undefined,
        driverId: foreignDriver!.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hides another organization's order from a direct read", async () => {
    await expect(
      admin.order.byId({ orderId: foreignOrder!.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hides another organization's order from the list", async () => {
    const { orders } = await admin.order.list();

    expect(orders.map((order) => order.id)).not.toContain(foreignOrder!.id);
  });
});

describe("listing orders", () => {
  it("filters by status", async () => {
    const { orders } = await admin.order.list({ status: "DELIVERED" });

    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((order) => order.status === "DELIVERED")).toBe(true);
  });

  it("filters by shipper", async () => {
    const { orders } = await admin.order.list({ shipperId: shipper!.id });

    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((o) => o.shipper.id === shipper!.id)).toBe(true);
  });

  it("pages with a cursor rather than a count", async () => {
    const first = await admin.order.list({ limit: 1 });

    expect(first.orders).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = await admin.order.list({
      limit: 1,
      cursor: first.nextCursor,
    });

    expect(second.orders[0]?.id).not.toBe(first.orders[0]?.id);
  });
});

describe("orders are audited", () => {
  it("records the creation against the row that was written", async () => {
    const order = await createOrder(`${suffix}-audit`);

    const entries = await db.auditLog.findMany({
      where: { entityType: "Order", entityId: order.id },
      select: { action: true, actorId: true, after: true },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "ORDER_CREATED",
      actorId: "user-forwarder-a-admin",
    });
  });

  it("writes no audit row when the create is rejected", async () => {
    const nomor = `${suffix}-noaudit`;
    await createOrder(nomor);

    const before = await db.auditLog.count({
      where: { entityType: "Order", action: "ORDER_CREATED" },
    });

    await expect(
      admin.order.create({ ...orderInput(nomor), status: undefined }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const after = await db.auditLog.count({
      where: { entityType: "Order", action: "ORDER_CREATED" },
    });

    expect(after).toBe(before);
  });
});
