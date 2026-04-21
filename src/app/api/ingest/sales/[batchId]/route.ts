export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireIngestAuth } from "@/lib/permissions";

/**
 * Poll batch status. Reliance calls this after a 202 from `/api/ingest/sales`
 * to see when the deferred recompute finishes. Returns the batch + the
 * latest recompute job's state so the caller can tell the difference between
 * "rows inserted, still recomputing" and "fully done".
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const auth = await requireIngestAuth(request);
  if ("error" in auth) return auth.error;

  const { batchId: batchIdStr } = await params;
  const batchId = Number(batchIdStr);
  if (!Number.isFinite(batchId) || batchId <= 0) {
    return NextResponse.json({ error: "Invalid batchId" }, { status: 400 });
  }

  const batch = await db.ingestionBatch.findUnique({
    where: { id: batchId },
    include: {
      recomputeJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const job = batch.recomputeJobs[0] ?? null;

  return NextResponse.json({
    batchId: batch.id,
    idempotencyKey: batch.idempotencyKey,
    status: batch.status,
    source: batch.source,
    batchRef: batch.batchRef,
    rowsSubmitted: batch.rowsSubmitted,
    rowsAccepted: batch.rowsAccepted,
    rowsRejected: batch.rowsRejected,
    errors: batch.errorLog ?? [],
    createdAt: batch.createdAt,
    completedAt: batch.completedAt,
    recompute: job
      ? {
          jobId: job.id,
          status: job.status,
          attempts: job.attempts,
          claimedAt: job.claimedAt,
          completedAt: job.completedAt,
          errorMessage: job.errorMessage,
          periodStart: job.periodStart,
          periodEnd: job.periodEnd,
        }
      : null,
  });
}
