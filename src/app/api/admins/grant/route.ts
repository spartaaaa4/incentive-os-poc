export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Vertical } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";

/**
 * Grant or update admin access for an employee. Upserts EmployeeAdminAccess
 * and flips EmployeeMaster.hasAdminAccess=true. Only `canManageUsers` holders
 * can call this.
 *
 * `verticals: []` means super-admin (all verticals). UI should require an
 * explicit opt-in checkbox for that.
 */
const grantSchema = z.object({
  employeeId: z.string().min(1),
  verticals: z.array(z.nativeEnum(Vertical)).default([]),
  canViewAll: z.boolean().default(false),
  canEditIncentives: z.boolean().default(false),
  canSubmitApproval: z.boolean().default(false),
  canApprove: z.boolean().default(false),
  canManageUsers: z.boolean().default(false),
  canUploadData: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, "canManageUsers");
  if ("error" in auth) return auth.error;

  const parsed = grantSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const data = parsed.data;

  const emp = await db.employeeMaster.findUnique({ where: { employeeId: data.employeeId } });
  if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  // Guardrail: only a super-admin (caller.verticals=[]) can grant super-admin
  // or canManageUsers to another user. Vertical-scoped admins can only grant
  // rights within their own verticals.
  const callerIsSuper = auth.identity.verticals.length === 0;
  if (!callerIsSuper) {
    if (data.verticals.length === 0) {
      return NextResponse.json(
        { error: "Only super-admins can grant all-vertical access." },
        { status: 403 },
      );
    }
    const outOfScope = data.verticals.filter((v) => !auth.identity.verticals.includes(v));
    if (outOfScope.length) {
      return NextResponse.json(
        { error: `Cannot grant access to verticals outside your own scope: ${outOfScope.join(", ")}` },
        { status: 403 },
      );
    }
    if (data.canManageUsers) {
      return NextResponse.json(
        { error: "Only super-admins can grant canManageUsers." },
        { status: 403 },
      );
    }
  }

  await db.$transaction(async (tx) => {
    await tx.employeeMaster.update({
      where: { employeeId: data.employeeId },
      data: { hasAdminAccess: true },
    });

    await tx.employeeAdminAccess.upsert({
      where: { employeeId: data.employeeId },
      create: {
        employeeId: data.employeeId,
        verticals: data.verticals,
        canViewAll: data.canViewAll,
        canEditIncentives: data.canEditIncentives,
        canSubmitApproval: data.canSubmitApproval,
        canApprove: data.canApprove,
        canManageUsers: data.canManageUsers,
        canUploadData: data.canUploadData,
        grantedBy: auth.identity.employeeId,
      },
      update: {
        verticals: data.verticals,
        canViewAll: data.canViewAll,
        canEditIncentives: data.canEditIncentives,
        canSubmitApproval: data.canSubmitApproval,
        canApprove: data.canApprove,
        canManageUsers: data.canManageUsers,
        canUploadData: data.canUploadData,
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: "PLAN", // AuditLog has no USER type; reusing nearest bucket (TODO: add AuditEntityType.ADMIN_ACCESS)
        entityId: 0,
        action: "CREATED",
        newValue: {
          type: "ADMIN_GRANT",
          targetEmployeeId: data.employeeId,
          verticals: data.verticals,
          flags: {
            canViewAll: data.canViewAll,
            canEditIncentives: data.canEditIncentives,
            canSubmitApproval: data.canSubmitApproval,
            canApprove: data.canApprove,
            canManageUsers: data.canManageUsers,
            canUploadData: data.canUploadData,
          },
        },
        performedBy: auth.identity.employeeId,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
