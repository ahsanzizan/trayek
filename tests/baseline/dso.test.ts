import { describe, expect, it } from "vitest";

import {
  calendarDaysBetween,
  computeDsoFromBalances,
  computeDsoFromInvoices,
  daysRemoved,
  InsufficientHistoryError,
  InvalidBalanceInputsError,
  type HistoricalInvoiceInput,
} from "~/server/domain/baseline/dso";

/** Midnight Jakarta on the given date, which is 17:00 UTC the day before. */
function wib(iso: string, time = "00:00"): Date {
  return new Date(`${iso}T${time}:00+07:00`);
}

function invoice(
  issue: string,
  payment: string | null,
  amount: bigint,
): HistoricalInvoiceInput {
  return {
    issueDate: wib(issue),
    paymentDate: payment === null ? null : wib(payment),
    amountRupiah: amount,
  };
}

describe("calendarDaysBetween", () => {
  it("counts whole days", () => {
    expect(calendarDaysBetween(wib("2026-01-01"), wib("2026-01-31"))).toBe(30);
  });

  it("counts calendar days, not elapsed 24-hour periods", () => {
    // Issued 23:00 Monday, paid 01:00 Wednesday: two calendar days in Jakarta,
    // even though only 26 hours passed. Dividing elapsed ms by 86.4m gives 1.
    expect(
      calendarDaysBetween(
        wib("2026-01-05", "23:00"),
        wib("2026-01-07", "01:00"),
      ),
    ).toBe(2);
  });

  it("counts a same-day payment as zero", () => {
    expect(
      calendarDaysBetween(
        wib("2026-01-05", "08:00"),
        wib("2026-01-05", "17:00"),
      ),
    ).toBe(0);
  });

  it("uses the Jakarta day boundary, not the UTC one", () => {
    // 2026-01-05T20:00Z is already 2026-01-06 in Jakarta.
    const issued = new Date("2026-01-05T20:00:00Z");
    const paid = new Date("2026-01-06T20:00:00Z");

    expect(calendarDaysBetween(issued, paid)).toBe(1);
    expect(calendarDaysBetween(issued, new Date("2026-01-06T01:00:00Z"))).toBe(
      0,
    );
  });

  it("crosses a month and a year boundary", () => {
    expect(calendarDaysBetween(wib("2025-12-30"), wib("2026-01-02"))).toBe(3);
  });

  it("is negative when payment precedes issue", () => {
    expect(calendarDaysBetween(wib("2026-01-10"), wib("2026-01-01"))).toBe(-9);
  });
});

describe("computeDsoFromInvoices", () => {
  it("averages days to pay, weighted by amount", () => {
    // 1,000,000 paid in 30 days and 9,000,000 paid in 80 days.
    // Weighted: (1M*30 + 9M*80) / 10M = 75 days. Unweighted would say 55.
    const result = computeDsoFromInvoices([
      invoice("2026-01-01", "2026-01-31", 1_000_000n),
      invoice("2026-01-01", "2026-03-22", 9_000_000n),
    ]);

    expect(result.dsoDays).toBe(75);
    expect(result.invoiceCount).toBe(2);
    expect(result.invoicedRevenue).toBe(10_000_000n);
  });

  it("lets one large slow invoice dominate, which is the point", () => {
    const fast = Array.from({ length: 50 }, (_, index) =>
      invoice("2026-01-01", "2026-01-06", 100_000n + BigInt(index) * 0n),
    );
    const slowAndLarge = invoice("2026-01-01", "2026-04-11", 500_000_000n);

    const result = computeDsoFromInvoices([...fast, slowAndLarge]);

    // A plain mean would report about 7 days and hide the money at risk.
    expect(result.dsoDays).toBeGreaterThan(90);
  });

  it("reports the period the figure covers", () => {
    const result = computeDsoFromInvoices([
      invoice("2026-02-10", "2026-03-01", 1_000_000n),
      invoice("2026-01-05", "2026-02-01", 1_000_000n),
      invoice("2026-03-20", "2026-04-01", 1_000_000n),
    ]);

    expect(result.periodStart).toEqual(wib("2026-01-05"));
    expect(result.periodEnd).toEqual(wib("2026-03-20"));
  });

  it("rounds to whole days rather than truncating", () => {
    // 1M at 10 days, 1M at 11 days -> 10.5, which rounds to 11.
    const result = computeDsoFromInvoices([
      invoice("2026-01-01", "2026-01-11", 1_000_000n),
      invoice("2026-01-01", "2026-01-12", 1_000_000n),
    ]);

    expect(result.dsoDays).toBe(11);
  });

  it("counts a same-day payment as zero days, not as an error", () => {
    const result = computeDsoFromInvoices([
      invoice("2026-01-01", "2026-01-01", 1_000_000n),
    ]);

    expect(result.dsoDays).toBe(0);
  });
});

