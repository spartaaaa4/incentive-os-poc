import type { Prisma } from "@prisma/client";

/**
 * Filter clause that restricts an `incentive_ledger` read to the "current"
 * answer — rows produced by the most recent successful calculation run for
 * their (plan, period) scope, plus legacy rows written before the
 * CalculationRun model existed (calculation_run_id IS NULL).
 *
 * Compose into a `where` clause with the spread operator:
 *
 *     db.incentiveLedger.findMany({
 *       where: { storeCode, ...currentLedgerWhere() },
 *     })
 *
 * Every read path must use this — raw reads see superseded history and will
 * double-count.
 */
export function currentLedgerWhere(): Prisma.IncentiveLedgerWhereInput {
  return {
    OR: [
      { calculationRun: { is: { isCurrent: true, status: "SUCCEEDED" } } },
      { calculationRunId: null },
    ],
  };
}
