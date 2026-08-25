/**
 * Baseline DSO computation (TRK-013).
 *
 * Days sales outstanding is the one number this product is sold on, and the
 * only way to prove a reduction is to have frozen the starting figure before
 * anything changed. This module derives that figure; storing it is the
 * caller's job.
 *
 * Not a pricing calculation (INV-3). Summing what a customer invoiced in the
 * past to measure how fast they got paid derives no rate, margin, or price,
 * and nothing here feeds an amount Trayek bills. The amounts involved are
 * imported history, deliberately kept apart from `Order.nilaiTagihan`.
 */

/**
 * CLAUDE.md: DSO arithmetic uses calendar days in Asia/Jakarta.
 *
 * Elapsed milliseconds divided by 86,400,000 is the tempting version and it is
 * wrong: an invoice issued at 23:00 and paid at 01:00 two nights later is two
 * calendar days, not one. Jakarta is UTC+7 with no daylight saving, so the
 * whole conversion is one fixed offset.
 */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function jakartaDayNumber(instant: Date): number {
  return Math.floor((instant.getTime() + JAKARTA_OFFSET_MS) / MS_PER_DAY);
}

/** Whole calendar days from `from` to `to`, counted in Asia/Jakarta. */
export function calendarDaysBetween(from: Date, to: Date): number {
  return jakartaDayNumber(to) - jakartaDayNumber(from);
}

export type HistoricalInvoiceInput = {
  issueDate: Date;
  /** Null when the invoice was still unpaid when the history was captured. */
  paymentDate: Date | null;
  amountRupiah: bigint;
};

export type InvoiceBaseline = {
  dsoDays: number;
  invoiceCount: number;
  periodStart: Date;
  periodEnd: Date;
  invoicedRevenue: bigint;
  /** Invoices excluded, with the reason, so the figure can be defended. */
  excluded: { unpaid: number; negativeDuration: number; zeroAmount: number };
};

export class InsufficientHistoryError extends Error {
  constructor(readonly usableCount: number) {
    super(
      `Baseline needs at least one paid invoice with a positive amount; got ${usableCount}.`,
    );
    this.name = "InsufficientHistoryError";
  }
}

/**
 * Average collection period, weighted by invoice amount.
 *
 * Weighted rather than a plain mean, because a forwarder's DSO is dominated by
 * its large invoices. An unweighted mean lets fifty tiny fast-paying invoices
 * hide one enormous slow one, which is exactly the money the product exists to
 * chase.
 *
 * Unpaid invoices are excluded, not treated as paid today: including them
 * would make the baseline depend on when it happened to be captured.
 */
export function computeDsoFromInvoices(
  invoices: readonly HistoricalInvoiceInput[],
): InvoiceBaseline {
  const excluded = { unpaid: 0, negativeDuration: 0, zeroAmount: 0 };

  let weightedDays = 0n;
  let totalAmount = 0n;
  let usableCount = 0;
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;

  for (const invoice of invoices) {
    if (invoice.paymentDate === null) {
      excluded.unpaid += 1;
      continue;
    }

    if (invoice.amountRupiah <= 0n) {
      excluded.zeroAmount += 1;
      continue;
    }

    const days = calendarDaysBetween(invoice.issueDate, invoice.paymentDate);

    // Paid before issued is a data error, not a zero-day collection.
    if (days < 0) {
      excluded.negativeDuration += 1;
      continue;
    }

    weightedDays += invoice.amountRupiah * BigInt(days);
    totalAmount += invoice.amountRupiah;
    usableCount += 1;

    if (periodStart === null || invoice.issueDate < periodStart) {
      periodStart = invoice.issueDate;
    }
    if (periodEnd === null || invoice.issueDate > periodEnd) {
      periodEnd = invoice.issueDate;
    }
  }

  if (usableCount === 0 || totalAmount === 0n || !periodStart || !periodEnd) {
    throw new InsufficientHistoryError(usableCount);
  }

  return {
    // Rounded to whole days: the claim is stated in days, and the inputs are
    // stored alongside so the exact figure can be re-derived.
    dsoDays: Number(roundedDivide(weightedDays, totalAmount)),
    invoiceCount: usableCount,
    periodStart,
    periodEnd,
    invoicedRevenue: totalAmount,
    excluded,
  };
}

/** BigInt division truncates; this rounds half away from zero instead. */
function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export type BalanceInputs = {
  /** Whole rupiah invoiced across the period. */
  invoicedRevenue: bigint;
  /** Whole rupiah, the average receivable balance over the same period. */
  averageReceivable: bigint;
  periodStart: Date;
  periodEnd: Date;
};

export class InvalidBalanceInputsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBalanceInputsError";
  }
}

/**
 * The textbook figure: receivables divided by revenue, times the days in the
 * period.
 *
 * Kept alongside the invoice-derived version because most owners can produce
 * two numbers off their trial balance long before they can export a year of
 * invoices, and a baseline captured on day one is worth more than a better one
 * captured in month three.
 */
export function computeDsoFromBalances(inputs: BalanceInputs): number {
  if (inputs.invoicedRevenue <= 0n) {
    throw new InvalidBalanceInputsError(
      "Invoiced revenue must be greater than zero.",
    );
  }

  if (inputs.averageReceivable < 0n) {
    throw new InvalidBalanceInputsError(
      "Average receivable cannot be negative.",
    );
  }

  // Inclusive of both endpoints: a period of 1 January to 30 June is 181 days,
  // not 180. Understating the period would flatter every baseline.
  const days = calendarDaysBetween(inputs.periodStart, inputs.periodEnd) + 1;

  if (days <= 0) {
    throw new InvalidBalanceInputsError("Period end precedes period start.");
  }

  return Number(
    roundedDivide(
      inputs.averageReceivable * BigInt(days),
      inputs.invoicedRevenue,
    ),
  );
}

/**
 * Days removed, computed against a baseline.
 *
 * Positive means improvement. Deliberately returns the raw difference rather
 * than a percentage: the PRD sells "8 or more days", and a percentage invites
 * the comparison to be re-based later to look better.
 */
export function daysRemoved(baselineDays: number, currentDays: number): number {
  return baselineDays - currentDays;
}
