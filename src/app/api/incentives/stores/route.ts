export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { startOfMonth, endOfMonth } from "date-fns";
import { getAllStoresSummary } from "@/server/services/incentives";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const now = new Date("2026-04-13");
    const periodStart = sp.get("periodStart") ? new Date(sp.get("periodStart")!) : startOfMonth(now);
    const periodEnd = sp.get("periodEnd") ? new Date(sp.get("periodEnd")!) : endOfMonth(now);

    const result = await getAllStoresSummary({
      vertical: sp.get("vertical") ?? undefined,
      periodStart,
      periodEnd,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Incentives stores API error:", error);
    return NextResponse.json({ error: "Failed to fetch store incentive data" }, { status: 500 });
  }
}
