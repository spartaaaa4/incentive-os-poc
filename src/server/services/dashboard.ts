import { startOfMonth } from "date-fns";
import { Vertical } from "@prisma/client";
import { db } from "@/lib/db";

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value ?? 0);
}

export async function getDashboardData(vertical?: Vertical) {
  const monthStart = startOfMonth(new Date("2026-04-13"));
  const verticalWhere = vertical ? { vertical } : {};

  const [
    storeRows,
    employeeCount,
    activeSchemes,
    totalIncentiveAgg,
    topPerformers,
    pendingApprovalTargets,
    pendingApprovalPlans,
    storeTargets,
    storeSalesAgg,
    storeLedgerAgg,
  ] = await Promise.all([
    db.storeMaster.findMany({
      where: verticalWhere,
      select: { storeCode: true, storeName: true, storeFormat: true, _count: { select: { employees: true } } },
    }),
    db.employeeMaster.count({
      where: { payrollStatus: "ACTIVE", ...(vertical ? { store: { vertical } } : {}) },
    }),
    db.incentivePlan.count({
      where: { status: "ACTIVE", ...verticalWhere },
    }),
    db.incentiveLedger.aggregate({
      where: { periodStart: { gte: monthStart }, ...verticalWhere },
      _sum: { finalIncentive: true },
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
        periodStart: { lte: new Date() },
        periodEnd: { gte: monthStart },
        status: "ACTIVE",
        ...verticalWhere,
      },
      select: { storeCode: true, targetValue: true },
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
      _sum: { finalIncentive: true },
    }),
  ]);

  const pendingApprovals = pendingApprovalTargets + pendingApprovalPlans;

  const targetByStore = new Map<string, number>();
  for (const t of storeTargets) {
    targetByStore.set(t.storeCode, (targetByStore.get(t.storeCode) ?? 0) + asNumber(t.targetValue));
  }
  const salesByStore = new Map(storeSalesAgg.map((s) => [s.storeCode, asNumber(s._sum.grossAmount)]));
  const incByStore = new Map(storeLedgerAgg.map((l) => [l.storeCode, asNumber(l._sum.finalIncentive)]));

  const performerIds = topPerformers.map((item) => item.employeeId);
  const performerEmployees = performerIds.length
    ? await db.employeeMaster.findMany({ where: { employeeId: { in: performerIds } } })
    : [];
  const employeeById = new Map(performerEmployees.map((e) => [e.employeeId, e]));

  return {
    stats: {
      totalEmployees: employeeCount,
      totalIncentiveMtd: asNumber(totalIncentiveAgg._sum.finalIncentive),
      activeSchemes,
      stores: storeRows.length,
    },
    alerts: {
      pendingApprovals,
      belowThresholdStores: storeRows.filter((store) => {
        const sales = salesByStore.get(store.storeCode) ?? 0;
        const incentives = incByStore.get(store.storeCode) ?? 0;
        return sales > 0 && incentives === 0;
      }).length,
    },
    stores: storeRows.map((store) => {
      const totalIncentiveStore = incByStore.get(store.storeCode) ?? 0;
      const sales = salesByStore.get(store.storeCode) ?? 0;
      const target = targetByStore.get(store.storeCode) ?? 0;
      const achievementPct = target > 0 ? Math.round((sales / target) * 100) : 0;

      return {
        storeCode: store.storeCode,
        storeName: store.storeName,
        storeFormat: store.storeFormat,
        employeeCount: store._count.employees,
        totalIncentive: totalIncentiveStore,
        achievementPct,
      };
    }),
    topPerformers: topPerformers.map((item, index) => ({
      rank: index + 1,
      employeeId: item.employeeId,
      employeeName: employeeById.get(item.employeeId)?.employeeName ?? item.employeeId,
      role: employeeById.get(item.employeeId)?.role ?? "SA",
      storeCode: item.storeCode,
      incentive: asNumber(item._sum.finalIncentive),
    })),
  };
}
