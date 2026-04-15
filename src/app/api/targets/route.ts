export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const vertical = request.nextUrl.searchParams.get("vertical") ?? undefined;
    const where = vertical ? { vertical: vertical as "ELECTRONICS" | "GROCERY" | "FNL" } : {};

    const targets = await db.target.findMany({
      where,
      include: { store: true },
      orderBy: [{ periodStart: "desc" }, { storeCode: "asc" }],
      take: 500,
    });

    return NextResponse.json({
      targets: targets.map((t) => ({
        id: t.id,
        storeCode: t.storeCode,
        storeName: t.store.storeName,
        state: t.store.state,
        vertical: t.vertical,
        department: t.department,
        productFamilyCode: t.productFamilyCode,
        productFamilyName: t.productFamilyName,
        targetValue: Number(t.targetValue),
        periodType: t.periodType,
        periodStart: t.periodStart.toISOString().slice(0, 10),
        periodEnd: t.periodEnd.toISOString().slice(0, 10),
        status: t.status,
      })),
    });
  } catch (error) {
    console.error("Targets API error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
