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
 * without blocking on jobs another worker is already processing.
 *
 * Reaper / retry semantics (added after architect review #1):
 *   - Stuck RUNNING jobs older than `RECLAIM_AFTER_MS` are eligible for
 *     re-claim. A worker that crashed mid-run won't leave the job wedged
 *     forever. `claimed_at` is stamped on every claim, so the threshold
 *     is measured against the LAST attempt.
 *   - `attempts` is incremented on every claim. Jobs hit `MAX_ATTEMPTS` and
 *     stop being re-claimable — they stay FAILED, which is our DLQ for now
 *     (ops UI in Phase 6 will surface `status=FAILED AND attempts>=5`).
 *   - A handler exception with `attempts < MAX_ATTEMPTS` flips the job back
 *     to PENDING so the next cron tick retries it. Only the final attempt
 *     marks the row FAILED and flips the owning `IngestionBatch` to FAILED.
 *
 * Auth: `CRON_SECRET` bearer (Replit Scheduled Deployment).
 *
 * Body (optional): { maxJobs?: number }   default 5, ceiling 20
 */

/** Max retries before a job is considered dead-lettered (stays FAILED). */
const MAX_ATTEMPTS = 5;
/** How long a RUNNING job can go without updating before the reaper reclaims it. */
const RECLAIM_AFTER_MS = 10 * 60 * 1000; // 10 minutes

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
    status: "COMPLETED" | "RETRY" | "FAILED";
    attempts: number;
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
          errorMessage: null,
        },
      });
      if (job.ingestionBatchId) {
        await db.ingestionBatch.update({
          where: { id: job.ingestionBatchId },
          data: {
            status: IngestionStatus.COMPLETED,
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
        attempts: job.attempts,
        stores: job.storeCodes.length,
        elapsedMs: Date.now() - jobStart,
      });
    } catch (e) {
      const errorMessage = (e as Error).message;
      const terminal = job.attempts >= MAX_ATTEMPTS;
      console.error(
        `[run-jobs] job ${job.id} failed (attempt ${job.attempts}/${MAX_ATTEMPTS}${terminal ? ", DLQ" : ", will retry"}):`,
        errorMessage,
      );

      if (terminal) {
        // DLQ: final attempt, stop retrying. Batch owner is also terminally FAILED.
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
          attempts: job.attempts,
          stores: job.storeCodes.length,
          elapsedMs: Date.now() - jobStart,
          error: errorMessage,
        });
      } else {
        // Transient failure: re-queue for the next cron tick. Cron frequency
        // is the de-facto backoff — no explicit sleep needed. Don't touch the
        // IngestionBatch status; it stays in its pre-run state.
        await db.recomputeJob.update({
          where: { id: job.id },
          data: {
            status: RecomputeJobStatus.PENDING,
            claimedAt: null,
            errorMessage,
          },
        });
        results.push({
          jobId: job.id,
          status: "RETRY",
          attempts: job.attempts,
          stores: job.storeCodes.length,
          elapsedMs: Date.now() - jobStart,
          error: errorMessage,
        });
      }
    }
  }

  return NextResponse.json({
    drained: results.length,
    results,
    elapsedMs: Date.now() - started,
  });
}

/**
 * Atomic claim. Picks the oldest job that is either:
 *   (a) PENDING — never tried, or re-queued after a transient failure; or
 *   (b) RUNNING but stuck — `claimed_at` older than RECLAIM_AFTER_MS, which
 *       means the worker that held it crashed or timed out.
 *
 * In both cases `attempts` must be below MAX_ATTEMPTS; terminally-failed jobs
 * stay in FAILED (our DLQ). `attempts` increments on every claim, so the
 * post-claim value is the current attempt number.
 *
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
  attempts: number;
};

async function claimNextJob(): Promise<ClaimedJob | null> {
  const reclaimBefore = new Date(Date.now() - RECLAIM_AFTER_MS);
  const rows = await db.$queryRaw<
    Array<{
      id: number;
      trigger: string;
      store_codes: string[];
      period_start: Date;
      period_end: Date;
      ingestion_batch_id: number | null;
      attempts: number;
    }>
  >`
    UPDATE recompute_job
       SET status = 'RUNNING',
           claimed_at = NOW(),
           attempts = attempts + 1,
           updated_at = NOW()
     WHERE id = (
       SELECT id FROM recompute_job
        WHERE attempts < ${MAX_ATTEMPTS}
          AND (
            status = 'PENDING'
            OR (status = 'RUNNING' AND claimed_at < ${reclaimBefore})
          )
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING id, trigger, store_codes, period_start, period_end, ingestion_batch_id, attempts
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
    attempts: row.attempts,
  };
}
