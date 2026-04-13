import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rows: unknown[] = Array.isArray(body.rows) ? body.rows : [];
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

    await db.target.createMany({
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
        submittedBy: "admin",
      })),
    });

    await db.auditLog.create({
      data: {
        entityType: "TARGET",
        entityId: 0,
        action: "SUBMITTED",
        newValue: { rowCount: validated.length, vertical: validated[0]?.vertical },
        performedBy: "admin",
      },
    });

    return NextResponse.json({ imported: validated.length, errors: [] });
  } catch (error) {
    console.error("Target import error:", error);
    return NextResponse.json({ imported: 0, errors: [String(error)] }, { status: 500 });
  }
}
