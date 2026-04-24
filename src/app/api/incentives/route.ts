export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { startOfMonth, endOfMonth } from "date-fns";
import type { Vertical } from "@prisma/client";
import { authenticateRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission, loadAdminIdentity } from "@/lib/permissions";
import { getIncentiveDrilldown } from "@/server/services/incentives";

/**
 * Auth model for this endpoint. This route USED to be in
 * `middleware.PUBLIC_ROUTES` — any caller could read any employee's payout
 * by changing `?employeeId=…`. The architect review flagged it; this closes
 * the hole while preserving legitimate read paths:
 *
 *   1. Self read — caller's JWT `employeeId` matches `?employeeId=…`
 *      (the mobile hero card).
 *   2. Management-role read — caller's JWT `role` is SM, DM, BA, or CENTRAL.
 *      These roles read store / city / drilldown data by design. NOTE: this
 *      is intentionally coarse for the pilot; Phase 5 tightens to
 *      store-scope for SM/DM and vertical-scope for CENTRAL.
 *   3. Admin-console read — caller has an `EmployeeAdminAccess` row with
 *      `canViewAll` scoped to the query's vertical (derived from `vertical`
 *      param, the target employee's store, or the target store).
 *   4. SA reading anyone else's data — rejected 403. This was the actual
 *      vulnerability and is what this patch exists to block.
 *
 * Cross-vertical queries with no scope vertical additionally require
 * super-admin (verticals:[]) on the admin path.
 */

/**
 * Mobile-app management roles permitted to read store/city/drilldown.
 * Phase 5 should replace this with scope checks (SM/DM → own store,
 * CENTRAL → vertical allow-list).
 */
const MANAGEMENT_ROLES = new Set(["SM", "DM", "BA", "CENTRAL"]);

const VALID_VERTICALS: Vertical[] = ["ELECTRONICS", "GROCERY", "FNL"];

function parseVertical(raw: string | null): Vertical | null {
  if (!raw) return null;
  return (VALID_VERTICALS as string[]).includes(raw) ? (raw as Vertical) : null;
}

export async function GET(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if ("error" in authed) return authed.error;
    const caller = authed.user;

    const sp = request.nextUrl.searchParams;
    const now = new Date("2026-04-13");
    const periodStart = sp.get("periodStart") ? new Date(sp.get("periodStart")!) : startOfMonth(now);
    const periodEnd = sp.get("periodEnd") ? new Date(sp.get("periodEnd")!) : endOfMonth(now);

    const targetEmployeeId = sp.get("employeeId");
    const storeCode = sp.get("storeCode");
    const city = sp.get("city");
    const department = sp.get("department");
    const verticalParam = parseVertical(sp.get("vertical"));

    // Self-read fast path: mobile app reading its own data.
    const isSelfRead = !!targetEmployeeId && targetEmployeeId === caller.employeeId;
    // Management roles on the mobile app read store/city/drilldown by design.
    const isManagementRole = MANAGEMENT_ROLES.has(caller.role);

    if (!isSelfRead && !isManagementRole) {
      // Remaining callers must come through the admin-console path.
      const identity = await loadAdminIdentity(caller.employeeId);
      if (!identity) {
        // SA asking for someone else's data with no admin grant: this is the
        // vulnerability being closed.
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Resolve the vertical scope being queried. Explicit `vertical` wins;
      // otherwise derive from the employee's or store's vertical.
      let scopeVertical: Vertical | null = verticalParam;
      if (!scopeVertical && targetEmployeeId) {
        const emp = await db.employeeMaster.findUnique({
          where: { employeeId: targetEmployeeId },
          select: { store: { select: { vertical: true } } },
        });
        if (!emp) {
          return NextResponse.json({ error: "Employee not found" }, { status: 404 });
        }
        scopeVertical = emp.store.vertical;
      }
      if (!scopeVertical && storeCode) {
        const store = await db.storeMaster.findUnique({
          where: { storeCode },
          select: { vertical: true },
        });
        if (!store) {
          return NextResponse.json({ error: "Store not found" }, { status: 404 });
        }
        scopeVertical = store.vertical;
      }

      if (!scopeVertical) {
        // No single vertical scope (e.g. cross-vertical city summary). Only
        // super-admins (empty verticals allow-list) + canViewAll may run it.
        if (identity.verticals.length > 0 || !identity.permissions.canViewAll) {
          return NextResponse.json(
            { error: "Cross-vertical reads require super-admin" },
            { status: 403 },
          );
        }
      } else if (!hasPermission(identity, "canViewAll", { vertical: scopeVertical })) {
        return NextResponse.json(
          { error: `Missing permission: canViewAll for ${scopeVertical}` },
          { status: 403 },
        );
      }
    }

    const result = await getIncentiveDrilldown({
      vertical: verticalParam ?? undefined,
      city: city ?? undefined,
      storeCode: storeCode ?? undefined,
      department: department ?? undefined,
      employeeId: targetEmployeeId ?? undefined,
      periodStart,
      periodEnd,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Incentives API error:", error);
    return NextResponse.json({ error: "Failed to fetch incentive data" }, { status: 500 });
  }
}
