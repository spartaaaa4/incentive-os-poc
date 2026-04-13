import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const tab = request.nextUrl.searchParams.get("tab") ?? "pending";

    if (tab === "pending") {
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

      const items = [
        ...plans.map((p) => ({
          id: p.id,
          entityType: "PLAN" as const,
          entityId: p.id,
          title: p.planName,
          vertical: p.vertical,
          submittedBy: p.submittedBy ?? "admin",
          submittedAt: p.updatedAt.toISOString(),
          summary: p.formulaType === "PER_UNIT"
            ? `Electronics slabs — ${p.productIncentiveSlabs.length} rows, ${p.achievementMultipliers.length} multiplier tiers`
            : p.formulaType === "CAMPAIGN_SLAB"
              ? `Grocery campaign — ${p.campaignConfigs.length} campaigns`
              : `F&L pool config — ${p.fnlRoleSplits.length} role splits`,
          details: p,
        })),
        ...groupTargets(targets),
      ];

      return NextResponse.json({ items });
    }

    const history = await db.auditLog.findMany({
      orderBy: { performedAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ history });
  } catch (error) {
    console.error("Approvals API error:", error);
    return NextResponse.json({ items: [], history: [], error: String(error) }, { status: 200 });
  }
}

function groupTargets(targets: Array<Record<string, unknown>>) {
  const groups = new Map<string, typeof targets>();
  for (const t of targets) {
    const key = `${t.vertical}-${t.periodType}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, list]) => ({
    id: `target-${key}`,
    entityType: "TARGET" as const,
    entityId: (list[0] as { id: number }).id,
    title: `Target Upload — ${key}`,
    vertical: (list[0] as { vertical: string }).vertical,
    submittedBy: ((list[0] as { submittedBy?: string }).submittedBy) ?? "admin",
    submittedAt: ((list[0] as { createdAt: Date }).createdAt).toISOString(),
    summary: `${list.length} target rows`,
    details: list,
  }));
}
