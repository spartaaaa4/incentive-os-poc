export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  // Try JWT auth but don't require it — admin dashboard calls this without a token
  const auth = await authenticateRequest(request);
  const userStoreCode = "error" in auth ? null : auth.user.storeCode;

  const { searchParams } = new URL(request.url);
  const storeCode = searchParams.get("storeCode") ?? userStoreCode;
  if (!storeCode) {
    return NextResponse.json({ error: "storeCode query parameter is required" }, { status: 400 });
  }

  const employees = await db.employeeMaster.findMany({
    where: { storeCode, payrollStatus: "ACTIVE" },
    include: { store: { select: { storeName: true, vertical: true } } },
    orderBy: { employeeName: "asc" },
  });

  return NextResponse.json({
    employees: employees.map((e) => ({
      employeeId: e.employeeId,
      employeeName: e.employeeName,
      role: e.role,
      storeCode: e.storeCode,
      storeName: e.store.storeName,
      vertical: e.store.vertical,
      department: e.department,
      payrollStatus: e.payrollStatus,
    })),
  });
}
