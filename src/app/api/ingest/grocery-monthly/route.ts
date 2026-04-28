export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { IngestionStatus, Prisma, StoreRating, StoreSalesStatus, Vertical } from "@prisma/client";
import { db } from "@/lib/db";
import { requireIngestAuth } from "@/lib/permissions";

/**
 * Phase 6.1 — Grocery HR Sales monthly ingest.
 *
 * Mirrors the shape of the .xlsb working file RIL Grocery sent over
 * (`Sales Incentive Input working file-March'26.xlsb`). One request can
 * carry two arrays:
 *
 *   - `stores[]` — per-(store, month) metrics: sales budget/actual, the
 *     two quality ratings (Mystery Shopper / POP Compliance), optional
 *     `salesStatus` override. Computed-at-ingest:
 *       * `salesAchievementPct = salesActualRsLacs / salesBudgetRsLacs`
 *       * `salesStatus` derived from the two ratings:
 *           - both GREEN              → ALL_STAFF_QUALIFIED
 *           - any AMBER (no RED)      → ONLY_ASSOCIATES_QUALIFIED
 *           - any RED                 → NONE_QUALIFIED
 *         Explicit `salesStatusOverride` on the row wins.
 *
 *   - `employees[]` — per-(employee, month) inputs: attendance, awl,
 *     working_days, plus the RIL-provided `incentiveSlab` and `finalPay`
 *     for reconciliation. Engine doesn't read these last two; only the
 *     reconciliation script does.
 *
 * Both arrays are upserted on their natural keys
 * (`(storeCode, vertical, periodStart)` for stores, `(employeeId,
 * periodStart)` for employees). Re-ingest of corrected values overwrites
 * cleanly. After a successful upsert, a single RecomputeJob is enqueued
 * spanning all touched stores and the period.
 *
 * Auth: service token OR admin with `canUploadData`.
 *
 * Request:
 *   headers:
 *     Authorization: Bearer <token>
 *     Idempotency-Key: <uuid>          (required)
 *     X-Ingest-Source: RELIANCE-GR     (optional, for audit)
 *   body: {
 *     batchRef?: string,
 *     stores?: GroceryStoreMonthRow[],     (max 5000)
 *     employees?: GroceryEmployeeMonthRow[] (max 50000)
 *   }
 *
 * Response: 202 { batchId, status, rowsAccepted, rowsRejected, errors? }
 */

const MAX_STORE_ROWS = 5000;
const MAX_EMP_ROWS = 50000;
const MAX_ERROR_LOG_ENTRIES = 100;

const ratingEnum = z.enum(["GREEN", "AMBER", "RED"]);

const storeRowSchema = z.object({
  storeCode: z.string().min(1).max(32),
  vertical: z.enum(["GROCERY"]).default("GROCERY"),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  salesBudgetRsLacs: z.coerce.number().nonnegative().optional().nullable(),
  salesActualRsLacs: z.coerce.number().nonnegative().optional().nullable(),
  /// If client doesn't send this, we compute from budget/actual.
  salesAchievementPct: z.coerce.number().nonnegative().optional().nullable(),
  /// Free-text band label as shipped (">=120%", "100% - 110%"); audit only.
  salesBucket: z.string().max(32).optional().nullable(),
  mysteryShopperRating: ratingEnum.optional().nullable(),
  popComplianceRating: ratingEnum.optional().nullable(),
  /// Explicit override — when present, takes precedence over rating-based
  /// derivation. Lets ops record exceptions ("Amber but RM approved").
  salesStatusOverride: z.enum([
    "ALL_STAFF_QUALIFIED",
    "ONLY_ASSOCIATES_QUALIFIED",
    "NONE_QUALIFIED",
  ]).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});
type StoreRow = z.infer<typeof storeRowSchema>;

const employeeRowSchema = z.object({
  employeeId: z.string().min(1).max(64),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  attendance: z.coerce.number().int().nonnegative(),
  awlDays: z.coerce.number().int().nonnegative().default(0),
  workingDays: z.coerce.number().int().nonnegative(),
  rilIncentiveSlab: z.coerce.number().nonnegative().optional().nullable(),
  rilFinalPay: z.coerce.number().nonnegative().optional().nullable(),
});
type EmpRow = z.infer<typeof employeeRowSchema>;

