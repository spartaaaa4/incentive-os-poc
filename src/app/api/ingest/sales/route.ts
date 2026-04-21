export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Channel, IngestionStatus, Prisma, TransactionType, Vertical } from "@prisma/client";
import { db } from "@/lib/db";
import { requireIngestAuth } from "@/lib/permissions";

/**
 * Async bulk sales ingest. Replaces the synchronous `/api/sales/import` path
 * for firehose traffic (Reliance POS). Three invariants:
 *
 *   1. **Idempotent by batch**: retrying with the same `Idempotency-Key`
 *      returns the stored batch result instead of re-inserting.
 *   2. **Non-blocking**: the handler inserts rows + enqueues a `RecomputeJob`
 *      and returns 202 in sub-second. The worker (`/api/cron/run-jobs`)
 *      drains the queue.
 *   3. **Row-level dedup**: `SalesTransaction.transactionId` is the PK, so
 *      `createMany({ skipDuplicates: true })` handles retried rows safely
 *      even without batch-level idempotency.
 *
 * Auth: service token (Reliance) OR admin with `canUploadData` (CSV replay).
 *
 * Request:
 *   headers:
 *     Authorization: Bearer <token>
 *     Idempotency-Key: <uuid>         (required)
 *     X-Ingest-Source: RELIANCE-POS   (optional, for audit)
 *   body: { batchRef?: string, rows: SalesRow[] }   (rows capped at 5000)
 *
 * Response: 202 { batchId, status, rowsAccepted, rowsRejected, errors? }
 *           200 (replay of completed batch)
 *           400 (validation)
 *           409 (batch still processing — shouldn't happen in practice)
 */

const MAX_ROWS_PER_BATCH = 5000;
const INSERT_CHUNK_SIZE = 1000;
const MAX_ERROR_LOG_ENTRIES = 100;

