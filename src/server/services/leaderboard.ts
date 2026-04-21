import { startOfMonth, endOfMonth, format, subMonths } from "date-fns";
import { Vertical } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Store-level leaderboard. Stores are ranked by target achievement percent
 * (sum of active period sales ÷ sum of active period targets) within a single
 * vertical and city.
 *
 * Reads from `store_period_rollup` maintained by the calculation coordinator.
 * Only rollup rows tagged with the current successful run are considered.
 */

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value ?? 0);
}

export type StoreLeaderboardRow = {
  rank: number;
  storeCode: string;
  storeName: string;
  city: string;
  target: number;
  actual: number;
  achievementPct: number;
  isViewerStore: boolean;
};

export type LeaderboardPeriod = {
  month: string;
  startDate: string;
  endDate: string;
  label: string;
};

export type StoreLeaderboardResult = {
  metric: "STORE_TARGET_ACHIEVEMENT";
  rankBy: "achievementPct";
  scope: "stores";
  vertical: Vertical;
  city: string;
  period: LeaderboardPeriod;
  viewer: {
    storeCode: string | null;
    storeName: string | null;
    city: string;
    vertical: Vertical;
  } | null;
  leaderboard: StoreLeaderboardRow[];
  myRank: {
    rank: number;
    storesAhead: number;
    totalStores: number;
    storeCode: string | null;
  };
};

function competitionRanks(sortedValues: number[]): number[] {
  const ranks: number[] = [];
  let i = 0;
  while (i < sortedValues.length) {
    const rank = i + 1;
    const v = sortedValues[i];
    let j = i;
    while (j < sortedValues.length && sortedValues[j] === v) {
      ranks.push(rank);
      j++;
    }
    i = j;
  }
  return ranks;
}

function buildPeriod(anchor: Date): LeaderboardPeriod {
  const start = startOfMonth(anchor);
  return {
    month: format(start, "yyyy-MM"),
    startDate: format(start, "yyyy-MM-dd"),
    endDate: format(endOfMonth(anchor), "yyyy-MM-dd"),
    label: format(start, "MMMM yyyy"),
  };
}

function resolveAnchor(input: { month?: string | null; monthsBack?: number | null }): Date {
  if (input.month && /^\d{4}-\d{2}$/.test(input.month)) return new Date(input.month + "-15");
  const back = typeof input.monthsBack === "number" && input.monthsBack >= 0 ? input.monthsBack : 0;
  return subMonths(new Date(), back);
}

export type LeaderboardViewer = {
  employeeId: string;
  storeCode: string;
  role: string;
};

/**
 * Rank stores by achievement %. If `viewer` is provided, the viewer's own
 * store is flagged in the response and `myRank` is populated.
 *
 * - `vertical` and `city` default to the viewer's store when not given.
 * - Admin callers (no viewer) MUST pass both `vertical` and `city`.
 */
export async function getStoreLeaderboard(input: {
  viewer?: LeaderboardViewer | null;
  vertical?: string | null;
  city?: string | null;
  month?: string | null;
  monthsBack?: number | null;
}): Promise<StoreLeaderboardResult> {
  let vertical = input.vertical as Vertical | undefined;
  let city = input.city ?? null;
  let viewerStoreCode: string | null = null;
  let viewerStoreName: string | null = null;

  if (input.viewer) {
    const employee = await db.employeeMaster.findUnique({
      where: { employeeId: input.viewer.employeeId },
      include: { store: true },
    });
    if (!employee) throw new Error("Employee not found");
    vertical = vertical ?? employee.store.vertical;
    city = city ?? employee.store.city;
    viewerStoreCode = employee.store.storeCode;
    viewerStoreName = employee.store.storeName;
  }

  if (!vertical || !city) {
    throw new Error("vertical and city are required when no viewer is supplied");
  }

  const anchor = resolveAnchor({ month: input.month ?? null, monthsBack: input.monthsBack ?? null });
  const period = buildPeriod(anchor);
  const periodStart = startOfMonth(anchor);
  const periodEnd = endOfMonth(anchor);

  const stores = await db.storeMaster.findMany({
    where: { city, vertical },
    select: { storeCode: true, storeName: true, city: true },
  });
  const storeCodes = stores.map((s) => s.storeCode);
  const emptyResult: StoreLeaderboardResult = {
    metric: "STORE_TARGET_ACHIEVEMENT",
    rankBy: "achievementPct",
    scope: "stores",
    vertical,
    city,
    period,
    viewer: input.viewer
      ? { storeCode: viewerStoreCode, storeName: viewerStoreName, city, vertical }
      : null,
    leaderboard: [],
    myRank: { rank: 0, storesAhead: 0, totalStores: 0, storeCode: viewerStoreCode },
  };
  if (!storeCodes.length) return emptyResult;

  // Resolve the active plan for this vertical — leaderboard is plan-scoped so
  // sums across weekly/monthly rollup grain work without cross-plan double count.
  const activePlan = await db.incentivePlan.findFirst({
    where: { vertical, status: "ACTIVE" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!activePlan) return emptyResult;

  const rollups = await db.storePeriodRollup.findMany({
    where: {
      planId: activePlan.id,
      vertical,
      city,
      storeCode: { in: storeCodes },
      periodStart: { gte: periodStart, lte: periodEnd },
      periodEnd: { gte: periodStart, lte: periodEnd },
      lastRun: { is: { isCurrent: true, status: "SUCCEEDED" } },
    },
    select: { storeCode: true, targetValue: true, actualSales: true },
  });

  const targetByStore = new Map<string, number>();
  const salesByStore = new Map<string, number>();
  for (const r of rollups) {
    targetByStore.set(r.storeCode, (targetByStore.get(r.storeCode) ?? 0) + asNumber(r.targetValue));
    salesByStore.set(r.storeCode, (salesByStore.get(r.storeCode) ?? 0) + asNumber(r.actualSales));
  }

  const raw = stores.map((s) => {
    const target = targetByStore.get(s.storeCode) ?? 0;
    const actual = salesByStore.get(s.storeCode) ?? 0;
    const achievementPct = target > 0 ? (actual / target) * 100 : 0;
    return {
      storeCode: s.storeCode,
      storeName: s.storeName,
      city: s.city,
      target: Math.round(target),
      actual: Math.round(actual),
      achievementPct: Math.round(achievementPct * 10) / 10,
    };
  });

  raw.sort((a, b) => b.achievementPct - a.achievementPct);
  const ranks = competitionRanks(raw.map((r) => r.achievementPct));

  const leaderboard: StoreLeaderboardRow[] = raw.map((r, i) => ({
    ...r,
    rank: ranks[i] ?? i + 1,
    isViewerStore: r.storeCode === viewerStoreCode,
  }));

  const mine = leaderboard.find((r) => r.isViewerStore) ?? null;
  const storesAhead = mine ? leaderboard.filter((r) => r.achievementPct > mine.achievementPct).length : 0;

  return {
    metric: "STORE_TARGET_ACHIEVEMENT",
    rankBy: "achievementPct",
    scope: "stores",
    vertical,
    city,
    period,
    viewer: input.viewer ? { storeCode: viewerStoreCode, storeName: viewerStoreName, city, vertical } : null,
    leaderboard,
    myRank: {
      rank: mine?.rank ?? 0,
      storesAhead,
      totalStores: leaderboard.length,
      storeCode: viewerStoreCode,
    },
  };
}
