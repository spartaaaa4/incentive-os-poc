export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { IngestionStatus, Prisma, Vertical } from "@prisma/client";
import { db } from "@/lib/db";
import { requireIngestAuth } from "@/lib/permissions";

/**
 * Phase 5.1 — F&L pilot store-week metrics ingest.
 *
 * One row per (storeCode, vertical, periodStart). Carries the two
 * external metrics the F&L policy gates on:
 *
 *   1. **Pilferage Index (PI)** — Reliance loss-prevention feed. Threshold
 *      ≥ 0.30% sets `piHoldFlag = true`, which blocks the entire store-week
 *      payout (engine reads this, see `computeFnL`).
 *   2. **Gross Margin (GM)** — finance feed. `gmActual >= gmTarget` sets
 *      `gmAchieved = true`. The gate only blocks SM/DM payout — CSAs are
 *      unaffected per policy.
 *
 * The threshold values (0.30% for PI, gm_actual >= gm_target for GM) are
 * computed *here* at ingest time, not re-derived in the engine. Two reasons:
 *  - Lets ops manually upsert a row with `piHoldFlag = false` to override
 *    a borderline reading after a manual review.
 *  - Lets us shift the PI threshold (e.g., to 0.25%) without redeploying
 *    the engine — just re-run this ingest with the new threshold logic.
 *
 * Auth: service token OR admin with `canUploadData`.
 *
 * Request:
 *   headers:
 *     Authorization: Bearer <token>
 *     Idempotency-Key: <uuid>          (required)
 *     X-Ingest-Source: RELIANCE-LP     (optional, for audit)
 *   body: {
 *     batchRef?: string,
 *     rows: StoreMetricRow[]           (max 5000)
 *   }
 *
 * Response: 202 { batchId, status, rowsAccepted, rowsRejected, errors? }
 *
 * On success, enqueues a single RecomputeJob covering all affected
 * store-weeks so the engine picks up the new gate state on the next worker
 * tick.
 */

const MAX_ROWS_PER_BATCH = 5000;
const MAX_ERROR_LOG_ENTRIES = 100;

// Pilferage Index hold threshold — kept here as a const so the override
// surface is obvious. Discussed on the Tuesday call: pilot starts at 0.30%
// per policy text, can be tuned via re-ingest if Reliance loss-prevention
// asks for a different cut.
const PI_HOLD_THRESHOLD_PCT = 0.30;

