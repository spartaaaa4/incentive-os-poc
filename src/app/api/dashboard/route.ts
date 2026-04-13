import { NextRequest, NextResponse } from "next/server";
import { Vertical } from "@prisma/client";
import { getDashboardData } from "@/server/services/dashboard";

export async function GET(request: NextRequest) {
  try {
    const verticalParam = request.nextUrl.searchParams.get("vertical");
    const vertical =
      verticalParam && ["ELECTRONICS", "GROCERY", "FNL"].includes(verticalParam)
        ? (verticalParam as Vertical)
        : undefined;

    const data = await getDashboardData(vertical);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json(
      {
        stats: { totalEmployees: 0, totalIncentiveMtd: 0, activeSchemes: 0, stores: 0 },
        alerts: { pendingApprovals: 0, belowThresholdStores: 0 },
        stores: [],
        topPerformers: [],
        error: error instanceof Error ? error.message : "Database connection failed",
      },
      { status: 200 },
    );
  }
}
