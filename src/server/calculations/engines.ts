import { addDays, endOfMonth, startOfMonth } from "date-fns";
import {
  AttendanceStatus,
  CalcRunTrigger,
  EmployeeRole,
  FormatTier,
  GroceryRoleBucket,
  PayrollStatus,
  StoreSalesStatus,
  TransactionType,
  Vertical,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  CalculationOutput,
  DailyRollupInput,
  LedgerRowInput,
  runCalculation,
} from "./runCoordinator";
import { EligibilityReason, makeReason } from "./eligibility";

type RecalculateInput = {
  storeCodes: string[];
  periodStart: Date;
  periodEnd: Date;
  trigger?: CalcRunTrigger;
  triggeredByUserId?: string | null;
};

/**
 * Maps product family codes to the slab product-family names they can match.
 * A code can map to multiple slab names (e.g. FJ03 can be "Large Appliances"
 * for non-IFB brands or "Large Washing Machines (LWC)" for IFB).
 * Brand filtering in the slab itself disambiguates.
 */
const familyCodeToSlabNames: Record<string, string[]> = {
  FF01: ["Laptops & Desktops"],
  FF03: ["Tablets"],
  FH01: ["Home Entertainment TVs"],
  FH07: ["Photography"],
  FK01: ["Wireless Phones"],
  FI01: ["SDA & Consumer Appliances"],
  FI02: ["SDA & Consumer Appliances"],
  FI04: ["SDA & Consumer Appliances"],
  FI05: ["SDA & Consumer Appliances"],
  FI06: ["SDA & Consumer Appliances"],
  FI07: ["SDA & Consumer Appliances"],
  FJ01: ["Large Appliances"],
  FJ02: ["Large Appliances"],
  FJ03: ["Large Appliances", "Large Washing Machines (LWC)"],
  FJ04: ["Large Appliances"],
  FJ05: ["Large Appliances"],
};

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value ?? 0);
}

/**
 * Products excluded entirely from Electronics incentives (vendor brief §6.4):
 *  - All Apple products (across all categories)
 *  - OnePlus phones only (FK01) — OnePlus TVs (FH01) earn their own slab
 *  - Microsoft Surface laptops only (FF01)
 */
function isElectronicsExcluded(brand: string | null, familyCode: string | null): boolean {
  const b = (brand ?? "").toLowerCase();
  if (b.includes("apple")) return true;
  if (familyCode === "FK01" && b.includes("oneplus")) return true;
  if (familyCode === "FF01" && b.includes("surface")) return true;
  return false;
}

function brandMatches(brandFilter: string, brand: string | null): boolean {
  if (!brand) return false;
  const normalized = brand.toLowerCase();
  const filter = brandFilter.toLowerCase();
  if (filter.includes("all brands")) {
    if (filter.includes("excl")) {
      if (filter.includes("apple") && normalized.includes("apple")) return false;
      if (filter.includes("surface") && normalized.includes("surface")) return false;
      if (filter.includes("oneplus") && normalized.includes("oneplus")) return false;
      if (filter.includes("mi") && normalized.includes("mi")) return false;
      if (filter.includes("realme") && normalized.includes("realme")) return false;
      if (filter.includes("ifb") && normalized.includes("ifb")) return false;
    }
    return true;
  }
  if (filter.includes("others")) return true;
  return filter
    .split(",")
    .map((value) => value.trim())
    .some((token) => normalized.includes(token));
}

type StoreMetadata = {
  storeCode: string;
  city: string;
  state: string;
  storeName: string;
  /// Phase 6.1 — needed by the Grocery HR Sales engine to resolve the
  /// store's slab tier (LARGE_FORMAT vs STORES). Cheap to include in the
  /// metadata fetch (already pulling per-store rows) so we avoid a second
  /// query inside the per-employee loop.
  storeFormat: string;
};

async function storeMetaFor(storeCodes: string[]): Promise<Map<string, StoreMetadata>> {
  if (!storeCodes.length) return new Map();
  const rows = await db.storeMaster.findMany({
    where: { storeCode: { in: storeCodes } },
    select: { storeCode: true, city: true, state: true, storeName: true, storeFormat: true },
  });
  return new Map(rows.map((r) => [r.storeCode, r]));
}

/**
 * Build per-(store, day) rollup inputs for one vertical from raw sales rows.
 * Used inside each vertical's compute phase so a single run writes both the
 * ledger and the matching daily rollup, tagged with the same run id.
 */
function dailyRollupsFrom(
  rows: Array<{ storeCode: string; vertical: Vertical; transactionDate: Date; grossAmount: unknown; taxAmount: unknown; quantity: number }>,
): DailyRollupInput[] {
  const bucket = new Map<string, DailyRollupInput>();
  for (const row of rows) {
    const dayKey = new Date(Date.UTC(
      row.transactionDate.getUTCFullYear(),
      row.transactionDate.getUTCMonth(),
      row.transactionDate.getUTCDate(),
    ));
    const key = `${row.storeCode}|${row.vertical}|${dayKey.toISOString().slice(0, 10)}`;
    const existing = bucket.get(key);
    const gross = asNumber(row.grossAmount);
    const tax = asNumber(row.taxAmount);
    if (existing) {
      existing.txnCount += 1;
      existing.grossAmount += gross;
      existing.netAmount += gross - tax;
      existing.unitsSold += row.quantity;
    } else {
      bucket.set(key, {
        storeCode: row.storeCode,
        vertical: row.vertical,
        dayKey,
        txnCount: 1,
        grossAmount: gross,
        netAmount: gross - tax,
        unitsSold: row.quantity,
      });
    }
  }
  return [...bucket.values()];
}

// ──────────── Electronics ────────────