const salesRowSchema = z.object({
  transactionId: z.string().min(1).max(96),
  transactionDate: z.string().min(1),
  storeCode: z.string().min(1).max(32),
  vertical: z.enum(["ELECTRONICS", "GROCERY", "FNL"]),
  storeFormat: z.string().min(1),
  employeeId: z.string().max(64).optional().nullable(),
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
  const ddmmyyyy = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }
  return new Date(clean);
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

  // Idempotency replay: same key within retention returns stored result.
  // We don't expire these automatically in the pilot; a separate purge job
  // can sweep completed batches older than 30 days if the table grows.
  const existing = await db.ingestionBatch.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    // If a prior attempt is still RECEIVED/PROCESSING, don't re-insert; just
    // report the current state. Client should poll GET /api/ingest/sales/:id.
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
        error: `Batch too large: ${rowsInput.length} rows (max ${MAX_ROWS_PER_BATCH}). Split and retry with new Idempotency-Keys.`,
      },
      { status: 400 },
    );
  }

  // Validate rows one-by-one so we can record per-row errors instead of
  // failing the whole batch on a single bad row. Reliance ops want PARTIAL,
  // not all-or-nothing, when 3 rows out of 5000 are malformed.
  const validated: SalesRow[] = [];
  const errors: Array<{ row: number; error: string }> = [];
  rowsInput.forEach((row, index) => {
    const parsed = salesRowSchema.safeParse(row);
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

  // Confirm store codes exist. Unknown store → row goes to the reject bucket.
  const uniqueStoresRequested = [...new Set(validated.map((r) => r.storeCode))];
  const knownStores = uniqueStoresRequested.length
    ? await db.storeMaster.findMany({
        where: { storeCode: { in: uniqueStoresRequested } },
        select: { storeCode: true },
      })
    : [];
  const knownStoreSet = new Set(knownStores.map((s) => s.storeCode));

  const acceptedRows: Prisma.SalesTransactionCreateManyInput[] = [];
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
    const txnDate = parseDate(row.transactionDate);
    if (isNaN(txnDate.getTime())) {
      if (errors.length < MAX_ERROR_LOG_ENTRIES) {
        errors.push({
          row: index + 1,
          error: `Invalid date: "${row.transactionDate}"`,
        });
      }
      return;
    }
    acceptedRows.push({
      transactionId: row.transactionId,
      transactionDate: txnDate,
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
    });
  });

  const uniqueStores = [...new Set(acceptedRows.map((r) => r.storeCode))];
  const dates = acceptedRows.map((r) => r.transactionDate as Date);
  const minTxnDate = dates.length
    ? new Date(Math.min(...dates.map((d) => d.getTime())))
    : null;
  const maxTxnDate = dates.length
    ? new Date(Math.max(...dates.map((d) => d.getTime())))
    : null;

  // Create the batch row first (RECEIVED). This is our idempotency record —
  // if we crash between here and the insert, a retry hits the replay branch
  // and we can reconcile manually.
  let batch;
  try {
    batch = await db.ingestionBatch.create({
      data: {
        idempotencyKey,
        source,
        batchRef,
        submittedBy,
        status: IngestionStatus.RECEIVED,
        rowsSubmitted: rowsInput.length,
        rowsAccepted: 0,
        rowsRejected: errors.length,
        errorLog: errors.length ? (errors as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        minTxnDate,
        maxTxnDate,
        storeCodes: uniqueStores,
      },
    });
  } catch (e) {
    // Race: another request with the same key beat us to the insert.
    // Re-read and replay.
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

  // If nothing survived validation, close the batch out here.
  if (acceptedRows.length === 0) {
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

  // Chunked insert. createMany has a parameter-count ceiling (~65K Postgres
  // params); at 16 columns per row, INSERT_CHUNK_SIZE=1000 stays well under
  // limits and keeps transactions short so autovacuum isn't starved.
  let totalInserted = 0;
  try {
    for (let i = 0; i < acceptedRows.length; i += INSERT_CHUNK_SIZE) {
      const chunk = acceptedRows.slice(i, i + INSERT_CHUNK_SIZE);
      const result = await db.salesTransaction.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      totalInserted += result.count;
    }
  } catch (e) {
    await db.ingestionBatch.update({
      where: { id: batch.id },
      data: {
        status: IngestionStatus.FAILED,
        completedAt: new Date(),
        errorLog: [
          ...errors,
          { row: 0, error: `Insert failed: ${(e as Error).message}` },
        ].slice(0, MAX_ERROR_LOG_ENTRIES) as unknown as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json(
      { error: `Database error: ${(e as Error).message}`, batchId: batch.id },
      { status: 500 },
    );
  }

  // Enqueue a recompute job instead of running the engine here. The cron
  // worker will claim it. If the job table insert fails we still count the
  // data as ingested — the cron can re-pick up by scanning PROCESSING
  // batches older than 10 minutes.
  let jobId: number | null = null;
  if (minTxnDate && maxTxnDate && uniqueStores.length) {
    try {
      const job = await db.recomputeJob.create({
        data: {
          trigger: "INGESTION",
          storeCodes: uniqueStores,
          periodStart: minTxnDate,
          periodEnd: maxTxnDate,
          ingestionBatchId: batch.id,
          enqueuedBy: submittedBy,
        },
      });
      jobId = job.id;
    } catch (e) {
      console.error(`[ingest] failed to enqueue recompute job for batch ${batch.id}:`, e);
    }
  }

  const skipped = acceptedRows.length - totalInserted;
  const status =
    errors.length === 0
      ? IngestionStatus.PROCESSING
      : IngestionStatus.PROCESSING;

  await db.ingestionBatch.update({
    where: { id: batch.id },
    data: {
      status,
      rowsAccepted: totalInserted,
      rowsRejected: errors.length + skipped,
      errorLog:
        errors.length || skipped
          ? ([
              ...errors,
              ...(skipped > 0
                ? [
                    {
                      row: 0,
                      error: `${skipped} row(s) already existed (duplicate transactionId), skipped`,
                    },
                  ]
                : []),
            ].slice(0, MAX_ERROR_LOG_ENTRIES) as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
    },
  });

  return NextResponse.json(
    {
      batchId: batch.id,
      status,
      rowsSubmitted: rowsInput.length,
      rowsAccepted: totalInserted,
      rowsRejected: errors.length + skipped,
      errors,
      recomputeJobId: jobId,
    },
    { status: 202 },
  );
}
