export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Channel, TransactionType, Vertical } from "@prisma/client";
import { db } from "@/lib/db";
import { recalculateByDateSpan } from "@/server/calculations/engines";

const salesRowSchema = z.object({
  transactionId: z.string().min(1),
  transactionDate: z.string().min(1),
  storeCode: z.string().min(1),
  vertical: z.enum(["ELECTRONICS", "GROCERY", "FNL"]),
  storeFormat: z.string().min(1),
  employeeId: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  articleCode: z.string().min(1),
  productFamilyCode: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  quantity: z.coerce.number().int().positive(),
  grossAmount: z.coerce.number().positive(),
  taxAmount: z.coerce.number().nonnegative(),
  totalAmount: z.coerce.number().positive(),
  transactionType: z.enum(["NORMAL", "SFS", "PAS", "JIOMART"]),
  channel: z.enum(["OFFLINE", "ONLINE"]),
});

type SalesRow = z.infer<typeof salesRowSchema>;

function parseDate(input: string): Date {
  const clean = input.trim().replace(/^["']|["']$/g, "");
  const [day, month, year] = clean.split("/").map((value) => Number(value));
  if (!day || !month || !year) {
    return new Date(clean);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

export async function POST(request: Request) {
  const body = await request.json();
  const rows: unknown[] = Array.isArray(body.rows) ? body.rows : [];
  const errors: string[] = [];
  const validated: SalesRow[] = [];

  rows.forEach((row, index) => {
    const parsed = salesRowSchema.safeParse(row);
    if (!parsed.success) {
      errors.push(`Row ${index + 1}: ${parsed.error.issues[0]?.message ?? "Invalid record"}`);
      return;
    }
    validated.push(parsed.data);
  });

  if (errors.length) {
    return NextResponse.json({ imported: 0, errors }, { status: 400 });
  }

  const uniqueStores = [...new Set(validated.map((row) => row.storeCode))];
  const knownStores = await db.storeMaster.findMany({
    where: { storeCode: { in: uniqueStores } },
    select: { storeCode: true },
  });
  const knownStoreSet = new Set(knownStores.map((store) => store.storeCode));
  for (const storeCode of uniqueStores) {
    if (!knownStoreSet.has(storeCode)) {
      errors.push(`Unknown store code: ${storeCode}`);
    }
  }
  if (errors.length) {
    return NextResponse.json({ imported: 0, errors }, { status: 400 });
  }

  let parsedRows;
  try {
    parsedRows = validated.map((row) => {
      const transactionDate = parseDate(row.transactionDate);
      if (isNaN(transactionDate.getTime())) {
        throw new Error(`Invalid date format for transaction ${row.transactionId}: "${row.transactionDate}". Use DD/MM/YYYY or ISO format.`);
      }
      return {
        transactionId: row.transactionId,
        transactionDate,
        storeCode: row.storeCode,
        vertical: row.vertical as Vertical,
        storeFormat: row.storeFormat,
        employeeId: row.employeeId ?? null,
        department: row.department ?? null,
        articleCode: row.articleCode,
        productFamilyCode: row.productFamilyCode ?? null,
        brand: row.brand ?? null,
        quantity: row.quantity,
        grossAmount: row.grossAmount,
        taxAmount: row.taxAmount,
        totalAmount: row.totalAmount,
        transactionType: row.transactionType as TransactionType,
        channel: row.channel as Channel,
      };
    });
  } catch (e) {
    return NextResponse.json({ imported: 0, errors: [(e as Error).message] }, { status: 400 });
  }

  let insertResult;
  try {
    insertResult = await db.salesTransaction.createMany({ data: parsedRows, skipDuplicates: true });
  } catch (e) {
    return NextResponse.json({ imported: 0, errors: [`Database error: ${(e as Error).message}`] }, { status: 500 });
  }

  const actuallyInserted = insertResult.count;
  const skipped = parsedRows.length - actuallyInserted;

  if (actuallyInserted === 0) {
    return NextResponse.json({
      imported: 0,
      skipped,
      errors: [`All ${skipped} row(s) were skipped — transaction IDs already exist in the database.`],
    }, { status: 400 });
  }

  const sortedDates = parsedRows.map((r) => r.transactionDate).sort((a, b) => a.getTime() - b.getTime());
  if (sortedDates.length) {
    await recalculateByDateSpan(uniqueStores, sortedDates[0], sortedDates[sortedDates.length - 1]);
  }

  return NextResponse.json({ imported: actuallyInserted, skipped, errors: [] });
}
