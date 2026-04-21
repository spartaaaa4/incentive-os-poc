export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";

const submitSchema = z.object({
  planId: z.number().int().positive(),
  submissionNote: z.string().max(4000).optional(),
});

/**
 * Flip a DRAFT plan → SUBMITTED and open an ApprovalRequest.
 *
 * If an earlier PENDING ApprovalRequest exists for the same (PLAN, planId), it
 * is marked SUPERSEDED and the new request points back to it via
 * `supersededById` — that's how we reconstruct the before/after chain in the
 * approvals UI.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = submitSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { planId, submissionNote } = parsed.data;

    // Load plan first so we can vertical-scope the permission check.
    const plan = await db.incentivePlan.findUnique({
      where: { id: planId },
      include: {
        productIncentiveSlabs: true,
        achievementMultipliers: true,
        fnlRoleSplits: true,
        campaignConfigs: { include: { articles: true, storeTargets: true, payoutSlabs: true } },
      },
    });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (plan.status !== "DRAFT") {
      return NextResponse.json({ error: `Cannot submit plan in ${plan.status} status` }, { status: 400 });
    }

    const auth = await requirePermission(request, "canSubmitApproval", { vertical: plan.vertical });
    if ("error" in auth) return auth.error;
    const submittedBy = auth.identity.employeeId;

    const changeSnapshot = {
      plan: {
        id: plan.id,
        planName: plan.planName,
        vertical: plan.vertical,
        formulaType: plan.formulaType,
        periodType: plan.periodType,
        version: plan.version,
        effectiveFrom: plan.effectiveFrom,
        effectiveTo: plan.effectiveTo,
        config: plan.config,
      },
      productIncentiveSlabs: plan.productIncentiveSlabs,
      achievementMultipliers: plan.achievementMultipliers,
      fnlRoleSplits: plan.fnlRoleSplits,
      campaignConfigs: plan.campaignConfigs,
    };

    await db.$transaction(async (tx) => {
      await tx.incentivePlan.update({
        where: { id: planId },
        data: { status: "SUBMITTED", submittedBy },
      });

      // Supersede any prior PENDING request for this same plan.
      const prior = await tx.approvalRequest.findFirst({
        where: { entityType: "PLAN", entityId: planId, decision: "PENDING" },
        orderBy: { submittedAt: "desc" },
      });

      const newReq = await tx.approvalRequest.create({
        data: {
          entityType: "PLAN",
          entityId: planId,
          vertical: plan.vertical,
          title: `${plan.planName} (v${plan.version})`,
          summary: `Plan submitted for approval by ${auth.identity.employeeName}`,
          changeSnapshot,
          submissionNote: submissionNote?.trim() || null,
          submittedBy,
          seenBy: [],
          decision: "PENDING",
        },
      });

      if (prior) {
        await tx.approvalRequest.update({
          where: { id: prior.id },
          data: {
            decision: "SUPERSEDED",
            supersededById: newReq.id,
            decidedAt: new Date(),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          entityType: "PLAN",
          entityId: planId,
          action: "SUBMITTED",
          newValue: {
            planName: plan.planName,
            vertical: plan.vertical,
            approvalRequestId: newReq.id,
            supersededRequestId: prior?.id ?? null,
          },
          performedBy: submittedBy,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Submit rule error:", error);
    return NextResponse.json({ error: "Failed to submit plan" }, { status: 500 });
  }
}
