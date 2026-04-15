export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const electronicsUpdateSchema = z.object({
  planId: z.number().int().positive(),
  slabs: z.array(z.object({
    productFamily: z.string().min(1),
    brandFilter: z.string().min(1),
    priceFrom: z.coerce.number().nonnegative(),
    priceTo: z.coerce.number().positive(),
    incentivePerUnit: z.coerce.number().nonnegative(),
    effectiveFrom: z.string().nullable().optional(),
  })).optional(),
  multipliers: z.array(z.object({
    achievementFrom: z.coerce.number().nonnegative(),
    achievementTo: z.coerce.number().positive(),
    multiplierPct: z.coerce.number().nonnegative(),
    effectiveFrom: z.string().nullable().optional(),
  })).optional(),
});

export async function PUT(request: Request) {
  try {
    const parsed = electronicsUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { planId, slabs, multipliers } = parsed.data;

    await db.$transaction(async (tx) => {
      await tx.incentivePlan.update({
        where: { id: planId },
        data: { status: "DRAFT" },
      });

      if (slabs) {
        await tx.productIncentiveSlab.deleteMany({ where: { planId } });
        await tx.productIncentiveSlab.createMany({
          data: slabs.map((s) => ({
            planId,
            productFamily: s.productFamily,
            brandFilter: s.brandFilter,
            priceFrom: s.priceFrom,
            priceTo: s.priceTo,
            incentivePerUnit: s.incentivePerUnit,
            effectiveFrom: s.effectiveFrom ? new Date(s.effectiveFrom) : null,
          })),
        });
      }

      if (multipliers) {
        await tx.achievementMultiplier.deleteMany({ where: { planId } });
        await tx.achievementMultiplier.createMany({
          data: multipliers.map((m) => ({
            planId,
            achievementFrom: m.achievementFrom,
            achievementTo: m.achievementTo,
            multiplierPct: m.multiplierPct,
            effectiveFrom: m.effectiveFrom ? new Date(m.effectiveFrom) : null,
          })),
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Electronics rule update error:", error);
    return NextResponse.json({ error: "Failed to update electronics rules" }, { status: 500 });
  }
}
