import { describe, expect, it } from "vitest";

import {
  type AuditEntry,
  InvalidAuditEntryError,
  toAuditLogRow,
} from "~/server/domain/audit/entry";

const base = {
  organizationId: "org_a",
  action: "INVOICE_APPROVED",
  entityType: "Invoice",
  entityId: "inv_1",
} satisfies Omit<AuditEntry, "actor">;

describe("toAuditLogRow: USER actor", () => {
  it("keeps the request context that proves who approved what (INV-1)", () => {
    expect(
      toAuditLogRow({
        ...base,
        actor: {
          type: "USER",
          id: "user_1",
          ip: "203.0.113.10",
          userAgent: "Mozilla/5.0",
        },
      }),
    ).toMatchObject({
      actorType: "USER",
      actorId: "user_1",
      ip: "203.0.113.10",
      userAgent: "Mozilla/5.0",
      agentModel: null,
      agentPromptVersion: null,
    });
  });

  it("allows a missing ip and user agent", () => {
    expect(
      toAuditLogRow({ ...base, actor: { type: "USER", id: "user_1" } }),
    ).toMatchObject({ ip: null, userAgent: null });
  });

  it("rejects a blank actor id", () => {
    expect(() =>
      toAuditLogRow({ ...base, actor: { type: "USER", id: "  " } }),
    ).toThrow(InvalidAuditEntryError);
  });
});

describe("toAuditLogRow: AGENT actor", () => {
  it("records the model and prompt version so the action is reproducible", () => {
    expect(
      toAuditLogRow({
        ...base,
        actor: {
          type: "AGENT",
          id: "extraction-agent",
          model: "claude-opus-5",
          promptVersion: "a1b2c3",
        },
      }),
    ).toMatchObject({
      actorType: "AGENT",
      actorId: "extraction-agent",
      agentModel: "claude-opus-5",
      agentPromptVersion: "a1b2c3",
    });
  });

  it("rejects an agent action with a blank prompt version", () => {
    expect(() =>
      toAuditLogRow({
        ...base,
        actor: {
          type: "AGENT",
          id: "extraction-agent",
          model: "claude-opus-5",
          promptVersion: "",
        },
      }),
    ).toThrow(InvalidAuditEntryError);
  });

  it("does not borrow request context an agent never had", () => {
    expect(
      toAuditLogRow({
        ...base,
        actor: {
          type: "AGENT",
          id: "extraction-agent",
          model: "claude-opus-5",
          promptVersion: "a1b2c3",
        },
      }),
    ).toMatchObject({ ip: null, userAgent: null });
  });
});

describe("toAuditLogRow: SYSTEM actor", () => {
  it("records no identity, because there is none", () => {
    expect(toAuditLogRow({ ...base, actor: { type: "SYSTEM" } })).toMatchObject(
      {
        actorType: "SYSTEM",
        actorId: null,
        agentModel: null,
      },
    );
  });
});

describe("toAuditLogRow: identifying fields", () => {
  it.each([
    ["organizationId", { organizationId: "" }],
    ["action", { action: "" }],
    ["entityType", { entityType: "  " }],
    ["entityId", { entityId: "" }],
  ])(
    "rejects a blank %s rather than storing an orphan row",
    (_label, patch) => {
      expect(() =>
        toAuditLogRow({
          ...base,
          ...patch,
          actor: { type: "SYSTEM" },
        }),
      ).toThrow(InvalidAuditEntryError);
    },
  );

  it("preserves before and after as given, defaulting to null", () => {
    expect(
      toAuditLogRow({
        ...base,
        actor: { type: "SYSTEM" },
        before: { status: "DRAFT" },
      }),
    ).toMatchObject({ before: { status: "DRAFT" }, after: null });
  });
});
