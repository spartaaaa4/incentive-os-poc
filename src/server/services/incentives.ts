import { Vertical } from "@prisma/client";
import { db } from "@/lib/db";

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value)
    return (value as { toNumber: () => number }).toNumber();
  return Number(value ?? 0);
}

function fmtInr(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

type Params = {
  vertical?: string;
  city?: string;
  storeCode?: string;
  department?: string;
  employeeId?: string;
  periodStart: Date;
  periodEnd: Date;
};

// ───── Level detection ─────

export async function getIncentiveDrilldown(params: Params) {
  if (params.employeeId) return getEmployeeDetail(params);
  if (params.storeCode) return getStoreDetail(params);
  if (params.city) return getStoreSummary(params);
  return getCitySummary(params);
}

// ───── Level 1: City summary ─────

async function getCitySummary(params: Params) {
  const verticalFilter = params.vertical ? { vertical: params.vertical as Vertical } : {};

  const stores = await db.storeMaster.findMany({
    where: { ...verticalFilter },
    select: { storeCode: true, city: true, state: true },
  });
  const storeCodes = stores.map((s) => s.storeCode);

  const ledger = await db.incentiveLedger.findMany({
    where: {
      storeCode: { in: storeCodes },
      periodStart: { gte: params.periodStart },
      periodEnd: { lte: params.periodEnd },
      ...verticalFilter,
    },
    select: { storeCode: true, employeeId: true, finalIncentive: true, achievementPct: true },
  });

  const cityMap = new Map<string, { state: string; stores: Set<string>; employees: Set<string>; incentive: number; achSum: number; achCount: number }>();
  const storeToCityMap = new Map<string, string>();
  for (const s of stores) {
    if (!cityMap.has(s.city)) cityMap.set(s.city, { state: s.state, stores: new Set(), employees: new Set(), incentive: 0, achSum: 0, achCount: 0 });
    cityMap.get(s.city)!.stores.add(s.storeCode);
    storeToCityMap.set(s.storeCode, s.city);
  }

  for (const row of ledger) {
    const city = storeToCityMap.get(row.storeCode);
    if (!city) continue;
    const bucket = cityMap.get(city)!;
    bucket.employees.add(row.employeeId);
    bucket.incentive += asNumber(row.finalIncentive);
    if (row.achievementPct != null) { bucket.achSum += asNumber(row.achievementPct); bucket.achCount++; }
  }

  const rows = [...cityMap.entries()].map(([city, b]) => ({
    city,
    state: b.state,
    storeCount: b.stores.size,
    employeeCount: b.employees.size,
    totalIncentive: Math.round(b.incentive),
    avgAchievementPct: b.achCount > 0 ? Math.round((b.achSum / b.achCount) * 10) / 10 : 0,
  })).sort((a, b) => b.totalIncentive - a.totalIncentive);

  return {
    level: "city" as const,
    summary: { totalIncentive: rows.reduce((s, r) => s + r.totalIncentive, 0), totalEmployees: rows.reduce((s, r) => s + r.employeeCount, 0), storeCount: rows.reduce((s, r) => s + r.storeCount, 0) },
    rows,
  };
}

// ───── Level 2: Store summary ─────

async function getStoreSummary(params: Params) {
  const verticalFilter = params.vertical ? { vertical: params.vertical as Vertical } : {};
  const stores = await db.storeMaster.findMany({
    where: { city: params.city!, ...verticalFilter },
    include: { employees: { where: { payrollStatus: "ACTIVE" }, select: { employeeId: true } } },
  });
  const storeCodes = stores.map((s) => s.storeCode);

  const ledger = await db.incentiveLedger.findMany({
    where: { storeCode: { in: storeCodes }, periodStart: { gte: params.periodStart }, periodEnd: { lte: params.periodEnd }, ...verticalFilter },
    select: { storeCode: true, finalIncentive: true, achievementPct: true },
  });

  const targets = await db.target.findMany({
    where: { storeCode: { in: storeCodes }, status: "ACTIVE", periodStart: { lte: params.periodEnd }, periodEnd: { gte: params.periodStart }, ...verticalFilter },
    select: { storeCode: true, targetValue: true },
  });

  const sales = await db.salesTransaction.groupBy({
    by: ["storeCode"] as const,
    _sum: { grossAmount: true },
    where: { storeCode: { in: storeCodes }, transactionDate: { gte: params.periodStart, lte: params.periodEnd }, transactionType: "NORMAL", channel: "OFFLINE", ...verticalFilter },
  });
  const salesByStore = new Map(sales.map((s) => [s.storeCode, asNumber(s._sum.grossAmount)]));
  const targetByStore = new Map<string, number>();
  for (const t of targets) { targetByStore.set(t.storeCode, (targetByStore.get(t.storeCode) ?? 0) + asNumber(t.targetValue)); }
  const incByStore = new Map<string, number>();
  for (const r of ledger) { incByStore.set(r.storeCode, (incByStore.get(r.storeCode) ?? 0) + asNumber(r.finalIncentive)); }

  const rows = stores.map((s) => {
    const target = targetByStore.get(s.storeCode) ?? 0;
    const actual = salesByStore.get(s.storeCode) ?? 0;
    return {
      storeCode: s.storeCode, storeName: s.storeName, vertical: s.vertical, storeFormat: s.storeFormat,
      employeeCount: s.employees.length, totalIncentive: Math.round(incByStore.get(s.storeCode) ?? 0),
      target: Math.round(target), actual: Math.round(actual),
      achievementPct: target > 0 ? Math.round((actual / target) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.totalIncentive - a.totalIncentive);

  return {
    level: "store" as const,
    summary: { city: params.city!, totalIncentive: rows.reduce((s, r) => s + r.totalIncentive, 0), storeCount: rows.length },
    rows,
  };
}

// ───── Level 3: Store detail (departments + employees) ─────

async function getStoreDetail(params: Params) {
  const store = await db.storeMaster.findUnique({ where: { storeCode: params.storeCode! } });
  if (!store) return { level: "storeDetail" as const, summary: {}, departments: [], employees: [] };

  const [ledger, targets, salesAgg] = await Promise.all([
    db.incentiveLedger.findMany({
      where: { storeCode: params.storeCode!, periodStart: { gte: params.periodStart }, periodEnd: { lte: params.periodEnd } },
      include: { employee: true },
    }),
    db.target.findMany({
      where: { storeCode: params.storeCode!, status: "ACTIVE", periodStart: { lte: params.periodEnd }, periodEnd: { gte: params.periodStart } },
      select: { department: true, targetValue: true, vertical: true },
    }),
    db.salesTransaction.groupBy({
      by: ["department"] as const,
      where: { storeCode: params.storeCode!, transactionDate: { gte: params.periodStart, lte: params.periodEnd }, transactionType: "NORMAL", channel: "OFFLINE" },
      _sum: { grossAmount: true },
    }),
  ]);

  // Department target/achievement summary
  const salesByDept = new Map(salesAgg.map((s) => [s.department ?? "OTHER", asNumber(s._sum.grossAmount)]));
  type DeptBucket = { target: number; actual: number; vertical: string };
  const deptMap = new Map<string, DeptBucket>();
  for (const t of targets) {
    const dept = t.department ?? (t.vertical === "GROCERY" ? "GROCERY" : t.vertical === "FNL" ? "APPAREL" : "OTHER");
    const existing = deptMap.get(dept);
    deptMap.set(dept, {
      target: (existing?.target ?? 0) + asNumber(t.targetValue),
      actual: salesByDept.get(dept) ?? 0,
      vertical: t.vertical,
    });
  }
  // Ensure departments with sales but no target still show
  for (const [dept] of salesByDept) {
    if (!deptMap.has(dept)) deptMap.set(dept, { target: 0, actual: salesByDept.get(dept) ?? 0, vertical: store.vertical });
  }

  const departments = [...deptMap.entries()].map(([department, b]) => ({
    department,
    vertical: b.vertical,
    target: Math.round(b.target),
    actual: Math.round(b.actual),
    achievementPct: b.target > 0 ? Math.round((b.actual / b.target) * 1000) / 10 : 0,
  })).sort((a, b) => b.actual - a.actual);

  // Employee incentive list (store-level, not department-level)
  type EmpBucket = { name: string; role: string; base: number; final: number; multiplier: number; achievement: number };
  const empMap = new Map<string, EmpBucket>();
  for (const r of ledger) {
    const existing = empMap.get(r.employeeId);
    empMap.set(r.employeeId, {
      name: r.employee?.employeeName ?? r.employeeId,
      role: r.employee?.role ?? "SA",
      base: (existing?.base ?? 0) + asNumber(r.baseIncentive),
      final: (existing?.final ?? 0) + asNumber(r.finalIncentive),
      multiplier: asNumber(r.multiplierApplied) || existing?.multiplier || 0,
      achievement: asNumber(r.achievementPct) || existing?.achievement || 0,
    });
  }

  const employees = [...empMap.entries()].map(([employeeId, b]) => ({
    employeeId, employeeName: b.name, role: b.role,
    baseIncentive: Math.round(b.base), multiplierPct: b.multiplier,
    achievementPct: Math.round(b.achievement * 10) / 10, finalIncentive: Math.round(b.final),
  })).sort((a, b) => b.finalIncentive - a.finalIncentive);

  const totalIncentive = employees.reduce((s, e) => s + e.finalIncentive, 0);

  return {
    level: "storeDetail" as const,
    summary: {
      storeCode: store.storeCode, storeName: store.storeName, vertical: store.vertical,
      totalIncentive, employeeCount: employees.length,
    },
    departments,
    employees,
  };
}

// ───── Level 5: Employee detail (mobile app payload) ─────

async function getEmployeeDetail(params: Params) {
  const employee = await db.employeeMaster.findUnique({
    where: { employeeId: params.employeeId! },
    include: { store: true },
  });
  if (!employee) return { level: "employeeDetail" as const, error: "Employee not found" };

  const ledgerRows = await db.incentiveLedger.findMany({
    where: { employeeId: params.employeeId!, periodStart: { gte: params.periodStart }, periodEnd: { lte: params.periodEnd } },
    include: { plan: { include: { achievementMultipliers: true, fnlRoleSplits: true, productIncentiveSlabs: true } } },
    orderBy: { periodStart: "desc" },
  });

  if (!ledgerRows.length) {
    return {
      level: "employeeDetail" as const,
      employee: { employeeId: employee.employeeId, employeeName: employee.employeeName, role: employee.role, storeCode: employee.storeCode, storeName: employee.store.storeName },
      vertical: employee.store.vertical,
      period: { start: params.periodStart.toISOString().slice(0, 10), end: params.periodEnd.toISOString().slice(0, 10) },
      message: "No incentive data found for this period. This employee may not have qualifying sales or the store may not have exceeded its target.",
      currentStanding: null,
    };
  }

  const vertical = ledgerRows[0].vertical ?? employee.store.vertical;

  if (vertical === "ELECTRONICS") return buildElectronicsDetail(employee, ledgerRows, params);
  if (vertical === "GROCERY") return buildGroceryDetail(employee, ledgerRows, params);
  return buildFnlDetail(employee, ledgerRows, params);
}

const familyCodeToSlabNames: Record<string, string[]> = {
  FF01: ["Laptops & Desktops"], FF03: ["Tablets"],
  FH01: ["Home Entertainment TVs"], FH07: ["Photography"],
  FK01: ["Wireless Phones"],
  FI01: ["SDA & Consumer Appliances"], FI02: ["SDA & Consumer Appliances"],
  FI04: ["SDA & Consumer Appliances"], FI05: ["SDA & Consumer Appliances"],
  FI06: ["SDA & Consumer Appliances"], FI07: ["SDA & Consumer Appliances"],
  FJ01: ["Large Appliances"], FJ02: ["Large Appliances"],
  FJ03: ["Large Appliances", "Large Washing Machines (LWC)"],
  FJ04: ["Large Appliances"], FJ05: ["Large Appliances"],
};

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
      for (const excl of ["apple", "surface", "oneplus", "mi", "realme", "ifb"]) {
        if (filter.includes(excl) && normalized.includes(excl)) return false;
      }
    }
    return true;
  }
  if (filter.includes("others")) return true;
  return filter.split(",").map((v) => v.trim()).some((token) => normalized.includes(token));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildElectronicsDetail(employee: any, ledgerRows: any[], params: Params) {
  const row = ledgerRows[0];
  const details = row.calculationDetails as Record<string, unknown>;
  const empDept = (details.employeeDepartment as string) ?? null;
  const departmentTarget = asNumber(details.departmentTarget);
  const departmentActual = asNumber(details.departmentActual);
  const departments = (details.departments ?? {}) as Record<string, { target: number; actual: number; achievementPct: number; multiplierPct: number }>;
  const achievementPct = departmentTarget > 0 ? Math.round((departmentActual / departmentTarget) * 1000) / 10 : 0;
  const base = asNumber(row.baseIncentive);
  const currentMultiplier = asNumber(row.multiplierApplied);
  const final = asNumber(row.finalIncentive);

  const multipliers = (row.plan.achievementMultipliers ?? [])
    .sort((a: { achievementFrom: unknown }, b: { achievementFrom: unknown }) => asNumber(a.achievementFrom) - asNumber(b.achievementFrom))
    .map((m: { achievementFrom: unknown; achievementTo: unknown; multiplierPct: unknown }) => {
      const mp = asNumber(m.multiplierPct);
      const isCurrentTier = achievementPct >= asNumber(m.achievementFrom) && achievementPct <= asNumber(m.achievementTo);
      return { from: asNumber(m.achievementFrom), to: asNumber(m.achievementTo), multiplierPct: mp, isCurrentTier, incentiveAtTier: Math.round(base * (mp / 100)) };
    });

  const currentIdx = multipliers.findIndex((t: { isCurrentTier: boolean }) => t.isCurrentTier);
  const next = currentIdx >= 0 && currentIdx < multipliers.length - 1 ? multipliers[currentIdx + 1] : null;
  const nudge = next ? `Reach ${next.from}% to unlock ${next.multiplierPct}% multiplier (${fmtInr(next.incentiveAtTier)} — ${fmtInr(next.incentiveAtTier - final)} more).` : "";

  const deptBreakdown = Object.entries(departments).map(([dept, d]) => ({
    department: dept, target: Math.round(d.target), actual: Math.round(d.actual),
    achievementPct: Math.round(d.achievementPct * 10) / 10,
  }));

  // Per-transaction sales breakdown with incentive earned
  const plan = row.plan;
  const slabs = plan.productIncentiveSlabs ?? [];
  const txns = await db.salesTransaction.findMany({
    where: {
      employeeId: employee.employeeId,
      storeCode: employee.storeCode,
      vertical: "ELECTRONICS",
      transactionDate: { gte: params.periodStart, lte: params.periodEnd },
      channel: "OFFLINE",
      transactionType: "NORMAL",
    },
    orderBy: { transactionDate: "desc" },
    take: 25,
  });

  const recentSales = txns.map((txn) => {
    const unitPrice = asNumber(txn.grossAmount) / (txn.quantity || 1);
    const slabNames = familyCodeToSlabNames[txn.productFamilyCode ?? ""];
    const familyName = slabNames?.[0] ?? txn.productFamilyCode ?? "Other";
    const excluded = isElectronicsExcluded(txn.brand, txn.productFamilyCode);
    let incentiveEarned = 0;
    if (!excluded && slabNames) {
      const slab = slabs.find(
        (s: { productFamily: string; brandFilter: string; priceFrom: unknown; priceTo: unknown }) =>
          slabNames.some((name) => s.productFamily === name) &&
          brandMatches(s.brandFilter, txn.brand) &&
          unitPrice >= asNumber(s.priceFrom) && unitPrice <= asNumber(s.priceTo),
      );
      if (slab) incentiveEarned = asNumber((slab as { incentivePerUnit: unknown }).incentivePerUnit) * txn.quantity;
    }
    return {
      date: txn.transactionDate.toISOString().slice(0, 10),
      brand: txn.brand ?? "—",
      productFamily: familyName,
      articleCode: txn.articleCode,
      quantity: txn.quantity,
      unitPrice: Math.round(unitPrice),
      grossAmount: Math.round(asNumber(txn.grossAmount)),
      incentiveEarned: Math.round(incentiveEarned),
    };
  });

  return {
    level: "employeeDetail" as const,
    employee: { employeeId: employee.employeeId, employeeName: employee.employeeName, role: employee.role, storeCode: employee.storeCode, storeName: employee.store.storeName },
    vertical: "ELECTRONICS",
    period: { start: params.periodStart.toISOString().slice(0, 10), end: params.periodEnd.toISOString().slice(0, 10) },
    currentStanding: {
      employeeDepartment: empDept,
      departmentTarget: Math.round(departmentTarget), departmentActual: Math.round(departmentActual),
      achievementPct, currentMultiplierPct: currentMultiplier,
      baseIncentive: Math.round(base), finalIncentive: Math.round(final),
    },
    departments: deptBreakdown,
    multiplierTiers: multipliers,
    recentSales,
    message: `${empDept ?? "Department"} is at ${achievementPct}% achievement. You're earning ${currentMultiplier}% multiplier (${fmtInr(final)}).${nudge ? " " + nudge : ""}`,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildGroceryDetail(employee: any, ledgerRows: any[], params: Params) {
  const row = ledgerRows[0];
  const details = row.calculationDetails as Record<string, unknown>;
  const totalPieces = asNumber(details.totalPieces);
  const rate = asNumber(details.rate);
  const employeeCount = asNumber(details.employeeCount);
  const achievementPct = asNumber(row.achievementPct);
  const totalStorePayout = asNumber(row.baseIncentive);
  const yourPayout = asNumber(row.finalIncentive);

  const campaign = row.campaignId
    ? await db.campaignConfig.findUnique({ where: { id: row.campaignId }, include: { payoutSlabs: true, storeTargets: true } })
    : null;

  const storeTarget = campaign?.storeTargets.find((t: { storeCode: string }) => t.storeCode === employee.storeCode);
  const targetValue = storeTarget ? asNumber(storeTarget.targetValue) : 0;

  const sortedSlabs = (campaign?.payoutSlabs ?? []).sort(
    (a: { achievementFrom: unknown }, b: { achievementFrom: unknown }) => asNumber(a.achievementFrom) - asNumber(b.achievementFrom),
  );

  const payoutSlabs = [
    { from: 0, to: 99.99, rate: 0, isCurrentSlab: achievementPct < 100, payoutAtSlab: 0 },
    ...sortedSlabs.map((s: { achievementFrom: unknown; achievementTo: unknown; perPieceRate: unknown }) => {
      const r = asNumber(s.perPieceRate);
      const isCurrent = achievementPct >= asNumber(s.achievementFrom) && achievementPct <= asNumber(s.achievementTo);
      return {
        from: asNumber(s.achievementFrom), to: asNumber(s.achievementTo), rate: r,
        isCurrentSlab: isCurrent, payoutAtSlab: employeeCount > 0 ? Math.round((r * totalPieces) / employeeCount) : 0,
      };
    }),
  ];

  const currentIdx = payoutSlabs.findIndex((s) => s.isCurrentSlab);
  const next = currentIdx >= 0 && currentIdx < payoutSlabs.length - 1 ? payoutSlabs[currentIdx + 1] : null;
  const nudge = next ? `Reach ${next.from}% to get ₹${next.rate}/piece (${fmtInr(next.payoutAtSlab)} — ${fmtInr(next.payoutAtSlab - Math.round(yourPayout))} more).` : "";

  const salesNeeded = next && targetValue > 0 ? Math.round(targetValue * (next.from / 100)) - Math.round(targetValue * (achievementPct / 100)) : 0;

  // Fetch employee's recent sales for the campaign period
  const campaignArticles = campaign
    ? await db.campaignArticle.findMany({ where: { campaignId: campaign.id }, select: { articleCode: true, description: true, brand: true } })
    : [];
  const articleDescMap = new Map(campaignArticles.map((a) => [a.articleCode, { description: a.description, brand: a.brand }]));

  const empSales = campaign
    ? await db.salesTransaction.findMany({
        where: {
          employeeId: employee.employeeId,
          storeCode: employee.storeCode,
          vertical: "GROCERY",
          transactionDate: { gte: campaign.startDate, lte: campaign.endDate },
          channel: "OFFLINE",
        },
        orderBy: { transactionDate: "desc" },
        take: 25,
      })
    : [];

  const recentSales = empSales.map((txn) => {
    const articleInfo = articleDescMap.get(txn.articleCode);
    return {
      date: txn.transactionDate.toISOString().slice(0, 10),
      brand: articleInfo?.brand ?? txn.brand ?? "—",
      articleCode: txn.articleCode,
      description: articleInfo?.description ?? txn.articleCode,
      quantity: txn.quantity,
      grossAmount: Math.round(asNumber(txn.grossAmount)),
    };
  });

  return {
    level: "employeeDetail" as const,
    employee: { employeeId: employee.employeeId, employeeName: employee.employeeName, role: employee.role, storeCode: employee.storeCode, storeName: employee.store.storeName },
    vertical: "GROCERY",
    period: { start: params.periodStart.toISOString().slice(0, 10), end: params.periodEnd.toISOString().slice(0, 10) },
    currentStanding: {
      campaignName: campaign?.campaignName ?? "Campaign",
      storeTarget: Math.round(targetValue), storeActual: targetValue > 0 ? Math.round(targetValue * achievementPct / 100) : 0,
      achievementPct: Math.round(achievementPct * 10) / 10, totalPiecesSold: totalPieces, currentRate: rate,
      totalStorePayout: Math.round(totalStorePayout), employeeCount, yourPayout: Math.round(yourPayout),
    },
    payoutSlabs,
    recentSales,
    message: `Store is at ${Math.round(achievementPct * 10) / 10}% of target. Current rate: ₹${rate}/piece (${fmtInr(Math.round(yourPayout))} your share).${nudge ? " " + nudge : ""}${salesNeeded > 0 ? ` Store needs ${fmtInr(salesNeeded)} more in sales.` : ""}`,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildFnlDetail(employee: any, ledgerRows: any[], params: Params) {
  const totalPayout = ledgerRows.reduce((s: number, r: { finalIncentive: unknown }) => s + asNumber(r.finalIncentive), 0);
  const latestRow = ledgerRows[0];
  const details = latestRow.calculationDetails as Record<string, unknown>;
  const actualSales = asNumber(details.actualSales);
  const targetValue = asNumber(details.targetValue);
  const exceeded = actualSales > targetValue;
  const plan = latestRow.plan;
  const planConfig = (plan.config ?? {}) as Record<string, unknown>;
  const poolPct = asNumber(planConfig.poolPct ?? 1) / 100;
  const storePool = exceeded ? Math.round(actualSales * poolPct) : 0;
  const storeEmployees = await db.employeeMaster.findMany({ where: { storeCode: employee.storeCode, payrollStatus: "ACTIVE" } });
  const smCount = storeEmployees.filter((e: { role: string }) => e.role === "SM").length;
  const dmCount = storeEmployees.filter((e: { role: string }) => e.role === "DM").length;
  const split = plan.fnlRoleSplits.find((r: { numSms: number; numDms: number }) => r.numSms === smCount && r.numDms === dmCount);

  const attendance = await db.attendance.findMany({
    where: { employeeId: employee.employeeId, date: { gte: latestRow.periodStart, lte: latestRow.periodEnd } },
  });
  const presentDays = attendance.filter((a) => a.status === "PRESENT").length;
  const disqualifyingStatuses = new Set<string>(["ABSENT", "LEAVE_APPROVED", "LEAVE_UNAPPROVED"]);
  const disqualifying = attendance.filter((a) => disqualifyingStatuses.has(a.status)).length;
  const attendanceEligible = presentDays >= 5 && disqualifying === 0;

  const eligibleSAs = storeEmployees.filter((e: { role: string }) => e.role === "SA").length;

  const roleSplit = split
    ? { saPoolPct: asNumber(split.saPoolPct), smSharePct: asNumber(split.smSharePct), dmSharePerDmPct: asNumber(split.dmSharePerDmPct) }
    : { saPoolPct: 0, smSharePct: 0, dmSharePerDmPct: 0 };

  const marginalPerLakh = eligibleSAs > 0 ? Math.round((100000 * 0.01 * roleSplit.saPoolPct / 100) / eligibleSAs) : 0;

  const weeks = ledgerRows.map((r: { periodStart: Date; periodEnd: Date; finalIncentive: unknown; calculationDetails: unknown }) => ({
    periodStart: r.periodStart.toISOString().slice(0, 10),
    periodEnd: r.periodEnd.toISOString().slice(0, 10),
    payout: Math.round(asNumber(r.finalIncentive)),
    actualSales: Math.round(asNumber((r.calculationDetails as Record<string, unknown>)?.actualSales ?? 0)),
    targetValue: Math.round(asNumber((r.calculationDetails as Record<string, unknown>)?.targetValue ?? 0)),
  }));

  return {
    level: "employeeDetail" as const,
    employee: { employeeId: employee.employeeId, employeeName: employee.employeeName, role: employee.role, storeCode: employee.storeCode, storeName: employee.store.storeName },
    vertical: "FNL",
    period: { start: params.periodStart.toISOString().slice(0, 10), end: params.periodEnd.toISOString().slice(0, 10) },
    currentStanding: {
      weeklyTarget: Math.round(targetValue), weeklyActual: Math.round(actualSales),
      achievementPct: targetValue > 0 ? Math.round((actualSales / targetValue) * 1000) / 10 : 0,
      exceeded, storePool, roleSplit,
      eligibleSAs, yourAttendanceDays: presentDays, attendanceEligible,
      yourPayout: Math.round(totalPayout),
    },
    weeks,
    whatIf: {
      ifNotExceeded: "If store had not exceeded the weekly target, no incentive pool would be created.",
      ifMoreSales: `Every additional ${fmtInr(100000)} in store sales adds ${fmtInr(1000)} to the pool (${fmtInr(marginalPerLakh)} to your share at current SA count).`,
    },
    message: exceeded
      ? `Store exceeded weekly target! Pool: ${fmtInr(storePool)}. Your ${employee.role} share: ${fmtInr(Math.round(totalPayout))}.${employee.role === "SA" ? ` You ${attendanceEligible ? "met" : "did NOT meet"} the 5-day attendance requirement.` : ""}`
      : "Store did not exceed the weekly target — no incentive pool was created this week.",
  };
}