async function computeElectronics(input: RecalculateInput): Promise<void> {
  const plan = await db.incentivePlan.findFirst({
    where: { vertical: Vertical.ELECTRONICS, status: "ACTIVE" },
    include: { productIncentiveSlabs: true, achievementMultipliers: true },
  });
  if (!plan) return;

  const storeMeta = await storeMetaFor(input.storeCodes);

  await runCalculation(
    {
      planId: plan.id,
      planVersion: plan.version,
      vertical: Vertical.ELECTRONICS,
      periodStart: startOfMonth(input.periodStart),
      periodEnd: endOfMonth(input.periodEnd),
      scopeStoreCodes: input.storeCodes,
      trigger: input.trigger ?? CalcRunTrigger.MANUAL_RECOMPUTE,
      triggeredByUserId: input.triggeredByUserId ?? null,
    },
    async () => {
      const ledgerRows: LedgerRowInput[] = [];
      const employeeRollups: CalculationOutput["employeeRollups"] = [];
      const storeRollups: CalculationOutput["storeRollups"] = [];
      const dailyRows: Array<{ storeCode: string; vertical: Vertical; transactionDate: Date; grossAmount: unknown; taxAmount: unknown; quantity: number }> = [];

      for (const storeCode of input.storeCodes) {
        const txns = await db.salesTransaction.findMany({
          where: {
            storeCode,
            vertical: Vertical.ELECTRONICS,
            transactionDate: { gte: input.periodStart, lte: input.periodEnd },
            channel: "OFFLINE",
            transactionType: TransactionType.NORMAL,
            employeeId: { not: null },
          },
          include: { employee: true },
        });

        dailyRows.push(...txns);

        // Broadened from `payrollStatus: ACTIVE` to also include NOTICE_PERIOD
        // and DISCIPLINARY_ACTION so the mobile app can render *why* those
        // employees see ₹0 instead of falling into the "no data" branch.
        const storeEmployees = await db.employeeMaster.findMany({
          where: {
            storeCode,
            payrollStatus: {
              in: [
                PayrollStatus.ACTIVE,
                PayrollStatus.NOTICE_PERIOD,
                PayrollStatus.DISCIPLINARY_ACTION,
              ],
            },
          },
        });
        const employeeDeptMap = new Map<string, string | null>();
        for (const emp of storeEmployees) {
          employeeDeptMap.set(emp.employeeId, emp.department);
        }

        const deptActual = new Map<string, number>();
        const employeeBase = new Map<string, number>();

        for (const txn of txns) {
          if (!txn.employee) continue;
          if (txn.employee.payrollStatus !== PayrollStatus.ACTIVE) continue;
          if (isElectronicsExcluded(txn.brand, txn.productFamilyCode)) continue;
          if (!txn.department || !txn.quantity || !txn.productFamilyCode) continue;

          deptActual.set(txn.department, (deptActual.get(txn.department) ?? 0) + asNumber(txn.grossAmount));
          if (txn.employee.role !== EmployeeRole.SA) continue;

          const unitPrice = asNumber(txn.grossAmount) / txn.quantity;
          const slabNames = familyCodeToSlabNames[txn.productFamilyCode];
          if (!slabNames) continue;

          const matchingSlab = plan.productIncentiveSlabs.find(
            (slab) =>
              slabNames.some((name) => slab.productFamily === name) &&
              brandMatches(slab.brandFilter, txn.brand) &&
              unitPrice >= asNumber(slab.priceFrom) &&
              unitPrice <= asNumber(slab.priceTo),
          );
          if (!matchingSlab) continue;

          const base = asNumber(matchingSlab.incentivePerUnit) * txn.quantity;
          employeeBase.set(txn.employeeId!, (employeeBase.get(txn.employeeId!) ?? 0) + base);
        }

        const targets = await db.target.findMany({
          where: {
            storeCode,
            vertical: Vertical.ELECTRONICS,
            status: "ACTIVE",
            periodStart: { lte: input.periodStart },
            periodEnd: { gte: input.periodEnd },
          },
        });

        const deptTargets = new Map<string, number>();
        for (const target of targets) {
          if (!target.department) continue;
          deptTargets.set(target.department, (deptTargets.get(target.department) ?? 0) + asNumber(target.targetValue));
        }

        const deptAchievement = new Map<string, { target: number; actual: number; achievementPct: number; multiplierPct: number }>();
        const allDepts = new Set([...deptActual.keys(), ...deptTargets.keys()]);
        for (const dept of allDepts) {
          const actual = deptActual.get(dept) ?? 0;
          const target = deptTargets.get(dept) ?? 0;
          const achievementPct = target > 0 ? (actual / target) * 100 : 0;
          const multiplier =
            plan.achievementMultipliers.find(
              (item) =>
                achievementPct >= asNumber(item.achievementFrom) &&
                achievementPct <= asNumber(item.achievementTo),
            )?.multiplierPct ?? 0;
          deptAchievement.set(dept, {
            target,
            actual,
            achievementPct,
            multiplierPct: asNumber(multiplier),
          });
        }

        const periodStart = startOfMonth(input.periodStart);
        const periodEnd = endOfMonth(input.periodEnd);

        let storeTotalIncentive = 0;
        let earningCount = 0;
        let storeTargetSum = 0;
        let storeActualSum = 0;
        for (const [, info] of deptAchievement) {
          storeTargetSum += info.target;
          storeActualSum += info.actual;
        }
        const storeAchievementPct = storeTargetSum > 0 ? (storeActualSum / storeTargetSum) * 100 : 0;

        // Find the lowest multiplier-tier threshold so we can label
        // DEPT_BELOW_THRESHOLD with a concrete number for the mobile copy.
        const lowestMultiplierFrom = plan.achievementMultipliers.length
          ? Math.min(...plan.achievementMultipliers.map((m) => asNumber(m.achievementFrom)))
          : 0;

        for (const emp of storeEmployees) {
          const employeeId = emp.employeeId;
          const empDept = employeeDeptMap.get(employeeId);
          const isActive = emp.payrollStatus === PayrollStatus.ACTIVE;
          const rawBase = employeeBase.get(employeeId) ?? 0;
          const deptInfo = empDept ? deptAchievement.get(empDept) : undefined;
          const multiplierPct = deptInfo?.multiplierPct ?? 0;
          const achievementPct = deptInfo?.achievementPct ?? 0;

          // Compute reason codes. Order matters for the leading message: the
          // first BLOCKING reason is what the mobile foregrounds.
          const reasons: EligibilityReason[] = [];

          if (emp.payrollStatus === PayrollStatus.NOTICE_PERIOD) {
            reasons.push(makeReason(
              "NOTICE_PERIOD",
              "On notice — not eligible for incentive payout this period.",
              { payrollStatus: emp.payrollStatus },
            ));
          }
          if (emp.payrollStatus === PayrollStatus.DISCIPLINARY_ACTION) {
            reasons.push(makeReason(
              "DISCIPLINARY_ACTION",
              "Under disciplinary action — incentive on hold for this period.",
              { payrollStatus: emp.payrollStatus },
            ));
          }
          if (emp.dateOfExit && emp.dateOfExit < periodEnd && emp.dateOfExit >= periodStart) {
            reasons.push(makeReason(
              "EXITED_MID_PERIOD",
              "Exited mid-period — not eligible for this month's payout.",
              { dateOfExit: emp.dateOfExit.toISOString().slice(0, 10) },
            ));
          }
          if (emp.dateOfJoining > periodStart && emp.dateOfJoining <= periodEnd) {
            reasons.push(makeReason(
              "NEW_JOINER_PRORATA",
              "Joined mid-period — payout pro-rated for this month.",
              { dateOfJoining: emp.dateOfJoining.toISOString().slice(0, 10) },
            ));
          }

          // Plan / achievement reasons only matter for ACTIVE employees who
          // could otherwise have earned. NP/DA we already explained above.
          if (isActive && rawBase === 0 && multiplierPct > 0 && achievementPct >= lowestMultiplierFrom) {
            // Department hit a multiplier tier but no slab matched any txn.
            // This is the AIOT-style "your department earned 0.8x but the plan
            // has no slabs for what you sell" case from the testing sheet.
            reasons.push(makeReason(
              "DEPT_NO_SLABS",
              empDept
                ? `${empDept} has no incentive slabs in this plan — no payout possible regardless of achievement.`
                : "Your department has no incentive slabs in this plan.",
              { department: empDept, achievementPct },
            ));
          } else if (isActive && multiplierPct === 0 && achievementPct < lowestMultiplierFrom) {
            // Below the lowest tier. Don't emit if there's literally no target
            // (deptInfo undefined) — that's a different bug class.
            if (deptInfo && deptInfo.target > 0) {
              reasons.push(makeReason(
                "DEPT_BELOW_THRESHOLD",
                `${empDept ?? "Department"} at ${Math.round(achievementPct * 10) / 10}% — needs ${lowestMultiplierFrom}% to start earning.`,
                { currentPct: achievementPct, requiredPct: lowestMultiplierFrom, department: empDept },
              ));
            }
          }

          // Final incentive: zero out for any non-ACTIVE payroll status. ACTIVE
          // earns base × multiplier as before.
          const base = isActive ? rawBase : 0;
          const finalIncentive = isActive ? base * (multiplierPct / 100) : 0;
          if (finalIncentive > 0) earningCount += 1;
          storeTotalIncentive += finalIncentive;

          // Potential = base × top multiplier tier, gives "at 100%+" target signal
          const topMultiplier = Math.max(
            0,
            ...plan.achievementMultipliers.map((m) => asNumber(m.multiplierPct)),
          );

          ledgerRows.push({
            planId: plan.id,
            employeeId,
            storeCode,
            vertical: Vertical.ELECTRONICS,
            periodStart,
            periodEnd,
            baseIncentive: base,
            multiplierApplied: multiplierPct,
            achievementPct,
            finalIncentive,
            calculationDetails: {
              employeeDepartment: empDept,
              departmentTarget: deptInfo?.target ?? 0,
              departmentActual: deptInfo?.actual ?? 0,
              departments: Object.fromEntries(deptAchievement),
              payrollStatus: emp.payrollStatus,
              reasons,
            },
          });

          employeeRollups.push({
            employeeId,
            planId: plan.id,
            storeCode,
            vertical: Vertical.ELECTRONICS,
            periodStart,
            periodEnd,
            earned: finalIncentive,
            eligible: base,
            potential: isActive ? base * (topMultiplier / 100) : 0,
            achievementPct,
            multiplierApplied: multiplierPct,
          });
        }

        const meta = storeMeta.get(storeCode);
        if (meta) {
          storeRollups.push({
            storeCode,
            planId: plan.id,
            vertical: Vertical.ELECTRONICS,
            city: meta.city,
            state: meta.state,
            periodStart,
            periodEnd,
            targetValue: storeTargetSum,
            actualSales: storeActualSum,
            achievementPct: Math.round(storeAchievementPct * 100) / 100,
            totalIncentive: storeTotalIncentive,
            employeeCount: storeEmployees.length,
            earningCount,
          });
        }
      }

      return {
        ledgerRows,
        employeeRollups,
        storeRollups,
        dailyRollups: dailyRollupsFrom(dailyRows),
      };
    },
  );
}

// ──────────── Grocery ────────────

