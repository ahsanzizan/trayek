import { describe, expect, it } from "vitest";

import { runSeed, type SeedDatabase, type SeedWriter } from "../../prisma/seed";

describe("TRK-002 seed runner", () => {
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
      "membership",
      "membership",
      "membership",
      "membership",
      "membership",
      "membership",
      "commit",
    ]);
  });
});