describe("computeDsoFromInvoices: what it refuses to count", () => {
  it("excludes unpaid invoices instead of treating them as paid today", () => {
    // Counting them would make the baseline depend on the day it was captured.
    const result = computeDsoFromInvoices([
      invoice("2026-01-01", "2026-01-31", 1_000_000n),
      invoice("2026-01-01", null, 50_000_000n),
    ]);

    expect(result.dsoDays).toBe(30);
    expect(result.invoiceCount).toBe(1);
    expect(result.excluded.unpaid).toBe(1);
  });

  it("excludes an invoice paid before it was issued", () => {
    const result = computeDsoFromInvoices([
      invoice("2026-01-01", "2026-01-31", 1_000_000n),
      invoice("2026-02-01", "2026-01-01", 1_000_000n),
    ]);

    expect(result.excluded.negativeDuration).toBe(1);
    expect(result.invoiceCount).toBe(1);
  });

  it("excludes zero and negative amounts", () => {
    const result = computeDsoFromInvoices([
      invoice("2026-01-01", "2026-01-31", 1_000_000n),
      invoice("2026-01-01", "2026-01-31", 0n),
      invoice("2026-01-01", "2026-01-31", -5_000n),
    ]);

    expect(result.excluded.zeroAmount).toBe(2);
    expect(result.invoiceCount).toBe(1);
  });

  it("refuses to invent a baseline from nothing", () => {
    expect(() => computeDsoFromInvoices([])).toThrow(InsufficientHistoryError);
  });

  it("refuses when every invoice was excluded", () => {
    expect(() =>
      computeDsoFromInvoices([invoice("2026-01-01", null, 1_000_000n)]),
    ).toThrow(InsufficientHistoryError);
  });
});

describe("computeDsoFromBalances", () => {
  it("computes receivables over revenue times days in the period", () => {
    // 500M receivable, 1B revenue over 181 days -> 90.5 -> 91.
    expect(
      computeDsoFromBalances({
        invoicedRevenue: 1_000_000_000n,
        averageReceivable: 500_000_000n,
        periodStart: wib("2026-01-01"),
        periodEnd: wib("2026-06-30"),
      }),
    ).toBe(91);
  });

  it("counts the period inclusively at both ends", () => {
    // 1 January to 1 January is one day, not zero; a zero-day period would
    // make every baseline zero.
    expect(
      computeDsoFromBalances({
        invoicedRevenue: 1_000_000n,
        averageReceivable: 1_000_000n,
        periodStart: wib("2026-01-01"),
        periodEnd: wib("2026-01-01"),
      }),
    ).toBe(1);
  });

  it("returns zero when nothing is outstanding", () => {
    expect(
      computeDsoFromBalances({
        invoicedRevenue: 1_000_000_000n,
        averageReceivable: 0n,
        periodStart: wib("2026-01-01"),
        periodEnd: wib("2026-06-30"),
      }),
    ).toBe(0);
  });

  it.each([
    ["zero revenue", 0n, 100n],
    ["negative revenue", -1n, 100n],
    ["negative receivable", 1_000_000n, -1n],
  ])("rejects %s", (_label, invoicedRevenue, averageReceivable) => {
    expect(() =>
      computeDsoFromBalances({
        invoicedRevenue,
        averageReceivable,
        periodStart: wib("2026-01-01"),
        periodEnd: wib("2026-06-30"),
      }),
    ).toThrow(InvalidBalanceInputsError);
  });

  it("rejects a period that runs backwards", () => {
    expect(() =>
      computeDsoFromBalances({
        invoicedRevenue: 1_000_000n,
        averageReceivable: 100_000n,
        periodStart: wib("2026-06-30"),
        periodEnd: wib("2026-01-01"),
      }),
    ).toThrow(InvalidBalanceInputsError);
  });

  it("keeps precision on amounts beyond the safe float range", () => {
    expect(
      computeDsoFromBalances({
        invoicedRevenue: 9_007_199_254_740_993n,
        averageReceivable: 9_007_199_254_740_993n,
        periodStart: wib("2026-01-01"),
        periodEnd: wib("2026-01-10"),
      }),
    ).toBe(10);
  });
});

describe("daysRemoved", () => {
  it("is positive when collection got faster", () => {
    expect(daysRemoved(75, 60)).toBe(15);
  });

  it("is negative when it got slower, and says so plainly", () => {
    expect(daysRemoved(60, 68)).toBe(-8);
  });

  it("reports the raw day difference, never a percentage", () => {
    // A percentage invites re-basing the comparison to look better. The PRD
    // sells "8 or more days", so days are what the function returns.
    expect(daysRemoved(80, 72)).toBe(8);
  });
});
