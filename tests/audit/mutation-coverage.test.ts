import { describe, expect, it } from "vitest";

import { appRouter } from "~/server/api/root";

/**
 * TRK-006 acceptance criterion: every mutation writes an audit entry, verified
 * by a test that enumerates mutations.
 *
 * The criterion names the packet and invoice state machines, which arrive in
 * TRK-080 and TRK-090. Rather than defer the whole thing, this enumerates the
 * mutations that exist now and forces a decision on every one added later: a
 * new mutation appears in neither list, so this test fails until someone
 * classifies it. That is the property worth having — it fails closed.
 *
 * When the packet and invoice state machines land, their transitions become
 * mutations here and must move into AUDITED.
 */

/** Mutations that write an audit entry through `withAudit()`. */
const AUDITED = new Set<string>([
  "shipper.create",
  "shipper.update",
  "shipper.publishProfileVersion",
  "driver.create",
  "order.create",
  "order.import",
  "baseline.captureClaimed",
  "baseline.captureFromBalances",
  "baseline.importHistoricalInvoices",
  "podLink.issue",
  "podLink.revoke",
  "podLink.rotate",
]);

/**
 * Mutations that deliberately do not audit, each with a stated reason.
 * Adding an entry here is a decision, not a default — it should be rare, and
 * anything touching a domain entity belongs in AUDITED instead.
 */
const NOT_AUDITED = new Map<string, string>([
  [
    "post.create",
    "create-t3-app scaffold example, not a domain entity. Unused by any route; " +
      "no issue currently owns removing it.",
  ],
  [
    "organization.switchOrganization",
    "changes which organization the caller is viewing; writes no domain entity. " +
      "It resolves a membership the user already holds and returns it for the session.",
  ],
]);

function mutationNames(): string[] {
  const procedures = (
    appRouter as unknown as {
      _def: { procedures: Record<string, { _def?: { type?: string } }> };
    }
  )._def.procedures;

  return Object.entries(procedures)
    .filter(([, procedure]) => procedure._def?.type === "mutation")
    .map(([name]) => name)
    .sort();
}

describe("audit coverage of mutations", () => {
  it("classifies every mutation as audited or explicitly exempt", () => {
    const unclassified = mutationNames().filter(
      (name) => !AUDITED.has(name) && !NOT_AUDITED.has(name),
    );

    expect(
      unclassified,
      `Unclassified mutation(s): ${unclassified.join(", ")}. ` +
        "Route the mutation through withAudit() and add it to AUDITED, or add " +
        "it to NOT_AUDITED with a reason.",
    ).toEqual([]);
  });

  it("finds at least one mutation, so the enumeration is not vacuous", () => {
    expect(mutationNames().length).toBeGreaterThan(0);
  });

  it("gives every exemption a stated reason", () => {
    for (const [name, reason] of NOT_AUDITED) {
      expect(
        reason.trim().length,
        `${name} has an empty reason`,
      ).toBeGreaterThan(20);
    }
  });

  it("does not carry exemptions for mutations that no longer exist", () => {
    const existing = new Set(mutationNames());
    const stale = [...NOT_AUDITED.keys(), ...AUDITED].filter(
      (name) => !existing.has(name),
    );

    expect(stale, `Stale audit classification(s): ${stale.join(", ")}`).toEqual(
      [],
    );
  });
});
