import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(request: Request) {
  try {
    const { planId, campaignId, campaignName, startDate, endDate, channel, articles, storeTargets, payoutSlabs } = await request.json();

    await db.$transaction(async (tx) => {
      await tx.incentivePlan.update({
        where: { id: planId },
        data: { status: "DRAFT" },
      });

      if (campaignId) {
        await tx.campaignConfig.update({
          where: { id: campaignId },
          data: {
            ...(campaignName ? { campaignName } : {}),
            ...(startDate ? { startDate: new Date(startDate) } : {}),
            ...(endDate ? { endDate: new Date(endDate) } : {}),
            ...(channel ? { channel } : {}),
            status: "DRAFT",
          },
        });

        if (articles) {
          await tx.campaignArticle.deleteMany({ where: { campaignId } });
          if (articles.length > 0) {
            await tx.campaignArticle.createMany({
              data: articles.map((a: { articleCode: string; brand: string; description: string }) => ({
                campaignId,
                articleCode: a.articleCode,
                brand: a.brand,
                description: a.description,
              })),
            });
          }
        }

        if (storeTargets) {
          await tx.campaignStoreTarget.deleteMany({ where: { campaignId } });
          if (storeTargets.length > 0) {
            await tx.campaignStoreTarget.createMany({
              data: storeTargets.map((t: { storeCode: string; targetValue: number }) => ({
                campaignId,
                storeCode: t.storeCode,
                targetValue: t.targetValue,
              })),
            });
          }
        }

        if (payoutSlabs) {
          await tx.campaignPayoutSlab.deleteMany({ where: { campaignId } });
          if (payoutSlabs.length > 0) {
            await tx.campaignPayoutSlab.createMany({
              data: payoutSlabs.map((s: { achievementFrom: number; achievementTo: number; perPieceRate: number }) => ({
                campaignId,
                achievementFrom: s.achievementFrom,
                achievementTo: s.achievementTo,
                perPieceRate: s.perPieceRate,
              })),
            });
          }
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Grocery rule update error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
