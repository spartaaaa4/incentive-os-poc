import { NextRequest, NextResponse } from "next/server";
import { Vertical } from "@prisma/client";
import { getDashboardData } from "@/server/services/dashboard";

export async function GET(request: NextRequest) {
  const verticalParam = request.nextUrl.searchParams.get("vertical");
  const vertical =
    verticalParam && ["ELECTRONICS", "GROCERY", "FNL"].includes(verticalParam)
      ? (verticalParam as Vertical)
      : undefined;

  const data = await getDashboardData(vertical);
  return NextResponse.json(data);
}
