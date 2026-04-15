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
    const search = request.nextUrl.searchParams.get("search") ?? undefined;
    const page = parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10);
    const pageSize = parseInt(request.nextUrl.searchParams.get("pageSize") ?? "100", 10);

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
      search,
      page: isNaN(page) ? 1 : page,
      pageSize: isNaN(pageSize) ? 100 : pageSize,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("Sales API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Database connection failed" },
      { status: 500 },
    );
  }
}
