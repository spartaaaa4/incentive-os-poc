import { addDays, endOfMonth, startOfMonth } from "date-fns";
import {
  AttendanceStatus,
  CalcRunTrigger,
  EmployeeRole,
  PayrollStatus,
  TransactionType,
  Vertical,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  CalculationOutput,
  DailyRollupInput,
  LedgerRowInput,
  runCalculation,
} from "./runCoordinator";

type RecalculateInput = {
  storeCodes: string[];
  periodStart: Date;
  periodEnd: Date;
  trigger?: CalcRunTrigger;
  triggeredByUserId?: string | null;
};

/**
 * Maps product family codes to the slab product-family names they can match.
 * A code can map to multiple slab names (e.g. FJ03 can be "Large Appliances"
 * for non-IFB brands or "Large Washing Machines (LWC)" for IFB).
 * Brand filtering in the slab itself disambiguates.
 */
const familyCodeToSlabNames: Record<string, string[]> = {
  FF01: ["Laptops & Desktops"],
  FF03: ["Tablets"],
  FH01: ["Home Entertainment TVs"],
  FH07: ["Photography"],
  FK01: ["Wireless Phones"],
  FI01: ["SDA & Consumer Appliances"],
  FI02: ["SDA & Consumer Appliances"],
  FI04: ["SDA & Consumer Appliances"],
  FI05: ["SDA & Consumer Appliances"],
  FI06: ["SDA & Consumer Appliances"],
  FI07: ["SDA & Consumer Appliances"],
  FJ01: ["Large Appliances"],
  FJ02: ["Large Appliances"],
  FJ03: ["Large Appliances", "Large Washing Machines (LWC)"],
  FJ04: ["Large Appliances"],
  FJ05: ["Large Appliances"],
};

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value ?? 0);
}

/**
 * Products excluded entirely from Electronics incentives (vendor brief §6.4):
 *  - All Apple products (across all categories)
 *  - OnePlus phones only (FK01) — OnePlus TVs (FH01) earn their own slab
 *  - Microsoft Surface laptops only (FF01)
 */
function isElectronicsExcluded(brand: string | null, familyCode: string | null): boolean {
  const b = (brand ?? "").toLowerCase();
  if (b.includes("apple")) return true;
  if (familyCode === "FK01" && b.includes("oneplus")) return true;
  if (familyCode === "FF01" && b.includes("surface")) return true;
  return false;
}

function brandMatches(brandFilter: string, brand: string | null): boolean {
  if (!brand) return false;
  const normalized = brand.toLowerCase();
  const filter = brandFilter.toLowerCase();
  if (filter.includes("all brands")) {
    if (filter.includes("excl")) {
      if (filter.includes("apple") && normalized.includes("apple")) return false;
      if (filter.includes("surface") && normalized.includes("surface")) return false;
      if (filter.includes("oneplus") && normalized.includes("oneplus")) return false;
      if (filter.includes("mi") && normalized.includes("mi")) return false;
      if (filter.includes("realme") && normalized.includes("realme")) return false;
      if (filter.includes("ifb") && normalized.includes("ifb")) return false;
    }
    return true;
  }
  if (filter.includes("others")) return true;
  return filter
    .split(",")
    .map((value) => value.trim())
    .some((token) => normalized.includes(token));
}

type StoreMetadata = {
  storeCode: string;
  city: string;
  state: string;
  storeName: string;
};

async function storeMetaFor(storeCodes: string[]): Promise<Map<string, StoreMetadata>> {
  if (!storeCodes.length) return new Map();
  const rows = await db.storeMaster.findMany({
    where: { storeCode: { in: storeCodes } },
    select: { storeCode: true, city: true, state: true, storeName: true },
  });
  return new Map(rows.map((r) => [r.storeCode, r]));
}

/**
 * Build per-(store, day) rollup inputs for one vertical from raw sales rows.
 * Used inside each vertical's compute phase so a single run writes both the
 * ledger and the matching daily rollup, tagged with the same run id.
 */
