import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const slabSchema = z.object({
  productFamily: z.string(),
  brandFilter: z.string(),
  priceFrom: z.number(),
  priceTo: z.number(),
  incentivePerUnit: z.number(),
});

const multiplierSchema = z.object({
  achievementFrom: z.number(),
  achievementTo: z.number(),
  multiplierPct: z.number(),
});

const roleSplitSchema = z.object({
  numSms: z.number(),
  numDms: z.number(),
  saPoolPct: z.number(),
  smSharePct: z.number(),
  dmSharePerDmPct: z.number(),
});

const wizardSchema = z.object({
  vertical: z.enum(["ELECTRONICS", "GROCERY", "FNL"]),
  planName: z.string().min(1),
  effectiveFrom: z.string(),
  effectiveTo: z.string(),
  slabs: z.array(slabSchema).optional(),
  multipliers: z.array(multiplierSchema).optional(),
  poolPct: z.number().optional(),
  attendanceMinDays: z.number().optional(),
  roleSplits: z.array(roleSplitSchema).optional(),
  campaignName: z.string().optional(),
  campaignStart: z.string().optional(),
  campaignEnd: z.string().optional(),
  distributionRule: z.enum(["EQUAL"]).optional(),
});

export async function POST(request: Request) {
  try {
    const parsed = wizardSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const d = parsed.data;

    const formulaType = d.vertical === "ELECTRONICS" ? "PER_UNIT" : d.vertical === "GROCERY" ? "CAMPAIGN_SLAB" : "WEEKLY_POOL";
    const periodType = d.vertical === "ELECTRONICS" ? "MONTHLY" : d.vertical === "GROCERY" ? "CAMPAIGN" : "WEEKLY";

    const plan = await db.$transaction(async (tx) => {
      const config = d.vertical === "FNL"
        ? { poolPct: d.poolPct ?? 1, attendanceMinDays: d.attendanceMinDays ?? 5, weekDefinition: "SUNDAY_TO_SATURDAY" }
        : undefined;

      const p = await tx.incentivePlan.create({
        data: {
          planName: d.planName,
          vertical: d.vertical,
          formulaType,
          periodType,
          status: "DRAFT",
          version: 1,
          effectiveFrom: new Date(d.effectiveFrom),
          effectiveTo: new Date(d.effectiveTo),
          config: config ?? undefined,
          createdBy: "admin",
        },
      });

      if (d.vertical === "ELECTRONICS" && d.slabs?.length) {
        await tx.productIncentiveSlab.createMany({
          data: d.slabs.map((s) => ({
            planId: p.id,
            productFamily: s.productFamily,
            brandFilter: s.brandFilter,
            priceFrom: s.priceFrom,
            priceTo: s.priceTo,
            incentivePerUnit: s.incentivePerUnit,
            effectiveFrom: new Date(d.effectiveFrom),
          })),
        });
      }

      if ((d.vertical === "ELECTRONICS" || d.vertical === "FNL") && d.multipliers?.length) {
        await tx.achievementMultiplier.createMany({
          data: d.multipliers.map((m) => ({
            planId: p.id,
            achievementFrom: m.achievementFrom,
            achievementTo: m.achievementTo,
            multiplierPct: m.multiplierPct,
            effectiveFrom: new Date(d.effectiveFrom),
          })),
        });
      }

      if (d.vertical === "GROCERY" && d.campaignName) {
        await tx.campaignConfig.create({
          data: {
            planId: p.id,
            campaignName: d.campaignName,
            startDate: new Date(d.campaignStart ?? d.effectiveFrom),
            endDate: new Date(d.campaignEnd ?? d.effectiveTo),
            channel: "OFFLINE",
            distributionRule: "EQUAL",
            status: "DRAFT",
          },
        });
      }

      if (d.vertical === "FNL" && d.roleSplits?.length) {
        await tx.fnlRoleSplit.createMany({
          data: d.roleSplits.map((r) => ({
            planId: p.id,
            numSms: r.numSms,
            numDms: r.numDms,
            saPoolPct: r.saPoolPct,
            smSharePct: r.smSharePct,
            dmSharePerDmPct: r.dmSharePerDmPct,
          })),
        });
      }

      return p;
    });

    return NextResponse.json({ planId: plan.id, planName: plan.planName });
  } catch (error) {
    console.error("Wizard create error:", error);
    return NextResponse.json({ error: "Failed to create plan" }, { status: 500 });
  }
}
