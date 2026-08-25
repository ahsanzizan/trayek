import { describe, expect, it } from "vitest";

import {
  buildUnpromptedReport,
  formatUnpromptedReport,
} from "~/server/baseline/report";

function reader(forwarders: number, claimed: (boolean | null)[]) {
  return {
    organization: { count: () => Promise.resolve(forwarders) },
    dsoBaseline: {
      findMany: () =>
        Promise.resolve(
          claimed.map((statedUnprompted) => ({ statedUnprompted })),
        ),
    },
  };
}

describe("buildUnpromptedReport", () => {
  it("counts owners who named a DSO without being asked", async () => {
    await expect(
      buildUnpromptedReport(reader(5, [true, true, false])),
    ).resolves.toEqual({
      organizationsSurveyed: 5,
      statedUnprompted: 2,
      statedWhenPrompted: 1,
      noClaimedBaseline: 2,
    });
  });

  it("separates never asked from could not answer", async () => {
    // An organization nobody interviewed is not evidence about the market.
    const report = await buildUnpromptedReport(reader(4, [false]));

    expect(report.statedWhenPrompted).toBe(1);
    expect(report.noClaimedBaseline).toBe(3);
  });

  it("treats a null flag as prompted rather than counting it as a yes", async () => {
    const report = await buildUnpromptedReport(reader(1, [null]));

    expect(report.statedUnprompted).toBe(0);
    expect(report.statedWhenPrompted).toBe(1);
  });

  it("never reports a negative count", async () => {
    const report = await buildUnpromptedReport(reader(1, [true, true, true]));

    expect(report.noClaimedBaseline).toBe(0);
  });

  it("handles an empty dataset", async () => {
    await expect(buildUnpromptedReport(reader(0, []))).resolves.toMatchObject({
      organizationsSurveyed: 0,
      statedUnprompted: 0,
    });
  });
});

describe("formatUnpromptedReport", () => {
  it("shows the share that is the actual go/no-go signal", () => {
    const output = formatUnpromptedReport({
      organizationsSurveyed: 4,
      statedUnprompted: 3,
      statedWhenPrompted: 1,
      noClaimedBaseline: 0,
    });

    expect(output).toContain("75%");
    expect(output).toContain("Stated DSO unprompted:      3");
  });

  it("does not divide by zero on an empty dataset", () => {
    expect(
      formatUnpromptedReport({
        organizationsSurveyed: 0,
        statedUnprompted: 0,
        statedWhenPrompted: 0,
        noClaimedBaseline: 0,
      }),
    ).toContain("n/a");
  });
});
