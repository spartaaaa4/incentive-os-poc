export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { startOfMonth, endOfMonth, subDays } from "date-fns";
import { db } from "@/lib/db";

/**
 * Attendance coverage status for F&L. Returns:
 *  - latestUpload: most recent AttendanceUpload row (when, by whom, row count)
 *  - currentMonthCovered: whether any upload covers the current month
 *  - lastUploadWithinDays: true if an upload landed in the last N days (default 7)
 *
 * The dashboard uses this to decide whether to show the "attendance not connected"
 * banner on the F&L card.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const withinDaysRaw = Number(searchParams.get("withinDays"));
  const withinDays = Number.isFinite(withinDaysRaw) && withinDaysRaw > 0 ? withinDaysRaw : 7;

  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const withinThreshold = subDays(now, withinDays);

  const [latest, currentMonthCount] = await Promise.all([
    db.attendanceUpload.findFirst({
      orderBy: { uploadedAt: "desc" },
      select: { id: true, uploadedBy: true, fileName: true, rowCount: true, periodStart: true, periodEnd: true, uploadedAt: true, storeCodes: true },
    }),
    db.attendanceUpload.count({
      where: {
        OR: [
          { periodStart: { gte: monthStart, lte: monthEnd } },
          { periodEnd: { gte: monthStart, lte: monthEnd } },
          { AND: [{ periodStart: { lte: monthStart } }, { periodEnd: { gte: monthEnd } }] },
        ],
      },
    }),
  ]);

  const lastUploadWithinDays = latest ? latest.uploadedAt >= withinThreshold : false;
  const isConnected = currentMonthCount > 0 && lastUploadWithinDays;

  return NextResponse.json({
    isConnected,
    currentMonthCovered: currentMonthCount > 0,
    lastUploadWithinDays,
    latestUpload: latest
      ? {
          id: latest.id,
          uploadedBy: latest.uploadedBy,
          fileName: latest.fileName,
          rowCount: latest.rowCount,
          uploadedAt: latest.uploadedAt.toISOString(),
          periodStart: latest.periodStart ? latest.periodStart.toISOString().slice(0, 10) : null,
          periodEnd: latest.periodEnd ? latest.periodEnd.toISOString().slice(0, 10) : null,
          storeCount: latest.storeCodes.length,
        }
      : null,
  });
}