function dailyRollupsFrom(
  rows: Array<{ storeCode: string; vertical: Vertical; transactionDate: Date; grossAmount: unknown; taxAmount: unknown; quantity: number }>,
): DailyRollupInput[] {
  const bucket = new Map<string, DailyRollupInput>();
  for (const row of rows) {
    const dayKey = new Date(Date.UTC(
      row.transactionDate.getUTCFullYear(),
      row.transactionDate.getUTCMonth(),
      row.transactionDate.getUTCDate(),
    ));
    const key = `${row.storeCode}|${row.vertical}|${dayKey.toISOString().slice(0, 10)}`;
    const existing = bucket.get(key);
    const gross = asNumber(row.grossAmount);
    const tax = asNumber(row.taxAmount);
    if (existing) {
      existing.txnCount += 1;
      existing.grossAmount += gross;
      existing.netAmount += gross - tax;
      existing.unitsSold += row.quantity;
    } else {
      bucket.set(key, {
        storeCode: row.storeCode,
        vertical: row.vertical,
        dayKey,
        txnCount: 1,
        grossAmount: gross,
        netAmount: gross - tax,
        unitsSold: row.quantity,
      });
    }
  }
  return [...bucket.values()];
}

// ──────────── Electronics ────────────

async function computeElectronics(input: RecalculateInput): Promise<void> {
  const plan = await db.incentivePlan.findFirst({
    where: { vertical: Vertical.ELECTRONICS, status: "ACTIVE" },
    include: { productIncentiveSlabs: true, achievementMultipliers: true },
  });
  if (!plan) return;

  const storeMeta = await storeMetaFor(input.storeCodes);

  await runCalculation(
    {
      planId: plan.id,
      planVersion: plan.version,
      vertical: Vertical.ELECTRONICS,
      periodStart: startOfMonth(input.periodStart),
      periodEnd: endOfMonth(input.periodEnd),
      scopeStoreCodes: input.storeCodes,
      trigger: input.trigger ?? CalcRunTrigger.MANUAL_RECOMPUTE,
      triggeredByUserId: input.triggeredByUserId ?? null,
    },
    async () => {
      const ledgerRows: LedgerRowInput[] = [];
      const employeeRollups: CalculationOutput["employeeRollups"] = [];
      const storeRollups: CalculationOutput["storeRollups"] = [];
      const dailyRows: Array<{ storeCode: string; vertical: Vertical; transactionDate: Date; grossAmount: unknown; taxAmount: unknown; quantity: number }> = [];

      for (const storeCode of input.storeCodes) {
        const txns = await db.salesTransaction.findMany({
          where: {
            storeCode,
            vertical: Vertical.ELECTRONICS,
            transactionDate: { gte: input.periodStart, lte: input.periodEnd },
            channel: "OFFLINE",
            transactionType: TransactionType.NORMAL,
            employeeId: { not: null },
          },
          include: { employee: true },
        });

        dailyRows.push(...txns);

        const storeEmployees = await db.employeeMaster.findMany({
          where: { storeCode, payrollStatus: PayrollStatus.ACTIVE },
        });
        const employeeDeptMap = new Map<string, string | null>();
        for (const emp of storeEmployees) {
          employeeDeptMap.set(emp.employeeId, emp.department);
        }

        const deptActual = new Map<string, number>();
        const employeeBase = new Map<string, number>();

        for (const txn of txns) {
          if (!txn.employee) continue;
          if (txn.employee.payrollStatus !== PayrollStatus.ACTIVE) continue;
          if (isElectronicsExcluded(txn.brand, txn.productFamilyCode)) continue;
          if (!txn.department || !txn.quantity || !txn.productFamilyCode) continue;

          deptActual.set(txn.department, (deptActual.get(txn.department) ?? 0) + asNumber(txn.grossAmount));
          if (txn.employee.role !== EmployeeRole.SA) continue;

          const unitPrice = asNumber(txn.grossAmount) / txn.quantity;
          const slabNames = familyCodeToSlabNames[txn.productFamilyCode];
          if (!slabNames) continue;

          const matchingSlab = plan.productIncentiveSlabs.find(
            (slab) =>
              slabNames.some((name) => slab.productFamily === name) &&
              brandMatches(slab.brandFilter, txn.brand) &&
              unitPrice >= asNumber(slab.priceFrom) &&
              unitPrice <= asNumber(slab.priceTo),
          );
          if (!matchingSlab) continue;

          const base = asNumber(matchingSlab.incentivePerUnit) * txn.quantity;
          employeeBase.set(txn.employeeId!, (employeeBase.get(txn.employeeId!) ?? 0) + base);
        }

        const targets = await db.target.findMany({
          where: {
            storeCode,
            vertical: Vertical.ELECTRONICS,
            status: "ACTIVE",
            periodStart: { lte: input.periodStart },
            periodEnd: { gte: input.periodEnd },
          },
        });

        const deptTargets = new Map<string, number>();
        for (const target of targets) {
          if (!target.department) continue;
          deptTargets.set(target.department, (deptTargets.get(target.department) ?? 0) + asNumber(target.targetValue));
        }

        const deptAchievement = new Map<string, { target: number; actual: number; achievementPct: number; multiplierPct: number }>();
        const allDepts = new Set([...deptActual.keys(), ...deptTargets.keys()]);
        for (const dept of allDepts) {
          const actual = deptActual.get(dept) ?? 0;
          const target = deptTargets.get(dept) ?? 0;
          const achievementPct = target > 0 ? (actual / target) * 100 : 0;
          const multiplier =
            plan.achievementMultipliers.find(
              (item) =>
                achievementPct >= asNumber(item.achievementFrom) &&
                achievementPct <= asNumber(item.achievementTo),
            )?.multiplierPct ?? 0;
          deptAchievement.set(dept, {
            target,
            actual,
            achievementPct,
            multiplierPct: asNumber(multiplier),
          });
        }

        const periodStart = startOfMonth(input.periodStart);
        const periodEnd = endOfMonth(input.periodEnd);

        let storeTotalIncentive = 0;
        let earningCount = 0;
        let storeTargetSum = 0;
        let storeActualSum = 0;
        for (const [, info] of deptAchievement) {
          storeTargetSum += info.target;
          storeActualSum += info.actual;
        }
        const storeAchievementPct = storeTargetSum > 0 ? (storeActualSum / storeTargetSum) * 100 : 0;

        for (const emp of storeEmployees) {
          const employeeId = emp.employeeId;
          const empDept = employeeDeptMap.get(employeeId);
          const base = employeeBase.get(employeeId) ?? 0;
          const deptInfo = empDept ? deptAchievement.get(empDept) : undefined;
          const multiplierPct = deptInfo?.multiplierPct ?? 0;
          const achievementPct = deptInfo?.achievementPct ?? 0;
          const finalIncentive = base * (multiplierPct / 100);
          if (finalIncentive > 0) earningCount += 1;
          storeTotalIncentive += finalIncentive;

          // Potential = base × top multiplier tier, gives "at 100%+" target signal
          const topMultiplier = Math.max(
            0,
            ...plan.achievementMultipliers.map((m) => asNumber(m.multiplierPct)),
          );

          ledgerRows.push({
            planId: plan.id,
            employeeId,
            storeCode,
            vertical: Vertical.ELECTRONICS,
            periodStart,
            periodEnd,
            baseIncentive: base,
            multiplierApplied: multiplierPct,
            achievementPct,
            finalIncentive,
            calculationDetails: {
              employeeDepartment: empDept,
              departmentTarget: deptInfo?.target ?? 0,
              departmentActual: deptInfo?.actual ?? 0,
              departments: Object.fromEntries(deptAchievement),
            },
          });

          employeeRollups.push({
            employeeId,
            planId: plan.id,
            storeCode,
            vertical: Vertical.ELECTRONICS,
            periodStart,
            periodEnd,
            earned: finalIncentive,
            eligible: base,
            potential: base * (topMultiplier / 100),
            achievementPct,
            multiplierApplied: multiplierPct,
          });
        }

        const meta = storeMeta.get(storeCode);
        if (meta) {
          storeRollups.push({
            storeCode,
            planId: plan.id,
            vertical: Vertical.ELECTRONICS,
            city: meta.city,
            state: meta.state,
            periodStart,
            periodEnd,
            targetValue: storeTargetSum,
            actualSales: storeActualSum,
            achievementPct: Math.round(storeAchievementPct * 100) / 100,
            totalIncentive: storeTotalIncentive,
            employeeCount: storeEmployees.length,
            earningCount,
          });
        }
      }

      return {
        ledgerRows,
        employeeRollups,
        storeRollups,
        dailyRollups: dailyRollupsFrom(dailyRows),
      };
    },
  );
}

