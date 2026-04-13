import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const fnlUpdateSchema = z.object({
  planId: z.number().int().positive(),
  roleSplits: z.array(z.object({
    numSms: z.coerce.number().int().nonnegative(),
    numDms: z.coerce.number().int().nonnegative(),
    saPoolPct: z.coerce.number().nonnegative(),
    smSharePct: z.coerce.number().nonnegative(),
    dmSharePerDmPct: z.coerce.number().nonnegative().default(0),
  })).optional(),
  config: z.any().optional(),
});

export async function PUT(request: Request) {
  try {
    const parsed = fnlUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { planId, roleSplits, config } = parsed.data;

    await db.$transaction(async (tx) => {
      await tx.incentivePlan.update({
        where: { id: planId },
        data: { status: "DRAFT", ...(config ? { config } : {}) },
      });

      if (roleSplits) {
        await tx.fnlRoleSplit.deleteMany({ where: { planId } });
        await tx.fnlRoleSplit.createMany({
          data: roleSplits.map((r) => ({
            planId,
            numSms: r.numSms,
            numDms: r.numDms,
            saPoolPct: r.saPoolPct,
            smSharePct: r.smSharePct,
            dmSharePerDmPct: r.dmSharePerDmPct,
          })),
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("F&L rule update error:", error);
    return NextResponse.json({ error: "Failed to update F&L rules" }, { status: 500 });
  }
}
