import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(request: Request) {
  try {
    const { planId, roleSplits, config } = await request.json();

    await db.$transaction(async (tx) => {
      if (config) {
        await tx.incentivePlan.update({
          where: { id: planId },
          data: { config },
        });
      }

      if (roleSplits) {
        await tx.fnlRoleSplit.deleteMany({ where: { planId } });
        await tx.fnlRoleSplit.createMany({
          data: roleSplits.map((r: Record<string, unknown>) => ({
            planId,
            numSms: Number(r.numSms),
            numDms: Number(r.numDms),
            saPoolPct: Number(r.saPoolPct),
            smSharePct: Number(r.smSharePct),
            dmSharePerDmPct: Number(r.dmSharePerDmPct ?? 0),
          })),
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("F&L rule update error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