// ──────────── Grocery ────────────

async function computeGrocery(input: RecalculateInput): Promise<void> {
  const campaigns = await db.campaignConfig.findMany({
    where: {
      status: "ACTIVE",
      plan: { vertical: Vertical.GROCERY },
      startDate: { lte: input.periodEnd },
      endDate: { gte: input.periodStart },
      storeTargets: { some: { storeCode: { in: input.storeCodes } } },
    },
    include: { payoutSlabs: true, articles: true, storeTargets: true, plan: true },
  });

  const storeMeta = await storeMetaFor(input.storeCodes);

  for (const campaign of campaigns) {
    await runCalculation(
      {
        planId: campaign.planId,
        planVersion: campaign.plan.version,
        vertical: Vertical.GROCERY,
        periodStart: campaign.startDate,
        periodEnd: campaign.endDate,
        scopeStoreCodes: input.storeCodes,
        trigger: input.trigger ?? CalcRunTrigger.MANUAL_RECOMPUTE,
        triggeredByUserId: input.triggeredByUserId ?? null,
      },
      async () => {
        const ledgerRows: LedgerRowInput[] = [];
        const employeeRollups: CalculationOutput["employeeRollups"] = [];
        const storeRollups: CalculationOutput["storeRollups"] = [];

        const articleSet = new Set(campaign.articles.map((item) => item.articleCode));
        const sortedSlabs = [...campaign.payoutSlabs].sort(
          (a, b) => asNumber(b.achievementFrom) - asNumber(a.achievementFrom),
        );

        const relevantStoreCodes = campaign.storeTargets
          .filter((st) => input.storeCodes.includes(st.storeCode))
          .map((st) => st.storeCode);

        const [allCampaignSales, allCampaignEmployees] = await Promise.all([
          db.salesTransaction.findMany({
            where: {
              storeCode: { in: relevantStoreCodes },
              vertical: Vertical.GROCERY,
              channel: "OFFLINE",
              transactionDate: { gte: campaign.startDate, lte: campaign.endDate },
            },
          }),
          db.employeeMaster.findMany({
            where: {
              storeCode: { in: relevantStoreCodes },
              payrollStatus: PayrollStatus.ACTIVE,
              role: { in: [EmployeeRole.SM, EmployeeRole.DM, EmployeeRole.SA, EmployeeRole.BA] },
            },
          }),
        ]);

        const salesByStore = new Map<string, typeof allCampaignSales>();
        for (const s of allCampaignSales) {
          const list = salesByStore.get(s.storeCode) ?? [];
          list.push(s);
          salesByStore.set(s.storeCode, list);
        }
        const empsByStore = new Map<string, typeof allCampaignEmployees>();
        for (const e of allCampaignEmployees) {
          const list = empsByStore.get(e.storeCode) ?? [];
          list.push(e);
          empsByStore.set(e.storeCode, list);
        }

        for (const storeTarget of campaign.storeTargets) {
          if (!input.storeCodes.includes(storeTarget.storeCode)) continue;
          const sales = salesByStore.get(storeTarget.storeCode) ?? [];
          const eligibleSales = sales.filter((sale) => articleSet.has(sale.articleCode));
          const totalSalesValue = eligibleSales.reduce((sum, sale) => sum + asNumber(sale.grossAmount), 0);
          const totalPieces = eligibleSales.reduce((sum, sale) => sum + sale.quantity, 0);
          const achievementPct = (totalSalesValue / asNumber(storeTarget.targetValue)) * 100;
          const matched = sortedSlabs.find((slab) => achievementPct >= asNumber(slab.achievementFrom));
          const rate = achievementPct >= 100 ? asNumber(matched?.perPieceRate ?? 0) : 0;
          const totalIncentive = rate * totalPieces;
          const topRate = asNumber(sortedSlabs[0]?.perPieceRate ?? 0);
          const potentialIncentive = topRate * totalPieces;

          const employees = empsByStore.get(storeTarget.storeCode) ?? [];
          if (!employees.length) continue;
          const individualPayout = totalIncentive / employees.length;
          const individualPotential = potentialIncentive / employees.length;

          const targetVal = asNumber(storeTarget.targetValue);

          for (const employee of employees) {
            ledgerRows.push({
              planId: campaign.planId,
              campaignId: campaign.id,
              employeeId: employee.employeeId,
              storeCode: employee.storeCode,
              vertical: Vertical.GROCERY,
              periodStart: campaign.startDate,
              periodEnd: campaign.endDate,
              baseIncentive: totalIncentive,
              achievementPct,
              finalIncentive: individualPayout,
              calculationDetails: {
                totalPieces,
                rate,
                employeeCount: employees.length,
                targetValue: targetVal,
                actualSales: totalSalesValue,
              },
            });

            employeeRollups.push({
              employeeId: employee.employeeId,
              planId: campaign.planId,
              storeCode: employee.storeCode,
              vertical: Vertical.GROCERY,
              periodStart: campaign.startDate,
              periodEnd: campaign.endDate,
              earned: individualPayout,
              eligible: individualPayout,
              potential: individualPotential,
              achievementPct,
              multiplierApplied: null,
            });
          }

          const meta = storeMeta.get(storeTarget.storeCode);
          if (meta) {
            storeRollups.push({
              storeCode: storeTarget.storeCode,
              planId: campaign.planId,
              vertical: Vertical.GROCERY,
              city: meta.city,
              state: meta.state,
              periodStart: campaign.startDate,
              periodEnd: campaign.endDate,
              targetValue: targetVal,
              actualSales: totalSalesValue,
              achievementPct: Math.round(achievementPct * 100) / 100,
              totalIncentive,
              employeeCount: employees.length,
              earningCount: totalIncentive > 0 ? employees.length : 0,
            });
          }
        }

        return {
          ledgerRows,
          employeeRollups,
          storeRollups,
          dailyRollups: dailyRollupsFrom(allCampaignSales),
        };
      },
    );
  }
}

