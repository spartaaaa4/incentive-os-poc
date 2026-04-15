import { NextRequest, NextResponse } from "next/server";
import { startOfMonth, endOfMonth } from "date-fns";
import { db } from "@/lib/db";
import { recalculateIncentives } from "@/server/calculations/engines";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const month = body.month as string | undefined;
    const anchor = month ? new Date(month + "-15") : new Date("2026-04-13");
    const periodStart = startOfMonth(anchor);
    const periodEnd = endOfMonth(anchor);

    const allStores = await db.storeMaster.findMany({ select: { storeCode: true } });
    const storeCodes = allStores.map((s) => s.storeCode);

    if (!storeCodes.length) {
      return NextResponse.json({ error: "No stores found" }, { status: 400 });
    }

    await recalculateIncentives({ storeCodes, periodStart, periodEnd });

    const ledgerCount = await db.incentiveLedger.count({
      where: { periodStart: { gte: periodStart }, periodEnd: { lte: periodEnd } },
    });

    return NextResponse.json({
      message: `Recalculation complete for ${storeCodes.length} stores`,
      ledgerRows: ledgerCount,
    });
  } catch (error) {
    console.error("Recalculate error:", error);
    return NextResponse.json({ error: "Recalculation failed" }, { status: 500 });
  }
}
