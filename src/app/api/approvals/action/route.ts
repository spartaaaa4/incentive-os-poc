import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const { entityType, entityId, action, reason } = await request.json();

    if (!["APPROVED", "REJECTED"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    if (!entityId || !entityType) {
      return NextResponse.json({ error: "entityType and entityId are required" }, { status: 400 });
    }

    const newStatus = action === "APPROVED" ? "ACTIVE" : "REJECTED";

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
    } else if (entityType === "TARGET") {
      const anchor = await db.target.findUnique({ where: { id: entityId } });
      if (!anchor || anchor.status !== "SUBMITTED") {
        return NextResponse.json({ error: "Target not in SUBMITTED status" }, { status: 400 });
      }

      await db.target.updateMany({
        where: {
          status: "SUBMITTED",
          vertical: anchor.vertical,
          periodType: anchor.periodType,
          periodStart: anchor.periodStart,
          periodEnd: anchor.periodEnd,
        },
        data: {
          status: newStatus,
          approvedBy: action === "APPROVED" ? "checker" : undefined,
        },
      });
    } else {
      return NextResponse.json({ error: "Unsupported entityType" }, { status: 400 });
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
