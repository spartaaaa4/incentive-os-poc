export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { TransactionType, Vertical } from "@prisma/client";
import { listSales } from "@/server/services/sales";

export async function GET(request: NextRequest) {
  try {
    const verticalParam = request.nextUrl.searchParams.get("vertical");
    const transactionTypeParam = request.nextUrl.searchParams.get("transactionType");
    const storeCode = request.nextUrl.searchParams.get("storeCode") ?? undefined;
    const employeeId = request.nextUrl.searchParams.get("employeeId") ?? undefined;
    const dateFrom = request.nextUrl.searchParams.get("dateFrom");
    const dateTo = request.nextUrl.searchParams.get("dateTo");

    const data = await listSales({
      vertical:
        verticalParam && ["ELECTRONICS", "GROCERY", "FNL"].includes(verticalParam)
          ? (verticalParam as Vertical)
          : undefined,
      transactionType:
        transactionTypeParam && ["NORMAL", "SFS", "PAS", "JIOMART"].includes(transactionTypeParam)
          ? (transactionTypeParam as TransactionType)
          : undefined,
      storeCode,
      employeeId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    });

    return NextResponse.json({ rows: data });
  } catch (error) {
    console.error("Sales API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Database connection failed" },
      { status: 500 },
    );
  }
}
