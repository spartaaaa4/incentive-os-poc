import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const groceryUpdateSchema = z.object({
  planId: z.number().int().positive(),
  campaignId: z.number().int().positive().optional(),
  campaignName: z.string().min(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  channel: z.enum(["OFFLINE", "ONLINE"]).optional(),
  articles: z.array(z.object({
    articleCode: z.string().min(1),
    brand: z.string().min(1),
    description: z.string().min(1),
  })).optional(),
  storeTargets: z.array(z.object({
    storeCode: z.string().min(1),
    targetValue: z.coerce.number().positive(),
  })).optional(),
  payoutSlabs: z.array(z.object({
    achievementFrom: z.coerce.number().nonnegative(),
    achievementTo: z.coerce.number().positive(),
    perPieceRate: z.coerce.number().nonnegative(),
  })).optional(),
});

export async function PUT(request: Request) {
  try {
    const parsed = groceryUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { planId, campaignId, campaignName, startDate, endDate, channel, articles, storeTargets, payoutSlabs } = parsed.data;

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
    return NextResponse.json({ error: "Failed to update grocery rules" }, { status: 500 });
  }
}