async function computeGrocery(input: RecalculateInput): Promise<void> {
  const campaigns = await db.campaignConfig.findMany({
    where: {
      status: "ACTIVE",
      plan: { vertical: Vertical.GROCERY },
      startDate: { lte: input.periodEnd },
      endDate: { gte: input.periodStart },
      storeTargets: { some: { storeCode: { in: input.storeCodes } } },
    },
    include: { payoutSlabs: true, articles: true, storeTargets: true, plan: true },
  });

  const storeMeta = await storeMetaFor(input.storeCodes);

  for (const campaign of campaigns) {
    await runCalculation(
      {
        planId: campaign.planId,
        planVersion: campaign.plan.version,
        vertical: Vertical.GROCERY,
        periodStart: campaign.startDate,
        periodEnd: campaign.endDate,
        scopeStoreCodes: input.storeCodes,
        trigger: input.trigger ?? CalcRunTrigger.MANUAL_RECOMPUTE,
        triggeredByUserId: input.triggeredByUserId ?? null,
      },
      async () => {
        const ledgerRows: LedgerRowInput[] = [];
        const employeeRollups: CalculationOutput["employeeRollups"] = [];
        const storeRollups: CalculationOutput["storeRollups"] = [];

        const articleSet = new Set(campaign.articles.map((item) => item.articleCode));
        const sortedSlabs = [...campaign.payoutSlabs].sort(
          (a, b) => asNumber(b.achievementFrom) - asNumber(a.achievementFrom),
        );

        const relevantStoreCodes = campaign.storeTargets
          .filter((st) => input.storeCodes.includes(st.storeCode))
          .map((st) => st.storeCode);

        // Pull employees for *all* scope stores, not just in-campaign ones, so
        // we can emit STORE_NOT_IN_CAMPAIGN rows for the out-of-campaign stores.
        // Include NP/DA so the mobile app can render *why* they see ₹0.
        const [allCampaignSales, allScopeEmployees] = await Promise.all([
          db.salesTransaction.findMany({
            where: {
              storeCode: { in: relevantStoreCodes },
              vertical: Vertical.GROCERY,
              channel: "OFFLINE",
              transactionDate: { gte: campaign.startDate, lte: campaign.endDate },
            },
          }),
          db.employeeMaster.findMany({
            where: {
              storeCode: { in: input.storeCodes },
              payrollStatus: {
                in: [
                  PayrollStatus.ACTIVE,
                  PayrollStatus.NOTICE_PERIOD,
                  PayrollStatus.DISCIPLINARY_ACTION,
                ],
              },
              role: { in: [EmployeeRole.SM, EmployeeRole.DM, EmployeeRole.SA, EmployeeRole.BA] },
            },
          }),
        ]);
        const allCampaignEmployees = allScopeEmployees.filter((e) =>
          relevantStoreCodes.includes(e.storeCode),
        );
        const outOfCampaignEmployees = allScopeEmployees.filter(
          (e) => !relevantStoreCodes.includes(e.storeCode),
        );

        const salesByStore = new Map<string, typeof allCampaignSales>();
        for (const s of allCampaignSales) {
          const list = salesByStore.get(s.storeCode) ?? [];
          list.push(s);
          salesByStore.set(s.storeCode, list);
        }
        const empsByStore = new Map<string, typeof allCampaignEmployees>();
        for (const e of allCampaignEmployees) {
          const list = empsByStore.get(e.storeCode) ?? [];
          list.push(e);
          empsByStore.set(e.storeCode, list);
        }

        for (const storeTarget of campaign.storeTargets) {
          if (!input.storeCodes.includes(storeTarget.storeCode)) continue;
          const sales = salesByStore.get(storeTarget.storeCode) ?? [];
          const eligibleSales = sales.filter((sale) => articleSet.has(sale.articleCode));
          const totalSalesValue = eligibleSales.reduce((sum, sale) => sum + asNumber(sale.grossAmount), 0);
          const totalPieces = eligibleSales.reduce((sum, sale) => sum + sale.quantity, 0);
          const achievementPct = (totalSalesValue / asNumber(storeTarget.targetValue)) * 100;
          const matched = sortedSlabs.find((slab) => achievementPct >= asNumber(slab.achievementFrom));
          const rate = achievementPct >= 100 ? asNumber(matched?.perPieceRate ?? 0) : 0;
          const totalIncentive = rate * totalPieces;
          const topRate = asNumber(sortedSlabs[0]?.perPieceRate ?? 0);
          const potentialIncentive = topRate * totalPieces;

          const employees = empsByStore.get(storeTarget.storeCode) ?? [];
          if (!employees.length) continue;
          const individualPayout = totalIncentive / employees.length;
          const individualPotential = potentialIncentive / employees.length;

          const targetVal = asNumber(storeTarget.targetValue);

          for (const employee of employees) {
            const isActive = employee.payrollStatus === PayrollStatus.ACTIVE;
            const reasons: EligibilityReason[] = [];

            if (employee.payrollStatus === PayrollStatus.NOTICE_PERIOD) {
              reasons.push(makeReason(
                "NOTICE_PERIOD",
                "On notice — not eligible for incentive payout this campaign.",
                { payrollStatus: employee.payrollStatus },
              ));
            }
            if (employee.payrollStatus === PayrollStatus.DISCIPLINARY_ACTION) {
              reasons.push(makeReason(
                "DISCIPLINARY_ACTION",
                "Under disciplinary action — incentive on hold for this campaign.",
                { payrollStatus: employee.payrollStatus },
              ));
            }

            const finalForEmployee = isActive ? individualPayout : 0;

            ledgerRows.push({
              planId: campaign.planId,
              campaignId: campaign.id,
              employeeId: employee.employeeId,
              storeCode: employee.storeCode,
              vertical: Vertical.GROCERY,
              periodStart: campaign.startDate,
              periodEnd: campaign.endDate,
              baseIncentive: totalIncentive,
              achievementPct,
              finalIncentive: finalForEmployee,
              calculationDetails: {
                totalPieces,
                rate,
                employeeCount: employees.length,
                targetValue: targetVal,
                actualSales: totalSalesValue,
                payrollStatus: employee.payrollStatus,
                reasons,
              },
            });

            employeeRollups.push({
              employeeId: employee.employeeId,
              planId: campaign.planId,
              storeCode: employee.storeCode,
              vertical: Vertical.GROCERY,
              periodStart: campaign.startDate,
              periodEnd: campaign.endDate,
              earned: finalForEmployee,
              eligible: finalForEmployee,
              potential: isActive ? individualPotential : 0,
              achievementPct,
              multiplierApplied: null,
            });
          }

          const meta = storeMeta.get(storeTarget.storeCode);
          if (meta) {
            storeRollups.push({
              storeCode: storeTarget.storeCode,
              planId: campaign.planId,
              vertical: Vertical.GROCERY,
              city: meta.city,
              state: meta.state,
              periodStart: campaign.startDate,
              periodEnd: campaign.endDate,
              targetValue: targetVal,
              actualSales: totalSalesValue,
              achievementPct: Math.round(achievementPct * 100) / 100,
              totalIncentive,
              employeeCount: employees.length,
              earningCount: totalIncentive > 0 ? employees.length : 0,
            });
          }
        }

        // STORE_NOT_IN_CAMPAIGN: emit zero-payout rows for employees in
        // scope-stores that aren't in this campaign's storeTargets, so the
        // mobile app can render "Your store is not in [Campaign] this period"
        // instead of a blank screen.
        for (const employee of outOfCampaignEmployees) {
          const reasons: EligibilityReason[] = [
            makeReason(
              "STORE_NOT_IN_CAMPAIGN",
              `Your store is not in the "${campaign.campaignName}" campaign this period.`,
              { campaignId: campaign.id, campaignName: campaign.campaignName },
            ),
          ];
          if (employee.payrollStatus === PayrollStatus.NOTICE_PERIOD) {
            reasons.push(makeReason(
              "NOTICE_PERIOD",
              "On notice — not eligible for incentive payout this campaign.",
              { payrollStatus: employee.payrollStatus },
            ));
          }
          if (employee.payrollStatus === PayrollStatus.DISCIPLINARY_ACTION) {
            reasons.push(makeReason(
              "DISCIPLINARY_ACTION",
              "Under disciplinary action — incentive on hold for this campaign.",
              { payrollStatus: employee.payrollStatus },
            ));
          }

          ledgerRows.push({
            planId: campaign.planId,
            campaignId: campaign.id,
            employeeId: employee.employeeId,
            storeCode: employee.storeCode,
            vertical: Vertical.GROCERY,
            periodStart: campaign.startDate,
            periodEnd: campaign.endDate,
            baseIncentive: 0,
            achievementPct: 0,
            finalIncentive: 0,
            calculationDetails: {
              totalPieces: 0,
              rate: 0,
              employeeCount: 0,
              targetValue: 0,
              actualSales: 0,
              payrollStatus: employee.payrollStatus,
              reasons,
            },
          });

          employeeRollups.push({
            employeeId: employee.employeeId,
            planId: campaign.planId,
            storeCode: employee.storeCode,
            vertical: Vertical.GROCERY,
            periodStart: campaign.startDate,
            periodEnd: campaign.endDate,
            earned: 0,
            eligible: 0,
            potential: 0,
            achievementPct: 0,
            multiplierApplied: null,
          });
        }

        return {
          ledgerRows,
          employeeRollups,
          storeRollups,
          dailyRollups: dailyRollupsFrom(allCampaignSales),
        };
      },
    );
  }
}

// ──────────── Grocery — HR Sales (Phase 6.1) ────────────

/**
 * Grocery format-tier mapping. RIL's slab matrix has two distinct tables:
 *
 *   - LARGE_FORMAT: FreshPik only (high-AOV "Premium" stores).
 *   - STORES:       Smart family (Smart, Smart Bazaar, Smart Point, gofresh).
 *
 * `StoreMaster.storeFormat` is free-text; we normalise via this map. Any
 * unmapped format defaults to STORES (the more common case) — ops will see
 * the store earning at Stores rates and can flag if a new format appears.
 *
 * The map keys are normalised lowercase to absorb the casing variation we
 * already see in the .xlsb ("FreshPik", "Smart Bazaar", "gofresh", "SMART").
 */
const GROCERY_FORMAT_TIER: Record<string, FormatTier> = {
  "freshpik": FormatTier.LARGE_FORMAT,
  "smart": FormatTier.STORES,
  "smart bazaar": FormatTier.STORES,
  "smart point": FormatTier.STORES,
  "gofresh": FormatTier.STORES,
};
function formatTierFor(storeFormat: string | null | undefined): FormatTier {
  const key = (storeFormat ?? "").trim().toLowerCase();
  return GROCERY_FORMAT_TIER[key] ?? FormatTier.STORES;
}

/**
 * Map (EmployeeRole, FormatTier) to a slab role-bucket.
 *
 * Stores tier has 5 distinct buckets (SM / ASM / OTHER_MGRL / CSA / PT).
 * Large tier collapses to 3 (SM_ASM combined / OTHER_MGRL / ASSOCIATES
 * combined). DM is "Other Managerial" in both. OMNI routes through CSA on
 * the Stores tier (same rule as F&L pilot — RIL hasn't published OMNI/PT
 * differentiation for Grocery, route through associates by default).
 *
 * Returns null for roles that aren't in the policy at all (BA on Grocery
 * — currently we don't have a Grocery-BA path; engine emits
 * ROLE_NOT_ELIGIBLE_FOR_INCENTIVE upstream).
 */
function roleBucketFor(
  role: EmployeeRole,
  tier: FormatTier,
): GroceryRoleBucket | null {
  if (tier === FormatTier.LARGE_FORMAT) {
    if (role === EmployeeRole.SM || role === EmployeeRole.ASM) return GroceryRoleBucket.SM_ASM;
    if (role === EmployeeRole.DM) return GroceryRoleBucket.OTHER_MGRL;
    if (role === EmployeeRole.SA || role === EmployeeRole.OMNI || role === EmployeeRole.PT) {
      return GroceryRoleBucket.ASSOCIATES;
    }
    return null;
  }
  // STORES tier
  if (role === EmployeeRole.SM) return GroceryRoleBucket.SM;
  if (role === EmployeeRole.ASM) return GroceryRoleBucket.ASM;
  if (role === EmployeeRole.DM) return GroceryRoleBucket.OTHER_MGRL;
  if (role === EmployeeRole.SA || role === EmployeeRole.OMNI) return GroceryRoleBucket.CSA;
  if (role === EmployeeRole.PT) return GroceryRoleBucket.PT;
  return null;
}

/** Buckets that a "manager" rating-degraded gate blocks. */
const MANAGER_BUCKETS = new Set<GroceryRoleBucket>([
  GroceryRoleBucket.SM,
  GroceryRoleBucket.ASM,
  GroceryRoleBucket.OTHER_MGRL,
  GroceryRoleBucket.SM_ASM,
]);

