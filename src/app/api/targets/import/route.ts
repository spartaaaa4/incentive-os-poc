export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";

const targetRowSchema = z.object({
  storeCode: z.string().min(1),
  vertical: z.enum(["ELECTRONICS", "GROCERY", "FNL"]),
  department: z.string().optional().nullable(),
  productFamilyCode: z.string().optional().nullable(),
  productFamilyName: z.string().optional().nullable(),
  targetValue: z.coerce.number().positive(),
  periodType: z.enum(["MONTHLY", "WEEKLY", "CAMPAIGN"]),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
});

function parseDate(input: string): Date {
  if (input.includes("/")) {
    const [day, month, year] = input.split("/").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  return new Date(input);
}

/**
 * Target CSV import. One import → many Target rows (status=SUBMITTED) + one
 * ApprovalRequest that represents the whole batch. The approver approves the
 * batch, not each row. `batchKey` lets us reconstruct which rows belong to
 * which request later.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rows: unknown[] = Array.isArray(body.rows) ? body.rows : [];
    const submissionNote = typeof body.submissionNote === "string" ? body.submissionNote : null;
    const errors: string[] = [];
    const validated: z.infer<typeof targetRowSchema>[] = [];

    rows.forEach((row, index) => {
      const parsed = targetRowSchema.safeParse(row);
      if (!parsed.success) {
        errors.push(`Row ${index + 1}: ${parsed.error.issues[0]?.message ?? "Invalid"}`);
        return;
      }
      validated.push(parsed.data);
    });

    if (errors.length) {
      return NextResponse.json({ imported: 0, errors }, { status: 400 });
    }
    if (!validated.length) {
      return NextResponse.json({ imported: 0, errors: ["No rows to import"] }, { status: 400 });
    }

    // All rows must share a vertical — target batches are vertical-scoped so
    // the approval gate can be vertical-scoped.
    const verticals = [...new Set(validated.map((r) => r.vertical))];
    if (verticals.length > 1) {
      return NextResponse.json(
        { imported: 0, errors: [`Batch contains multiple verticals (${verticals.join(", ")}). Split into separate uploads.`] },
        { status: 400 },
      );
    }
    const vertical = verticals[0];

    const auth = await requirePermission(request, "canSubmitApproval", { vertical });
    if ("error" in auth) return auth.error;
    const submittedBy = auth.identity.employeeId;

    const uniqueStores = [...new Set(validated.map((r) => r.storeCode))];
    const known = await db.storeMaster.findMany({
      where: { storeCode: { in: uniqueStores } },
      select: { storeCode: true },
    });
    const knownSet = new Set(known.map((s) => s.storeCode));
    for (const code of uniqueStores) {
      if (!knownSet.has(code)) errors.push(`Unknown store: ${code}`);
    }
    if (errors.length) {
      return NextResponse.json({ imported: 0, errors }, { status: 400 });
    }

    const batchKey = `TGT-${vertical}-${Date.now()}`;

    const result = await db.$transaction(async (tx) => {
      const createRes = await tx.target.createMany({
        data: validated.map((r) => ({
          storeCode: r.storeCode,
          vertical: r.vertical,
          department: r.department ?? null,
          productFamilyCode: r.productFamilyCode ?? null,
          productFamilyName: r.productFamilyName ?? null,
          targetValue: r.targetValue,
          periodType: r.periodType,
          periodStart: parseDate(r.periodStart),
          periodEnd: parseDate(r.periodEnd),
          status: "SUBMITTED" as const,
          submittedBy,
          batchKey,
        })),
      });

      // Pick the first created row's id as the ApprovalRequest.entityId anchor.
      // The canonical lookup is by batchKey — see approvals/action route.
      const anchor = await tx.target.findFirst({
        where: { batchKey },
        orderBy: { id: "asc" },
        select: { id: true },
      });

      const approvalReq = await tx.approvalRequest.create({
        data: {
          entityType: "TARGET",
          entityId: anchor?.id ?? 0,
          batchKey,
          vertical,
          title: `Targets: ${vertical} (${validated.length} rows)`,
          summary: `${validated.length} target rows across ${uniqueStores.length} store(s) submitted by ${auth.identity.employeeName}`,
          changeSnapshot: {
            rowCount: validated.length,
            storeCount: uniqueStores.length,
            vertical,
            periodTypes: [...new Set(validated.map((r) => r.periodType))],
            totalTargetValue: validated.reduce((sum, r) => sum + r.targetValue, 0),
            sampleRows: validated.slice(0, 10),
          },
          submissionNote: submissionNote?.trim() || null,
          submittedBy,
          seenBy: [],
          decision: "PENDING",
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "TARGET",
          entityId: anchor?.id ?? 0,
          action: "SUBMITTED",
          newValue: {
            rowCount: validated.length,
            vertical,
            batchKey,
            approvalRequestId: approvalReq.id,
          },
          performedBy: submittedBy,
        },
      });

      return { imported: createRes.count, approvalRequestId: approvalReq.id, batchKey };
    });

    return NextResponse.json({ ...result, errors: [] });
  } catch (error) {
    console.error("Target import error:", error);
    return NextResponse.json({ imported: 0, errors: ["Target import failed"] }, { status: 500 });
  }
}
