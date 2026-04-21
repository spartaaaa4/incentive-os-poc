export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";

const revokeSchema = z.object({
  employeeId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, "canManageUsers");
  if ("error" in auth) return auth.error;

  const parsed = revokeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { employeeId } = parsed.data;

  // Self-revoke guard: don't let an admin lock themselves out (and lock the
  // tenant out of user-management if they're the last super-admin).
  if (employeeId === auth.identity.employeeId) {
    return NextResponse.json(
      { error: "You cannot revoke your own admin access. Ask another super-admin." },
      { status: 400 },
    );
  }

  const existing = await db.employeeAdminAccess.findUnique({ where: { employeeId } });
  if (!existing) return NextResponse.json({ error: "No admin access to revoke" }, { status: 404 });

  // Last-super-admin guard: if the target is a super-admin (verticals=[]) AND
  // they're the last one with canManageUsers, refuse. Otherwise the system
  // locks itself out of admin management.
  if (existing.verticals.length === 0 && existing.canManageUsers) {
    const remaining = await db.employeeAdminAccess.count({
      where: {
        canManageUsers: true,
        verticals: { isEmpty: true },
        NOT: { employeeId },
      },
    });
    if (remaining === 0) {
      return NextResponse.json(
        { error: "Cannot revoke the last super-admin. Grant another super-admin first." },
        { status: 400 },
      );
    }
  }

  // Scope guard: vertical-scoped admins cannot revoke super-admins or admins
  // outside their scope.
  const callerIsSuper = auth.identity.verticals.length === 0;
  if (!callerIsSuper) {
    if (existing.verticals.length === 0) {
      return NextResponse.json(
        { error: "Only super-admins can revoke other super-admins." },
        { status: 403 },
      );
    }
    const outOfScope = existing.verticals.filter((v) => !auth.identity.verticals.includes(v));
    if (outOfScope.length) {
      return NextResponse.json(
        { error: `Target admin holds access to verticals outside your scope: ${outOfScope.join(", ")}` },
        { status: 403 },
      );
    }
  }

  await db.$transaction(async (tx) => {
    await tx.employeeAdminAccess.delete({ where: { employeeId } });
    await tx.employeeMaster.update({
      where: { employeeId },
      data: { hasAdminAccess: false },
    });
    await tx.auditLog.create({
      data: {
        entityType: "PLAN", // TODO: add AuditEntityType.ADMIN_ACCESS
        entityId: 0,
        action: "REJECTED", // closest verb for "revoked"; newValue.type carries the semantics
        newValue: { type: "ADMIN_REVOKE", targetEmployeeId: employeeId },
        performedBy: auth.identity.employeeId,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
