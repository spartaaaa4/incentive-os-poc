export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { startOfMonth, endOfMonth } from "date-fns";
import { db } from "@/lib/db";
import { recalculateIncentives } from "@/server/calculations/engines";
import { requirePermission } from "@/lib/permissions";

async function runRecalculate(storeCode: string | null, month: string | null) {
  const anchor = month ? new Date(month + "-15") : new Date("2026-04-13");
  const periodStart = startOfMonth(anchor);
  const periodEnd = endOfMonth(anchor);

  let storeCodes: string[];
  if (storeCode) {
    storeCodes = [storeCode];
  } else {
    const allStores = await db.storeMaster.findMany({ select: { storeCode: true } });
    storeCodes = allStores.map((s) => s.storeCode);
  }

  if (!storeCodes.length) {
    return { error: "No stores found", status: 400 as const };
  }

  await recalculateIncentives({ storeCodes, periodStart, periodEnd, trigger: "MANUAL_RECOMPUTE" });

  const ledgerCount = await db.incentiveLedger.count({
    where: {
      storeCode: { in: storeCodes },
      periodStart: { gte: periodStart },
      periodEnd: { lte: periodEnd },
    },
  });

  return {
    message: `Recalculation complete for ${storeCodes.length} store(s)`,
    stores: storeCodes,
    ledgerRows: ledgerCount,
    period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePermission(request, "canEditIncentives");
    if ("error" in auth) return auth.error;

    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get("storeCode");
    const month = searchParams.get("month");
    const result = await runRecalculate(storeCode, month);
    if ("status" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Recalculate GET error:", error);
    return NextResponse.json({ error: "Recalculation failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePermission(request, "canEditIncentives");
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const month = body.month as string | undefined;
    const storeCode = body.storeCode as string | undefined;
    const result = await runRecalculate(storeCode ?? null, month ?? null);
    if ("status" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Recalculate POST error:", error);
    return NextResponse.json({ error: "Recalculation failed" }, { status: 500 });
  }
}