/**
 * Walk the slab matrix and find the row whose [bandMinPct, bandMaxPct)
 * range contains the achievement %. Bands are stored as decimal fractions
 * (0.85 = 85%), achievement is a fraction too (1.10 = 110%). NULL
 * bandMaxPct = +infinity. Returns 0 if no band matches (which is the
 * correct semantic — the "below floor" bucket pays zero).
 */
function findSlabAmount(
  slabs: Array<{
    formatTier: FormatTier;
    roleBucket: GroceryRoleBucket;
    bandMinPct: unknown;
    bandMaxPct: unknown;
    amountRs: unknown;
  }>,
  tier: FormatTier,
  bucket: GroceryRoleBucket,
  achievementFrac: number,
): number {
  const matches = slabs.filter((s) => s.formatTier === tier && s.roleBucket === bucket);
  for (const s of matches) {
    const min = asNumber(s.bandMinPct);
    const max = s.bandMaxPct === null || s.bandMaxPct === undefined ? Infinity : asNumber(s.bandMaxPct);
    if (achievementFrac >= min && achievementFrac < max) {
      return asNumber(s.amountRs);
    }
  }
  return 0;
}

/**
 * Compute Grocery HR Sales payouts.
 *
 * Reads plans where `config.mode === "HR_SALES"`. For each in-scope store
 * × period (intersected with the plan's effective range):
 *
 *   1. Read StoreMonthlyMetric for the (store, periodStart). If absent,
 *      skip the store (no input → no payout, ops will chase the feed).
 *   2. For each employee in the store: derive (formatTier, roleBucket),
 *      look up slab amount in `GrocerySalesSlab`, apply gates:
 *
 *        - BELOW_MIN_ACHIEVEMENT (BLOCKING): slab amount is 0 because the
 *          store didn't clear the lowest payable band.
 *        - QUALITY_GATE_FAILED_FULL (BLOCKING): salesStatus =
 *          NONE_QUALIFIED. Nobody earns.
 *        - QUALITY_GATE_FAILED_PARTIAL (BLOCKING for managers only):
 *          salesStatus = ONLY_ASSOCIATES_QUALIFIED. Engine emits the reason
 *          only on manager rows; CSA/PT keep their slab.
 *        - ROLE_NOT_ELIGIBLE_FOR_INCENTIVE (BLOCKING): roleBucket is null
 *          (e.g., a BA somehow showing up in a Grocery store).
 *
 *   3. Apply attendance pro-rata: `final = slab × workingDays / attendance`.
 *      Pulled from EmployeeMonthlyInput. If absent, emit
 *      MONTHLY_INPUT_MISSING (WARNING) and apply a default (workingDays =
 *      attendance = days_in_period) so the row pays the slab in full —
 *      the assumption is "we got store-level metric but missed the
 *      employee-level feed; default to fully-attended rather than zero".
 */