function parseDate(input: string): Date {
  const clean = input.trim().replace(/^["']|["']$/g, "");
  const ddmmyyyy = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }
  const parsed = new Date(clean);
  if (isNaN(parsed.getTime())) return parsed;
  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  ));
}

/**
 * Derive the canonical sales-status from the two quality ratings.
 *  - both GREEN          → ALL_STAFF_QUALIFIED
 *  - any AMBER (no RED)  → ONLY_ASSOCIATES_QUALIFIED  (managers blocked)
 *  - any RED             → NONE_QUALIFIED
 *  - missing either      → null (engine treats as "no data")
 */
function deriveStatus(
  mystery: StoreRating | null | undefined,
  pop: StoreRating | null | undefined,
): StoreSalesStatus | null {
  if (!mystery || !pop) return null;
  if (mystery === "RED" || pop === "RED") return StoreSalesStatus.NONE_QUALIFIED;
  if (mystery === "AMBER" || pop === "AMBER") return StoreSalesStatus.ONLY_ASSOCIATES_QUALIFIED;
  return StoreSalesStatus.ALL_STAFF_QUALIFIED;
}

function batchResponse(batch: {
  id: number;
  status: IngestionStatus;
  rowsSubmitted: number;
  rowsAccepted: number;
  rowsRejected: number;
  errorLog: unknown;
}) {
  return {
    batchId: batch.id,
    status: batch.status,
    rowsSubmitted: batch.rowsSubmitted,
    rowsAccepted: batch.rowsAccepted,
    rowsRejected: batch.rowsRejected,
    errors: (batch.errorLog as Array<{ row: number; error: string }> | null) ?? [],
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireIngestAuth(request);
  if ("error" in auth) return auth.error;
  const submittedBy =
    auth.kind === "service" ? auth.submittedBy : auth.identity.employeeId;
  const source = auth.kind === "service" ? auth.submittedBy : "ADMIN";

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "Idempotency-Key header is required" },
      { status: 400 },
    );
  }
  if (idempotencyKey.length > 128) {
    return NextResponse.json(
      { error: "Idempotency-Key must be <= 128 chars" },
      { status: 400 },
    );
  }

  const existing = await db.ingestionBatch.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    return NextResponse.json(batchResponse(existing), {
      status: existing.status === IngestionStatus.COMPLETED ? 200 : 202,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const storesInput: unknown[] = Array.isArray((body as { stores?: unknown }).stores)
    ? ((body as { stores: unknown[] }).stores)
    : [];
  const employeesInput: unknown[] = Array.isArray((body as { employees?: unknown }).employees)
    ? ((body as { employees: unknown[] }).employees)
    : [];
  const batchRef =
    typeof (body as { batchRef?: unknown }).batchRef === "string"
      ? ((body as { batchRef: string }).batchRef).slice(0, 128)
      : null;

  if (!storesInput.length && !employeesInput.length) {
    return NextResponse.json(
      { error: "Either stores[] or employees[] must be non-empty" },
      { status: 400 },
    );
  }
  if (storesInput.length > MAX_STORE_ROWS) {
    return NextResponse.json(
      { error: `Too many store rows: ${storesInput.length} (max ${MAX_STORE_ROWS})` },
      { status: 400 },
    );
  }
  if (employeesInput.length > MAX_EMP_ROWS) {
    return NextResponse.json(
      { error: `Too many employee rows: ${employeesInput.length} (max ${MAX_EMP_ROWS})` },
      { status: 400 },
    );
  }

  // Validate per-row, accumulate errors. Same fail-soft posture as
  // /api/ingest/sales — bad rows go to the error log, good rows survive.
  const validatedStores: StoreRow[] = [];
  const validatedEmps: EmpRow[] = [];
  const errors: Array<{ row: number; error: string }> = [];

  storesInput.forEach((row, index) => {
    const parsed = storeRowSchema.safeParse(row);
    if (!parsed.success) {
      if (errors.length < MAX_ERROR_LOG_ENTRIES) {
        errors.push({ row: index + 1, error: `stores[${index}]: ${parsed.error.issues[0]?.message ?? "Invalid"}` });
      }
      return;
    }
    validatedStores.push(parsed.data);
  });
  employeesInput.forEach((row, index) => {
    const parsed = employeeRowSchema.safeParse(row);
    if (!parsed.success) {
      if (errors.length < MAX_ERROR_LOG_ENTRIES) {
        errors.push({ row: index + 1, error: `employees[${index}]: ${parsed.error.issues[0]?.message ?? "Invalid"}` });
      }
      return;
    }
    validatedEmps.push(parsed.data);
  });

  // Verify referenced stores + employees exist. Unknown FKs go to the
  // reject bucket — never silently insert orphans.
  const requestedStoreCodes = [...new Set(validatedStores.map((r) => r.storeCode))];
  const requestedEmpIds = [...new Set(validatedEmps.map((r) => r.employeeId))];
  const [knownStores, knownEmps] = await Promise.all([
    requestedStoreCodes.length
      ? db.storeMaster.findMany({
          where: { storeCode: { in: requestedStoreCodes } },
          select: { storeCode: true },
        })
      : Promise.resolve([] as { storeCode: string }[]),
    requestedEmpIds.length
      ? db.employeeMaster.findMany({
          where: { employeeId: { in: requestedEmpIds } },
          select: { employeeId: true, storeCode: true },
        })
      : Promise.resolve([] as { employeeId: string; storeCode: string }[]),
  ]);
  const knownStoreSet = new Set(knownStores.map((s) => s.storeCode));
  const empToStoreMap = new Map(knownEmps.map((e) => [e.employeeId, e.storeCode]));

  // Prepare upsert payloads + collect downstream store-codes for the
  // recompute job. Any row referring to an unknown store/employee gets
  // rejected here.
  type PreparedStore = {
    storeCode: string;
    vertical: Vertical;
    periodStart: Date;
    periodEnd: Date;
    salesBudgetRsLacs: number | null;
    salesActualRsLacs: number | null;
    salesAchievementPct: number | null;
    salesBucket: string | null;
    mysteryShopperRating: StoreRating | null;
    popComplianceRating: StoreRating | null;
    salesStatus: StoreSalesStatus | null;
    note: string | null;
    source: string;
  };
  type PreparedEmp = {
    employeeId: string;
    periodStart: Date;
    periodEnd: Date;
    attendance: number;
    awlDays: number;
    workingDays: number;
    rilIncentiveSlab: number | null;
    rilFinalPay: number | null;
    source: string;
    storeCode: string;
  };

  const preparedStores: PreparedStore[] = [];
  const preparedEmps: PreparedEmp[] = [];

  validatedStores.forEach((row, index) => {
    if (!knownStoreSet.has(row.storeCode)) {
      if (errors.length < MAX_ERROR_LOG_ENTRIES) {
        errors.push({ row: index + 1, error: `stores[${index}]: unknown storeCode "${row.storeCode}"` });
      }
      return;
    }
    const periodStart = parseDate(row.periodStart);
    const periodEnd = parseDate(row.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
      if (errors.length < MAX_ERROR_LOG_ENTRIES) {
        errors.push({ row: index + 1, error: `stores[${index}]: invalid period dates` });
      }
      return;
    }

    const budget = row.salesBudgetRsLacs ?? null;
    const actual = row.salesActualRsLacs ?? null;
    // Derive achievement if not explicitly provided.
    const computedAch =
      row.salesAchievementPct ??
      (budget && budget > 0 && actual != null ? actual / budget : null);

    const mystery = (row.mysteryShopperRating ?? null) as StoreRating | null;
    const pop = (row.popComplianceRating ?? null) as StoreRating | null;
    const status =
      (row.salesStatusOverride as StoreSalesStatus | null | undefined) ??
      deriveStatus(mystery, pop);

    preparedStores.push({
      storeCode: row.storeCode,
      vertical: Vertical.GROCERY,
      periodStart,
      periodEnd,
      salesBudgetRsLacs: budget,
      salesActualRsLacs: actual,
      salesAchievementPct: computedAch,
      salesBucket: row.salesBucket ?? null,
      mysteryShopperRating: mystery,
      popComplianceRating: pop,
      salesStatus: status,
      note: row.note ?? null,
      source,
    });
  });

  validatedEmps.forEach((row, index) => {
    const empStoreCode = empToStoreMap.get(row.employeeId);
    if (!empStoreCode) {
      if (errors.length < MAX_ERROR_LOG_ENTRIES) {
        errors.push({ row: index + 1, error: `employees[${index}]: unknown employeeId "${row.employeeId}"` });
      }
      return;
    }
    const periodStart = parseDate(row.periodStart);
    const periodEnd = parseDate(row.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
      if (errors.length < MAX_ERROR_LOG_ENTRIES) {
        errors.push({ row: index + 1, error: `employees[${index}]: invalid period dates` });
      }
      return;
    }
    if (row.workingDays > row.attendance) {
      if (errors.length < MAX_ERROR_LOG_ENTRIES) {
        errors.push({ row: index + 1, error: `employees[${index}]: workingDays > attendance` });
      }
      return;
    }
    preparedEmps.push({
      employeeId: row.employeeId,
      periodStart,
      periodEnd,
      attendance: row.attendance,
      awlDays: row.awlDays,
      workingDays: row.workingDays,
      rilIncentiveSlab: row.rilIncentiveSlab ?? null,
      rilFinalPay: row.rilFinalPay ?? null,
      source,
      storeCode: empStoreCode,
    });
  });

  const allStoreCodesTouched = [...new Set([
    ...preparedStores.map((p) => p.storeCode),
    ...preparedEmps.map((p) => p.storeCode),
  ])];
  const allDates = [
    ...preparedStores.map((p) => p.periodStart),
    ...preparedEmps.map((p) => p.periodStart),
  ];
  const allEndDates = [
    ...preparedStores.map((p) => p.periodEnd),
    ...preparedEmps.map((p) => p.periodEnd),
  ];
  const minPeriod = allDates.length
    ? new Date(Math.min(...allDates.map((d) => d.getTime())))
    : null;
  const maxPeriod = allEndDates.length
    ? new Date(Math.max(...allEndDates.map((d) => d.getTime())))
    : null;

  let batch;
  try {
    batch = await db.ingestionBatch.create({
      data: {
        idempotencyKey,
        source: `${source}:GROCERY_MONTHLY`,
        batchRef,
        submittedBy,
        status: IngestionStatus.RECEIVED,
        rowsSubmitted: storesInput.length + employeesInput.length,
        rowsAccepted: 0,
        rowsRejected: errors.length,
        errorLog: errors.length ? (errors as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        minTxnDate: minPeriod,
        maxTxnDate: maxPeriod,
        storeCodes: allStoreCodesTouched,
      },
    });
  } catch (e) {
    const raced = await db.ingestionBatch.findUnique({ where: { idempotencyKey } });
    if (raced) {
      return NextResponse.json(batchResponse(raced), {
        status: raced.status === IngestionStatus.COMPLETED ? 200 : 202,
      });
    }
    return NextResponse.json(
      { error: `Failed to record batch: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  if (preparedStores.length === 0 && preparedEmps.length === 0) {
    await db.ingestionBatch.update({
      where: { id: batch.id },
      data: { status: IngestionStatus.FAILED, completedAt: new Date() },
    });
    return NextResponse.json(
      { ...batchResponse({ ...batch, status: IngestionStatus.FAILED }), errors },
      { status: 400 },
    );
  }

  // Upsert in a single transaction so a mid-batch crash leaves a
  // consistent state. The two upsert passes touch different tables —
  // they don't conflict, so order isn't semantically important.
  let storeUpserts = 0;
  let empUpserts = 0;
  try {
    await db.$transaction(async (tx) => {
      for (const row of preparedStores) {
        await tx.storeMonthlyMetric.upsert({
          where: {
            storeCode_vertical_periodStart: {
              storeCode: row.storeCode,
              vertical: row.vertical,
              periodStart: row.periodStart,
            },
          },
          create: {
            storeCode: row.storeCode,
            vertical: row.vertical,
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            salesBudgetRsLacs: row.salesBudgetRsLacs ?? undefined,
            salesActualRsLacs: row.salesActualRsLacs ?? undefined,
            salesAchievementPct: row.salesAchievementPct ?? undefined,
            salesBucket: row.salesBucket,
            mysteryShopperRating: row.mysteryShopperRating ?? undefined,
            popComplianceRating: row.popComplianceRating ?? undefined,
            salesStatus: row.salesStatus ?? undefined,
            note: row.note,
            source: row.source,
          },
          update: {
            periodEnd: row.periodEnd,
            salesBudgetRsLacs: row.salesBudgetRsLacs ?? null,
            salesActualRsLacs: row.salesActualRsLacs ?? null,
            salesAchievementPct: row.salesAchievementPct ?? null,
            salesBucket: row.salesBucket,
            mysteryShopperRating: row.mysteryShopperRating ?? null,
            popComplianceRating: row.popComplianceRating ?? null,
            salesStatus: row.salesStatus ?? null,
            note: row.note,
            source: row.source,
          },
        });
        storeUpserts += 1;
      }
      for (const row of preparedEmps) {
        await tx.employeeMonthlyInput.upsert({
          where: {
            employeeId_periodStart: {
              employeeId: row.employeeId,
              periodStart: row.periodStart,
            },
          },
          create: {
            employeeId: row.employeeId,
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            attendance: row.attendance,
            awlDays: row.awlDays,
            workingDays: row.workingDays,
            rilIncentiveSlab: row.rilIncentiveSlab ?? undefined,
            rilFinalPay: row.rilFinalPay ?? undefined,
            source: row.source,
          },
          update: {
            periodEnd: row.periodEnd,
            attendance: row.attendance,
            awlDays: row.awlDays,
            workingDays: row.workingDays,
            rilIncentiveSlab: row.rilIncentiveSlab ?? null,
            rilFinalPay: row.rilFinalPay ?? null,
            source: row.source,
          },
        });
        empUpserts += 1;
      }
    });
  } catch (e) {
    await db.ingestionBatch.update({
      where: { id: batch.id },
      data: {
        status: IngestionStatus.FAILED,
        completedAt: new Date(),
        errorLog: [
          ...errors,
          { row: 0, error: `Upsert failed: ${(e as Error).message}` },
        ].slice(0, MAX_ERROR_LOG_ENTRIES) as unknown as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json(
      { error: `Database error: ${(e as Error).message}`, batchId: batch.id },
      { status: 500 },
    );
  }

  // One recompute job covering all touched store-months.
  let jobId: number | null = null;
  if (minPeriod && maxPeriod && allStoreCodesTouched.length) {
    try {
      const job = await db.recomputeJob.create({
        data: {
          trigger: "INGESTION",
          storeCodes: allStoreCodesTouched,
          periodStart: minPeriod,
          periodEnd: maxPeriod,
          ingestionBatchId: batch.id,
          enqueuedBy: submittedBy,
        },
      });
      jobId = job.id;
    } catch (e) {
      console.error(`[ingest:grocery-monthly] failed to enqueue recompute job for batch ${batch.id}:`, e);
    }
  }

  const totalUpserted = storeUpserts + empUpserts;
  await db.ingestionBatch.update({
    where: { id: batch.id },
    data: {
      status: IngestionStatus.PROCESSING,
      rowsAccepted: totalUpserted,
      rowsRejected: errors.length,
      errorLog: errors.length
        ? (errors as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
    },
  });

  return NextResponse.json(
    {
      batchId: batch.id,
      status: IngestionStatus.PROCESSING,
      rowsSubmitted: storesInput.length + employeesInput.length,
      rowsAccepted: totalUpserted,
      rowsRejected: errors.length,
      storeUpserts,
      employeeUpserts: empUpserts,
      errors,
      recomputeJobId: jobId,
    },
    { status: 202 },
  );
}
