export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getLeaderboard, getAdminLeaderboard, type LeaderboardScope } from "@/server/services/leaderboard";

const querySchema = z.object({
  scope: z.enum(["store", "city"]).default("store"),
  storeCode: z.string().trim().optional(),
  /** Calendar month yyyy-MM. If set, takes precedence over `monthsBack`. */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  /**
   * 0 = calendar month containing today, 1 = previous calendar month, etc.
   * Ignored when `month` is provided.
   */
  monthsBack: z.coerce.number().int().min(0).max(60).optional(),
  /** Admin mode: vertical filter (ELECTRONICS, GROCERY, FNL) */
  vertical: z.enum(["ELECTRONICS", "GROCERY", "FNL"]).optional(),
  /** Admin mode: city filter */
  city: z.string().trim().optional(),
});

function viewerFromRequest(request: NextRequest) {
  const employeeId = request.headers.get("x-user-employee-id");
  const storeCode = request.headers.get("x-user-store-code");
  const role = request.headers.get("x-user-role");
  if (!employeeId || !storeCode || !role) {
    return null;
  }
  return { employeeId, storeCode, role };
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
      scope: sp.get("scope") ?? "store",
      storeCode: sp.get("storeCode") ?? undefined,
      month: sp.get("month") ?? undefined,
      monthsBack: sp.get("monthsBack") ?? undefined,
      vertical: sp.get("vertical") ?? undefined,
      city: sp.get("city") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid query" },
        { status: 400 },
      );
    }

    // Admin mode: when vertical + city are provided, use admin leaderboard
    if (parsed.data.vertical && parsed.data.city) {
      const data = await getAdminLeaderboard({
        vertical: parsed.data.vertical,
        city: parsed.data.city,
        storeCode: parsed.data.storeCode,
        month: parsed.data.month,
        monthsBack: parsed.data.monthsBack,
      });
      return NextResponse.json(data);
    }

    // Employee-facing mode: use JWT viewer or default to E001
    const viewer = viewerFromRequest(request) ?? { employeeId: "E001", storeCode: "3675", role: "SM" };

    const scope = parsed.data.scope as LeaderboardScope;
    const data = await getLeaderboard({
      viewer,
      scope,
      storeCode: parsed.data.storeCode,
      month: parsed.data.month,
      monthsBack: parsed.data.monthsBack,
    });

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load leaderboard";
    const status = message.includes("only view") ? 403 : 500;
    if (status === 500) console.error("Leaderboard API error:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
