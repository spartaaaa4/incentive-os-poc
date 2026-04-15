import { startOfMonth, endOfMonth, format, subMonths } from "date-fns";
import { Vertical } from "@prisma/client";
import { db } from "@/lib/db";

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value ?? 0);
}

export type LeaderboardScope = "store" | "city";

export type LeaderboardViewer = {
  employeeId: string;
  storeCode: string;
  role: string;
};

export type LeaderboardPeriod = {
  /** Calendar month key yyyy-MM */
  month: string;
  /** First calendar day (date-only) */
  startDate: string;
  /** Last calendar day (date-only) */
  endDate: string;
  /** Human label, e.g. "April 2026" */
  label: string;
  /** Short explanation for clients / UI */
  description: string;
};

export type LeaderboardRow = {
  rank: number;
  employeeId: string;
  employeeName: string;
  role: string;
  storeCode: string;
  storeName: string;
  city: string;
  /** Sum of `gross_amount` on sales lines in scope for the calendar month */
  totalSales: number;
  /** Number of sales transaction rows attributed to this employee in the period */
  transactionCount: number;
  isViewer: boolean;
};

export type LeaderboardResult = {
  /** Always gross sales for the calendar month */
  metric: "TOTAL_SALES_GROSS";
  rankBy: "totalSales";
  scope: LeaderboardScope;
  vertical: Vertical;
  /** City leaderboard only includes stores (and people) in this vertical */
  verticalFilter: "VIEWER_STORE_VERTICAL_ONLY";
  city: string;
  storeCode: string | null;
  storeName: string | null;
  period: LeaderboardPeriod;
  viewer: {
    employeeId: string;
    employeeName: string;
    storeCode: string;
    storeName: string;
    city: string;
    vertical: Vertical;
    role: string;
  };
  leaderboard: LeaderboardRow[];
};

function competitionRanks(sortedTotals: number[]): number[] {
  const ranks: number[] = [];
  let i = 0;
  while (i < sortedTotals.length) {
    const rank = i + 1;
    const v = sortedTotals[i];
    let j = i;
    while (j < sortedTotals.length && sortedTotals[j] === v) {
      ranks.push(rank);
      j++;
    }
    i = j;
  }
  return ranks;
}

function buildPeriod(anchor: Date): LeaderboardPeriod {
  const start = startOfMonth(anchor);
  const end = endOfMonth(anchor);
  const month = format(start, "yyyy-MM");
  return {
    month,
    startDate: format(start, "yyyy-MM-dd"),
    endDate: format(end, "yyyy-MM-dd"),
    label: format(start, "MMMM yyyy"),
    description:
      `Sales leaderboard for ${format(start, "MMMM yyyy")}. ` +
      "Includes every sales line whose transaction date falls on or between the start and end dates (inclusive). " +
      "Ranking uses sum of gross amount for the viewer's vertical only.",
  };
}

/** Resolve calendar month: explicit `month` wins; else `monthsBack` from today; else current month. */
function resolveLeaderboardAnchor(input: {
  month?: string | null;
  monthsBack?: number | null;
}): Date {
  if (input.month && /^\d{4}-\d{2}$/.test(input.month)) {
    return new Date(input.month + "-15");
  }
  const back = typeof input.monthsBack === "number" && input.monthsBack >= 0
    ? input.monthsBack
    : 0;
  return subMonths(new Date(), back);
}

/* ------------------------------------------------------------------ */
/*  Admin leaderboard — no viewer needed, filter by vertical + city   */
/* ------------------------------------------------------------------ */

export type AdminLeaderboardResult = {
  metric: "TOTAL_SALES_GROSS";
  rankBy: "totalSales";
  scope: "city" | "store";
  vertical: Vertical;
  city: string;
  storeCode: string | null;
  storeName: string | null;
  period: LeaderboardPeriod;
  leaderboard: Omit<LeaderboardRow, "isViewer">[];
};

export async function getAdminLeaderboard(input: {
  vertical: string;
  city: string;
  storeCode?: string | null;
  month?: string | null;
  monthsBack?: number | null;
}): Promise<AdminLeaderboardResult> {
  const vertical = input.vertical as Vertical;
  const anchor = resolveLeaderboardAnchor({
    month: input.month ?? null,
    monthsBack: input.monthsBack ?? null,
  });
  const period = buildPeriod(anchor);
  const periodStart = startOfMonth(anchor);
  const periodEnd = endOfMonth(anchor);

  // Determine scope stores
  let storeCodes: string[];
  let scopeStoreCode: string | null = null;
  let scopeStoreName: string | null = null;
  const scope: "city" | "store" = input.storeCode ? "store" : "city";

  if (input.storeCode) {
    const store = await db.storeMaster.findUnique({
      where: { storeCode: input.storeCode },
    });
    if (!store) throw new Error(`Store ${input.storeCode} not found`);
    storeCodes = [input.storeCode];
    scopeStoreCode = store.storeCode;
    scopeStoreName = store.storeName;
  } else {
    const cityStores = await db.storeMaster.findMany({
      where: { city: input.city, vertical },
      select: { storeCode: true },
    });
    storeCodes = cityStores.map((s) => s.storeCode);
    if (!storeCodes.length) throw new Error(`No ${vertical} stores found in ${input.city}`);
  }

  const salesAgg = await db.salesTransaction.groupBy({
    by: ["employeeId"],
    where: {
      vertical,
      storeCode: { in: storeCodes },
      employeeId: { not: null },
      transactionDate: { gte: periodStart, lte: periodEnd },
    },
    _sum: { grossAmount: true },
    _count: { _all: true },
  });

  const salesByEmployee = new Map(
    salesAgg
      .filter((r) => r.employeeId != null)
      .map((r) => [
        r.employeeId as string,
        {
          totalSales: asNumber(r._sum.grossAmount),
          transactionCount: r._count._all,
        },
      ]),
  );

  const employees = await db.employeeMaster.findMany({
    where: {
      storeCode: { in: storeCodes },
      store: { vertical },
    },
    include: { store: true },
  });

  const rows: (Omit<LeaderboardRow, "rank" | "isViewer">)[] = employees.map((e) => {
    const s = salesByEmployee.get(e.employeeId) ?? { totalSales: 0, transactionCount: 0 };
    return {
      employeeId: e.employeeId,
      employeeName: e.employeeName,
      role: e.role,
      storeCode: e.storeCode,
      storeName: e.store.storeName,
      city: e.store.city,
      totalSales: Math.round(s.totalSales),
      transactionCount: s.transactionCount,
    };
  });

  rows.sort((a, b) => b.totalSales - a.totalSales);
  const totals = rows.map((r) => r.totalSales);
  const ranks = competitionRanks(totals);

  return {
    metric: "TOTAL_SALES_GROSS",
    rankBy: "totalSales",
    scope,
    vertical,
    city: input.city,
    storeCode: scopeStoreCode,
    storeName: scopeStoreName,
    period,
    leaderboard: rows.map((r, i) => ({ ...r, rank: ranks[i] ?? i + 1 })),
  };
}

