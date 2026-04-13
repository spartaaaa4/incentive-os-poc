import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const vertical = request.nextUrl.searchParams.get("vertical") ?? undefined;
    const where = vertical ? { vertical: vertical as "ELECTRONICS" | "GROCERY" | "FNL" } : {};

    const plans = await db.incentivePlan.findMany({
      where,
      include: {
        productIncentiveSlabs: true,
        achievementMultipliers: { orderBy: { achievementFrom: "asc" } },
        campaignConfigs: {
          include: {
            articles: true,
            storeTargets: { include: { store: true } },
            payoutSlabs: { orderBy: { achievementFrom: "asc" } },
          },
        },
        fnlRoleSplits: { orderBy: { numDms: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ plans });
  } catch (error) {
    console.error("Rules API error:", error);
    return NextResponse.json({ plans: [], error: String(error) }, { status: 200 });
  }
}