async function computeGroceryHrSales(input: RecalculateInput): Promise<void> {
  const plans = await db.incentivePlan.findMany({
    where: {
      vertical: Vertical.GROCERY,
      status: "ACTIVE",
    },
    include: { grocerySalesSlabs: true },
  });
  // Filter to HR_SALES mode plans (config.mode discriminator). We do this
  // post-fetch rather than in the SQL where-clause because Prisma's JSON
  // path filtering needs the raw column name and we want to keep this in
  // TypeScript for clarity.
  const hrPlans = plans.filter((p) => {
    const cfg = (p.config ?? {}) as Record<string, unknown>;
    return cfg.mode === "HR_SALES";
  });
  if (!hrPlans.length) return;

  const storeMeta = await storeMetaFor(input.storeCodes);

  for (const plan of hrPlans) {
    // Plan-level effective window intersect with input span.
    const planFrom = plan.effectiveFrom ?? input.periodStart;
    const planTo = plan.effectiveTo ?? input.periodEnd;
    const periodStart = planFrom > input.periodStart ? planFrom : input.periodStart;
    const periodEnd = planTo < input.periodEnd ? planTo : input.periodEnd;
    if (periodEnd < periodStart) continue;

    // Read all store-month metrics in scope. Single query, scoped to
    // input stores + this plan's window.
    const metrics = await db.storeMonthlyMetric.findMany({
      where: {
        vertical: Vertical.GROCERY,
        storeCode: { in: input.storeCodes },
        periodStart: { gte: periodStart, lte: periodEnd },
      },
    });
    if (!metrics.length) continue;

    // Group metrics by month so each runCalculation covers one (plan,
    // periodStart) pair — keeps CalculationRun rows clean.
    const metricsByPeriod = new Map<string, typeof metrics>();
    for (const m of metrics) {
      const key = `${m.periodStart.toISOString().slice(0, 10)}|${m.periodEnd.toISOString().slice(0, 10)}`;
      const list = metricsByPeriod.get(key) ?? [];
      list.push(m);
      metricsByPeriod.set(key, list);
    }

    for (const [, monthMetrics] of metricsByPeriod) {
      const monthStart = monthMetrics[0].periodStart;
      const monthEnd = monthMetrics[0].periodEnd;
      const monthStores = monthMetrics.map((m) => m.storeCode);
      const daysInPeriod =
        Math.round((monthEnd.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

      await runCalculation(
        {
          planId: plan.id,
          planVersion: plan.version,
          vertical: Vertical.GROCERY,
          periodStart: monthStart,
          periodEnd: monthEnd,
          scopeStoreCodes: monthStores,
          trigger: input.trigger ?? CalcRunTrigger.MANUAL_RECOMPUTE,
          triggeredByUserId: input.triggeredByUserId ?? null,
        },
        async () => {
          const ledgerRows: LedgerRowInput[] = [];
          const employeeRollups: CalculationOutput["employeeRollups"] = [];
          const storeRollups: CalculationOutput["storeRollups"] = [];

          // Pull all the day-level txns for the daily rollup so the dashboard
          // still has the trend even on stores with no payout.
          const allMonthTxns = await db.salesTransaction.findMany({
            where: {
              storeCode: { in: monthStores },
              vertical: Vertical.GROCERY,
              transactionDate: { gte: monthStart, lte: monthEnd },
            },
            select: { storeCode: true, vertical: true, transactionDate: true, grossAmount: true, taxAmount: true, quantity: true },
          });

          // Pull all employees and monthly inputs in one shot.
          const allEmployees = await db.employeeMaster.findMany({
            where: {
              storeCode: { in: monthStores },
              payrollStatus: {
                in: [PayrollStatus.ACTIVE, PayrollStatus.NOTICE_PERIOD, PayrollStatus.DISCIPLINARY_ACTION],
              },
            },
          });
          const allMonthlyInputs = await db.employeeMonthlyInput.findMany({
            where: {
              employeeId: { in: allEmployees.map((e) => e.employeeId) },
              periodStart: monthStart,
            },
          });
          const inputByEmp = new Map(allMonthlyInputs.map((i) => [i.employeeId, i]));
          const empsByStore = new Map<string, typeof allEmployees>();
          for (const e of allEmployees) {
            const list = empsByStore.get(e.storeCode) ?? [];
            list.push(e);
            empsByStore.set(e.storeCode, list);
          }

          for (const metric of monthMetrics) {
            const meta = storeMeta.get(metric.storeCode);
            if (!meta) continue;

            const tier = formatTierFor(meta.storeFormat);
            const ach = metric.salesAchievementPct ? asNumber(metric.salesAchievementPct) : 0;
            const status = metric.salesStatus;
            // achievement is stored as decimal fraction (1.10 = 110%); the slab
            // bands are also fractions, so they compare directly.
            const achFrac = ach;

            const employees = empsByStore.get(metric.storeCode) ?? [];
            let storeEarning = 0;
            let storeEarners = 0;

            for (const employee of employees) {
              const isActive = employee.payrollStatus === PayrollStatus.ACTIVE;
              const reasons: EligibilityReason[] = [];

              if (employee.payrollStatus === PayrollStatus.NOTICE_PERIOD) {
                reasons.push(makeReason(
                  "NOTICE_PERIOD",
                  "On notice — not eligible for incentive payout this month.",
                  { payrollStatus: employee.payrollStatus },
                ));
              }
              if (employee.payrollStatus === PayrollStatus.DISCIPLINARY_ACTION) {
                reasons.push(makeReason(
                  "DISCIPLINARY_ACTION",
                  "Under disciplinary action — incentive on hold for this month.",
                  { payrollStatus: employee.payrollStatus },
                ));
              }

              const bucket = roleBucketFor(employee.role, tier);
              if (!bucket) {
                reasons.push(makeReason(
                  "ROLE_NOT_ELIGIBLE_FOR_INCENTIVE",
                  `Role ${employee.role} not in the Grocery HR Sales policy for ${tier} stores.`,
                  { role: employee.role, formatTier: tier },
                ));
              }

              const slabAmount = bucket
                ? findSlabAmount(plan.grocerySalesSlabs, tier, bucket, achFrac)
                : 0;

              // Gate 1 — Below min achievement. The slab table itself
              // encodes a 0-amount row for the floor band, but we surface
              // the reason explicitly so the mobile app can render "hit
              // 95% to unlock" rather than a silent ₹0.
              if (bucket && slabAmount === 0 && achFrac > 0) {
                const floor = tier === FormatTier.LARGE_FORMAT ? 0.85 : 0.95;
                reasons.push(makeReason(
                  "BELOW_MIN_ACHIEVEMENT",
                  `Store at ${(achFrac * 100).toFixed(1)}% — minimum ${(floor * 100).toFixed(0)}% needed for any payout.`,
                  { achievementPct: achFrac, floorPct: floor, formatTier: tier },
                ));
              }

              // Gate 2 — Quality gate. FULL blocks everyone; PARTIAL only
              // blocks managers.
              const isManager = bucket ? MANAGER_BUCKETS.has(bucket) : false;
              if (status === StoreSalesStatus.NONE_QUALIFIED) {
                reasons.push(makeReason(
                  "QUALITY_GATE_FAILED_FULL",
                  "Store quality gate failed — no incentive this month.",
                  {
                    salesStatus: status,
                    mysteryShopper: metric.mysteryShopperRating,
                    popCompliance: metric.popComplianceRating,
                  },
                ));
              } else if (status === StoreSalesStatus.ONLY_ASSOCIATES_QUALIFIED && isManager) {
                reasons.push(makeReason(
                  "QUALITY_GATE_FAILED_PARTIAL",
                  "Store quality ratings degraded — manager incentive blocked. Associates still earn.",
                  {
                    salesStatus: status,
                    mysteryShopper: metric.mysteryShopperRating,
                    popCompliance: metric.popComplianceRating,
                  },
                ));
              }

              // Attendance pro-rata. EmployeeMonthlyInput is canonical;
              // missing row → default to fully attended + WARNING.
              const monthlyInput = inputByEmp.get(employee.employeeId) ?? null;
              const attendance = monthlyInput?.attendance ?? daysInPeriod;
              const workingDays = monthlyInput?.workingDays ?? daysInPeriod;
              if (!monthlyInput && bucket) {
                reasons.push(makeReason(
                  "MONTHLY_INPUT_MISSING",
                  "No monthly attendance row found — defaulted to fully attended. Ops should verify.",
                  { defaultedAttendance: attendance, defaultedWorkingDays: workingDays },
                ));
              }

              // Compute final amount. ALL blocking reasons collapse to 0;
              // active + role + slab > 0 + no quality block → pro-rata
              // payout. We re-collect the blocking decision here rather
              // than peeking at reasons[].severity so the math is local
              // and easy to follow.
              const qualityBlocks =
                status === StoreSalesStatus.NONE_QUALIFIED ||
                (status === StoreSalesStatus.ONLY_ASSOCIATES_QUALIFIED && isManager);
              let finalAmount = 0;
              if (
                isActive &&
                bucket &&
                slabAmount > 0 &&
                !qualityBlocks
              ) {
                finalAmount = attendance > 0
                  ? Math.round((slabAmount * workingDays / attendance) * 100) / 100
                  : 0;
              }

              if (finalAmount > 0) {
                storeEarning += finalAmount;
                storeEarners += 1;
              }

              ledgerRows.push({
                planId: plan.id,
                employeeId: employee.employeeId,
                storeCode: metric.storeCode,
                vertical: Vertical.GROCERY,
                periodStart: monthStart,
                periodEnd: monthEnd,
                baseIncentive: slabAmount,
                finalIncentive: finalAmount,
                achievementPct: achFrac * 100,
                calculationDetails: {
                  mode: "HR_SALES",
                  formatTier: tier,
                  roleBucket: bucket ?? null,
                  slabAmount,
                  attendance,
                  awlDays: monthlyInput?.awlDays ?? 0,
                  workingDays,
                  salesAchievementPct: achFrac,
                  salesBucket: metric.salesBucket ?? null,
                  salesBudgetRsLacs: metric.salesBudgetRsLacs ? asNumber(metric.salesBudgetRsLacs) : null,
                  salesActualRsLacs: metric.salesActualRsLacs ? asNumber(metric.salesActualRsLacs) : null,
                  mysteryShopperRating: metric.mysteryShopperRating,
                  popComplianceRating: metric.popComplianceRating,
                  salesStatus: status,
                  // Reconciliation hooks — RIL's pre-computed values from
                  // the working file, surfaced for the diff script.
                  rilIncentiveSlab: monthlyInput?.rilIncentiveSlab
                    ? asNumber(monthlyInput.rilIncentiveSlab)
                    : null,
                  rilFinalPay: monthlyInput?.rilFinalPay
                    ? asNumber(monthlyInput.rilFinalPay)
                    : null,
                  payrollStatus: employee.payrollStatus,
                  reasons,
                },
              });

              employeeRollups.push({
                employeeId: employee.employeeId,
                planId: plan.id,
                storeCode: metric.storeCode,
                vertical: Vertical.GROCERY,
                periodStart: monthStart,
                periodEnd: monthEnd,
                earned: finalAmount,
                eligible: finalAmount,
                potential: bucket
                  ? findSlabAmount(plan.grocerySalesSlabs, tier, bucket, 999)
                  : 0,
                achievementPct: achFrac * 100,
                multiplierApplied: null,
              });
            }

            storeRollups.push({
              storeCode: metric.storeCode,
              planId: plan.id,
              vertical: Vertical.GROCERY,
              city: meta.city,
              state: meta.state,
              periodStart: monthStart,
              periodEnd: monthEnd,
              targetValue: metric.salesBudgetRsLacs
                ? asNumber(metric.salesBudgetRsLacs) * 100000
                : 0,
              actualSales: metric.salesActualRsLacs
                ? asNumber(metric.salesActualRsLacs) * 100000
                : 0,
              achievementPct: Math.round(achFrac * 100 * 100) / 100,
              totalIncentive: storeEarning,
              employeeCount: employees.length,
              earningCount: storeEarners,
            });
          }

          return {
            ledgerRows,
            employeeRollups,
            storeRollups,
            dailyRollups: dailyRollupsFrom(allMonthTxns),
          };
        },
      );
    }
  }
}

// ──────────── Grocery — Category PIP (Phase 6.1) ────────────

/**
 * Compute Grocery Category PIP (Per-Piece Incentive) payouts.
 *
 * Reads plans where `config.mode === "CATEGORY_PIP"`. For each such plan,
 * matches `SalesTransaction.articleCode` to `CategoryPipArticle` rows,
 * computes per-store-period totals, and distributes per the plan's
 * `pipAttribution` config:
 *
 *   - "EQUAL_CSA"            (DEFAULT): split across all CSA-pool roles
 *                            (SA + OMNI + PT) in the store.
 *   - "EQUAL_ALL_EMPLOYEES":  split across all active employees.
 *   - "STORE_LEVEL_DM_DRIVEN": entire pool to DM (department lead earns
 *                            the campaign — manager-driven attribution).
 *
 * The default is EQUAL_CSA because the Mar'26 Ice Cream PIP file doesn't
 * specify attribution and Rupali (RIL Grocery) confirmed associates are
 * the primary earners on similar PIP campaigns. Flip via plan.config.
 *
 * Per-article gating: payout = `qty × rateRs` if `qty >= targetQty ×
 * minCriteriaPct`, else 0. The threshold is per-article (a store can
 * qualify on some SKUs, fail on others) and aggregated to a store total.
 */
async function computeGroceryCategoryPip(input: RecalculateInput): Promise<void> {
  const plans = await db.incentivePlan.findMany({
    where: {
      vertical: Vertical.GROCERY,
      status: "ACTIVE",
    },
    include: { categoryPipArticles: true },
  });
  const pipPlans = plans.filter((p) => {
    const cfg = (p.config ?? {}) as Record<string, unknown>;
    return cfg.mode === "CATEGORY_PIP";
  });
  if (!pipPlans.length) return;

  const storeMeta = await storeMetaFor(input.storeCodes);

  for (const plan of pipPlans) {
    if (!plan.categoryPipArticles.length) continue;

    const planFrom = plan.effectiveFrom ?? input.periodStart;
    const planTo = plan.effectiveTo ?? input.periodEnd;
    const periodStart = planFrom > input.periodStart ? planFrom : input.periodStart;
    const periodEnd = planTo < input.periodEnd ? planTo : input.periodEnd;
    if (periodEnd < periodStart) continue;

    const cfg = (plan.config ?? {}) as Record<string, unknown>;
    const attribution = (cfg.pipAttribution as string) ?? "EQUAL_CSA";

    const articleSet = new Set(plan.categoryPipArticles.map((a) => a.articleCode));
    const articleByCode = new Map(plan.categoryPipArticles.map((a) => [a.articleCode, a]));

    await runCalculation(
      {
        planId: plan.id,
        planVersion: plan.version,
        vertical: Vertical.GROCERY,
        periodStart,
        periodEnd,
        scopeStoreCodes: input.storeCodes,
        trigger: input.trigger ?? CalcRunTrigger.MANUAL_RECOMPUTE,
        triggeredByUserId: input.triggeredByUserId ?? null,
      },
      async () => {
        const ledgerRows: LedgerRowInput[] = [];
        const employeeRollups: CalculationOutput["employeeRollups"] = [];
        const storeRollups: CalculationOutput["storeRollups"] = [];

        // Single batched txn read for all in-scope stores. Cap at the
        // plan-effective window; the .xlsb plan has Both online/offline
        // so we don't filter on channel.
        const allTxns = await db.salesTransaction.findMany({
          where: {
            storeCode: { in: input.storeCodes },
            vertical: Vertical.GROCERY,
            transactionDate: { gte: periodStart, lte: periodEnd },
            articleCode: { in: [...articleSet] },
          },
          select: { storeCode: true, vertical: true, transactionDate: true, grossAmount: true, taxAmount: true, quantity: true, articleCode: true },
        });
        const txnsByStore = new Map<string, typeof allTxns>();
        for (const t of allTxns) {
          const list = txnsByStore.get(t.storeCode) ?? [];
          list.push(t);
          txnsByStore.set(t.storeCode, list);
        }

        const allEmployees = await db.employeeMaster.findMany({
          where: {
            storeCode: { in: input.storeCodes },
            payrollStatus: {
              in: [PayrollStatus.ACTIVE, PayrollStatus.NOTICE_PERIOD, PayrollStatus.DISCIPLINARY_ACTION],
            },
          },
        });
        const empsByStore = new Map<string, typeof allEmployees>();
        for (const e of allEmployees) {
          const list = empsByStore.get(e.storeCode) ?? [];
          list.push(e);
          empsByStore.set(e.storeCode, list);
        }

        for (const storeCode of input.storeCodes) {
          const meta = storeMeta.get(storeCode);
          if (!meta) continue;
          const txns = txnsByStore.get(storeCode) ?? [];
          const employees = empsByStore.get(storeCode) ?? [];

          // Per-article aggregates.
          const qtyByArticle = new Map<string, number>();
          for (const t of txns) {
            qtyByArticle.set(t.articleCode, (qtyByArticle.get(t.articleCode) ?? 0) + t.quantity);
          }

          // For each article in the plan: gate + payout.
          let storePool = 0;
          let storePotential = 0;
          const perArticleBreakdown: Array<{
            articleCode: string;
            qty: number;
            targetQty: number;
            minQty: number;
            rateRs: number;
            qualifies: boolean;
            payout: number;
          }> = [];
          for (const article of plan.categoryPipArticles) {
            const qty = qtyByArticle.get(article.articleCode) ?? 0;
            const targetQty = article.targetQty;
            const minQty = Math.ceil(targetQty * asNumber(article.minCriteriaPct));
            const rateRs = asNumber(article.rateRs);
            const qualifies = qty >= minQty;
            const payout = qualifies ? qty * rateRs : 0;
            storePool += payout;
            storePotential += targetQty * rateRs; // upper bound for "potential"
            perArticleBreakdown.push({
              articleCode: article.articleCode,
              qty,
              targetQty,
              minQty,
              rateRs,
              qualifies,
              payout,
            });
          }

          // Determine attribution group for this store.
          let earners: typeof employees;
          if (attribution === "STORE_LEVEL_DM_DRIVEN") {
            earners = employees.filter(
              (e) => e.payrollStatus === PayrollStatus.ACTIVE && e.role === EmployeeRole.DM,
            );
          } else if (attribution === "EQUAL_ALL_EMPLOYEES") {
            earners = employees.filter((e) => e.payrollStatus === PayrollStatus.ACTIVE);
          } else {
            // Default: EQUAL_CSA — split across CSA-pool roles.
            earners = employees.filter(
              (e) =>
                e.payrollStatus === PayrollStatus.ACTIVE &&
                (e.role === EmployeeRole.SA || e.role === EmployeeRole.OMNI || e.role === EmployeeRole.PT),
            );
          }

          const perEarner = earners.length > 0 ? storePool / earners.length : 0;
          const perEarnerPotential = earners.length > 0 ? storePotential / earners.length : 0;

          // Emit a row per active employee (and NP/DA — needs a "why ₹0"
          // surface). Earners get the share; non-earners get 0 + reason.
          let storeEarning = 0;
          let storeEarners = 0;
          for (const employee of employees) {
            const isActive = employee.payrollStatus === PayrollStatus.ACTIVE;
            const isAttributed = earners.some((er) => er.employeeId === employee.employeeId);
            const reasons: EligibilityReason[] = [];

            if (employee.payrollStatus === PayrollStatus.NOTICE_PERIOD) {
              reasons.push(makeReason(
                "NOTICE_PERIOD",
                "On notice — not eligible for the campaign payout.",
                { payrollStatus: employee.payrollStatus },
              ));
            }
            if (employee.payrollStatus === PayrollStatus.DISCIPLINARY_ACTION) {
              reasons.push(makeReason(
                "DISCIPLINARY_ACTION",
                "Under disciplinary action — campaign payout on hold.",
                { payrollStatus: employee.payrollStatus },
              ));
            }

            // Role-eligibility for this attribution rule.
            if (isActive && !isAttributed) {
              reasons.push(makeReason(
                "ROLE_NOT_ELIGIBLE_FOR_INCENTIVE",
                `Role ${employee.role} not eligible under this campaign's "${attribution}" attribution rule.`,
                { role: employee.role, attribution },
              ));
            }

            // Below-min-criteria reason (campaign-level summary). We emit
            // it on every employee row so the mobile app shows the
            // headline reason; the per-article breakdown lives in
            // calculationDetails for drilldown.
            if (storePool === 0 && txns.length > 0) {
              reasons.push(makeReason(
                "BELOW_MIN_CRITERIA",
                "Store didn't hit the minimum quantity for any campaign article — no payout this period.",
                { perArticle: perArticleBreakdown },
              ));
            } else if (txns.length === 0) {
              reasons.push(makeReason(
                "ARTICLES_NOT_SOLD",
                `No qualifying article transactions in scope for this campaign.`,
                { campaignArticles: plan.categoryPipArticles.length },
              ));
            }

            const finalAmount = isActive && isAttributed ? Math.round(perEarner * 100) / 100 : 0;
            if (finalAmount > 0) {
              storeEarning += finalAmount;
              storeEarners += 1;
            }

            ledgerRows.push({
              planId: plan.id,
              employeeId: employee.employeeId,
              storeCode,
              vertical: Vertical.GROCERY,
              periodStart,
              periodEnd,
              baseIncentive: storePool,
              finalIncentive: finalAmount,
              achievementPct: null,
              calculationDetails: {
                mode: "CATEGORY_PIP",
                attribution,
                fundingSource: plan.fundingSource,
                storePool,
                earnerCount: earners.length,
                perArticle: perArticleBreakdown,
                payrollStatus: employee.payrollStatus,
                reasons,
              },
            });

            employeeRollups.push({
              employeeId: employee.employeeId,
              planId: plan.id,
              storeCode,
              vertical: Vertical.GROCERY,
              periodStart,
              periodEnd,
              earned: finalAmount,
              eligible: finalAmount,
              potential: isActive && isAttributed ? perEarnerPotential : 0,
              achievementPct: null,
              multiplierApplied: null,
            });
          }

          storeRollups.push({
            storeCode,
            planId: plan.id,
            vertical: Vertical.GROCERY,
            city: meta.city,
            state: meta.state,
            periodStart,
            periodEnd,
            targetValue: storePotential,
            actualSales: txns.reduce((s, t) => s + asNumber(t.grossAmount), 0),
            achievementPct: storePotential > 0 ? Math.round((storePool / storePotential) * 10000) / 100 : 0,
            totalIncentive: storeEarning,
            employeeCount: employees.length,
            earningCount: storeEarners,
          });
        }

        return {
          ledgerRows,
          employeeRollups,
          storeRollups,
          dailyRollups: dailyRollupsFrom(allTxns),
        };
      },
    );
  }
}

// ──────────── F&L ────────────

/**
 * F&L pilot — CSA pool roles. SA is the legacy tag; OMNI and PT showed up in
 * the W1 working file (Reliance Trends Incentive Policy v1, eff. 1 Mar 2026)
 * and per the Tuesday call default, both are routed through the CSA pool for
 * the pilot. If the call goes the other way we'll narrow this back to [SA].
 */
const FNL_CSA_POOL_ROLES: EmployeeRole[] = [
  EmployeeRole.SA,
  EmployeeRole.OMNI,
  EmployeeRole.PT,
];
const isCsaPoolRole = (role: EmployeeRole) => FNL_CSA_POOL_ROLES.includes(role);

async function computeFnL(input: RecalculateInput): Promise<void> {
  const plan = await db.incentivePlan.findFirst({
    where: { vertical: Vertical.FNL, status: "ACTIVE" },
    include: { fnlRoleSplits: true },
  });
  if (!plan) return;

  // Phase 5.1 — pilot gate flags. Default to "enforce" (policy text); ops
  // can flip to "advisory" via env if Reliance asks us to soft-launch a gate.
  // Advisory mode still emits the reason in calculationDetails (so the trail
  // is visible) but doesn't block payout — the engine treats the metric as
  // passing for the math.
  const piHoldMode = (process.env.FNL_PI_HOLD_MODE ?? "enforce").toLowerCase();
  const gmGateMode = (process.env.FNL_GM_GATE_MODE ?? "enforce").toLowerCase();
  const piHoldEnforced = piHoldMode === "enforce";
  const gmGateEnforced = gmGateMode === "enforce";

  const fnlTargets = await db.target.findMany({
    where: {
      vertical: Vertical.FNL,
      status: "ACTIVE",
      storeCode: { in: input.storeCodes },
      periodType: "WEEKLY",
      periodStart: { gte: input.periodStart, lte: input.periodEnd },
    },
  });

  const storeMeta = await storeMetaFor(input.storeCodes);

  // Group targets by week so one run covers one week × all scope stores.
  type WeekKey = string;
  const targetsByWeek = new Map<WeekKey, typeof fnlTargets>();
  for (const t of fnlTargets) {
    const key = `${t.periodStart.toISOString().slice(0, 10)}|${t.periodEnd.toISOString().slice(0, 10)}`;
    const list = targetsByWeek.get(key) ?? [];
    list.push(t);
    targetsByWeek.set(key, list);
  }

  for (const [, weekTargets] of targetsByWeek) {
    const weekStart = weekTargets[0].periodStart;
    const weekEnd = weekTargets[0].periodEnd;

    // Phase 5.1 — single batched read of (PI, GM) per (store, week). The
    // ingest endpoint is the source of truth for piHoldFlag/gmAchieved; the
    // engine only consumes them. Missing row = no data yet → treat as
    // passing (engine fails open; the admin console surfaces stores with no
    // metric so ops can chase the feed).
    const weekStoreCodes = weekTargets.map((t) => t.storeCode);
    const weeklyMetrics = await db.storeWeeklyMetric.findMany({
      where: {
        vertical: Vertical.FNL,
        storeCode: { in: weekStoreCodes },
        periodStart: weekStart,
      },
    });
    const metricByStore = new Map(weeklyMetrics.map((m) => [m.storeCode, m]));

    await runCalculation(
      {
        planId: plan.id,
        planVersion: plan.version,
        vertical: Vertical.FNL,
        periodStart: weekStart,
        periodEnd: weekEnd,
        scopeStoreCodes: weekTargets.map((t) => t.storeCode),
        trigger: input.trigger ?? CalcRunTrigger.MANUAL_RECOMPUTE,
        triggeredByUserId: input.triggeredByUserId ?? null,
      },
      async () => {
        const ledgerRows: LedgerRowInput[] = [];
        const employeeRollups: CalculationOutput["employeeRollups"] = [];
        const storeRollups: CalculationOutput["storeRollups"] = [];
        const allWeekTxns: Array<{ storeCode: string; vertical: Vertical; transactionDate: Date; grossAmount: unknown; taxAmount: unknown; quantity: number }> = [];

        for (const target of weekTargets) {
          const salesAggregate = await db.salesTransaction.aggregate({
            _sum: { grossAmount: true },
            where: {
              storeCode: target.storeCode,
              vertical: Vertical.FNL,
              transactionDate: { gte: target.periodStart, lte: target.periodEnd },
            },
          });
          const actualSales = asNumber(salesAggregate._sum.grossAmount);
          const targetValue = asNumber(target.targetValue);
          const achievementPct = targetValue > 0 ? (actualSales / targetValue) * 100 : 0;

          // Always pull the weekly txns for the daily rollup, even if the store
          // didn't exceed target — the dashboard still needs to see daily sales.
          const weekTxns = await db.salesTransaction.findMany({
            where: {
              storeCode: target.storeCode,
              vertical: Vertical.FNL,
              transactionDate: { gte: target.periodStart, lte: target.periodEnd },
            },
            select: { storeCode: true, vertical: true, transactionDate: true, grossAmount: true, taxAmount: true, quantity: true },
          });
          allWeekTxns.push(...weekTxns);

          const allEmployees = await db.employeeMaster.findMany({
            where: { storeCode: target.storeCode },
          });
          const activeEmployees = allEmployees.filter((e) => {
            if (
              e.payrollStatus !== PayrollStatus.ACTIVE &&
              e.payrollStatus !== PayrollStatus.NOTICE_PERIOD &&
              e.payrollStatus !== PayrollStatus.DISCIPLINARY_ACTION
            ) return false;
            if (e.dateOfJoining > target.periodEnd) return false;
            if (e.dateOfExit && e.dateOfExit < target.periodStart) return false;
            return true;
          });
          const smCount = activeEmployees
            .filter((e) => e.payrollStatus === PayrollStatus.ACTIVE)
            .filter((employee) => employee.role === EmployeeRole.SM).length;
          const dmCount = activeEmployees
            .filter((e) => e.payrollStatus === PayrollStatus.ACTIVE)
            .filter((employee) => employee.role === EmployeeRole.DM).length;

          // Annexure split lookup. The FnlRoleSplit table is keyed by exact
          // (numSms, numDms). Single-MOD stores (1 SM, 0 DM) showed up in
          // W1 data but aren't in the annexure matrix — the policy doc
          // calls them out as a 70/30 (CSA/MOD) split with no DM share. We
          // override here so single-MOD stores still pay out correctly
          // without polluting the annexure seed.
          const annexureSplit = plan.fnlRoleSplits.find(
            (row) => row.numSms === smCount && row.numDms === dmCount,
          ) ?? null;
          const isSingleMOD = !annexureSplit && smCount === 1 && dmCount === 0;
          const splitResolved = !!annexureSplit || isSingleMOD;
          const saPoolPct = annexureSplit
            ? asNumber(annexureSplit.saPoolPct)
            : isSingleMOD ? 70 : 0;
          const smSharePct = annexureSplit
            ? asNumber(annexureSplit.smSharePct)
            : isSingleMOD ? 30 : 0;
          const dmSharePerDmPct = annexureSplit
            ? asNumber(annexureSplit.dmSharePerDmPct)
            : 0;

          // Phase 5.1 — store-week external metrics (PI, GM). Missing row
          // means the metric ingest hasn't landed yet for this store-week;
          // we fail open (treat as passing) and the admin console flags
          // missing-metric stores so ops can chase the feed.
          const metric = metricByStore.get(target.storeCode) ?? null;
          const piHoldRaw = !!metric?.piHoldFlag;
          const gmAchievedRaw = metric ? metric.gmAchieved : true;
          const piHoldBlocks = piHoldRaw && piHoldEnforced;
          const gmGateBlocksManagers = !gmAchievedRaw && gmGateEnforced;

          const meta = storeMeta.get(target.storeCode);
          // Store qualifies for payout iff sales beat target, a split is
          // resolved, AND PI HOLD doesn't apply. GM is role-conditional
          // (handled per-employee below) — it doesn't void the whole store.
          const hasExceeded =
            actualSales > targetValue && splitResolved && !piHoldBlocks;

          // Phase 5.1 — pull attendance for the entire CSA pool (SA + OMNI
          // + PT) instead of just SA. We need full per-day status (not just
          // PRESENT counts) because the new policy disqualifies on ANY
          // leave during the week — approved or not — not just "fewer than
          // 5 PRESENT days". Managers (SM/DM) are not attendance-gated by
          // the policy; we leave their leave-handling to the dateOfExit /
          // payrollStatus checks above.
          const csaPoolIds = activeEmployees
            .filter((e) => isCsaPoolRole(e.role))
            .map((e) => e.employeeId);
          const allAttendance = csaPoolIds.length
            ? await db.attendance.findMany({
                where: {
                  employeeId: { in: csaPoolIds },
                  date: { gte: target.periodStart, lte: target.periodEnd },
                },
              })
            : [];
          const presentDaysByEmp = new Map<string, number>();
          const hasLeaveByEmp = new Map<string, AttendanceStatus>();
          for (const a of allAttendance) {
            if (a.status === AttendanceStatus.PRESENT) {
              presentDaysByEmp.set(a.employeeId, (presentDaysByEmp.get(a.employeeId) ?? 0) + 1);
            } else if (!hasLeaveByEmp.has(a.employeeId)) {
              // Capture the *first* non-PRESENT status we see — used for
              // the LEAVE_IN_WEEK reason payload. Order doesn't matter
              // semantically (any leave disqualifies); this just gives ops
              // a representative example to surface.
              hasLeaveByEmp.set(a.employeeId, a.status);
            }
          }

          const planConfig = (plan.config ?? {}) as Record<string, unknown>;
          const poolPct = asNumber(planConfig.poolPct ?? 1) / 100;
          const minAttendanceDays = Number(planConfig.minWorkingDays ?? 5);
          const storeIncentive = hasExceeded ? actualSales * poolPct : 0;

          // CSA-pool eligibility: ACTIVE + meets attendance minimum + no
          // leave during the week. The leave check is the new gate from
          // Phase 5.1; the days-PRESENT check is preserved so a mostly-
          // absent employee with no recorded leave (data gap) still gets
          // INSUFFICIENT_ATTENDANCE rather than slipping through.
          const eligibleSAIds = new Set<string>();
          if (hasExceeded) {
            for (const e of activeEmployees) {
              if (!isCsaPoolRole(e.role)) continue;
              if (e.payrollStatus !== PayrollStatus.ACTIVE) continue;
              if (hasLeaveByEmp.has(e.employeeId)) continue;
              const days = presentDaysByEmp.get(e.employeeId) ?? 0;
              if (days >= minAttendanceDays) eligibleSAIds.add(e.employeeId);
            }
          }
          const eligibleSACount = eligibleSAIds.size;

          const saPool = hasExceeded ? storeIncentive * (saPoolPct / 100) : 0;
          const eachSaPayout = hasExceeded && eligibleSACount > 0 ? saPool / eligibleSACount : 0;
          const smPayout = hasExceeded && !gmGateBlocksManagers
            ? storeIncentive * (smSharePct / 100)
            : 0;
          const dmPayout = hasExceeded && !gmGateBlocksManagers
            ? storeIncentive * (dmSharePerDmPct / 100)
            : 0;

          let storeEarningCount = 0;
          let storeTotalIncentive = 0;

          // Emit a ledger row for *every* employee in activeEmployees — earners
          // and non-earners alike — so the mobile app can render the correct
          // reason instead of falling into the "no incentive data" branch.
          for (const employee of activeEmployees) {
            const isActive = employee.payrollStatus === PayrollStatus.ACTIVE;
            const reasons: EligibilityReason[] = [];

            // Payroll-driven reasons (BLOCKING)
            if (employee.payrollStatus === PayrollStatus.NOTICE_PERIOD) {
              reasons.push(makeReason(
                "NOTICE_PERIOD",
                "On notice — not eligible for incentive payout this week.",
                { payrollStatus: employee.payrollStatus },
              ));
            }
            if (employee.payrollStatus === PayrollStatus.DISCIPLINARY_ACTION) {
              reasons.push(makeReason(
                "DISCIPLINARY_ACTION",
                "Under disciplinary action — incentive on hold for this week.",
                { payrollStatus: employee.payrollStatus },
              ));
            }
            if (employee.dateOfExit && employee.dateOfExit < target.periodEnd && employee.dateOfExit >= target.periodStart) {
              reasons.push(makeReason(
                "EXITED_MID_PERIOD",
                "Exited mid-week — not eligible for this week's payout.",
                { dateOfExit: employee.dateOfExit.toISOString().slice(0, 10) },
              ));
            }
            // Mid-period joiner (warning, still earns pro-rata if attendance ok)
            if (employee.dateOfJoining > target.periodStart && employee.dateOfJoining <= target.periodEnd) {
              reasons.push(makeReason(
                "NEW_JOINER_PRORATA",
                "Joined mid-week — payout pro-rated.",
                { dateOfJoining: employee.dateOfJoining.toISOString().slice(0, 10) },
              ));
            }

            // Phase 5.1 — Role-not-eligible reason. The policy names CSA
            // (incl. OMNI/PT for the pilot), SM, and DM as the only eligible
            // roles. BAs and any other role that lands in an F&L store (rare
            // but possible) get a clear reason instead of a silent zero.
            const isPolicyRole =
              isCsaPoolRole(employee.role) ||
              employee.role === EmployeeRole.SM ||
              employee.role === EmployeeRole.DM;
            if (!isPolicyRole) {
              reasons.push(makeReason(
                "ROLE_NOT_ELIGIBLE_FOR_INCENTIVE",
                "Role not in the F&L incentive policy — no payout path this week.",
                { role: employee.role },
              ));
            }

            // Phase 5.1 — Store PI HOLD. Pilferage Index ≥ 0.30% blocks the
            // entire store-week regardless of role. We always emit the
            // reason when the store is on hold; if the pilot is in
            // "advisory" mode the math doesn't actually block, but the
            // reason is preserved in the trail so the admin console can
            // show "would have blocked under enforce mode".
            if (piHoldRaw) {
              const piPct = metric?.pilferageIndex
                ? asNumber(metric.pilferageIndex)
                : null;
              reasons.push(makeReason(
                "STORE_PI_HOLD",
                piHoldEnforced
                  ? `Store on PI hold${piPct !== null ? ` (${piPct.toFixed(2)}%)` : ""} — no incentive this week.`
                  : `Store would be on PI hold${piPct !== null ? ` (${piPct.toFixed(2)}%)` : ""} — advisory mode, payout not blocked.`,
                {
                  pilferageIndex: piPct,
                  enforced: piHoldEnforced,
                  note: metric?.note ?? null,
                },
              ));
            }

            // Phase 5.1 — Store GM gate. Only emitted for SM/DM. CSAs are
            // unaffected by GM per policy text — they can still earn even
            // when the store misses GM. We only attach this reason when
            // the store would otherwise have qualified (sales beat target,
            // no PI hold) — otherwise the chain is noisy.
            if (
              metric &&
              !gmAchievedRaw &&
              (employee.role === EmployeeRole.SM || employee.role === EmployeeRole.DM) &&
              actualSales > targetValue &&
              !piHoldBlocks
            ) {
              const gmActual = metric.gmActual ? asNumber(metric.gmActual) : null;
              const gmTarget = metric.gmTarget ? asNumber(metric.gmTarget) : null;
              reasons.push(makeReason(
                "STORE_GM_NOT_ACHIEVED",
                gmGateEnforced
                  ? `Store missed gross-margin target${gmActual !== null && gmTarget !== null ? ` (${gmActual.toFixed(2)}% vs ${gmTarget.toFixed(2)}%)` : ""} — manager incentive blocked.`
                  : `Store missed gross-margin target${gmActual !== null && gmTarget !== null ? ` (${gmActual.toFixed(2)}% vs ${gmTarget.toFixed(2)}%)` : ""} — advisory mode, payout not blocked.`,
                {
                  gmActual,
                  gmTarget,
                  enforced: gmGateEnforced,
                },
              ));
            }

            // Store-level reason (BLOCKING) — only when the store didn't
            // beat target. Suppressed when PI hold already explains the
            // zero (otherwise we'd emit two competing blocking reasons for
            // the same store-week).
            if (!hasExceeded && !piHoldBlocks && actualSales <= targetValue) {
              reasons.push(makeReason(
                "STORE_UNQUALIFIED",
                `Store didn't beat the weekly target (${Math.round(achievementPct * 10) / 10}% of ₹${Math.round(targetValue).toLocaleString("en-IN")}).`,
                { actualSales, targetValue, achievementPct },
              ));
            }

            // Attendance reasons for the CSA pool (SA + OMNI + PT). Two
            // separate codes: LEAVE_IN_WEEK fires when the employee took
            // ANY leave (the new policy gate); INSUFFICIENT_ATTENDANCE
            // fires when they have no recorded leave but still missed the
            // 5-day floor (data-gap fallback).
            const presentDays = presentDaysByEmp.get(employee.employeeId) ?? 0;
            const leaveStatusThisWeek = hasLeaveByEmp.get(employee.employeeId) ?? null;
            if (
              hasExceeded &&
              isActive &&
              isCsaPoolRole(employee.role) &&
              leaveStatusThisWeek
            ) {
              reasons.push(makeReason(
                "LEAVE_IN_WEEK",
                "Took leave during the incentive week — not eligible per policy (any leave disqualifies).",
                { leaveStatus: leaveStatusThisWeek, presentDays },
              ));
            }
            if (
              hasExceeded &&
              isActive &&
              isCsaPoolRole(employee.role) &&
              !leaveStatusThisWeek &&
              presentDays < minAttendanceDays
            ) {
              reasons.push(makeReason(
                "INSUFFICIENT_ATTENDANCE",
                `${presentDays} of ${minAttendanceDays} days PRESENT — minimum ${minAttendanceDays} needed for this week's payout.`,
                { presentDays, required: minAttendanceDays },
              ));
            }

            // Compute amount: only ACTIVE employees in a policy role with
            // no blocking-reason can earn. OMNI/PT route through the CSA
            // pool. SM/DM payout already had GM gate baked in via
            // smPayout/dmPayout being zero when gmGateBlocksManagers.
            let amount = 0;
            if (isActive && hasExceeded && isPolicyRole) {
              if (isCsaPoolRole(employee.role) && eligibleSAIds.has(employee.employeeId)) {
                amount = eachSaPayout;
              } else if (employee.role === EmployeeRole.SM) {
                amount = smPayout;
              } else if (employee.role === EmployeeRole.DM) {
                amount = dmPayout;
              }
            }

            if (amount > 0) {
              storeTotalIncentive += amount;
              storeEarningCount += 1;
            }

            ledgerRows.push({
              planId: plan.id,
              employeeId: employee.employeeId,
              storeCode: target.storeCode,
              vertical: Vertical.FNL,
              periodStart: target.periodStart,
              periodEnd: target.periodEnd,
              baseIncentive: storeIncentive,
              finalIncentive: amount,
              achievementPct,
              calculationDetails: {
                actualSales,
                targetValue,
                eligibleSAs: eligibleSACount,
                storeQualified: hasExceeded,
                presentDays: isCsaPoolRole(employee.role) ? presentDays : null,
                leaveStatusThisWeek: isCsaPoolRole(employee.role)
                  ? leaveStatusThisWeek
                  : null,
                payrollStatus: employee.payrollStatus,
                // Phase 5.1 — surface the store-week metric & split context
                // so the admin drilldown can render "why this number" without
                // re-querying. Null when no metric was ingested for the week.
                pilferageIndex: metric?.pilferageIndex
                  ? asNumber(metric.pilferageIndex)
                  : null,
                piHoldFlag: piHoldRaw,
                piHoldEnforced,
                gmTarget: metric?.gmTarget ? asNumber(metric.gmTarget) : null,
                gmActual: metric?.gmActual ? asNumber(metric.gmActual) : null,
                gmAchieved: gmAchievedRaw,
                gmGateEnforced,
                splitMode: annexureSplit
                  ? "ANNEXURE"
                  : isSingleMOD
                    ? "SINGLE_MOD_70_30"
                    : "UNRESOLVED",
                smCount,
                dmCount,
                reasons,
              },
            });

            employeeRollups.push({
              employeeId: employee.employeeId,
              planId: plan.id,
              storeCode: target.storeCode,
              vertical: Vertical.FNL,
              periodStart: target.periodStart,
              periodEnd: target.periodEnd,
              earned: amount,
              eligible: amount,
              potential: amount,
              achievementPct,
              multiplierApplied: null,
            });
          }

          // If the store didn't qualify, we still emit the storeRollup below
          // (was previously gated behind the unreachable `continue`).
          if (!hasExceeded && meta) {
            storeRollups.push({
              storeCode: target.storeCode,
              planId: plan.id,
              vertical: Vertical.FNL,
              city: meta.city,
              state: meta.state,
              periodStart: target.periodStart,
              periodEnd: target.periodEnd,
              targetValue,
              actualSales,
              achievementPct: Math.round(achievementPct * 100) / 100,
              totalIncentive: 0,
              employeeCount: activeEmployees.length,
              earningCount: 0,
            });
            continue;
          }

          if (meta) {
            storeRollups.push({
              storeCode: target.storeCode,
              planId: plan.id,
              vertical: Vertical.FNL,
              city: meta.city,
              state: meta.state,
              periodStart: target.periodStart,
              periodEnd: target.periodEnd,
              targetValue,
              actualSales,
              achievementPct: Math.round(achievementPct * 100) / 100,
              totalIncentive: storeTotalIncentive,
              employeeCount: activeEmployees.length,
              earningCount: storeEarningCount,
            });
          }
        }

        return {
          ledgerRows,
          employeeRollups,
          storeRollups,
          dailyRollups: dailyRollupsFrom(allWeekTxns),
        };
      },
    );
  }
}

// ──────────── Public API ────────────

export async function recalculateIncentives(input: RecalculateInput) {
  await computeElectronics(input);
  await computeGrocery(input);
  // Phase 6.1 — Grocery pilot. Two new engine paths, both gated on plan
  // `config.mode`. They no-op cleanly when no matching plans exist, so
  // running them unconditionally is safe even before seeding lands.
  await computeGroceryHrSales(input);
  await computeGroceryCategoryPip(input);
  await computeFnL(input);
}

export async function recalculateStoreMonth(
  storeCode: string,
  monthDate: Date,
  opts?: { trigger?: CalcRunTrigger; triggeredByUserId?: string | null },
) {
  await recalculateIncentives({
    storeCodes: [storeCode],
    periodStart: startOfMonth(monthDate),
    periodEnd: endOfMonth(monthDate),
    trigger: opts?.trigger,
    triggeredByUserId: opts?.triggeredByUserId ?? null,
  });
}

export async function recalculateByDateSpan(
  storeCodes: string[],
  start: Date,
  end: Date,
  opts?: { trigger?: CalcRunTrigger; triggeredByUserId?: string | null },
) {
  await recalculateIncentives({
    storeCodes,
    periodStart: start,
    periodEnd: addDays(end, 0),
    trigger: opts?.trigger,
    triggeredByUserId: opts?.triggeredByUserId ?? null,
  });
}
