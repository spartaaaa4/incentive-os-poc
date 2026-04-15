import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const vertical = searchParams.get("vertical");

  const stores = await db.storeMaster.findMany({
    where: vertical ? { vertical: vertical as "ELECTRONICS" | "GROCERY" | "FNL" } : undefined,
    orderBy: { storeName: "asc" },
  });

  return NextResponse.json({
    stores: stores.map((s) => ({
      storeCode: s.storeCode,
      storeName: s.storeName,
      vertical: s.vertical,
      storeFormat: s.storeFormat,
      state: s.state,
      city: s.city,
      storeStatus: s.storeStatus,
    })),
  });
}
