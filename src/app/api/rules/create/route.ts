export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";

const createPlanSchema = z.object({
  vertical: z.enum(["ELECTRONICS", "GROCERY", "FNL"]),
});

const electronicsSlabs = [
  ["Photography", "All brands", 500, 42000, 40], ["Photography", "All brands", 42001, 52000, 75], ["Photography", "All brands", 52001, 999999, 120],
  ["SDA & Consumer Appliances", "All brands", 500, 3200, 40], ["SDA & Consumer Appliances", "All brands", 3201, 4200, 50], ["SDA & Consumer Appliances", "All brands", 4201, 999999, 100],
  ["Tablets", "All brands", 500, 22000, 20], ["Tablets", "All brands", 22001, 30000, 35], ["Tablets", "All brands", 30001, 999999, 60],
  ["Wireless Phones", "Samsung, Oppo, Vivo", 500, 18000, 25], ["Wireless Phones", "Samsung, Oppo, Vivo", 18001, 20000, 50], ["Wireless Phones", "Samsung, Oppo, Vivo", 20001, 999999, 75],
  ["Wireless Phones", "Xiaomi, Realme, Others", 500, 40000, 10], ["Wireless Phones", "Xiaomi, Realme, Others", 40001, 47000, 15], ["Wireless Phones", "Xiaomi, Realme, Others", 47001, 999999, 20],
  ["Laptops & Desktops", "All brands excl Apple & Microsoft Surface", 500, 47000, 50], ["Laptops & Desktops", "All brands excl Apple & Microsoft Surface", 47001, 52000, 70], ["Laptops & Desktops", "All brands excl Apple & Microsoft Surface", 52001, 999999, 90],
  ["Home Entertainment TVs", "All brands excl OnePlus, MI, Realme", 500, 40000, 50], ["Home Entertainment TVs", "All brands excl OnePlus, MI, Realme", 40001, 60000, 100], ["Home Entertainment TVs", "All brands excl OnePlus, MI, Realme", 60001, 999999, 225],
  ["Home Entertainment TVs", "OnePlus, MI, Realme", 500, 25000, 25], ["Home Entertainment TVs", "OnePlus, MI, Realme", 25001, 30000, 50], ["Home Entertainment TVs", "OnePlus, MI, Realme", 30001, 999999, 75],
  ["Large Appliances", "All brands excl IFB washing machines", 500, 25000, 50], ["Large Appliances", "All brands excl IFB washing machines", 25001, 40000, 100], ["Large Appliances", "All brands excl IFB washing machines", 40001, 999999, 150],
  ["Large Washing Machines (LWC)", "IFB only", 500, 20000, 25], ["Large Washing Machines (LWC)", "IFB only", 20001, 35000, 50], ["Large Washing Machines (LWC)", "IFB only", 35001, 999999, 75],
];

const defaultMultipliers = [
  [0, 84.99, 0], [85, 89.99, 50], [90, 99.99, 80],
  [100, 109.99, 100], [110, 119.99, 110], [120, 999, 120],
];

const defaultRoleSplits = [
  [1, 0, 70, 30, 0], [1, 1, 60, 24, 16], [1, 2, 60, 16, 12],
  [1, 3, 60, 12, 9.2], [1, 4, 60, 10, 7.6],
];

export async function POST(request: NextRequest) {
  try {
    const body = createPlanSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { vertical } = body.data;

    const auth = await requirePermission(request, "canEditIncentives", { vertical });
    if ("error" in auth) return auth.error;
    const createdBy = auth.identity.employeeId;

    if (vertical === "ELECTRONICS") {
      const plan = await db.$transaction(async (tx) => {
        const p = await tx.incentivePlan.create({
          data: {
            planName: "Electronics Per Unit Plan",
            vertical: "ELECTRONICS",
            formulaType: "PER_UNIT",
            periodType: "MONTHLY",
            status: "DRAFT",
            version: 1,
            createdBy,
          },
        });
        await tx.productIncentiveSlab.createMany({
          data: electronicsSlabs.map((s) => ({
            planId: p.id,
            productFamily: s[0] as string,
            brandFilter: s[1] as string,
            priceFrom: s[2] as number,
            priceTo: s[3] as number,
            incentivePerUnit: s[4] as number,
            effectiveFrom: new Date(),
          })),
        });
        await tx.achievementMultiplier.createMany({
          data: defaultMultipliers.map((r) => ({
            planId: p.id,
            achievementFrom: r[0],
            achievementTo: r[1],
            multiplierPct: r[2],
            effectiveFrom: new Date(),
          })),
        });
        return p;
      });
      return NextResponse.json({ planId: plan.id });
    }

    if (vertical === "GROCERY") {
      const plan = await db.$transaction(async (tx) => {
        const p = await tx.incentivePlan.create({
          data: {
            planName: "Grocery Campaign Plan",
            vertical: "GROCERY",
            formulaType: "CAMPAIGN_SLAB",
            periodType: "CAMPAIGN",
            status: "DRAFT",
            version: 1,
            createdBy,
          },
        });
        await tx.campaignConfig.create({
          data: {
            planId: p.id,
            campaignName: "New Campaign",
            startDate: new Date(),
            endDate: new Date(Date.now() + 10 * 86400000),
            channel: "OFFLINE",
            distributionRule: "EQUAL",
            status: "DRAFT",
          },
        });
        return p;
      });
      return NextResponse.json({ planId: plan.id });
    }

    if (vertical === "FNL") {
      const plan = await db.$transaction(async (tx) => {
        const p = await tx.incentivePlan.create({
          data: {
            planName: "F&L Weekly Store Pool",
            vertical: "FNL",
            formulaType: "WEEKLY_POOL",
            periodType: "WEEKLY",
            status: "DRAFT",
            version: 1,
            config: { poolPct: 1, attendanceMinDays: 5, weekDefinition: "SUNDAY_TO_SATURDAY" },
            createdBy,
          },
        });
        await tx.fnlRoleSplit.createMany({
          data: defaultRoleSplits.map((r) => ({
            planId: p.id,
            numSms: r[0],
            numDms: r[1],
            saPoolPct: r[2],
            smSharePct: r[3],
            dmSharePerDmPct: r[4],
          })),
        });
        return p;
      });
      return NextResponse.json({ planId: plan.id });
    }

    return NextResponse.json({ error: "Invalid vertical" }, { status: 400 });
  } catch (error) {
    console.error("Create plan error:", error);
    return NextResponse.json({ error: "Failed to create plan" }, { status: 500 });
  }
}
