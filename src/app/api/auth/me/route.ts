export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const employee = await db.employeeMaster.findUnique({
    where: { employeeId: auth.user.employeeId },
    include: { store: true, adminAccess: true },
  });

  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const hasAdminAccess = Boolean(employee.hasAdminAccess && employee.adminAccess);
  const adminAccess = hasAdminAccess && employee.adminAccess
    ? {
        verticals: employee.adminAccess.verticals,
        canViewAll: employee.adminAccess.canViewAll,
        canEditIncentives: employee.adminAccess.canEditIncentives,
        canSubmitApproval: employee.adminAccess.canSubmitApproval,
        canApprove: employee.adminAccess.canApprove,
        canManageUsers: employee.adminAccess.canManageUsers,
        canUploadData: employee.adminAccess.canUploadData,
      }
    : null;

  return NextResponse.json({
    user: {
      employerId: auth.user.employerId,
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
      role: employee.role,
      department: employee.department,
      storeCode: employee.storeCode,
      storeName: employee.store.storeName,
      vertical: employee.store.vertical,
      storeFormat: employee.store.storeFormat,
      state: employee.store.state,
      city: employee.store.city,
      storeStatus: employee.store.storeStatus,
      payrollStatus: employee.payrollStatus,
      hasAdminAccess,
      adminAccess,
    },
  });
}
