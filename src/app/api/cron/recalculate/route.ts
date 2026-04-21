export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { startOfMonth, endOfMonth, startOfDay, subDays } from "date-fns";
import { db } from "@/lib/db";
import { recalculateIncentives } from "@/server/calculations/engines";

/**
 * End-of-day recompute safety net. Called by Replit Scheduled Deployment.
 *
 * Protects the per-transaction recompute path by re-running the full current
 * month across all stores. Catches:
 *  - late-arriving transactions whose ingestion skipped the inline recalc
 *  - attendance edits that missed their trigger
 *  - plan changes published without a maker-checker recompute
 *
 * Auth: requires `CRON_SECRET` bearer — Replit schedule sets
 *       `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const daysBackRaw = Number(body?.daysBack);
  const daysBack = Number.isFinite(daysBackRaw) && daysBackRaw > 0 ? Math.min(31, daysBackRaw) : 1;

  const now = new Date();
  const windowEnd = endOfMonth(now);
  const windowStart = startOfMonth(subDays(startOfDay(now), daysBack));

  const stores = await db.storeMaster.findMany({ select: { storeCode: true } });
  const storeCodes = stores.map((s) => s.storeCode);
  if (!storeCodes.length) {
    return NextResponse.json({ message: "no stores", stores: 0 });
  }

  const started = Date.now();
  await recalculateIncentives({
    storeCodes,
    periodStart: windowStart,
    periodEnd: windowEnd,
    trigger: "SCHEDULED_CRON",
  });

  return NextResponse.json({
    message: "eod recompute complete",
    stores: storeCodes.length,
    window: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
    elapsedMs: Date.now() - started,
  });
}
