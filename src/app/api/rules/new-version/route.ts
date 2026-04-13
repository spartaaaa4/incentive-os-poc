import { NextResponse } from "next/server";
import { db } from "@/lib/db";

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) return (value as { toNumber: () => number }).toNumber();
  return Number(value ?? 0);
}

export async function POST(request: Request) {
  try {
    const { planId } = await request.json();

    const source = await db.incentivePlan.findUnique({
      where: { id: planId },
      include: {
        productIncentiveSlabs: true,
        achievementMultipliers: true,
        campaignConfigs: { include: { articles: true, storeTargets: true, payoutSlabs: true } },
        fnlRoleSplits: true,
      },
    });

    if (!source) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (source.status !== "ACTIVE") {
      return NextResponse.json({ error: "Can only create new version from ACTIVE plan" }, { status: 400 });
    }

    const newPlan = await db.incentivePlan.create({
      data: {
        planName: source.planName,
        vertical: source.vertical,
        formulaType: source.formulaType,
        periodType: source.periodType,
        status: "DRAFT",
        version: source.version + 1,
        config: source.config ?? undefined,
        createdBy: "admin",
      },
    });

    if (source.productIncentiveSlabs.length > 0) {
      await db.productIncentiveSlab.createMany({
        data: source.productIncentiveSlabs.map((s) => ({
          planId: newPlan.id,
          productFamily: s.productFamily,
          brandFilter: s.brandFilter,
          priceFrom: asNumber(s.priceFrom),
          priceTo: asNumber(s.priceTo),
          incentivePerUnit: asNumber(s.incentivePerUnit),
          effectiveFrom: s.effectiveFrom,
          effectiveTo: s.effectiveTo,
        })),
      });
    }

    if (source.achievementMultipliers.length > 0) {
      await db.achievementMultiplier.createMany({
        data: source.achievementMultipliers.map((m) => ({
          planId: newPlan.id,
          achievementFrom: asNumber(m.achievementFrom),
          achievementTo: asNumber(m.achievementTo),
          multiplierPct: asNumber(m.multiplierPct),
          effectiveFrom: m.effectiveFrom,
          effectiveTo: m.effectiveTo,
        })),
      });
    }

    for (const campaign of source.campaignConfigs) {
      const newCampaign = await db.campaignConfig.create({
        data: {
          planId: newPlan.id,
          campaignName: campaign.campaignName,
          startDate: campaign.startDate,
          endDate: campaign.endDate,
          channel: campaign.channel,
          distributionRule: campaign.distributionRule,
          status: "DRAFT",
        },
      });
      if (campaign.articles.length > 0) {
        await db.campaignArticle.createMany({
          data: campaign.articles.map((a) => ({
            campaignId: newCampaign.id,
            articleCode: a.articleCode,
            brand: a.brand,
            description: a.description,
          })),
        });
      }
      if (campaign.storeTargets.length > 0) {
        await db.campaignStoreTarget.createMany({
          data: campaign.storeTargets.map((t) => ({
            campaignId: newCampaign.id,
            storeCode: t.storeCode,
            targetValue: asNumber(t.targetValue),
          })),
        });
      }
      if (campaign.payoutSlabs.length > 0) {
        await db.campaignPayoutSlab.createMany({
          data: campaign.payoutSlabs.map((s) => ({
            campaignId: newCampaign.id,
            achievementFrom: asNumber(s.achievementFrom),
            achievementTo: asNumber(s.achievementTo),
            perPieceRate: asNumber(s.perPieceRate),
          })),
        });
      }
    }

    if (source.fnlRoleSplits.length > 0) {
      await db.fnlRoleSplit.createMany({
        data: source.fnlRoleSplits.map((r) => ({
          planId: newPlan.id,
          numSms: r.numSms,
          numDms: r.numDms,
          saPoolPct: asNumber(r.saPoolPct),
          smSharePct: asNumber(r.smSharePct),
          dmSharePerDmPct: asNumber(r.dmSharePerDmPct),
        })),
      });
    }

    await db.auditLog.create({
      data: {
        entityType: "PLAN",
        entityId: newPlan.id,
        action: "CREATED",
        newValue: { clonedFrom: source.id, version: newPlan.version },
        performedBy: "admin",
      },
    });

    return NextResponse.json({ planId: newPlan.id, version: newPlan.version });
  } catch (error) {
    console.error("New version error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
