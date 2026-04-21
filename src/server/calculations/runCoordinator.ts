import {
  CalcRunStatus,
  CalcRunTrigger,
  Prisma,
  Vertical,
} from "@prisma/client";
import { db } from "@/lib/db";

export type LedgerRowInput = {
  planId: number;
  campaignId?: number | null;
  employeeId: string;
  storeCode: string;
  vertical: Vertical;
  periodStart: Date;
  periodEnd: Date;
  baseIncentive: number;
  multiplierApplied?: number | null;
  achievementPct?: number | null;
  finalIncentive: number;
  calculationDetails?: Prisma.InputJsonValue | null;
};

export type EmployeeRollupInput = {
  employeeId: string;
  planId: number;
  storeCode: string;
  vertical: Vertical;
  periodStart: Date;
  periodEnd: Date;
  earned: number;
  eligible: number;
  potential: number;
  achievementPct?: number | null;
  multiplierApplied?: number | null;
};

export type StoreRollupInput = {
  storeCode: string;
  planId: number;
  vertical: Vertical;
  city: string;
  state: string;
  periodStart: Date;
  periodEnd: Date;
  targetValue: number;
  actualSales: number;
  achievementPct: number;
  totalIncentive: number;
  employeeCount: number;
  earningCount: number;
};

export type DailyRollupInput = {
  storeCode: string;
  vertical: Vertical;
  dayKey: Date;
  txnCount: number;
  grossAmount: number;
  netAmount: number;
  unitsSold: number;
};

export type CalculationOutput = {
  ledgerRows: LedgerRowInput[];
  employeeRollups: EmployeeRollupInput[];
  storeRollups: StoreRollupInput[];
  dailyRollups: DailyRollupInput[];
};

type RunSpec = {
  planId: number;
  planVersion: number;
  vertical: Vertical;
  periodStart: Date;
  periodEnd: Date;
  scopeStoreCodes: string[];
  trigger: CalcRunTrigger;
  triggeredByUserId?: string | null;
};

/**
 * Execute a calculation inside the run-versioning wrapper.
 *
 * Lifecycle:
 *   1. Create CalculationRun with status=RUNNING, is_current=false.
 *   2. Invoke `compute(runId)` to produce ledger + rollup rows. The compute
 *      function reads from the DB but must NOT write ledger/rollup rows —
 *      the coordinator owns writes to keep the atomic swap correct.
 *   3. In a single transaction: insert new ledger rows, upsert rollups with
 *      this run's id, flip any prior is_current run for the same
 *      (plan, period) to SUPERSEDED, mark this run is_current=true +
 *      status=SUCCEEDED.
 *   4. On error: run status becomes FAILED; no is_current flip occurs so
 *      the previous run remains authoritative.
 *
 * Reads (mobile, dashboard, leaderboard) go through `current_incentive_ledger`
 * view or by filtering to `calculation_run.is_current = true`, so a failed
 * recompute never blanks the app.
 */
