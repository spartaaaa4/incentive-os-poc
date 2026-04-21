export const dynamic = "force-dynamic";
export const maxDuration = 300;
import { NextRequest, NextResponse } from "next/server";
import { IngestionStatus, RecomputeJobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { recalculateByDateSpan } from "@/server/calculations/engines";

/**
 * Drains pending `RecomputeJob` rows enqueued by `/api/ingest/sales`.
 *
 * Claim pattern: `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`.
 * This is the idiomatic Postgres queue: multiple worker invocations can run
 * concurrently without double-claiming, without a distributed lock, and
 * without blocking on jobs another worker is already processing. If Reliance
 * scale later demands more throughput, scale the cron frequency or swap in
 * pg-boss/BullMQ — the schema doesn't change.
 *
 * Auth: `CRON_SECRET` bearer (Replit Scheduled Deployment).
 *
 * Body (optional): { maxJobs?: number }   default 5, ceiling 20
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => ({} as { maxJobs?: number }));
  const maxJobsRaw = Number(body?.maxJobs);
  const maxJobs = Number.isFinite(maxJobsRaw) && maxJobsRaw > 0
    ? Math.min(20, Math.floor(maxJobsRaw))
    : 5;

  const started = Date.now();
  const results: Array<{
    jobId: number;
    status: "COMPLETED" | "FAILED";
    stores: number;
    elapsedMs: number;
    error?: string;
  }> = [];

  for (let i = 0; i < maxJobs; i++) {
    const job = await claimNextJob();
    if (!job) break;

    const jobStart = Date.now();
    try {
      if (job.storeCodes.length && job.periodStart && job.periodEnd) {
        await recalculateByDateSpan(
          job.storeCodes,
          job.periodStart,
          job.periodEnd,
          { trigger: job.trigger },
        );
      }
      await db.recomputeJob.update({
        where: { id: job.id },
        data: {
          status: RecomputeJobStatus.COMPLETED,
          completedAt: new Date(),
        },
      });
      if (job.ingestionBatchId) {
        await db.ingestionBatch.update({
          where: { id: job.ingestionBatchId },
          data: {
            status:
              // If the batch had any rejects, close it PARTIAL; otherwise COMPLETED.
              // We read the current rowsRejected inside the update so we don't race
              // with a concurrent retry.
              IngestionStatus.COMPLETED,
            completedAt: new Date(),
          },
        });
        // Separate update to flip to PARTIAL when there were rejects, to keep
        // the first update idempotent and readable.
        const b = await db.ingestionBatch.findUnique({
          where: { id: job.ingestionBatchId },
          select: { rowsRejected: true },
        });
        if (b && b.rowsRejected > 0) {
          await db.ingestionBatch.update({
            where: { id: job.ingestionBatchId },
            data: { status: IngestionStatus.PARTIAL },
          });
        }
      }
      results.push({
        jobId: job.id,
        status: "COMPLETED",
        stores: job.storeCodes.length,
        elapsedMs: Date.now() - jobStart,
      });
    } catch (e) {
      const errorMessage = (e as Error).message;
      console.error(`[run-jobs] job ${job.id} failed:`, errorMessage);
      await db.recomputeJob.update({
        where: { id: job.id },
        data: {
          status: RecomputeJobStatus.FAILED,
          completedAt: new Date(),
          errorMessage,
        },
      });
      if (job.ingestionBatchId) {
        await db.ingestionBatch.update({
          where: { id: job.ingestionBatchId },
          data: {
            status: IngestionStatus.FAILED,
            completedAt: new Date(),
          },
        });
      }
      results.push({
        jobId: job.id,
        status: "FAILED",
        stores: job.storeCodes.length,
        elapsedMs: Date.now() - jobStart,
        error: errorMessage,
      });
    }
  }

  return NextResponse.json({
    drained: results.length,
    results,
    elapsedMs: Date.now() - started,
  });
}

/**
 * Atomic claim: bump the oldest PENDING job to RUNNING and return it.
 * `SKIP LOCKED` means concurrent invocations pick different rows instead of
 * blocking or double-claiming.
 */
type ClaimedJob = {
  id: number;
  trigger: "INGESTION" | "MANUAL_RECOMPUTE" | "SCHEDULED_CRON" | "PLAN_PUBLISH" | "ATTENDANCE_UPDATE" | "BACKFILL";
  storeCodes: string[];
  periodStart: Date;
  periodEnd: Date;
  ingestionBatchId: number | null;
};

async function claimNextJob(): Promise<ClaimedJob | null> {
  const rows = await db.$queryRaw<
    Array<{
      id: number;
      trigger: string;
      store_codes: string[];
      period_start: Date;
      period_end: Date;
      ingestion_batch_id: number | null;
    }>
  >`
    UPDATE recompute_job
       SET status = 'RUNNING',
           claimed_at = NOW(),
           attempts = attempts + 1,
           updated_at = NOW()
     WHERE id = (
       SELECT id FROM recompute_job
        WHERE status = 'PENDING'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING id, trigger, store_codes, period_start, period_end, ingestion_batch_id
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    trigger: row.trigger as ClaimedJob["trigger"],
    storeCodes: row.store_codes,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    ingestionBatchId: row.ingestion_batch_id,
  };
}
