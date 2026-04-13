import { addDays, endOfMonth, startOfMonth } from "date-fns";
import {
  AttendanceStatus,
  EmployeeRole,
  PayrollStatus,
  TransactionType,
  Vertical,
} from "@prisma/client";
import { db } from "@/lib/db";

type RecalculateInput = {
  storeCodes: string[];
  periodStart: Date;
  periodEnd: Date;
};

const familyCodeToName: Record<string, string> = {
  FF01: "Laptops & Desktops",
  FF03: "Tablets",
  FH07: "Photography",
  FK01: "Wireless Phones",
  FH01: "Home Entertainment TVs",
  FJ03: "Large Appliances",
};

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value ?? 0);
}

function isElectronicsExcluded(brand: string | null, familyCode: string | null): boolean {
  const normalizedBrand = (brand ?? "").toLowerCase();
  if (normalizedBrand.includes("apple")) return true;
  if (familyCode === "FK01" && normalizedBrand.includes("oneplus")) return true;
  if (familyCode === "FF01" && normalizedBrand.includes("surface")) return true;
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

async function calculateElectronics(input: RecalculateInput) {
  const plan = await db.incentivePlan.findFirst({
    where: { vertical: Vertical.ELECTRONICS, status: "ACTIVE" },
    include: { productIncentiveSlabs: true, achievementMultipliers: true },
  });
  if (!plan) return;

  await db.incentiveLedger.deleteMany({
    where: {
      vertical: Vertical.ELECTRONICS,
      planId: plan.id,
      storeCode: { in: input.storeCodes },
      periodStart: { gte: startOfMonth(input.periodStart), lte: endOfMonth(input.periodEnd) },
    },
  });

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

    const deptActual = new Map<string, number>();
    const employeeBase = new Map<string, number>();

    for (const txn of txns) {
      if (!txn.employee) continue;
      if (txn.employee.payrollStatus !== PayrollStatus.ACTIVE) continue;
      if (isElectronicsExcluded(txn.brand, txn.productFamilyCode)) continue;
      if (!txn.department || !txn.quantity || !txn.productFamilyCode) continue;

      // All eligible sales count toward department achievement
      deptActual.set(txn.department, (deptActual.get(txn.department) ?? 0) + asNumber(txn.grossAmount));

      // Only SAs earn per-unit incentive (SM/BA sales → achievement only)
      if (txn.employee.role !== EmployeeRole.SA) continue;

      const unitPrice = asNumber(txn.grossAmount) / txn.quantity;
      const familyName = familyCodeToName[txn.productFamilyCode] ?? txn.productFamilyCode;
      const matchingSlab = plan.productIncentiveSlabs.find(
        (slab) =>
          slab.productFamily.toLowerCase().includes(familyName.toLowerCase().replace(" & ", " ")) &&
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

    // Compute per-department achievement and multiplier
    const deptAchievement = new Map<string, { target: number; actual: number; achievementPct: number; multiplierPct: number }>();
    for (const [dept, actual] of deptActual.entries()) {
      const target = deptTargets.get(dept) ?? 0;
      const achievementPct = target > 0 ? (actual / target) * 100 : 0;
      const multiplier =
        plan.achievementMultipliers.find(
          (item) =>
            achievementPct >= asNumber(item.achievementFrom) &&
            achievementPct <= asNumber(item.achievementTo),
        )?.multiplierPct ?? 0;
      deptAchievement.set(dept, { target, actual, achievementPct, multiplierPct: asNumber(multiplier) });
    }

    // Compute a store-level weighted average multiplier for each SA
    // SA sells across departments; each department has its own multiplier
    // We use the store's overall achievement (total actual / total target) for the multiplier
    const totalStoreTarget = [...deptTargets.values()].reduce((s, v) => s + v, 0);
    const totalStoreActual = [...deptActual.values()].reduce((s, v) => s + v, 0);
    const storeAchievementPct = totalStoreTarget > 0 ? (totalStoreActual / totalStoreTarget) * 100 : 0;
    const storeMultiplier =
      plan.achievementMultipliers.find(
        (item) =>
          storeAchievementPct >= asNumber(item.achievementFrom) &&
          storeAchievementPct <= asNumber(item.achievementTo),
      )?.multiplierPct ?? 0;

    const ledgerRows = [];
    for (const [employeeId, base] of employeeBase.entries()) {
      ledgerRows.push({
        planId: plan.id,
        employeeId,
        storeCode,
        vertical: Vertical.ELECTRONICS,
        periodStart: startOfMonth(input.periodStart),
        periodEnd: endOfMonth(input.periodEnd),
        baseIncentive: base,
        multiplierApplied: asNumber(storeMultiplier),
        achievementPct: storeAchievementPct,
        finalIncentive: base * (asNumber(storeMultiplier) / 100),
        calculationStatus: "FINAL" as const,
        calculationDetails: {
          storeTarget: totalStoreTarget,
          storeActual: totalStoreActual,
          departments: Object.fromEntries(deptAchievement),
        },
      });
    }

    if (ledgerRows.length) {
      await db.incentiveLedger.createMany({ data: ledgerRows });
    }
  }
}

async function calculateGrocery(input: RecalculateInput) {
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

  for (const campaign of campaigns) {
    await db.incentiveLedger.deleteMany({
      where: {
        campaignId: campaign.id,
        vertical: Vertical.GROCERY,
        storeCode: { in: input.storeCodes },
      },
    });

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
          role: { in: [EmployeeRole.SM, EmployeeRole.DM, EmployeeRole.SA] },
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

      const employees = empsByStore.get(storeTarget.storeCode) ?? [];
      if (!employees.length) continue;

      const individualPayout = totalIncentive / employees.length;
      await db.incentiveLedger.createMany({
        data: employees.map((employee) => ({
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
          calculationStatus: "FINAL",
          calculationDetails: { totalPieces, rate, employeeCount: employees.length },
        })),
      });
    }
  }
}

async function calculateFnL(input: RecalculateInput) {
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

  for (const target of fnlTargets) {
    await db.incentiveLedger.deleteMany({
      where: {
        vertical: Vertical.FNL,
        planId: plan.id,
        storeCode: target.storeCode,
        periodStart: target.periodStart,
        periodEnd: target.periodEnd,
      },
    });

    const salesAggregate = await db.salesTransaction.aggregate({
      _sum: { grossAmount: true },
      where: {
        storeCode: target.storeCode,
        vertical: Vertical.FNL,
        transactionDate: { gte: target.periodStart, lte: target.periodEnd },
      },
    });
    const actualSales = asNumber(salesAggregate._sum.grossAmount);
    if (actualSales <= asNumber(target.targetValue)) {
      continue;
    }

    const storeIncentive = actualSales * 0.01;
    const allEmployees = await db.employeeMaster.findMany({
      where: { storeCode: target.storeCode },
    });
    const activeEmployees = allEmployees.filter((e) =>
      e.payrollStatus === PayrollStatus.ACTIVE ||
      e.payrollStatus === PayrollStatus.NOTICE_PERIOD ||
      e.payrollStatus === PayrollStatus.DISCIPLINARY_ACTION
    );
    const smCount = activeEmployees.filter((employee) => employee.role === EmployeeRole.SM).length;
    const dmCount = activeEmployees.filter((employee) => employee.role === EmployeeRole.DM).length;
    const split = plan.fnlRoleSplits.find((row) => row.numSms === smCount && row.numDms === dmCount);
    if (!split) continue;

    // Notice-period/disciplinary excluded at disbursement, not from denominator
    const disbursableEmployees = activeEmployees.filter((e) => e.payrollStatus === PayrollStatus.ACTIVE);

    const eligibleSAs: string[] = [];
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
    for (const employee of saEmployees) {
      const weekAttendance = attendanceByEmp.get(employee.employeeId) ?? [];
      const presentDays = weekAttendance.filter((day) => day.status === AttendanceStatus.PRESENT).length;
      if (presentDays >= 5) {
        eligibleSAs.push(employee.employeeId);
      }
    }

    const saPool = storeIncentive * (asNumber(split.saPoolPct) / 100);
    const eachSaPayout = eligibleSAs.length ? saPool / eligibleSAs.length : 0;
    const smPayout = storeIncentive * (asNumber(split.smSharePct) / 100);
    const dmPayout = storeIncentive * (asNumber(split.dmSharePerDmPct) / 100);

    const payoutRows = [];
    for (const employee of disbursableEmployees) {
      if (employee.role === EmployeeRole.SA && eligibleSAs.includes(employee.employeeId)) {
        payoutRows.push({ employeeId: employee.employeeId, amount: eachSaPayout });
      }
      if (employee.role === EmployeeRole.SM) {
        payoutRows.push({ employeeId: employee.employeeId, amount: smPayout });
      }
      if (employee.role === EmployeeRole.DM) {
        payoutRows.push({ employeeId: employee.employeeId, amount: dmPayout });
      }
    }

    if (!payoutRows.length) continue;

    await db.incentiveLedger.createMany({
      data: payoutRows.map((row) => ({
        planId: plan.id,
        employeeId: row.employeeId,
        storeCode: target.storeCode,
        vertical: Vertical.FNL,
        periodStart: target.periodStart,
        periodEnd: target.periodEnd,
        baseIncentive: storeIncentive,
        finalIncentive: row.amount,
        calculationStatus: "FINAL",
        calculationDetails: { actualSales, targetValue: asNumber(target.targetValue) },
      })),
    });
  }
}

export async function recalculateIncentives(input: RecalculateInput) {
  await calculateElectronics(input);
  await calculateGrocery(input);
  await calculateFnL(input);
}

export async function recalculateStoreMonth(storeCode: string, monthDate: Date) {
  await recalculateIncentives({
    storeCodes: [storeCode],
    periodStart: startOfMonth(monthDate),
    periodEnd: endOfMonth(monthDate),
  });
}

export async function recalculateByDateSpan(storeCodes: string[], start: Date, end: Date) {
  await recalculateIncentives({
    storeCodes,
    periodStart: start,
    periodEnd: addDays(end, 0),
  });
}
