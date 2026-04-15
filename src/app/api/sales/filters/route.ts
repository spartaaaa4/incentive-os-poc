export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const [stores, employees] = await Promise.all([
      db.storeMaster.findMany({
        select: { storeCode: true, storeName: true, vertical: true },
        orderBy: { storeCode: "asc" },
      }),
      db.employeeMaster.findMany({
        where: { payrollStatus: "ACTIVE" },
        select: { employeeId: true, employeeName: true, storeCode: true },
        orderBy: { employeeName: "asc" },
      }),
    ]);

    return NextResponse.json({ stores, employees });
  } catch (error) {
    console.error("Sales filters API error:", error);
    return NextResponse.json({ error: "Failed to fetch filters" }, { status: 500 });
  }
}