// ──────────── F&L ────────────

async function computeFnL(input: RecalculateInput): Promise<void> {
  const plan = await db.incentivePlan.findFirst({
    where: { vertical: Vertical.FNL, status: "ACTIVE" },
    include: { fnlRoleSplits: true },
  });
  if (!plan) return;

  const fnlTargets = await db.target.findMany({
    where: {
      vertical: Vertical.FNL,
      status: "ACTIVE",
      storeCode: { in: input.storeCodes },
      periodType: "WEEKLY",
      periodStart: { gte: input.periodStart, lte: input.periodEnd },
    },
  });

  const storeMeta = await storeMetaFor(input.storeCodes);

  // Group targets by week so one run covers one week × all scope stores.
  type WeekKey = string;
  const targetsByWeek = new Map<WeekKey, typeof fnlTargets>();
  for (const t of fnlTargets) {
    const key = `${t.periodStart.toISOString().slice(0, 10)}|${t.periodEnd.toISOString().slice(0, 10)}`;
    const list = targetsByWeek.get(key) ?? [];
    list.push(t);
    targetsByWeek.set(key, list);
  }

  for (const [, weekTargets] of targetsByWeek) {
    const weekStart = weekTargets[0].periodStart;
    const weekEnd = weekTargets[0].periodEnd;

    await runCalculation(
      {
        planId: plan.id,
        planVersion: plan.version,
        vertical: Vertical.FNL,
        periodStart: weekStart,
        periodEnd: weekEnd,
        scopeStoreCodes: weekTargets.map((t) => t.storeCode),
        trigger: input.trigger ?? CalcRunTrigger.MANUAL_RECOMPUTE,
        triggeredByUserId: input.triggeredByUserId ?? null,
      },
      async () => {
        const ledgerRows: LedgerRowInput[] = [];
        const employeeRollups: CalculationOutput["employeeRollups"] = [];
        const storeRollups: CalculationOutput["storeRollups"] = [];
        const allWeekTxns: Array<{ storeCode: string; vertical: Vertical; transactionDate: Date; grossAmount: unknown; taxAmount: unknown; quantity: number }> = [];

        for (const target of weekTargets) {
          const salesAggregate = await db.salesTransaction.aggregate({
            _sum: { grossAmount: true },
            where: {
              storeCode: target.storeCode,
              vertical: Vertical.FNL,
              transactionDate: { gte: target.periodStart, lte: target.periodEnd },
            },
          });
          const actualSales = asNumber(salesAggregate._sum.grossAmount);
          const targetValue = asNumber(target.targetValue);
          const achievementPct = targetValue > 0 ? (actualSales / targetValue) * 100 : 0;

          // Always pull the weekly txns for the daily rollup, even if the store
          // didn't exceed target — the dashboard still needs to see daily sales.
          const weekTxns = await db.salesTransaction.findMany({
            where: {
              storeCode: target.storeCode,
              vertical: Vertical.FNL,
              transactionDate: { gte: target.periodStart, lte: target.periodEnd },
            },
            select: { storeCode: true, vertical: true, transactionDate: true, grossAmount: true, taxAmount: true, quantity: true },
          });
          allWeekTxns.push(...weekTxns);

          const allEmployees = await db.employeeMaster.findMany({
            where: { storeCode: target.storeCode },
          });
          const activeEmployees = allEmployees.filter((e) => {
            if (
              e.payrollStatus !== PayrollStatus.ACTIVE &&
              e.payrollStatus !== PayrollStatus.NOTICE_PERIOD &&
              e.payrollStatus !== PayrollStatus.DISCIPLINARY_ACTION
            ) return false;
            if (e.dateOfJoining > target.periodEnd) return false;
            if (e.dateOfExit && e.dateOfExit < target.periodStart) return false;
            return true;
          });
          const smCount = activeEmployees.filter((employee) => employee.role === EmployeeRole.SM).length;
          const dmCount = activeEmployees.filter((employee) => employee.role === EmployeeRole.DM).length;
          const split = plan.fnlRoleSplits.find((row) => row.numSms === smCount && row.numDms === dmCount);

          const meta = storeMeta.get(target.storeCode);
          const hasExceeded = actualSales > targetValue && !!split;

          if (!hasExceeded) {
            // Still emit zero-payout rollup so the dashboard shows "didn't qualify"
            if (meta) {
              storeRollups.push({
                storeCode: target.storeCode,
                planId: plan.id,
                vertical: Vertical.FNL,
                city: meta.city,
                state: meta.state,
                periodStart: target.periodStart,
                periodEnd: target.periodEnd,
                targetValue,
                actualSales,
                achievementPct: Math.round(achievementPct * 100) / 100,
                totalIncentive: 0,
                employeeCount: activeEmployees.length,
                earningCount: 0,
              });
            }
            continue;
          }

          const planConfig = (plan.config ?? {}) as Record<string, unknown>;
          const poolPct = asNumber(planConfig.poolPct ?? 1) / 100;
          const storeIncentive = actualSales * poolPct;

          const disbursableEmployees = activeEmployees.filter((e) => e.payrollStatus === PayrollStatus.ACTIVE);
          const saEmployees = disbursableEmployees.filter((employee) => employee.role === EmployeeRole.SA);
          const saIds = saEmployees.map((e) => e.employeeId);
          const allAttendance = saIds.length
            ? await db.attendance.findMany({
                where: {
                  employeeId: { in: saIds },
                  date: { gte: target.periodStart, lte: target.periodEnd },
                },
              })
            : [];
          const attendanceByEmp = new Map<string, typeof allAttendance>();
          for (const a of allAttendance) {
            const list = attendanceByEmp.get(a.employeeId) ?? [];
            list.push(a);
            attendanceByEmp.set(a.employeeId, list);
          }
          const eligibleSAs: string[] = [];
          for (const employee of saEmployees) {
            const weekAttendance = attendanceByEmp.get(employee.employeeId) ?? [];
            const presentDays = weekAttendance.filter((day) => day.status === AttendanceStatus.PRESENT).length;
            if (presentDays >= 5) eligibleSAs.push(employee.employeeId);
          }

          const saPool = storeIncentive * (asNumber(split!.saPoolPct) / 100);
          const eachSaPayout = eligibleSAs.length ? saPool / eligibleSAs.length : 0;
          const smPayout = storeIncentive * (asNumber(split!.smSharePct) / 100);
          const dmPayout = storeIncentive * (asNumber(split!.dmSharePerDmPct) / 100);

          let storeEarningCount = 0;
          let storeTotalIncentive = 0;
          for (const employee of disbursableEmployees) {
            let amount = 0;
            if (employee.role === EmployeeRole.SA && eligibleSAs.includes(employee.employeeId)) amount = eachSaPayout;
            if (employee.role === EmployeeRole.SM) amount = smPayout;
            if (employee.role === EmployeeRole.DM) amount = dmPayout;
            if (amount <= 0) continue;

            storeTotalIncentive += amount;
            storeEarningCount += 1;

            ledgerRows.push({
              planId: plan.id,
              employeeId: employee.employeeId,
              storeCode: target.storeCode,
              vertical: Vertical.FNL,
              periodStart: target.periodStart,
              periodEnd: target.periodEnd,
              baseIncentive: storeIncentive,
              finalIncentive: amount,
              achievementPct,
              calculationDetails: { actualSales, targetValue, eligibleSAs: eligibleSAs.length },
            });

            employeeRollups.push({
              employeeId: employee.employeeId,
              planId: plan.id,
              storeCode: target.storeCode,
              vertical: Vertical.FNL,
              periodStart: target.periodStart,
              periodEnd: target.periodEnd,
              earned: amount,
              eligible: amount,
              potential: amount,
              achievementPct,
              multiplierApplied: null,
            });
          }

          if (meta) {
            storeRollups.push({
              storeCode: target.storeCode,
              planId: plan.id,
              vertical: Vertical.FNL,
              city: meta.city,
              state: meta.state,
              periodStart: target.periodStart,
              periodEnd: target.periodEnd,
              targetValue,
              actualSales,
              achievementPct: Math.round(achievementPct * 100) / 100,
              totalIncentive: storeTotalIncentive,
              employeeCount: activeEmployees.length,
              earningCount: storeEarningCount,
            });
          }
        }

        return {
          ledgerRows,
          employeeRollups,
          storeRollups,
          dailyRollups: dailyRollupsFrom(allWeekTxns),
        };
      },
    );
  }
}

// ──────────── Public API ────────────

export async function recalculateIncentives(input: RecalculateInput) {
  await computeElectronics(input);
  await computeGrocery(input);
  await computeFnL(input);
}

export async function recalculateStoreMonth(
  storeCode: string,
  monthDate: Date,
  opts?: { trigger?: CalcRunTrigger; triggeredByUserId?: string | null },
) {
  await recalculateIncentives({
    storeCodes: [storeCode],
    periodStart: startOfMonth(monthDate),
    periodEnd: endOfMonth(monthDate),
    trigger: opts?.trigger,
    triggeredByUserId: opts?.triggeredByUserId ?? null,
  });
}

export async function recalculateByDateSpan(
  storeCodes: string[],
  start: Date,
  end: Date,
  opts?: { trigger?: CalcRunTrigger; triggeredByUserId?: string | null },
) {
  await recalculateIncentives({
    storeCodes,
    periodStart: start,
    periodEnd: addDays(end, 0),
    trigger: opts?.trigger,
    triggeredByUserId: opts?.triggeredByUserId ?? null,
  });
}
