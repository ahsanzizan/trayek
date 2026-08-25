import { describe, expect, it, vi } from "vitest";
import Papa from "papaparse";

import {
  costFor,
  costMetadataFor,
  designRuleViolation,
  toCsv,
} from "~/server/domain/channel/cost";
import { type db } from "~/server/db";
import { channelRouter } from "~/server/api/routers/channel";
import { createCallerFactory } from "~/server/api/trpc";

describe("message cost attribution", () => {
  it("records Baileys as zero-cost and outside a conversation window", () => {
    expect(
      costFor("WHATSAPP_BAILEYS", "WHATSAPP_BAILEYS", {
        WHATSAPP_BAILEYS: 99,
      }),
    ).toBe(0);
    expect(costMetadataFor("WHATSAPP_BAILEYS")).toEqual({
      category: "WHATSAPP_BAILEYS",
      estimatedCost: 0,
      conversationWindowState: "N/A",
    });
  });

  it("uses an injected cost table for channels that have billing", () => {
    expect(costFor("EMAIL", "UTILITY", { UTILITY: 12.5 })).toBe(12.5);
    expect(costMetadataFor("EMAIL", { UTILITY: 12.5 })).toEqual({
      category: "UTILITY",
      estimatedCost: 12.5,
      conversationWindowState: "N/A",
    });
  });

  it("flags only averages above three messages per POD", () => {
    expect(designRuleViolation(3)).toBe(false);
    expect(designRuleViolation(3.01)).toBe(true);
  });

  it("serializes category summaries as escaped CSV", () => {
    const csv = toCsv([
      {
        category: "UTILITY",
        messageCount: 2,
        estimatedCost: 12.5,
      },
      {
        category: 'MARKETING, "legacy"',
        messageCount: 1,
        estimatedCost: 0,
      },
    ]);

    expect(csv).toBe(
      [
        "category,messageCount,estimatedCost",
        "UTILITY,2,12.5",
        '"MARKETING, ""legacy""",1,0',
      ].join("\n"),
    );
    expect(Papa.parse(csv, { header: true }).data).toEqual([
      { category: "UTILITY", messageCount: "2", estimatedCost: "12.5" },
      {
        category: 'MARKETING, "legacy"',
        messageCount: "1",
        estimatedCost: "0",
      },
    ]);
    expect(toCsv([])).toBe("");
  });
});

describe("channel.monthlyReport", () => {
  it("returns an org-scoped monthly summary and CSV export", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      {
        category: "WHATSAPP_BAILEYS",
        _count: { _all: 3 },
        _sum: { estimatedCost: 0 },
      },
      {
        category: "UTILITY",
        _count: { _all: 1 },
        _sum: { estimatedCost: 12.5 },
      },
    ]);
    const podCount = vi.fn().mockResolvedValue(1);
    let database = {} as typeof db;
    database = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({
          userId: "user-1",
          organizationId: "org-1",
          role: "OWNER",
        }),
      },
      messageLog: { groupBy },
      podSubmission: { count: podCount },
      $extends: vi.fn(() => database),
    } as unknown as typeof db;

    const caller = createCallerFactory(channelRouter)({
      db: database,
      session: {
        user: {
          id: "user-1",
          activeOrganizationId: "org-1",
        },
        memberships: [],
        expires: "2099-01-01T00:00:00.000Z",
      },
      headers: new Headers(),
      requestId: "cost-report-test",
    });

    const report = await caller.monthlyReport({ month: "2026-02" });
    const monthStart = new Date("2026-02-01T00:00:00.000Z");
    const monthEnd = new Date("2026-03-01T00:00:00.000Z");

    expect(groupBy).toHaveBeenCalledWith({
      by: ["category"],
      where: {
        organizationId: "org-1",
        createdAt: { gte: monthStart, lt: monthEnd },
      },
      _count: { _all: true },
      _sum: { estimatedCost: true },
    });
    expect(podCount).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        receivedAt: { gte: monthStart, lt: monthEnd },
      },
    });
    expect(report).toEqual({
      month: "2026-02",
      totalMessages: 4,
      byCategory: [
        {
          category: "WHATSAPP_BAILEYS",
          messageCount: 3,
          estimatedCost: 0,
        },
        { category: "UTILITY", messageCount: 1, estimatedCost: 12.5 },
      ],
      avgPerPod: 4,
      designRuleViolation: true,
      csv: [
        "category,messageCount,estimatedCost",
        "WHATSAPP_BAILEYS,3,0",
        "UTILITY,1,12.5",
      ].join("\n"),
    });
  });

  it("returns a stable empty report when the month has no messages or PODs", async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const podCount = vi.fn().mockResolvedValue(0);
    let database = {} as typeof db;
    database = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({
          userId: "user-1",
          organizationId: "org-1",
          role: "OWNER",
        }),
      },
      messageLog: { groupBy },
      podSubmission: { count: podCount },
      $extends: vi.fn(() => database),
    } as unknown as typeof db;

    const caller = createCallerFactory(channelRouter)({
      db: database,
      session: {
        user: {
          id: "user-1",
          activeOrganizationId: "org-1",
        },
        memberships: [],
        expires: "2099-01-01T00:00:00.000Z",
      },
      headers: new Headers(),
      requestId: "cost-report-empty-test",
    });

    await expect(caller.monthlyReport({ month: "2026-13" })).rejects.toThrow();
    await expect(caller.monthlyReport({ month: "2026-02" })).resolves.toEqual({
      month: "2026-02",
      totalMessages: 0,
      byCategory: [],
      avgPerPod: 0,
      designRuleViolation: false,
      csv: "",
    });
  });
});
