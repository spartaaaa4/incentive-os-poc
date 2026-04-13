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

const disqualifyingAttendanceStatuses = new Set<AttendanceStatus>([
  AttendanceStatus.ABSENT,
  AttendanceStatus.LEAVE_APPROVED,
  AttendanceStatus.LEAVE_UNAPPROVED,
]);

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
    const employeeDeptBase = new Map<string, { employeeId: string; department: string; base: number }>();

    for (const txn of txns) {
      if (!txn.employee || txn.employee.role !== EmployeeRole.SA) continue;
      if (txn.employee.payrollStatus !== PayrollStatus.ACTIVE) continue;
      if (isElectronicsExcluded(txn.brand, txn.productFamilyCode)) continue;
      if (!txn.department || !txn.quantity || !txn.productFamilyCode) continue;

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
      const groupKey = `${txn.employeeId}|${txn.department}`;
      const current = employeeDeptBase.get(groupKey);
      employeeDeptBase.set(groupKey, {
        employeeId: txn.employeeId!,
        department: txn.department,
        base: (current?.base ?? 0) + base,
      });
      deptActual.set(txn.department, (deptActual.get(txn.department) ?? 0) + asNumber(txn.grossAmount));
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

    const ledgerRows = [];
    for (const row of employeeDeptBase.values()) {
      const target = deptTargets.get(row.department) ?? 0;
      const actual = deptActual.get(row.department) ?? 0;
      const achievementPct = target > 0 ? (actual / target) * 100 : 0;
      const multiplier =
        plan.achievementMultipliers.find(
          (item) =>
            achievementPct >= asNumber(item.achievementFrom) &&
            achievementPct <= asNumber(item.achievementTo),
        )?.multiplierPct ?? 0;

      ledgerRows.push({
        planId: plan.id,
        employeeId: row.employeeId,
        storeCode,
        vertical: Vertical.ELECTRONICS,
        periodStart: startOfMonth(input.periodStart),
        periodEnd: endOfMonth(input.periodEnd),
        baseIncentive: row.base,
        multiplierApplied: asNumber(multiplier),
        achievementPct,
        finalIncentive: row.base * (asNumber(multiplier) / 100),
        calculationStatus: "FINAL" as const,
        calculationDetails: {
          department: row.department,
          target,
          actual,
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

    for (const storeTarget of campaign.storeTargets) {
      if (!input.storeCodes.includes(storeTarget.storeCode)) continue;
      const sales = await db.salesTransaction.findMany({
        where: {
          storeCode: storeTarget.storeCode,
          vertical: Vertical.GROCERY,
          channel: "OFFLINE",
          transactionDate: { gte: campaign.startDate, lte: campaign.endDate },
        },
      });

      const eligibleSales = sales.filter((sale) => articleSet.has(sale.articleCode));
      const totalSalesValue = eligibleSales.reduce((sum, sale) => sum + asNumber(sale.grossAmount), 0);
      const totalPieces = eligibleSales.reduce((sum, sale) => sum + sale.quantity, 0);
      const achievementPct = (totalSalesValue / asNumber(storeTarget.targetValue)) * 100;
      const matched = sortedSlabs.find((slab) => achievementPct >= asNumber(slab.achievementFrom));
      const rate = achievementPct >= 100 ? asNumber(matched?.perPieceRate ?? 0) : 0;
      const totalIncentive = rate * totalPieces;

      const employees = await db.employeeMaster.findMany({
        where: {
          storeCode: storeTarget.storeCode,
          payrollStatus: PayrollStatus.ACTIVE,
          role: { in: [EmployeeRole.SM, EmployeeRole.DM, EmployeeRole.SA] },
        },
      });
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
    const employees = await db.employeeMaster.findMany({
      where: { storeCode: target.storeCode, payrollStatus: PayrollStatus.ACTIVE },
    });
    const smCount = employees.filter((employee) => employee.role === EmployeeRole.SM).length;
    const dmCount = employees.filter((employee) => employee.role === EmployeeRole.DM).length;
    const split = plan.fnlRoleSplits.find((row) => row.numSms === smCount && row.numDms === dmCount);
    if (!split) continue;

    const eligibleSAs: string[] = [];
    const saEmployees = employees.filter((employee) => employee.role === EmployeeRole.SA);
    for (const employee of saEmployees) {
      const weekAttendance = await db.attendance.findMany({
        where: {
          employeeId: employee.employeeId,
          date: { gte: target.periodStart, lte: target.periodEnd },
        },
      });
      const presentDays = weekAttendance.filter((day) => day.status === AttendanceStatus.PRESENT).length;
      const disqualifyingDays = weekAttendance.filter((day) =>
        disqualifyingAttendanceStatuses.has(day.status),
      ).length;
      if (presentDays >= 5 && disqualifyingDays === 0) {
        eligibleSAs.push(employee.employeeId);
      }
    }

    const saPool = storeIncentive * (asNumber(split.saPoolPct) / 100);
    const eachSaPayout = eligibleSAs.length ? saPool / eligibleSAs.length : 0;
    const smPayout = storeIncentive * (asNumber(split.smSharePct) / 100);
    const dmPayout = storeIncentive * (asNumber(split.dmSharePerDmPct) / 100);

    const payoutRows = [];
    for (const employee of employees) {
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
