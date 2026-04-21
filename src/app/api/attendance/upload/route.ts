export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AttendanceStatus, Vertical } from "@prisma/client";
import { db } from "@/lib/db";
import { recalculateByDateSpan } from "@/server/calculations/engines";
import { requirePermission } from "@/lib/permissions";

/**
 * Attendance CSV upload. One upload batch → one AttendanceUpload row +
 * many Attendance rows (upserted on (employeeId, date)). After write, F&L
 * incentives are recomputed across the periods the batch touches.
 *
 * Payload: { rows: Array<{ employeeId, storeCode, date (DD/MM/YYYY or ISO), status }>,
 *            fileName?: string, uploadedBy?: string }
 */
const rowSchema = z.object({
  employeeId: z.string().min(1),
  storeCode: z.string().min(1),
  date: z.string().min(1),
  status: z.enum(["PRESENT", "ABSENT", "LEAVE_APPROVED", "LEAVE_UNAPPROVED", "HOLIDAY"]),
});
type AttnRow = z.infer<typeof rowSchema>;

function parseDate(input: string): Date {
  const clean = input.trim().replace(/^["']|["']$/g, "");
  const slash = clean.split("/").map(Number);
  if (slash.length === 3 && slash.every((n) => Number.isFinite(n))) {
    const [day, month, year] = slash;
    return new Date(Date.UTC(year, month - 1, day));
  }
  return new Date(clean);
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(request, "canUploadData", { vertical: "FNL" });
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const rawRows: unknown[] = Array.isArray(body.rows) ? body.rows : [];
  const fileName = typeof body.fileName === "string" ? body.fileName : null;
  const uploadedBy = auth.identity.employeeId;

  const errors: string[] = [];
  const validated: AttnRow[] = [];
  rawRows.forEach((row, i) => {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      errors.push(`Row ${i + 1}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      return;
    }
    validated.push(parsed.data);
  });
  if (errors.length) return NextResponse.json({ imported: 0, errors }, { status: 400 });
  if (!validated.length) return NextResponse.json({ imported: 0, errors: ["No rows to upload"] }, { status: 400 });

  const employeeIds = [...new Set(validated.map((r) => r.employeeId))];
  const storeCodes = [...new Set(validated.map((r) => r.storeCode))];
  const [knownEmps, knownStores] = await Promise.all([
    db.employeeMaster.findMany({ where: { employeeId: { in: employeeIds } }, select: { employeeId: true } }),
    db.storeMaster.findMany({ where: { storeCode: { in: storeCodes } }, select: { storeCode: true } }),
  ]);
  const knownEmpSet = new Set(knownEmps.map((e) => e.employeeId));
  const knownStoreSet = new Set(knownStores.map((s) => s.storeCode));
  for (const id of employeeIds) if (!knownEmpSet.has(id)) errors.push(`Unknown employee: ${id}`);
  for (const code of storeCodes) if (!knownStoreSet.has(code)) errors.push(`Unknown store: ${code}`);
  if (errors.length) return NextResponse.json({ imported: 0, errors }, { status: 400 });

  const parsedRows = validated.map((r) => ({
    employeeId: r.employeeId,
    storeCode: r.storeCode,
    date: parseDate(r.date),
    status: r.status as AttendanceStatus,
  }));
  const badDate = parsedRows.find((r) => isNaN(r.date.getTime()));
  if (badDate) {
    return NextResponse.json({ imported: 0, errors: [`Invalid date for employee ${badDate.employeeId}`] }, { status: 400 });
  }

  const sortedDates = parsedRows.map((r) => r.date).sort((a, b) => a.getTime() - b.getTime());
  const periodStart = sortedDates[0];
  const periodEnd = sortedDates[sortedDates.length - 1];

  const upload = await db.$transaction(async (tx) => {
    const batch = await tx.attendanceUpload.create({
      data: {
        uploadedBy,
        fileName,
        rowCount: parsedRows.length,
        periodStart,
        periodEnd,
        storeCodes,
      },
    });
    for (const row of parsedRows) {
      await tx.attendance.upsert({
        where: { employeeId_date: { employeeId: row.employeeId, date: row.date } },
        create: { ...row, source: "upload", uploadId: batch.id },
        update: { status: row.status, storeCode: row.storeCode, source: "upload", uploadId: batch.id },
      });
    }
    return batch;
  });

  // Recompute F&L only — attendance only affects F&L weekly pool math.
  await recalculateByDateSpan(storeCodes, periodStart, periodEnd, {
    trigger: "ATTENDANCE_UPDATE",
  }).catch((err) => {
    console.error("Attendance recompute failed:", err);
  });

  return NextResponse.json({
    imported: parsedRows.length,
    uploadId: upload.id,
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
    stores: storeCodes.length,
    vertical: Vertical.FNL,
  });
}
