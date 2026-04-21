export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStoreLeaderboard } from "@/server/services/leaderboard";

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

/** Store-level rank for the viewer's store. */
export async function GET(request: NextRequest) {
  try {
    const viewer = viewerFromRequest(request);
    if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sp = request.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
      month: sp.get("month") ?? undefined,
      monthsBack: sp.get("monthsBack") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, { status: 400 });
    }

    const full = await getStoreLeaderboard({
      viewer,
      month: parsed.data.month,
      monthsBack: parsed.data.monthsBack,
    });

    return NextResponse.json({
      metric: full.metric,
      rankBy: full.rankBy,
      period: full.period,
      vertical: full.vertical,
      city: full.city,
      viewer: full.viewer,
      myRank: full.myRank,
      topStores: full.leaderboard.slice(0, 5),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load leaderboard";
    console.error("Leaderboard /me error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
