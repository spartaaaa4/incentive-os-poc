import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(request: Request) {
  try {
    const { planId, slabs, multipliers } = await request.json();

    await db.$transaction(async (tx) => {
      await tx.incentivePlan.update({
        where: { id: planId },
        data: { status: "DRAFT" },
      });

      if (slabs) {
        await tx.productIncentiveSlab.deleteMany({ where: { planId } });
        await tx.productIncentiveSlab.createMany({
          data: slabs.map((s: Record<string, unknown>) => ({
            planId,
            productFamily: s.productFamily,
            brandFilter: s.brandFilter,
            priceFrom: Number(s.priceFrom),
            priceTo: Number(s.priceTo),
            incentivePerUnit: Number(s.incentivePerUnit),
            effectiveFrom: s.effectiveFrom ? new Date(s.effectiveFrom as string) : null,
          })),
        });
      }

      if (multipliers) {
        await tx.achievementMultiplier.deleteMany({ where: { planId } });
        await tx.achievementMultiplier.createMany({
          data: multipliers.map((m: Record<string, unknown>) => ({
            planId,
            achievementFrom: Number(m.achievementFrom),
            achievementTo: Number(m.achievementTo),
            multiplierPct: Number(m.multiplierPct),
            effectiveFrom: m.effectiveFrom ? new Date(m.effectiveFrom as string) : null,
          })),
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Electronics rule update error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
