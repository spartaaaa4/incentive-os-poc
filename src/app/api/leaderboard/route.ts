export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getLeaderboard, type LeaderboardScope } from "@/server/services/leaderboard";

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
    const viewer = viewerFromRequest(request);
    if (!viewer) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sp = request.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
      scope: sp.get("scope") ?? "store",
      storeCode: sp.get("storeCode") ?? undefined,
      month: sp.get("month") ?? undefined,
      monthsBack: sp.get("monthsBack") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid query" },
        { status: 400 },
      );
    }

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
