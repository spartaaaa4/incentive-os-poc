import { startOfMonth, endOfMonth, format, addDays, differenceInDays } from "date-fns";
import { Vertical } from "@prisma/client";
import { db } from "@/lib/db";

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value ?? 0);
}

export async function getDashboardData(vertical?: Vertical, month?: string) {
  const anchor = month ? new Date(month + "-15") : new Date("2026-04-13");
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const verticalWhere = vertical ? { vertical } : {};

  const [
    storeRows,
    employeeCount,
    activeSchemes,
    totalIncentiveAgg,
    totalSalesAgg,
    topPerformers,
    pendingApprovalTargets,
    pendingApprovalPlans,
    storeTargets,
    storeSalesAgg,
    storeLedgerAgg,
    dailySalesRaw,
    verticalStores,
    verticalEmployees,
    verticalSales,
    verticalLedger,
  ] = await Promise.all([
    db.storeMaster.findMany({
      where: verticalWhere,
      select: { storeCode: true, storeName: true, storeFormat: true, vertical: true, _count: { select: { employees: true } } },
    }),
    db.employeeMaster.count({
      where: { payrollStatus: "ACTIVE", ...(vertical ? { store: { vertical } } : {}) },
    }),
    db.incentivePlan.count({
      where: { status: "ACTIVE", ...verticalWhere },
    }),
    db.incentiveLedger.aggregate({
      where: { periodStart: { gte: monthStart }, ...verticalWhere },
      _sum: { finalIncentive: true, baseIncentive: true },
    }),
    db.salesTransaction.aggregate({
      where: { transactionDate: { gte: monthStart }, ...verticalWhere },
      _sum: { grossAmount: true },
    }),
    db.incentiveLedger.groupBy({
      by: ["employeeId", "storeCode"] as const,
      where: { periodStart: { gte: monthStart }, ...verticalWhere },
      _sum: { finalIncentive: true },
      orderBy: { _sum: { finalIncentive: "desc" } },
      take: 10,
    }),
    db.target.count({ where: { status: "SUBMITTED" } }),
    db.incentivePlan.count({ where: { status: "SUBMITTED" } }),
    db.target.findMany({
      where: {
        periodStart: { lte: monthEnd },
        periodEnd: { gte: monthStart },
        status: "ACTIVE",
        ...verticalWhere,
      },
      select: { storeCode: true, targetValue: true, vertical: true },
    }),
    db.salesTransaction.groupBy({
      by: ["storeCode"] as const,
      where: {
        transactionDate: { gte: monthStart },
        transactionType: "NORMAL",
        channel: "OFFLINE",
        ...verticalWhere,
      },
      _sum: { grossAmount: true },
    }),
    db.incentiveLedger.groupBy({
      by: ["storeCode"] as const,
      where: { periodStart: { gte: monthStart }, ...verticalWhere },
      _sum: { finalIncentive: true, baseIncentive: true },
    }),
    db.salesTransaction.groupBy({
      by: ["transactionDate"] as const,
      where: { transactionDate: { gte: monthStart, lte: monthEnd }, ...verticalWhere },
      _sum: { grossAmount: true },
      _count: true,
      orderBy: { transactionDate: "asc" },
    }),
    // Vertical breakdown queries (unfiltered)
    db.storeMaster.groupBy({
      by: ["vertical"] as const,
      _count: true,
    }),
    db.employeeMaster.groupBy({
      by: ["storeCode"] as const,
      where: { payrollStatus: "ACTIVE" },
      _count: true,
    }),
    db.salesTransaction.groupBy({
      by: ["vertical"] as const,
      where: { transactionDate: { gte: monthStart } },
      _sum: { grossAmount: true },
    }),
    db.incentiveLedger.groupBy({
      by: ["vertical"] as const,
      where: { periodStart: { gte: monthStart } },
      _sum: { finalIncentive: true, baseIncentive: true },
    }),
  ]);

  const pendingApprovals = pendingApprovalTargets + pendingApprovalPlans;

  const targetByStore = new Map<string, number>();
  for (const t of storeTargets) {
    targetByStore.set(t.storeCode, (targetByStore.get(t.storeCode) ?? 0) + asNumber(t.targetValue));
  }
  const salesByStore = new Map(storeSalesAgg.map((s) => [s.storeCode, asNumber(s._sum.grossAmount)]));
  const incByStore = new Map(storeLedgerAgg.map((l) => [l.storeCode, asNumber(l._sum.finalIncentive)]));
  const baseByStore = new Map(storeLedgerAgg.map((l) => [l.storeCode, asNumber(l._sum.baseIncentive)]));

  // Achievement per store for distribution chart
  const storeAchievements: { storeCode: string; achievementPct: number; incentive: number; sales: number }[] = [];
  for (const store of storeRows) {
    const target = targetByStore.get(store.storeCode) ?? 0;
    const sales = salesByStore.get(store.storeCode) ?? 0;
    const achievementPct = target > 0 ? Math.round((sales / target) * 100) : 0;
    storeAchievements.push({ storeCode: store.storeCode, achievementPct, incentive: incByStore.get(store.storeCode) ?? 0, sales });
  }

  // Achievement distribution buckets
  const buckets = [
    { label: "0-70%", min: 0, max: 70 },
    { label: "70-85%", min: 70, max: 85 },
    { label: "85-95%", min: 85, max: 95 },
    { label: "95-105%", min: 95, max: 105 },
    { label: "105-120%", min: 105, max: 120 },
    { label: "120%+", min: 120, max: 9999 },
  ];
  const achievementDistribution = buckets.map((b) => ({
    bucket: b.label,
    count: storeAchievements.filter((s) => s.achievementPct >= b.min && s.achievementPct < b.max).length,
  }));

  // Total target across all stores (needed for daily pace line)
  const totalTarget = [...targetByStore.values()].reduce((a, b) => a + b, 0);

  // Daily target pace line (cumulative target up to each day)
  const daysInMonth = differenceInDays(monthEnd, monthStart) + 1;
  const dailyTargetRate = totalTarget / daysInMonth;

  // Daily sales trend
  const dailyMap = new Map<string, { sales: number; txnCount: number }>();
  for (let i = 0; i < daysInMonth; i++) {
    const d = format(addDays(monthStart, i), "yyyy-MM-dd");
    dailyMap.set(d, { sales: 0, txnCount: 0 });
  }
  for (const row of dailySalesRaw) {
    const key = format(row.transactionDate, "yyyy-MM-dd");
    dailyMap.set(key, { sales: asNumber(row._sum.grossAmount), txnCount: row._count });
  }
  const dailySalesTrend = [...dailyMap.entries()].map(([date, v], idx) => ({
    date,
    label: format(new Date(date), "dd MMM"),
    sales: Math.round(v.sales),
    transactions: v.txnCount,
    targetPace: Math.round(dailyTargetRate * (idx + 1)),
  }));

  const totalFinal = asNumber(totalIncentiveAgg._sum.finalIncentive);
  let potentialFromBelow = 0;
  for (const store of storeRows) {
    const base = baseByStore.get(store.storeCode) ?? 0;
    const earned = incByStore.get(store.storeCode) ?? 0;
    if (base > 0 && earned === 0) {
      potentialFromBelow += base;
    }
  }
  const potentialIncentive = totalFinal + potentialFromBelow;

  // Last calculated timestamp (most recent ledger entry)
  const lastLedgerRow = await db.incentiveLedger.findFirst({
    where: { periodStart: { gte: monthStart }, ...verticalWhere },
    orderBy: { calculatedAt: "desc" },
    select: { calculatedAt: true },
  });
  const lastCalculatedAt = lastLedgerRow?.calculatedAt?.toISOString() ?? null;

  // Vertical breakdown (always unfiltered for the overview cards)
  const storesByVertical = new Map(verticalStores.map((v) => [v.vertical, v._count]));
  const empCountByStore = new Map(verticalEmployees.map((v) => [v.storeCode, v._count]));
  const storeVerticalMap = new Map(storeRows.map((s) => [s.storeCode, s.vertical]));
  const empsByVertical = new Map<string, number>();
  for (const [sc, count] of empCountByStore) {
    const v = storeVerticalMap.get(sc);
    if (v) empsByVertical.set(v, (empsByVertical.get(v) ?? 0) + count);
  }
  const salesByVertical = new Map(verticalSales.map((v) => [v.vertical, asNumber(v._sum.grossAmount)]));
  const ledgerByVertical = new Map(verticalLedger.map((v) => [v.vertical, asNumber(v._sum.finalIncentive)]));

  const targetsByVertical = new Map<string, number>();
  const salesByVerticalOffline = new Map<string, number>();
  for (const t of storeTargets) {
    targetsByVertical.set(t.vertical, (targetsByVertical.get(t.vertical) ?? 0) + asNumber(t.targetValue));
  }
  for (const s of storeSalesAgg) {
    const v = storeVerticalMap.get(s.storeCode);
    if (v) salesByVerticalOffline.set(v, (salesByVerticalOffline.get(v) ?? 0) + asNumber(s._sum.grossAmount));
  }

  const verticalBreakdown = [Vertical.ELECTRONICS, Vertical.GROCERY, Vertical.FNL].map((v) => {
    const tgt = targetsByVertical.get(v) ?? 0;
    const act = salesByVerticalOffline.get(v) ?? 0;
    return {
      vertical: v,
      stores: storesByVertical.get(v) ?? 0,
      employees: empsByVertical.get(v) ?? 0,
      salesMtd: Math.round(salesByVertical.get(v) ?? 0),
      incentiveEarned: Math.round(ledgerByVertical.get(v) ?? 0),
      avgAchievementPct: tgt > 0 ? Math.round((act / tgt) * 100) : 0,
    };
  });

  // Below-threshold stores with names
  const belowThresholdList: { storeCode: string; storeName: string; achievementPct: number }[] = [];
  for (const store of storeRows) {
    const sales = salesByStore.get(store.storeCode) ?? 0;
    const incentives = incByStore.get(store.storeCode) ?? 0;
    if (sales > 0 && incentives === 0) {
      const target = targetByStore.get(store.storeCode) ?? 0;
      belowThresholdList.push({
        storeCode: store.storeCode,
        storeName: store.storeName,
        achievementPct: target > 0 ? Math.round((sales / target) * 100) : 0,
      });
    }
  }

  const performerIds = topPerformers.map((item) => item.employeeId);
  const performerEmployees = performerIds.length
    ? await db.employeeMaster.findMany({ where: { employeeId: { in: performerIds } } })
    : [];
  const employeeById = new Map(performerEmployees.map((e) => [e.employeeId, e]));
  const storeNameByCode = new Map(storeRows.map((s) => [s.storeCode, s.storeName]));

  const avgAchievement = storeAchievements.length > 0
    ? Math.round(storeAchievements.reduce((s, a) => s + a.achievementPct, 0) / storeAchievements.length)
    : 0;

  // Employees earning incentive vs total
  const earningEmployees = new Set(
    storeLedgerAgg.length > 0
      ? (await db.incentiveLedger.findMany({
          where: { periodStart: { gte: monthStart }, ...verticalWhere, finalIncentive: { gt: 0 } },
          select: { employeeId: true },
          distinct: ["employeeId"],
        })).map((r) => r.employeeId)
      : [],
  );

  return {
    month: format(monthStart, "yyyy-MM"),
    monthLabel: format(monthStart, "MMMM yyyy"),
    lastCalculatedAt,
    stats: {
      totalEmployees: employeeCount,
      employeesEarning: earningEmployees.size,
      totalSalesMtd: Math.round(asNumber(totalSalesAgg._sum.grossAmount)),
      totalTarget: Math.round(totalTarget),
      totalIncentiveMtd: Math.round(totalFinal),
      potentialIncentive: Math.round(potentialIncentive),
      avgAchievementPct: avgAchievement,
      activeSchemes,
      stores: storeRows.length,
    },
    alerts: {
      pendingApprovals,
      belowThresholdStores: belowThresholdList.length,
      belowThresholdList: belowThresholdList.sort((a, b) => a.achievementPct - b.achievementPct).slice(0, 5),
    },
    verticalBreakdown,
    achievementDistribution,
    dailySalesTrend,
    topPerformers: topPerformers.map((item, index) => ({
      rank: index + 1,
      employeeId: item.employeeId,
      employeeName: employeeById.get(item.employeeId)?.employeeName ?? item.employeeId,
      role: employeeById.get(item.employeeId)?.role ?? "SA",
      storeCode: item.storeCode,
      storeName: storeNameByCode.get(item.storeCode) ?? item.storeCode,
      incentive: asNumber(item._sum.finalIncentive),
    })),
  };
}
