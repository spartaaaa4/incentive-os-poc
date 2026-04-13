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
  const storeWhere = vertical ? { vertical } : {};
  const ledgerWhere = vertical
    ? { vertical, periodStart: { gte: monthStart } }
    : { periodStart: { gte: monthStart } };

  const [stores, employees, activeSchemes, totalIncentive, topPerformers, pendingApprovalTargets, pendingApprovalPlans, storeTargets] =
    await Promise.all([
      db.storeMaster.findMany({
        where: storeWhere,
        include: {
          employees: true,
          incentiveLedger: { where: { periodStart: { gte: monthStart } } },
          salesTransactions: {
            where: { transactionDate: { gte: monthStart }, transactionType: "NORMAL", channel: "OFFLINE" },
          },
        },
      }),
      db.employeeMaster.count({
        where: {
          payrollStatus: "ACTIVE",
          ...(vertical ? { store: { vertical } } : {}),
        },
      }),
      db.incentivePlan.count({
        where: { status: "ACTIVE", ...(vertical ? { vertical } : {}) },
      }),
      db.incentiveLedger.aggregate({
        where: ledgerWhere,
        _sum: { finalIncentive: true },
      }),
      db.incentiveLedger.groupBy({
        by: ["employeeId", "storeCode"],
        where: ledgerWhere,
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
          ...(vertical ? { vertical } : {}),
        },
        select: { storeCode: true, targetValue: true },
      }),
    ]);

  const pendingApprovals = pendingApprovalTargets + pendingApprovalPlans;
  const targetByStore = new Map<string, number>();
  for (const t of storeTargets) {
    targetByStore.set(t.storeCode, (targetByStore.get(t.storeCode) ?? 0) + asNumber(t.targetValue));
  }

  const performerIds = topPerformers.map((item) => item.employeeId);
  const performerEmployees = performerIds.length
    ? await db.employeeMaster.findMany({ where: { employeeId: { in: performerIds } } })
    : [];
  const employeeById = new Map(performerEmployees.map((employee) => [employee.employeeId, employee]));

  return {
    stats: {
      totalEmployees: employees,
      totalIncentiveMtd: asNumber(totalIncentive._sum.finalIncentive),
      activeSchemes,
      stores: stores.length,
    },
    alerts: {
      pendingApprovals,
      belowThresholdStores: stores.filter((store) => {
        const sales = store.salesTransactions.reduce((sum, item) => sum + asNumber(item.grossAmount), 0);
        const incentives = store.incentiveLedger.reduce((sum, item) => sum + asNumber(item.finalIncentive), 0);
        return sales > 0 && incentives === 0;
      }).length,
    },
    stores: stores.map((store) => {
      const totalIncentiveStore = store.incentiveLedger.reduce(
        (sum, item) => sum + asNumber(item.finalIncentive),
        0,
      );
      const sales = store.salesTransactions.reduce((sum, item) => sum + asNumber(item.grossAmount), 0);
      const target = targetByStore.get(store.storeCode) ?? 0;
      const achievementPct = target > 0 ? Math.round((sales / target) * 100) : 0;

      return {
        storeCode: store.storeCode,
        storeName: store.storeName,
        storeFormat: store.storeFormat,
        employeeCount: store.employees.length,
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
