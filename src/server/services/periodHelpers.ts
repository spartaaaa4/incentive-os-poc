import { Vertical } from "@prisma/client";
import { addDays, addMonths, differenceInCalendarDays, isAfter, isBefore, startOfDay } from "date-fns";

/**
 * Resolve the authoritative payout date for a ledger row.
 *
 * - ELECTRONICS / GROCERY: paid on the 7th of the month following `periodEnd`.
 * - FNL (weekly pool): paid the Friday after the week ends.
 *
 * The rule is a product convention — if it changes, update here.
 */
export function payoutDateFor(vertical: Vertical, periodEnd: Date): string {
  if (vertical === "FNL") {
    // Find next Friday after periodEnd (5 = Friday, date-fns uses 0=Sun..6=Sat)
    let d = addDays(periodEnd, 1);
    while (d.getDay() !== 5) d = addDays(d, 1);
    return d.toISOString().slice(0, 10);
  }
  const next = addMonths(periodEnd, 1);
  const seventh = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 7));
  return seventh.toISOString().slice(0, 10);
}

/**
 * Working-day math for a period. Treats Sunday as weekly off (Reliance retail
 * stores open 6 days/week). `today` is clamped within [periodStart, periodEnd].
 */
export function workingDaysInPeriod(periodStart: Date, periodEnd: Date, today: Date = new Date()) {
  const start = startOfDay(periodStart);
  const end = startOfDay(periodEnd);
  const now = startOfDay(today);

  let total = 0;
  let elapsed = 0;
  for (let d = new Date(start); !isAfter(d, end); d = addDays(d, 1)) {
    if (d.getDay() !== 0) total += 1;
    if (!isAfter(d, now) && d.getDay() !== 0) elapsed += 1;
  }
  const current = isBefore(now, start) ? 0 : Math.min(elapsed, total);
  const daysLeft = Math.max(0, total - current);
  const calendarDaysLeft = Math.max(0, differenceInCalendarDays(end, now));

  return { current, total, daysLeft, calendarDaysLeft };
}

/**
 * Simple per-day run-rate projection. Null-safe.
 */
export function runRateFor(opts: { actual: number; target: number; daysElapsed: number; daysTotal: number }) {
  const { actual, target, daysElapsed, daysTotal } = opts;
  if (daysElapsed <= 0) return { perDay: 0, projected: 0, projectedPct: 0 };
  const perDay = actual / daysElapsed;
  const projected = perDay * daysTotal;
  const projectedPct = target > 0 ? Math.round((projected / target) * 1000) / 10 : 0;
  return {
    perDay: Math.round(perDay),
    projected: Math.round(projected),
    projectedPct,
  };
}
