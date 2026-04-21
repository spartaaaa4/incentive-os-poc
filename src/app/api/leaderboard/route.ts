export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStoreLeaderboard } from "@/server/services/leaderboard";

const querySchema = z.object({
  /** Calendar month yyyy-MM. If set, takes precedence over `monthsBack`. */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  /** 0 = current month, 1 = previous, etc. Ignored if `month` is set. */
  monthsBack: z.coerce.number().int().min(0).max(60).optional(),
  /** Admin / unauthenticated callers: explicit vertical. */
  vertical: z.enum(["ELECTRONICS", "GROCERY", "FNL"]).optional(),
  /** Admin / unauthenticated callers: explicit city. */
  city: z.string().trim().optional(),
});

function viewerFromRequest(request: NextRequest) {
  const employeeId = request.headers.get("x-user-employee-id");
  const storeCode = request.headers.get("x-user-store-code");
  const role = request.headers.get("x-user-role");
  if (!employeeId || !storeCode || !role) return null;
  return { employeeId, storeCode, role };
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
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

    const viewer = viewerFromRequest(request);
    const data = await getStoreLeaderboard({
      viewer,
      vertical: parsed.data.vertical,
      city: parsed.data.city,
      month: parsed.data.month,
      monthsBack: parsed.data.monthsBack,
    });

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load leaderboard";
    const status = /required|not found/i.test(message) ? 400 : 500;
    if (status === 500) console.error("Leaderboard API error:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
