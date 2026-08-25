import { describe, expect, it } from "vitest";

import { runSeed, type SeedDatabase, type SeedWriter } from "../../prisma/seed";

describe("seed runner", () => {
  it("runs the fixture writer atomically without closing an injected database", async () => {
    const operations: string[] = [];
    const writer: SeedWriter = {
      organization: {
        upsert: async () => {
          operations.push("organization");
        },
      },
      user: {
        upsert: async () => {
          operations.push("user");
        },
      },
      membership: {
        upsert: async () => {
          operations.push("membership");
        },
      },
      shipper: {
        upsert: async () => {
          operations.push("shipper");
        },
      },
      requirementProfile: {
        upsert: async () => {
          operations.push("requirementProfile");
        },
      },
      driver: {
        upsert: async () => {
          operations.push("driver");
        },
      },
      order: {
        upsert: async () => {
          operations.push("order");
        },
      },
      podUploadLink: {
        upsert: async () => {
          operations.push("podUploadLink");
        },
      },
    };
    const database: SeedDatabase = {
      ...writer,
      $transaction: async (callback) => {
        operations.push("begin");
        const result = await callback(writer);
        operations.push("commit");
        return result;
      },
      $disconnect: async () => {
        operations.push("disconnect");
      },
    };

    await runSeed(database);

    expect(operations).toEqual([
      "begin",
      "organization",
      "organization",
      "organization",
      "user",
      "user",
      "user",
      "user",
      "user",
      "user",
      "membership",
      "membership",
      "membership",
      "membership",
      "membership",
      "membership",
      "membership",
      "membership",
      "shipper",
      "shipper",
      "shipper",
      "requirementProfile",
      "requirementProfile",
      "requirementProfile",
      "driver",
      "driver",
      "driver",
      "order",
      "order",
      "order",
      "podUploadLink",
      "podUploadLink",
      "commit",
    ]);
  });
});
