import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const storeCode = searchParams.get("storeCode") ?? auth.user.storeCode;

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
