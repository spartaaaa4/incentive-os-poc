export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startOfMonth, endOfMonth } from "date-fns";
import { db } from "@/lib/db";
import { recalculateIncentives } from "@/server/calculations/engines";
import { requirePermission } from "@/lib/permissions";
import type { Vertical } from "@prisma/client";

const approvalSchema = z
  .object({
    entityType: z.enum(["PLAN", "TARGET"]),
    entityId: z.number().int().positive(),
    /** Required for TARGET batches (anchor row → batchKey). */
    batchKey: z.string().optional(),
    action: z.enum(["APPROVED", "REJECTED"]),
    /** Required when rejecting (min 5 chars after trim). */
    reason: z.string().optional(),
    /** Optional checker notes when approving. */
    approvalComment: z.string().max(4000).optional(),
  })
  .refine(
    (data) =>
      data.action !== "REJECTED" ||
      (data.reason?.trim().length ?? 0) >= 5,
    { message: "Rejection reason is required (at least 5 characters).", path: ["reason"] },
  );

export async function POST(request: NextRequest) {
  try {
    const parsed = approvalSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { entityType, entityId, batchKey, action, reason, approvalComment } = parsed.data;

    // Look up the ApprovalRequest first so we can vertical-scope the permission
    // check. Fall back to the underlying entity if no request exists (legacy
    // entities submitted before Phase 2).
    let approvalReq = await db.approvalRequest.findFirst({
      where: {
        entityType,
        decision: "PENDING",
        ...(batchKey ? { batchKey } : { entityId }),
      },
      orderBy: { submittedAt: "desc" },
    });

    let vertical: Vertical | null = approvalReq?.vertical ?? null;
    if (!vertical) {
      if (entityType === "PLAN") {
        const plan = await db.incentivePlan.findUnique({ where: { id: entityId }, select: { vertical: true } });
        vertical = plan?.vertical ?? null;
      } else {
        const t = batchKey
          ? await db.target.findFirst({ where: { batchKey }, select: { vertical: true } })
          : await db.target.findUnique({ where: { id: entityId }, select: { vertical: true } });
        vertical = t?.vertical ?? null;
      }
    }

    const auth = await requirePermission(request, "canApprove", vertical ? { vertical } : undefined);
    if ("error" in auth) return auth.error;
    const decidedBy = auth.identity.employeeId;

    const newStatus = action === "APPROVED" ? "ACTIVE" : "DRAFT";
    const newDecision = action === "APPROVED" ? "APPROVED" : "REJECTED";

    await db.$transaction(async (tx) => {
      if (entityType === "PLAN") {
        const plan = await tx.incentivePlan.findUnique({ where: { id: entityId } });
        if (!plan || plan.status !== "SUBMITTED") {
          throw new Error("Plan not in SUBMITTED status");
        }

        await tx.incentivePlan.update({
          where: { id: entityId },
          data: {
            status: newStatus,
            approvedBy: action === "APPROVED" ? decidedBy : undefined,
            rejectionReason:
              action === "REJECTED" ? (reason?.trim() ?? null) : null,
          },
        });

        if (action === "APPROVED") {
          await tx.campaignConfig.updateMany({
            where: { planId: entityId, status: "SUBMITTED" },
            data: { status: "ACTIVE" },
          });
        }
      }

      if (entityType === "TARGET") {
        // Prefer batchKey scope (new path). Fall back to (vertical, periodType)
        // for legacy targets with no batchKey.
        if (batchKey) {
          const any = await tx.target.findFirst({ where: { batchKey, status: "SUBMITTED" } });
          if (!any) throw new Error("Target batch not in SUBMITTED status");

          await tx.target.updateMany({
            where: { batchKey, status: "SUBMITTED" },
            data: {
              status: newStatus,
              approvedBy: action === "APPROVED" ? decidedBy : undefined,
            },
          });
        } else {
          const refTarget = await tx.target.findUnique({ where: { id: entityId } });
          if (!refTarget || refTarget.status !== "SUBMITTED") {
            throw new Error("Target group not in SUBMITTED status");
          }
          await tx.target.updateMany({
            where: {
              status: "SUBMITTED",
              vertical: refTarget.vertical,
              periodType: refTarget.periodType,
            },
            data: {
              status: newStatus,
              approvedBy: action === "APPROVED" ? decidedBy : undefined,
            },
          });
        }
      }

      // Write the decision onto the ApprovalRequest. Create one retroactively
      // for legacy SUBMITTED entities that pre-date Phase 2.
      if (approvalReq) {
        await tx.approvalRequest.update({
          where: { id: approvalReq.id },
          data: {
            decision: newDecision,
            decidedBy,
            decidedAt: new Date(),
            decisionNote:
              action === "REJECTED"
                ? (reason?.trim() ?? null)
                : (approvalComment?.trim() || null),
          },
        });
      } else {
        approvalReq = await tx.approvalRequest.create({
          data: {
            entityType,
            entityId,
            batchKey: batchKey ?? null,
            vertical,
            title: `${entityType} #${entityId}`,
            summary: "Legacy entity decided without submission trail",
            submittedBy: decidedBy, // best we can do — no real submitter recorded
            seenBy: [],
            decision: newDecision,
            decidedBy,
            decidedAt: new Date(),
            decisionNote:
              action === "REJECTED"
                ? (reason?.trim() ?? null)
                : (approvalComment?.trim() || null),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          entityType: entityType as "PLAN" | "TARGET" | "CAMPAIGN" | "CALCULATION",
          entityId: typeof entityId === "number" ? entityId : 0,
          action: action as "APPROVED" | "REJECTED",
          newValue: {
            rejectionReason: action === "REJECTED" ? (reason?.trim() ?? null) : null,
            approvalComment:
              action === "APPROVED" ? (approvalComment?.trim() || null) : null,
            approvalRequestId: approvalReq?.id ?? null,
            batchKey: batchKey ?? null,
          },
          performedBy: decidedBy,
        },
      });
    });

    // Retroactive recalculation: when a plan or target is approved, recalculate affected incentives
    if (action === "APPROVED") {
      try {
        const allStores = await db.storeMaster.findMany({ select: { storeCode: true } });
        const storeCodes = allStores.map((s) => s.storeCode);
        const now = new Date();
        await recalculateIncentives({
          storeCodes,
          periodStart: startOfMonth(now),
          periodEnd: endOfMonth(now),
        });
      } catch (recalcError) {
        console.error("Post-approval recalculation error:", recalcError);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Approval action failed";
    if (message.includes("not in SUBMITTED status") || message.includes("Target batch")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("Approval action error:", error);
    return NextResponse.json({ error: "Approval action failed" }, { status: 500 });
  }
}
