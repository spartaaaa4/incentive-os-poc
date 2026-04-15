import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type SubmittedPlan = Prisma.IncentivePlanGetPayload<{
  include: {
    productIncentiveSlabs: true;
    achievementMultipliers: true;
    campaignConfigs: { include: { articles: true; storeTargets: true; payoutSlabs: true } };
    fnlRoleSplits: true;
  };
}>;

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "toNumber" in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v ?? 0);
}

export type PlanApprovalDetail = {
  planId: number;
  planName: string;
  vertical: string;
  formulaType: string;
  periodType: string;
  version: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  submittedBy: string | null;
  createdBy: string | null;
  config: Record<string, unknown> | null;
  slabs: Array<{
    productFamily: string;
    brandFilter: string;
    priceFrom: number;
    priceTo: number;
    incentivePerUnit: number;
  }>;
  achievementMultipliers: Array<{
    achievementFrom: number;
    achievementTo: number;
    multiplierPct: number;
  }>;
  campaignConfigs: Array<{
    id: number;
    campaignName: string;
    startDate: string;
    endDate: string;
    channel: string;
    articlesCount: number;
    storeTargetsCount: number;
    payoutSlabsCount: number;
  }>;
  fnlRoleSplits: Array<{
    numSms: number;
    numDms: number;
    saPoolPct: number;
    smSharePct: number;
    dmSharePerDmPct: number;
  }>;
};

export type TargetApprovalRow = {
  id: number;
  storeCode: string;
  storeName: string;
  department: string | null;
  productFamilyName: string | null;
  targetValue: number;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  vertical: string;
};

export type TargetApprovalDetail = {
  rows: TargetApprovalRow[];
  vertical: string;
  periodType: string;
  rowCount: number;
};

export type PendingPlanItem = {
  id: number;
  entityType: "PLAN";
  entityId: number;
  title: string;
  vertical: string;
  submittedBy: string;
  submittedAt: string;
  summary: string;
  planDetail: PlanApprovalDetail;
};

export type PendingTargetItem = {
  id: string;
  entityType: "TARGET";
  entityId: number;
  title: string;
  vertical: string;
  submittedBy: string;
  submittedAt: string;
  summary: string;
  targetDetail: TargetApprovalDetail;
};

export type PendingApprovalItem = PendingPlanItem | PendingTargetItem;

function planDetailFromDb(p: SubmittedPlan): PlanApprovalDetail {
  return {
    planId: p.id,
    planName: p.planName,
    vertical: p.vertical,
    formulaType: p.formulaType,
    periodType: p.periodType,
    version: p.version,
    effectiveFrom: p.effectiveFrom ? p.effectiveFrom.toISOString().slice(0, 10) : null,
    effectiveTo: p.effectiveTo ? p.effectiveTo.toISOString().slice(0, 10) : null,
    submittedBy: p.submittedBy,
    createdBy: p.createdBy,
    config: (p.config && typeof p.config === "object" ? p.config as Record<string, unknown> : null) ?? null,
    slabs: p.productIncentiveSlabs.map((s) => ({
      productFamily: s.productFamily,
      brandFilter: s.brandFilter,
      priceFrom: num(s.priceFrom),
      priceTo: num(s.priceTo),
      incentivePerUnit: num(s.incentivePerUnit),
    })),
    achievementMultipliers: p.achievementMultipliers.map((m) => ({
      achievementFrom: num(m.achievementFrom),
      achievementTo: num(m.achievementTo),
      multiplierPct: num(m.multiplierPct),
    })),
    campaignConfigs: p.campaignConfigs.map((c) => ({
      id: c.id,
      campaignName: c.campaignName,
      startDate: c.startDate.toISOString().slice(0, 10),
      endDate: c.endDate.toISOString().slice(0, 10),
      channel: c.channel,
      articlesCount: c.articles.length,
      storeTargetsCount: c.storeTargets.length,
      payoutSlabsCount: c.payoutSlabs.length,
    })),
    fnlRoleSplits: p.fnlRoleSplits.map((r) => ({
      numSms: r.numSms,
      numDms: r.numDms,
      saPoolPct: num(r.saPoolPct),
      smSharePct: num(r.smSharePct),
      dmSharePerDmPct: num(r.dmSharePerDmPct),
    })),
  };
}

function targetRowsFromList(
  list: Array<{
    id: number;
    storeCode: string;
    vertical: string;
    department: string | null;
    productFamilyName: string | null;
    targetValue: unknown;
    periodType: string;
    periodStart: Date;
    periodEnd: Date;
    store: { storeName: string };
  }>,
): TargetApprovalDetail {
  const first = list[0];
  return {
    vertical: first.vertical,
    periodType: first.periodType,
    rowCount: list.length,
    rows: list.map((t) => ({
      id: t.id,
      storeCode: t.storeCode,
      storeName: t.store.storeName,
      department: t.department,
      productFamilyName: t.productFamilyName,
      targetValue: Math.round(num(t.targetValue)),
      periodType: t.periodType,
      periodStart: t.periodStart.toISOString().slice(0, 10),
      periodEnd: t.periodEnd.toISOString().slice(0, 10),
      vertical: t.vertical,
    })),
  };
}

export async function fetchPendingApprovalItems(): Promise<PendingApprovalItem[]> {
  const [plans, targets] = await Promise.all([
    db.incentivePlan.findMany({
      where: { status: "SUBMITTED" },
      include: {
        productIncentiveSlabs: true,
        achievementMultipliers: true,
        campaignConfigs: { include: { articles: true, storeTargets: true, payoutSlabs: true } },
        fnlRoleSplits: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.target.findMany({
      where: { status: "SUBMITTED" },
      include: { store: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const planItems: PendingPlanItem[] = plans.map((p) => ({
    id: p.id,
    entityType: "PLAN",
    entityId: p.id,
    title: p.planName,
    vertical: p.vertical,
    submittedBy: p.submittedBy ?? "admin",
    submittedAt: p.updatedAt.toISOString(),
    summary:
      p.formulaType === "PER_UNIT"
        ? `Electronics-style plan — ${p.productIncentiveSlabs.length} product slabs, ${p.achievementMultipliers.length} achievement tiers`
        : p.formulaType === "CAMPAIGN_SLAB"
          ? `Grocery campaign plan — ${p.campaignConfigs.length} campaign(s)`
          : `F&L weekly pool — ${p.fnlRoleSplits.length} role-split row(s)`,
    planDetail: planDetailFromDb(p),
  }));

  const targetGroups = new Map<string, typeof targets>();
  for (const t of targets) {
    const key = `${t.vertical}-${t.periodType}`;
    const list = targetGroups.get(key) ?? [];
    list.push(t);
    targetGroups.set(key, list);
  }

  const targetItems: PendingTargetItem[] = [...targetGroups.entries()].map(([key, list]) => {
    const first = list[0];
    return {
      id: `target-${key}`,
      entityType: "TARGET",
      entityId: first.id,
      title: `Target batch — ${first.vertical} / ${first.periodType}`,
      vertical: first.vertical,
      submittedBy: first.submittedBy ?? "admin",
      submittedAt: first.createdAt.toISOString(),
      summary: `${list.length} store-level target row(s)`,
      targetDetail: targetRowsFromList(list),
    };
  });

  return [...planItems, ...targetItems];
}