/* ------------------------------------------------------------------ */
/*  Employee-facing leaderboard (original)                            */
/* ------------------------------------------------------------------ */

export async function getLeaderboard(input: {
  viewer: LeaderboardViewer;
  scope: LeaderboardScope;
  storeCode?: string | null;
  month?: string | null;
  monthsBack?: number | null;
}): Promise<LeaderboardResult> {
  const employee = await db.employeeMaster.findUnique({
    where: { employeeId: input.viewer.employeeId },
    include: { store: true },
  });

  if (!employee) {
    throw new Error("Employee not found");
  }

  const vertical = employee.store.vertical;
  const anchor = resolveLeaderboardAnchor({
    month: input.month ?? null,
    monthsBack: input.monthsBack ?? null,
  });
  const period = buildPeriod(anchor);
  const periodStart = startOfMonth(anchor);
  const periodEnd = endOfMonth(anchor);

  let storeCodes: string[];
  let scopeStoreCode: string | null = null;
  let scopeStoreName: string | null = null;

  if (input.scope === "store") {
    const code = (input.storeCode?.trim() || input.viewer.storeCode).trim();
    if (code !== employee.storeCode) {
      throw new Error("You can only view the leaderboard for your own store");
    }
    storeCodes = [code];
    scopeStoreCode = employee.store.storeCode;
    scopeStoreName = employee.store.storeName;
  } else {
    const cityStores = await db.storeMaster.findMany({
      where: { city: employee.store.city, vertical },
      select: { storeCode: true },
    });
    storeCodes = cityStores.map((s) => s.storeCode);
    if (!storeCodes.length) {
      storeCodes = [employee.storeCode];
    }
  }

  const salesAgg = await db.salesTransaction.groupBy({
    by: ["employeeId"],
    where: {
      vertical,
      storeCode: { in: storeCodes },
      employeeId: { not: null },
      transactionDate: { gte: periodStart, lte: periodEnd },
    },
    _sum: { grossAmount: true },
    _count: { _all: true },
  });

  const salesByEmployee = new Map(
    salesAgg
      .filter((r) => r.employeeId != null)
      .map((r) => [
        r.employeeId as string,
        {
          totalSales: asNumber(r._sum.grossAmount),
          transactionCount: r._count._all,
        },
      ]),
  );

  const employees = await db.employeeMaster.findMany({
    where: {
      storeCode: { in: storeCodes },
      store: { vertical },
    },
    include: { store: true },
  });

  const rows: Omit<LeaderboardRow, "rank">[] = employees.map((e) => {
    const s = salesByEmployee.get(e.employeeId) ?? { totalSales: 0, transactionCount: 0 };
    return {
      employeeId: e.employeeId,
      employeeName: e.employeeName,
      role: e.role,
      storeCode: e.storeCode,
      storeName: e.store.storeName,
      city: e.store.city,
      totalSales: Math.round(s.totalSales),
      transactionCount: s.transactionCount,
      isViewer: e.employeeId === input.viewer.employeeId,
    };
  });

  rows.sort((a, b) => b.totalSales - a.totalSales);
  const totals = rows.map((r) => r.totalSales);
  const ranks = competitionRanks(totals);

  const leaderboard: LeaderboardRow[] = rows.map((r, i) => ({
    ...r,
    rank: ranks[i] ?? i + 1,
  }));

  return {
    metric: "TOTAL_SALES_GROSS",
    rankBy: "totalSales",
    scope: input.scope,
    vertical,
    verticalFilter: "VIEWER_STORE_VERTICAL_ONLY",
    city: employee.store.city,
    storeCode: input.scope === "store" ? scopeStoreCode : null,
    storeName: input.scope === "store" ? scopeStoreName : null,
    period,
    viewer: {
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
      storeCode: employee.storeCode,
      storeName: employee.store.storeName,
      city: employee.store.city,
      vertical,
      role: employee.role,
    },
    leaderboard,
  };
}
