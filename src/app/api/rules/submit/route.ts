export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const submitSchema = z.object({
  planId: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const parsed = submitSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { planId } = parsed.data;
    const plan = await db.incentivePlan.findUnique({ where: { id: planId } });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (plan.status !== "DRAFT") {
      return NextResponse.json({ error: `Cannot submit plan in ${plan.status} status` }, { status: 400 });
    }

    await db.incentivePlan.update({
      where: { id: planId },
      data: { status: "SUBMITTED", submittedBy: "admin" },
    });

    await db.auditLog.create({
      data: {
        entityType: "PLAN",
        entityId: planId,
        action: "SUBMITTED",
        newValue: { planName: plan.planName, vertical: plan.vertical },
        performedBy: "admin",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Submit rule error:", error);
    return NextResponse.json({ error: "Failed to submit plan" }, { status: 500 });
  }
}
