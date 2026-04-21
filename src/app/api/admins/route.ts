export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";

/**
 * List employees with optional admin-access detail.
 *
 * Query params:
 *   `adminsOnly=true` — only employees with hasAdminAccess=true
 *   `q=<search>`      — match on employeeId or employeeName
 */
export async function GET(request: NextRequest) {
  const auth = await requirePermission(request, "canManageUsers");
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const adminsOnly = url.searchParams.get("adminsOnly") === "true";
  const q = url.searchParams.get("q")?.trim() ?? "";

  const employees = await db.employeeMaster.findMany({
    where: {
      ...(adminsOnly ? { hasAdminAccess: true } : {}),
      ...(q
        ? {
            OR: [
              { employeeId: { contains: q, mode: "insensitive" } },
              { employeeName: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      adminAccess: true,
      store: { select: { storeName: true, vertical: true } },
    },
    orderBy: [{ hasAdminAccess: "desc" }, { employeeName: "asc" }],
    take: 200,
  });

  return NextResponse.json({
    items: employees.map((e) => ({
      employeeId: e.employeeId,
      employeeName: e.employeeName,
      role: e.role,
      storeCode: e.storeCode,
      storeName: e.store.storeName,
      vertical: e.store.vertical,
      hasAdminAccess: e.hasAdminAccess,
      adminAccess: e.adminAccess
        ? {
            verticals: e.adminAccess.verticals,
            canViewAll: e.adminAccess.canViewAll,
            canEditIncentives: e.adminAccess.canEditIncentives,
            canSubmitApproval: e.adminAccess.canSubmitApproval,
            canApprove: e.adminAccess.canApprove,
            canManageUsers: e.adminAccess.canManageUsers,
            canUploadData: e.adminAccess.canUploadData,
            grantedBy: e.adminAccess.grantedBy,
            grantedAt: e.adminAccess.grantedAt,
            updatedAt: e.adminAccess.updatedAt,
          }
        : null,
    })),
  });
}
