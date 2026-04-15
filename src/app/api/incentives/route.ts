export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { startOfMonth, endOfMonth } from "date-fns";
import { getIncentiveDrilldown } from "@/server/services/incentives";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const now = new Date("2026-04-13");
    const periodStart = sp.get("periodStart") ? new Date(sp.get("periodStart")!) : startOfMonth(now);
    const periodEnd = sp.get("periodEnd") ? new Date(sp.get("periodEnd")!) : endOfMonth(now);

    const result = await getIncentiveDrilldown({
      vertical: sp.get("vertical") ?? undefined,
      city: sp.get("city") ?? undefined,
      storeCode: sp.get("storeCode") ?? undefined,
      department: sp.get("department") ?? undefined,
      employeeId: sp.get("employeeId") ?? undefined,
      periodStart,
      periodEnd,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Incentives API error:", error);
    return NextResponse.json({ error: "Failed to fetch incentive data" }, { status: 500 });
  }
}