export async function runCalculation(
  spec: RunSpec,
  compute: (runId: string) => Promise<CalculationOutput>,
): Promise<{ runId: string; rowsWritten: number }> {
  const run = await db.calculationRun.create({
    data: {
      planId: spec.planId,
      planVersion: spec.planVersion,
      vertical: spec.vertical,
      periodStart: spec.periodStart,
      periodEnd: spec.periodEnd,
      scopeStoreCodes: spec.scopeStoreCodes,
      trigger: spec.trigger,
      triggeredByUserId: spec.triggeredByUserId ?? null,
      status: CalcRunStatus.RUNNING,
      isCurrent: false,
    },
  });

  try {
    const output = await compute(run.id);

    const rowsWritten = await db.$transaction(async (tx) => {
      if (output.ledgerRows.length) {
        await tx.incentiveLedger.createMany({
          data: output.ledgerRows.map((row) => ({
            planId: row.planId,
            campaignId: row.campaignId ?? null,
            calculationRunId: run.id,
            employeeId: row.employeeId,
            storeCode: row.storeCode,
            vertical: row.vertical,
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            baseIncentive: row.baseIncentive,
            multiplierApplied: row.multiplierApplied ?? null,
            achievementPct: row.achievementPct ?? null,
            finalIncentive: row.finalIncentive,
            calculationDetails: row.calculationDetails ?? Prisma.JsonNull,
            calculationStatus: "FINAL",
          })),
        });
      }

      for (const er of output.employeeRollups) {
        await tx.employeePeriodRollup.upsert({
          where: {
            employeeId_planId_periodStart: {
              employeeId: er.employeeId,
              planId: er.planId,
              periodStart: er.periodStart,
            },
          },
          create: {
            employeeId: er.employeeId,
            planId: er.planId,
            storeCode: er.storeCode,
            vertical: er.vertical,
            periodStart: er.periodStart,
            periodEnd: er.periodEnd,
            earned: er.earned,
            eligible: er.eligible,
            potential: er.potential,
            paid: 0,
            achievementPct: er.achievementPct ?? null,
            multiplierApplied: er.multiplierApplied ?? null,
            lastRunId: run.id,
          },
          update: {
            storeCode: er.storeCode,
            vertical: er.vertical,
            periodEnd: er.periodEnd,
            earned: er.earned,
            eligible: er.eligible,
            potential: er.potential,
            achievementPct: er.achievementPct ?? null,
            multiplierApplied: er.multiplierApplied ?? null,
            lastRunId: run.id,
          },
        });
      }

      for (const sr of output.storeRollups) {
        await tx.storePeriodRollup.upsert({
          where: {
            storeCode_planId_periodStart: {
              storeCode: sr.storeCode,
              planId: sr.planId,
              periodStart: sr.periodStart,
            },
          },
          create: {
            storeCode: sr.storeCode,
            planId: sr.planId,
            vertical: sr.vertical,
            city: sr.city,
            state: sr.state,
            periodStart: sr.periodStart,
            periodEnd: sr.periodEnd,
            targetValue: sr.targetValue,
            actualSales: sr.actualSales,
            achievementPct: sr.achievementPct,
            totalIncentive: sr.totalIncentive,
            employeeCount: sr.employeeCount,
            earningCount: sr.earningCount,
            lastRunId: run.id,
          },
          update: {
            vertical: sr.vertical,
            city: sr.city,
            state: sr.state,
            periodEnd: sr.periodEnd,
            targetValue: sr.targetValue,
            actualSales: sr.actualSales,
            achievementPct: sr.achievementPct,
            totalIncentive: sr.totalIncentive,
            employeeCount: sr.employeeCount,
            earningCount: sr.earningCount,
            lastRunId: run.id,
          },
        });
      }

      for (const dr of output.dailyRollups) {
        await tx.storeDailyRollup.upsert({
          where: {
            storeCode_vertical_dayKey: {
              storeCode: dr.storeCode,
              vertical: dr.vertical,
              dayKey: dr.dayKey,
            },
          },
          create: {
            storeCode: dr.storeCode,
            vertical: dr.vertical,
            dayKey: dr.dayKey,
            txnCount: dr.txnCount,
            grossAmount: dr.grossAmount,
            netAmount: dr.netAmount,
            unitsSold: dr.unitsSold,
            lastRunId: run.id,
          },
          update: {
            txnCount: dr.txnCount,
            grossAmount: dr.grossAmount,
            netAmount: dr.netAmount,
            unitsSold: dr.unitsSold,
            lastRunId: run.id,
          },
        });
      }

      // Atomic swap: supersede any prior current run for this (plan, period).
      await tx.calculationRun.updateMany({
        where: {
          planId: spec.planId,
          periodStart: spec.periodStart,
          periodEnd: spec.periodEnd,
          isCurrent: true,
          id: { not: run.id },
        },
        data: { isCurrent: false, status: CalcRunStatus.SUPERSEDED },
      });

      await tx.calculationRun.update({
        where: { id: run.id },
        data: {
          status: CalcRunStatus.SUCCEEDED,
          isCurrent: true,
          completedAt: new Date(),
          ledgerRowCount: output.ledgerRows.length,
        },
      });

      // Post-success: recompute rankInCity across all currently-active stores
      // for this (vertical, city, periodStart) combination. Cheap because the
      // rollup table is already small (≤ tens of thousands of rows per period).
      await recomputeStoreRanks(tx, spec.vertical, spec.periodStart);

      return output.ledgerRows.length;
    });

    return { runId: run.id, rowsWritten };
  } catch (error) {
    await db.calculationRun.update({
      where: { id: run.id },
      data: {
        status: CalcRunStatus.FAILED,
        completedAt: new Date(),
        errorMessage:
          error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
      },
    });
    throw error;
  }
}

/**
 * Re-rank stores within a (vertical, city, periodStart) after a run completes.
 * Standard competition ranking: tied achievement percentages share the higher
 * rank; the next store's rank skips accordingly.
 */
async function recomputeStoreRanks(
  tx: Prisma.TransactionClient,
  vertical: Vertical,
  periodStart: Date,
): Promise<void> {
  const rows = await tx.storePeriodRollup.findMany({
    where: { vertical, periodStart },
    select: { id: true, city: true, achievementPct: true },
    orderBy: [{ city: "asc" }, { achievementPct: "desc" }],
  });

  const byCity = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCity.get(row.city) ?? [];
    list.push(row);
    byCity.set(row.city, list);
  }

  for (const list of byCity.values()) {
    let i = 0;
    while (i < list.length) {
      const tierValue = Number(list[i].achievementPct);
      const rank = i + 1;
      let j = i;
      while (j < list.length && Number(list[j].achievementPct) === tierValue) {
        await tx.storePeriodRollup.update({
          where: { id: list[j].id },
          data: { rankInCity: rank },
        });
        j++;
      }
      i = j;
    }
  }
}
