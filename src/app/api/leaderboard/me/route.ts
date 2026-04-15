import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getLeaderboard } from "@/server/services/leaderboard";

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  monthsBack: z.coerce.number().int().min(0).max(60).optional(),
});

function viewerFromRequest(request: NextRequest) {
  const employeeId = request.headers.get("x-user-employee-id");
  const storeCode = request.headers.get("x-user-store-code");
  const role = request.headers.get("x-user-role");
  if (!employeeId || !storeCode || !role) return null;
  return { employeeId, storeCode, role };
}

/** Store-level snapshot for the signed-in user (rank within own store by monthly sales). */
export async function GET(request: NextRequest) {
  try {
    const viewer = viewerFromRequest(request);
    if (!viewer) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sp = request.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
      month: sp.get("month") ?? undefined,
      monthsBack: sp.get("monthsBack") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid query" },
        { status: 400 },
      );
    }

    const full = await getLeaderboard({
      viewer,
      scope: "store",
      month: parsed.data.month,
      monthsBack: parsed.data.monthsBack,
    });

    const me = full.leaderboard.find((r) => r.isViewer);
    if (!me) {
      return NextResponse.json({ error: "Viewer not found in store roster" }, { status: 404 });
    }

    const inStore = full.leaderboard.length;
    const ahead = full.leaderboard.filter((r) => r.totalSales > me.totalSales).length;

    return NextResponse.json({
      metric: full.metric,
      rankBy: full.rankBy,
      period: full.period,
      vertical: full.vertical,
      verticalFilter: full.verticalFilter,
      storeCode: full.storeCode,
      storeName: full.storeName,
      viewer: full.viewer,
      myRank: me.rank,
      totalSales: me.totalSales,
      transactionCount: me.transactionCount,
      employeesInStore: inStore,
      employeesAheadOfMe: ahead,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load leaderboard";
    if (message.includes("only view")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    console.error("Leaderboard /me error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
