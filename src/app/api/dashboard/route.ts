export const dynamic = "force-dynamic";
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

    const monthParam = request.nextUrl.searchParams.get("month");

    const data = await getDashboardData(vertical, monthParam ?? undefined);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Database connection failed" },
      { status: 500 },
    );
  }
}
