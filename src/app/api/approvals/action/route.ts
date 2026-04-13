import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const { entityType, entityId, action, reason } = await request.json();

    if (!["APPROVED", "REJECTED"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const newStatus = action === "APPROVED" ? "ACTIVE" : "DRAFT";

    if (entityType === "PLAN") {
      const plan = await db.incentivePlan.findUnique({ where: { id: entityId } });
      if (!plan || plan.status !== "SUBMITTED") {
        return NextResponse.json({ error: "Plan not in SUBMITTED status" }, { status: 400 });
      }

      await db.incentivePlan.update({
        where: { id: entityId },
        data: {
          status: newStatus,
          approvedBy: action === "APPROVED" ? "checker" : undefined,
          rejectionReason: action === "REJECTED" ? reason : undefined,
        },
      });

      if (action === "APPROVED") {
        await db.campaignConfig.updateMany({
          where: { planId: entityId, status: "SUBMITTED" },
          data: { status: "ACTIVE" },
        });
      }
    }

    if (entityType === "TARGET") {
      const refTarget = await db.target.findUnique({ where: { id: entityId } });
      if (!refTarget || refTarget.status !== "SUBMITTED") {
        return NextResponse.json({ error: "Target group not in SUBMITTED status" }, { status: 400 });
      }

      await db.target.updateMany({
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

    await db.auditLog.create({
      data: {
        entityType: entityType as "PLAN" | "TARGET" | "CAMPAIGN" | "CALCULATION",
        entityId: typeof entityId === "number" ? entityId : 0,
        action: action as "APPROVED" | "REJECTED",
        newValue: { reason: reason ?? null },
        performedBy: "checker",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Approval action error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
