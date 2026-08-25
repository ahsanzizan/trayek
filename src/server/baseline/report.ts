import { pathToFileURL } from "node:url";

import { type PrismaClient } from "../../../generated/prisma";

/**
 * How many design partners could state their own DSO without being prompted
 * (TRK-013).
 *
 * The PRD treats this as the month 0-2 go/no-go signal: an owner who does not
 * know their DSO cannot feel the pain the product is sold on, and a market
 * full of such owners is a market that will not buy. Recording it per
 * organization and counting it here keeps that judgement on evidence rather
 * than on someone's recollection of six meetings.
 *
 * Deliberately a command, not a tRPC procedure. It reads across every
 * organization, which no `orgProcedure` may do — exposing it over HTTP would
 * mean building a cross-tenant read path and then guarding it, when nothing
 * about this needs to be in the product at all. It is our metric, not a
 * customer's (INV-5).
 *
 * Run with `pnpm baseline:report`.
 */

export type UnpromptedReport = {
  organizationsSurveyed: number;
  statedUnprompted: number;
  statedWhenPrompted: number;
  noClaimedBaseline: number;
};

type ClaimedBaselineReader = {
  organization: { count: (args?: unknown) => Promise<number> };
  dsoBaseline: {
    findMany: (
      args: unknown,
    ) => Promise<{ statedUnprompted: boolean | null }[]>;
  };
};

export async function buildUnpromptedReport(
  db: ClaimedBaselineReader,
): Promise<UnpromptedReport> {
  const [forwarderCount, claimed] = await Promise.all([
    db.organization.count({ where: { type: "FORWARDER" } }),
    db.dsoBaseline.findMany({
      where: { method: "CLAIMED" },
      select: { statedUnprompted: true },
    }),
  ]);

  const statedUnprompted = claimed.filter(
    (baseline) => baseline.statedUnprompted === true,
  ).length;

  return {
    organizationsSurveyed: forwarderCount,
    statedUnprompted,
    statedWhenPrompted: claimed.length - statedUnprompted,
    // An organization with no claimed baseline was never asked, which is a
    // different finding from an owner who could not answer.
    noClaimedBaseline: Math.max(forwarderCount - claimed.length, 0),
  };
}

export function formatUnpromptedReport(report: UnpromptedReport): string {
  const share =
    report.organizationsSurveyed === 0
      ? "n/a"
      : `${Math.round((report.statedUnprompted / report.organizationsSurveyed) * 100)}%`;

  return [
    "DSO awareness across forwarder organizations",
    "",
    `  Organizations:              ${report.organizationsSurveyed}`,
    `  Stated DSO unprompted:      ${report.statedUnprompted}  (${share})`,
    `  Stated only when prompted:  ${report.statedWhenPrompted}`,
    `  Never asked:                ${report.noClaimedBaseline}`,
  ].join("\n");
}

const isMainModule =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  void (async () => {
    const { db } = await import("../db.js");

    try {
      const report = await buildUnpromptedReport(
        db as unknown as ClaimedBaselineReader,
      );
      console.log(formatUnpromptedReport(report));
    } catch (error: unknown) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      await (db as PrismaClient).$disconnect();
    }
  })();
}
