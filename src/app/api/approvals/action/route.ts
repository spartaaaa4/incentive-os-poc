import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const approvalSchema = z.object({
  entityType: z.enum(["PLAN", "TARGET"]),
  entityId: z.number().int().positive(),
  action: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const parsed = approvalSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { entityType, entityId, action, reason } = parsed.data;

    if (!entityId || !entityType) {
      return NextResponse.json({ error: "entityType and entityId are required" }, { status: 400 });
    }

    const newStatus = action === "APPROVED" ? "ACTIVE" : "DRAFT";

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
            approvedBy: action === "APPROVED" ? "checker" : undefined,
            rejectionReason: action === "REJECTED" ? reason : undefined,
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
            approvedBy: action === "APPROVED" ? "checker" : undefined,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          entityType: entityType as "PLAN" | "TARGET" | "CAMPAIGN" | "CALCULATION",
          entityId: typeof entityId === "number" ? entityId : 0,
          action: action as "APPROVED" | "REJECTED",
          newValue: { reason: reason ?? null },
          performedBy: "checker",
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Approval action failed";
    if (message.includes("not in SUBMITTED status")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("Approval action error:", error);
    return NextResponse.json({ error: "Approval action failed" }, { status: 500 });
  }
}
