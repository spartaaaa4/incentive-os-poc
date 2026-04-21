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

  const [latest, currentMonthCount, attendanceRowsThisMonth] = await Promise.all([
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
    // Truth test: are there actual attendance rows for the current month?
    // The upload-batch metadata is secondary. Seed/backfill/direct-SQL paths
    // write Attendance rows without creating an AttendanceUpload — without
    // this check the banner lies ("not connected" while showing 5 PRESENT
    // days in the same screen).
    db.attendance.count({
      where: { date: { gte: monthStart, lte: monthEnd } },
    }),
  ]);

  const lastUploadWithinDays = latest ? latest.uploadedAt >= withinThreshold : false;
  const hasAttendanceData = attendanceRowsThisMonth > 0;
  // Connected = data exists. The upload channel is one way to land data;
  // it's not the only way.
  const isConnected = hasAttendanceData || (currentMonthCount > 0 && lastUploadWithinDays);

  return NextResponse.json({
    isConnected,
    hasAttendanceData,
    attendanceRowCount: attendanceRowsThisMonth,
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