const storeMetricRowSchema = z.object({
  storeCode: z.string().min(1).max(32),
  vertical: z.enum(["ELECTRONICS", "GROCERY", "FNL"]),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  pilferageIndex: z.coerce.number().min(0).max(100).optional().nullable(),
  // Optional explicit override — when present, takes precedence over the
  // computed threshold check. Lets ops record a manual exception ("PI was
  // 0.32% but LP cleared us, don't hold").
  piHoldFlagOverride: z.boolean().optional().nullable(),
  gmTarget: z.coerce.number().optional().nullable(),
  gmActual: z.coerce.number().optional().nullable(),
  // Same override pattern for GM.
  gmAchievedOverride: z.boolean().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

type StoreMetricRow = z.infer<typeof storeMetricRowSchema>;

function parseDate(input: string): Date {
  const clean = input.trim().replace(/^["']|["']$/g, "");
  const ddmmyyyy = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }
  // ISO date — ensure midnight UTC so unique-on-(storeCode, vertical,
  // periodStart) doesn't collide on TZ rounding.
  const parsed = new Date(clean);
  if (isNaN(parsed.getTime())) return parsed;
  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  ));
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

  // Reuse the IngestionBatch table — same retention story, same idempotency
  // contract, same admin UI surface ("recent batches" page).
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
  const rowsInput: unknown[] = Array.isArray(
    (body as { rows?: unknown }).rows,
  )
    ? ((body as { rows: unknown[] }).rows)
    : [];
  const batchRef =
    typeof (body as { batchRef?: unknown }).batchRef === "string"
      ? ((body as { batchRef: string }).batchRef).slice(0, 128)
      : null;

  if (!rowsInput.length) {
    return NextResponse.json(
      { error: "rows[] is required and must be non-empty" },
      { status: 400 },
    );
  }
  if (rowsInput.length > MAX_ROWS_PER_BATCH) {
    return NextResponse.json(
      {
        error: `Batch too large: ${rowsInput.length} rows (max ${MAX_ROWS_PER_BATCH}). Split and retry.`,
      },
      { status: 400 },
    );
  }

  const validated: StoreMetricRow[] = [];
  const errors: Array<{ row: number; error: string }> = [];
  rowsInput.forEach((row, index) => {
    const parsed = storeMetricRowSchema.safeParse(row);
    if (!parsed.success) {
      if (errors.length < MAX_ERROR_LOG_ENTRIES) {
        errors.push({
          row: index + 1,
          error: parsed.error.issues[0]?.message ?? "Invalid record",
        });
      }
      return;
    }
    validated.push(parsed.data);
  });

  // Verify store codes exist. Unknown stores are rejected at row level.
  const uniqueStoresRequested = [...new Set(validated.map((r) => r.storeCode))];
  const knownStores = uniqueStoresRequested.length
    ? await db.storeMaster.findMany({
        where: { storeCode: { in: uniqueStoresRequested } },
        select: { storeCode: true },
      })
    : [];
  const knownStoreSet = new Set(knownStores.map((s) => s.storeCode));

  // Final per-row prep + threshold computation. We do this in JS rather
  // than as DB defaults so the threshold is unit-testable and visible in
  // code review.
  type PreparedRow = {
    storeCode: string;
    vertical: Vertical;
    periodStart: Date;
    periodEnd: Date;
    pilferageIndex: number | null;
    piHoldFlag: boolean;
    gmTarget: number | null;
    gmActual: number | null;
    gmAchieved: boolean;
    note: string | null;
    source: string;
  };

  const prepared: PreparedRow[] = [];
  validated.forEach((row, index) => {
    if (!knownStoreSet.has(row.storeCode)) {
      if (errors.length < MAX_ERROR_LOG_ENTRIES) {
        errors.push({
          row: index + 1,
          error: `Unknown storeCode: ${row.storeCode}`,
        });
      }
      return;
    }
    const periodStart = parseDate(row.periodStart);
    const periodEnd = parseDate(row.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
      if (errors.length < MAX_ERROR_LOG_ENTRIES) {
        errors.push({
          row: index + 1,
          error: `Invalid period dates: "${row.periodStart}" / "${row.periodEnd}"`,
        });
      }
      return;
    }
    if (periodEnd < periodStart) {
      if (errors.length < MAX_ERROR_LOG_ENTRIES) {
        errors.push({
          row: index + 1,
          error: `periodEnd before periodStart`,
        });
      }
      return;
    }

    // PI hold: explicit override wins; else threshold check; else false.
    const piHoldFlag =
      row.piHoldFlagOverride !== null && row.piHoldFlagOverride !== undefined
        ? row.piHoldFlagOverride
        : row.pilferageIndex !== null && row.pilferageIndex !== undefined
          ? row.pilferageIndex >= PI_HOLD_THRESHOLD_PCT
          : false;

    // GM achieved: explicit override wins; else target/actual comparison;
    // else false (treat missing GM data as "not achieved" for SM/DM gate
    // safety — admin can flip via override).
    const gmAchieved =
      row.gmAchievedOverride !== null && row.gmAchievedOverride !== undefined
        ? row.gmAchievedOverride
        : row.gmTarget !== null && row.gmTarget !== undefined &&
          row.gmActual !== null && row.gmActual !== undefined
          ? row.gmActual >= row.gmTarget
          : false;

    prepared.push({
      storeCode: row.storeCode,
      vertical: row.vertical as Vertical,
      periodStart,
      periodEnd,
      pilferageIndex: row.pilferageIndex ?? null,
      piHoldFlag,
      gmTarget: row.gmTarget ?? null,
      gmActual: row.gmActual ?? null,
      gmAchieved,
      note: row.note ?? null,
      source,
    });
  });

  const uniqueStores = [...new Set(prepared.map((r) => r.storeCode))];
  const minPeriod = prepared.length
    ? new Date(Math.min(...prepared.map((r) => r.periodStart.getTime())))
    : null;
  const maxPeriod = prepared.length
    ? new Date(Math.max(...prepared.map((r) => r.periodEnd.getTime())))
    : null;

  let batch;
  try {
    batch = await db.ingestionBatch.create({
      data: {
        idempotencyKey,
        source: `${source}:STORE_METRICS`,
        batchRef,
        submittedBy,
        status: IngestionStatus.RECEIVED,
        rowsSubmitted: rowsInput.length,
        rowsAccepted: 0,
        rowsRejected: errors.length,
        errorLog: errors.length ? (errors as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        minTxnDate: minPeriod,
        maxTxnDate: maxPeriod,
        storeCodes: uniqueStores,
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

  if (prepared.length === 0) {
    await db.ingestionBatch.update({
      where: { id: batch.id },
      data: { status: IngestionStatus.FAILED, completedAt: new Date() },
    });
    return NextResponse.json(
      {
        ...batchResponse({ ...batch, status: IngestionStatus.FAILED }),
        errors,
      },
      { status: 400 },
    );
  }

  // Upsert per row. Unique key is (storeCode, vertical, periodStart) — a
  // re-ingest of the same store-week overwrites the prior reading, which
  // is exactly what we want when ops corrects a value. We do this in a
  // transaction so a mid-batch crash leaves a consistent state.
  let totalUpserted = 0;
  try {
    await db.$transaction(async (tx) => {
      for (const row of prepared) {
        await tx.storeWeeklyMetric.upsert({
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
            pilferageIndex: row.pilferageIndex ?? undefined,
            piHoldFlag: row.piHoldFlag,
            gmTarget: row.gmTarget ?? undefined,
            gmActual: row.gmActual ?? undefined,
            gmAchieved: row.gmAchieved,
            note: row.note,
            source: row.source,
          },
          update: {
            periodEnd: row.periodEnd,
            pilferageIndex: row.pilferageIndex ?? null,
            piHoldFlag: row.piHoldFlag,
            gmTarget: row.gmTarget ?? null,
            gmActual: row.gmActual ?? null,
            gmAchieved: row.gmAchieved,
            note: row.note,
            source: row.source,
          },
        });
        totalUpserted += 1;
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

  // Enqueue ONE recompute job spanning the affected store-weeks. The
  // worker (`/api/cron/run-jobs`) will pick this up and re-run the engine
  // for those stores, picking up the new gate state.
  let jobId: number | null = null;
  if (minPeriod && maxPeriod && uniqueStores.length) {
    try {
      const job = await db.recomputeJob.create({
        data: {
          trigger: "INGESTION",
          storeCodes: uniqueStores,
          periodStart: minPeriod,
          periodEnd: maxPeriod,
          ingestionBatchId: batch.id,
          enqueuedBy: submittedBy,
        },
      });
      jobId = job.id;
    } catch (e) {
      console.error(`[ingest:store-metrics] failed to enqueue recompute job for batch ${batch.id}:`, e);
    }
  }

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
      rowsSubmitted: rowsInput.length,
      rowsAccepted: totalUpserted,
      rowsRejected: errors.length,
      errors,
      recomputeJobId: jobId,
    },
    { status: 202 },
  );
}
