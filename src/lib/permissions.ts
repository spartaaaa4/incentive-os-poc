import { NextRequest, NextResponse } from "next/server";
import type { Vertical } from "@prisma/client";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";

/**
 * Granular admin permission flags. Checked per-call by `requirePermission`.
 *
 *   canViewAll        — read any vertical's dashboard/leaderboard
 *   canEditIncentives — create/edit plans, campaigns, slabs, multipliers
 *   canSubmitApproval — flip a plan or target batch to SUBMITTED
 *   canApprove        — approve/reject a submitted ApprovalRequest
 *   canManageUsers    — grant/revoke admin access for other employees
 *   canUploadData     — attendance upload, sales CSV import
 */
export type AdminPermissionFlag =
  | "canViewAll"
  | "canEditIncentives"
  | "canSubmitApproval"
  | "canApprove"
  | "canManageUsers"
  | "canUploadData";

export type AdminIdentity = {
  employeeId: string;
  employerId: string;
  employeeName: string;
  role: string;
  storeCode: string;
  hasAdminAccess: boolean;
  verticals: Vertical[]; // empty array = all verticals (super-admin)
  permissions: Record<AdminPermissionFlag, boolean>;
};

/**
 * Load the authenticated caller's admin identity + permissions.
 * Returns `null` when the user has no admin grant (i.e. hasAdminAccess=false
 * or no EmployeeAdminAccess row).
 */
export async function loadAdminIdentity(employeeId: string): Promise<AdminIdentity | null> {
  const employee = await db.employeeMaster.findUnique({
    where: { employeeId },
    include: {
      adminAccess: true,
      credential: { select: { employerId: true } },
    },
  });

  if (!employee || !employee.hasAdminAccess || !employee.adminAccess) {
    return null;
  }

  const a = employee.adminAccess;
  return {
    employeeId: employee.employeeId,
    employerId: employee.credential?.employerId ?? employee.employeeId,
    employeeName: employee.employeeName,
    role: employee.role,
    storeCode: employee.storeCode,
    hasAdminAccess: true,
    verticals: a.verticals,
    permissions: {
      canViewAll: a.canViewAll,
      canEditIncentives: a.canEditIncentives,
      canSubmitApproval: a.canSubmitApproval,
      canApprove: a.canApprove,
      canManageUsers: a.canManageUsers,
      canUploadData: a.canUploadData,
    },
  };
}

/**
 * Permission check. `verticals: []` on the grant means super-admin (all
 * verticals). If `vertical` is supplied, the admin must either be super-admin
 * or have that vertical in their allow-list.
 */
export function hasPermission(
  identity: AdminIdentity,
  flag: AdminPermissionFlag,
  opts?: { vertical?: Vertical | null },
): boolean {
  if (!identity.permissions[flag]) return false;
  if (!opts?.vertical) return true;
  if (identity.verticals.length === 0) return true; // super-admin
  return identity.verticals.includes(opts.vertical);
}

/**
 * Express-style guard for API routes. Returns either the hydrated identity
 * or a NextResponse with 401/403 that the caller should return directly.
 *
 *     const auth = await requirePermission(request, "canApprove", { vertical });
 *     if ("error" in auth) return auth.error;
 *     // ... use auth.identity
 */
export async function requirePermission(
  request: NextRequest,
  flag: AdminPermissionFlag,
  opts?: { vertical?: Vertical | null },
): Promise<{ identity: AdminIdentity } | { error: NextResponse }> {
  const authed = await authenticateRequest(request);
  if ("error" in authed) return { error: authed.error };

  const identity = await loadAdminIdentity(authed.user.employeeId);
  if (!identity) {
    return {
      error: NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      ),
    };
  }

  if (!hasPermission(identity, flag, opts)) {
    return {
      error: NextResponse.json(
        {
          error: `Missing permission: ${flag}${opts?.vertical ? ` for ${opts.vertical}` : ""}`,
        },
        { status: 403 },
      ),
    };
  }

  return { identity };
}

/**
 * Ingest endpoint auth: accepts EITHER a service-token bearer (for
 * system-to-system pushes — Reliance POS firehose) OR a logged-in admin with
 * `canUploadData`. Returns a tag describing which path authorised the call;
 * writers use it for audit logging.
 *
 * Service token is loaded from `INGEST_SERVICE_TOKEN`. In dev, if the env var
 * is missing, fall back to cookie/bearer admin auth — never accept
 * unauthenticated requests.
 */
export async function requireIngestAuth(
  request: NextRequest,
): Promise<
  | { kind: "service"; submittedBy: string }
  | { kind: "admin"; identity: AdminIdentity }
  | { error: NextResponse }
> {
  const serviceToken = process.env.INGEST_SERVICE_TOKEN;
  const header = request.headers.get("authorization") ?? "";
  if (serviceToken && header === `Bearer ${serviceToken}`) {
    const src = request.headers.get("x-ingest-source") ?? "service";
    return { kind: "service", submittedBy: src.slice(0, 64) };
  }

  const admin = await requirePermission(request, "canUploadData");
  if ("error" in admin) return { error: admin.error };
  return { kind: "admin", identity: admin.identity };
}
