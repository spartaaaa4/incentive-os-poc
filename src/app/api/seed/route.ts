export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { addDays } from "date-fns";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  ApprovalStatus,
  AttendanceStatus,
  Channel,
  EmployeeRole,
  PayrollStatus,
  PeriodType,
  TransactionType,
  Vertical,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { recalculateIncentives } from "@/server/calculations/engines";

let sequence = 1;
function nextId(prefix: string): string {
  return `${prefix}${String(sequence++).padStart(6, "0")}`;
}

function rng(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

function generateDemoPassword(employeeId: string): string {
  const numeric = employeeId.replace(/\D/g, "").padStart(3, "0");
  return `Demo@${numeric}${String(employeeId.length).padStart(2, "0")}`;
}

const stores = [
  { storeCode: "3675", storeName: "Bijapur KA", vertical: Vertical.ELECTRONICS, storeFormat: "Reliance Digital", state: "Karnataka", city: "Bijapur" },
  { storeCode: "4201", storeName: "Andheri MH", vertical: Vertical.ELECTRONICS, storeFormat: "Reliance Digital", state: "Maharashtra", city: "Mumbai" },
  { storeCode: "4502", storeName: "Koramangala KA", vertical: Vertical.ELECTRONICS, storeFormat: "Reliance Digital", state: "Karnataka", city: "Bengaluru" },
  { storeCode: "4801", storeName: "Powai MH", vertical: Vertical.ELECTRONICS, storeFormat: "Reliance Digital", state: "Maharashtra", city: "Mumbai" },
  { storeCode: "5102", storeName: "Whitefield KA", vertical: Vertical.ELECTRONICS, storeFormat: "Reliance Digital", state: "Karnataka", city: "Bengaluru" },
  { storeCode: "2536", storeName: "SIG-Pottammel", vertical: Vertical.GROCERY, storeFormat: "Signature", state: "Kerala", city: "Kozhikode" },
  { storeCode: "TGL5", storeName: "SMT-Edappal", vertical: Vertical.GROCERY, storeFormat: "Smart", state: "Kerala", city: "Malappuram" },
  { storeCode: "T28V", storeName: "SMT-Kalpetta", vertical: Vertical.GROCERY, storeFormat: "Smart", state: "Kerala", city: "Wayanad" },
  { storeCode: "GR04", storeName: "SMT-Bandra", vertical: Vertical.GROCERY, storeFormat: "Smart", state: "Maharashtra", city: "Mumbai" },
  { storeCode: "GR05", storeName: "SIG-Kochi", vertical: Vertical.GROCERY, storeFormat: "Signature", state: "Kerala", city: "Kochi" },
  { storeCode: "FL01", storeName: "Trends Indiranagar", vertical: Vertical.FNL, storeFormat: "Trends", state: "Karnataka", city: "Bengaluru" },
  { storeCode: "FL02", storeName: "TST Whitefield", vertical: Vertical.FNL, storeFormat: "TST", state: "Karnataka", city: "Bengaluru" },
  { storeCode: "FL03", storeName: "Trends Andheri", vertical: Vertical.FNL, storeFormat: "Trends", state: "Maharashtra", city: "Mumbai" },
  { storeCode: "FL04", storeName: "Trends HSR", vertical: Vertical.FNL, storeFormat: "Trends", state: "Karnataka", city: "Bengaluru" },
  { storeCode: "FL05", storeName: "TST Pune", vertical: Vertical.FNL, storeFormat: "TST", state: "Maharashtra", city: "Pune" },
];

const groceryArticles = [
  ["Andree", "494271428", "Andree Premium Butterscotch Cake 1 kg"],
  ["Andree", "493626014", "Andree Premium Rich Dates Cake 1 kg"],
  ["Andree", "493626016", "Andree Premium Rich Plum Cake 1 kg"],
  ["Bakemill", "492577824", "Bakemill Chocolate Cake 320 g"],
  ["Bakemill", "492577823", "Bakemill Coffee Cake 320 g"],
  ["Bakemill", "490432185", "Bakemill Dates and Carrot Cake 400 g"],
  ["Bakemill", "492577825", "Bakemill Jackfruit Cake 320 g"],
  ["Kairali", "494300095", "Kairali Pudding Cake 250 g CBD"],
  ["Unibic", "494359510", "Unibic Plum Cake 300 g (Egg)"],
  ["Unibic", "494359508", "Unibic Veg Plum Cake 300 g"],
];

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

export async function GET() {
  try {
    const [storeCount, ledgerCount] = await Promise.all([
      db.storeMaster.count(),
      db.incentiveLedger.count(),
    ]);
    return NextResponse.json({
      storeCount,
      ledgerCount,
      needsReseed: storeCount === 0 || ledgerCount === 0,
    });
  } catch {
    return NextResponse.json({ storeCount: 0, ledgerCount: 0, needsReseed: false });
  }
}

export async function POST(request: Request) {
  try {
    if (process.env.ENABLE_SEED !== "true") {
      return NextResponse.json({ error: "Seed endpoint is disabled. Set ENABLE_SEED=true to enable." }, { status: 403 });
    }

    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "true";

    if (force) {
      await db.incentiveLedger.deleteMany();
      await db.auditLog.deleteMany();
      await db.attendance.deleteMany();
      await db.salesTransaction.deleteMany();
      await db.target.deleteMany();
      await db.campaignPayoutSlab.deleteMany();
      await db.campaignStoreTarget.deleteMany();
      await db.campaignArticle.deleteMany();
      await db.campaignConfig.deleteMany();
      await db.productIncentiveSlab.deleteMany();
      await db.achievementMultiplier.deleteMany();
      await db.fnlRoleSplit.deleteMany();
      await db.incentivePlan.deleteMany();
      await db.userCredential.deleteMany();
      await db.employeeMaster.deleteMany();
      await db.storeMaster.deleteMany();
    }

    const existingStores = await db.storeMaster.count();
    if (existingStores > 0 && !force) {
      const ledgerCount = await db.incentiveLedger.count();
      if (ledgerCount === 0) {
        const allStoreCodes = (await db.storeMaster.findMany({ select: { storeCode: true } })).map((s) => s.storeCode);
        const aprilStart = new Date("2026-04-01");
        const aprilEnd = new Date("2026-04-30");
        try {
          await recalculateIncentives({ storeCodes: allStoreCodes, periodStart: aprilStart, periodEnd: aprilEnd });
        } catch (err) {
          console.error("Recalculation recovery error:", err);
          return NextResponse.json({ message: `Recalculation failed: ${String(err)}`, stats: { ledgerRows: 0 } }, { status: 500 });
        }
        const newLedgerCount = await db.incentiveLedger.count();
        return NextResponse.json({ message: "Incentives recalculated on existing data", stats: { ledgerRows: newLedgerCount } });
      }
      return NextResponse.json({ message: "Database already has data. Use ?force=true to reseed." }, { status: 200 });
    }

    sequence = 1;

    await db.storeMaster.createMany({
      data: stores.map((s) => ({ ...s, storeStatus: "ACTIVE" as const, operationalSince: new Date("2020-01-01") })),
    });

    const names = ["Aarav", "Vivaan", "Aditya", "Saanvi", "Ananya", "Diya", "Rohan", "Karan", "Ishita", "Meera", "Rahul", "Nitin", "Priya", "Ayesha", "Sneha", "Dev", "Om", "Arjun", "Ritika", "Neha"];
    const employeeRows: Array<{
      employeeId: string; employeeName: string; role: EmployeeRole; storeCode: string; payrollStatus: PayrollStatus; dateOfJoining: Date; dateOfExit: Date | null;
    }> = [];

    let empCounter = 1;
    for (const store of stores) {
      const roles: EmployeeRole[] = [EmployeeRole.SM, EmployeeRole.DM, EmployeeRole.DM];
      for (let i = 0; i < 12; i++) roles.push(EmployeeRole.SA);
      if (store.vertical === Vertical.ELECTRONICS) { roles.push(EmployeeRole.BA, EmployeeRole.BA); } else { roles.push(EmployeeRole.SA, EmployeeRole.SA); }
      roles.forEach((role, idx) => {
        const id = `E${String(empCounter++).padStart(3, "0")}`;
        employeeRows.push({
          employeeId: id, employeeName: `${names[idx % names.length]} ${store.city}`, role, storeCode: store.storeCode,
          payrollStatus: idx % 31 === 0 ? PayrollStatus.NOTICE_PERIOD : PayrollStatus.ACTIVE,
          dateOfJoining: new Date("2023-01-01"), dateOfExit: null,
        });
      });
    }
    await db.employeeMaster.createMany({ data: employeeRows });

    const credentialData = await Promise.all(
      employeeRows.map(async (employee) => ({
        employerId: employee.employeeId,
        employeeId: employee.employeeId,
        password: await bcrypt.hash(generateDemoPassword(employee.employeeId), 10),
      })),
    );
    await db.userCredential.createMany({ data: credentialData });

    const elecPlan = await db.incentivePlan.create({
      data: { planName: "Electronics Monthly Per Unit Plan", vertical: Vertical.ELECTRONICS, formulaType: "PER_UNIT", periodType: PeriodType.MONTHLY, status: ApprovalStatus.ACTIVE, version: 1, effectiveFrom: new Date("2026-04-01"), createdBy: "system", approvedBy: "checker", submittedBy: "maker" },
    });
    await db.productIncentiveSlab.createMany({
      data: electronicsSlabs.map((s) => ({ planId: elecPlan.id, productFamily: s[0] as string, brandFilter: s[1] as string, priceFrom: s[2] as number, priceTo: s[3] as number, incentivePerUnit: s[4] as number, effectiveFrom: new Date("2026-04-01") })),
    });
    await db.achievementMultiplier.createMany({
      data: [[0, 84.99, 0], [85, 89.99, 50], [90, 99.99, 80], [100, 109.99, 100], [110, 119.99, 110], [120, 999, 120]].map((r) => ({ planId: elecPlan.id, achievementFrom: r[0], achievementTo: r[1], multiplierPct: r[2], effectiveFrom: new Date("2026-04-01") })),
    });

    const groPlan = await db.incentivePlan.create({
      data: { planName: "Grocery Category Campaign Plan", vertical: Vertical.GROCERY, formulaType: "CAMPAIGN_SLAB", periodType: PeriodType.CAMPAIGN, status: ApprovalStatus.ACTIVE, createdBy: "system", approvedBy: "checker", submittedBy: "maker" },
    });
    const campaign = await db.campaignConfig.create({
      data: { planId: groPlan.id, campaignName: "Kerala Cakes April Drive", startDate: new Date("2026-04-15"), endDate: new Date("2026-04-25"), channel: Channel.OFFLINE, distributionRule: "EQUAL", status: ApprovalStatus.ACTIVE },
    });
    await db.campaignArticle.createMany({ data: groceryArticles.map((a) => ({ campaignId: campaign.id, brand: a[0], articleCode: a[1], description: a[2] })) });
    await db.campaignStoreTarget.createMany({ data: [{ campaignId: campaign.id, storeCode: "2536", targetValue: 48000 }, { campaignId: campaign.id, storeCode: "TGL5", targetValue: 55000 }, { campaignId: campaign.id, storeCode: "T28V", targetValue: 42000 }] });
    await db.campaignPayoutSlab.createMany({ data: [[100, 119.99, 2], [120, 129.99, 3], [130, 999, 4]].map((r) => ({ campaignId: campaign.id, achievementFrom: r[0], achievementTo: r[1], perPieceRate: r[2] })) });

    const fnlPlan = await db.incentivePlan.create({
      data: { planName: "F&L Weekly Store Pool", vertical: Vertical.FNL, formulaType: "WEEKLY_POOL", periodType: PeriodType.WEEKLY, status: ApprovalStatus.ACTIVE, config: { poolPct: 1, attendanceMinDays: 5, weekDefinition: "SUNDAY_TO_SATURDAY" }, createdBy: "system", approvedBy: "checker", submittedBy: "maker" },
    });
    await db.fnlRoleSplit.createMany({
      data: [[1, 0, 70, 30, 0], [1, 1, 60, 24, 16], [1, 2, 60, 16, 12], [1, 3, 60, 12, 9.2], [1, 4, 60, 10, 7.6]].map((r) => ({ planId: fnlPlan.id, numSms: r[0], numDms: r[1], saPoolPct: r[2], smSharePct: r[3], dmSharePerDmPct: r[4] })),
    });

    const aprilStart = new Date("2026-04-01");
    const aprilEnd = new Date("2026-04-30");
    const weeklySpans: [Date, Date, number][] = [
      [new Date("2026-04-05"), new Date("2026-04-11"), 95000],
      [new Date("2026-04-12"), new Date("2026-04-18"), 105000],
      [new Date("2026-04-19"), new Date("2026-04-25"), 115000],
      [new Date("2026-04-26"), new Date("2026-05-02"), 100000],
    ];
    const electronicsDeptTargets = [
      ["IT", 850000], ["ENT", 750000], ["Telecom", 700000], ["Large Appliances", 550000],
    ] as const;

    const targetRows: Prisma.TargetCreateManyInput[] = [];
    for (const store of stores.filter((s) => s.vertical === Vertical.ELECTRONICS)) {
      for (const [dept, baseTarget] of electronicsDeptTargets) {
        targetRows.push({ storeCode: store.storeCode, vertical: Vertical.ELECTRONICS, department: dept, productFamilyCode: null, productFamilyName: null, targetValue: baseTarget + Math.round(Math.random() * 200000), periodType: PeriodType.MONTHLY, periodStart: aprilStart, periodEnd: aprilEnd, status: ApprovalStatus.ACTIVE, submittedBy: "maker", approvedBy: "checker" });
      }
    }
    for (const [sc, tv] of [["2536", 48000], ["TGL5", 55000], ["T28V", 42000]] as const) {
      targetRows.push({ storeCode: sc, vertical: Vertical.GROCERY, department: null, productFamilyCode: null, productFamilyName: "Campaign Target", targetValue: tv, periodType: PeriodType.CAMPAIGN, periodStart: new Date("2026-04-15"), periodEnd: new Date("2026-04-25"), status: ApprovalStatus.ACTIVE, submittedBy: "maker", approvedBy: "checker" });
    }
    for (const store of stores.filter((s) => s.vertical === Vertical.FNL)) {
      for (const [ws, we, base] of weeklySpans) {
        targetRows.push({ storeCode: store.storeCode, vertical: Vertical.FNL, department: null, productFamilyCode: null, productFamilyName: "Weekly Store Target", targetValue: base + Math.round(Math.random() * 20000), periodType: PeriodType.WEEKLY, periodStart: ws, periodEnd: we, status: ApprovalStatus.ACTIVE, submittedBy: "maker", approvedBy: "checker" });
      }
    }
    await db.target.createMany({ data: targetRows });

    const fnlEmps = employeeRows.filter((e) => stores.find((s) => s.storeCode === e.storeCode)?.vertical === Vertical.FNL);
    const attendanceRows: Prisma.AttendanceCreateManyInput[] = [];
    for (const emp of fnlEmps) {
      const rand = rng(emp.employeeId.charCodeAt(1) + emp.employeeId.charCodeAt(2));
      for (let d = 0; d < 30; d++) {
        const date = addDays(new Date("2026-04-01"), d);
        const wd = date.getUTCDay();
        let status: AttendanceStatus = AttendanceStatus.PRESENT;
        if (wd === 0 || wd === 6) { status = rand() > 0.5 ? AttendanceStatus.WEEK_OFF : AttendanceStatus.HOLIDAY; }
        else if (rand() > 0.92) { status = rand() > 0.5 ? AttendanceStatus.ABSENT : AttendanceStatus.LEAVE_APPROVED; }
        attendanceRows.push({ employeeId: emp.employeeId, storeCode: emp.storeCode, date, status });
      }
    }
    await db.attendance.createMany({ data: attendanceRows, skipDuplicates: true });

    const salesRows: Prisma.SalesTransactionCreateManyInput[] = [];
    const rand = rng(77);
    const elecFamilies = [
      { dept: "Telecom", code: "FK01", pre: "PH", brands: ["Samsung", "Oppo", "Vivo", "Xiaomi", "Realme", "OnePlus"], min: 8000, max: 54000 },
      { dept: "ENT", code: "FH01", pre: "TV", brands: ["Sony", "LG", "MI", "OnePlus", "Realme"], min: 18000, max: 85000 },
      { dept: "Large Appliances", code: "FJ03", pre: "AP", brands: ["Samsung", "LG", "Whirlpool", "IFB"], min: 12000, max: 50000 },
      { dept: "IT", code: "FF01", pre: "LP", brands: ["HP", "Dell", "Lenovo", "Apple", "Microsoft Surface"], min: 25000, max: 90000 },
      { dept: "ENT", code: "FH07", pre: "CM", brands: ["Canon", "Nikon", "Sony"], min: 12000, max: 60000 },
      { dept: "IT", code: "FF03", pre: "TB", brands: ["Samsung", "Apple", "Lenovo"], min: 9000, max: 45000 },
    ];
    const empByStore = new Map<string, string[]>();
    for (const e of employeeRows) { if (e.role === EmployeeRole.SA) { const l = empByStore.get(e.storeCode) ?? []; l.push(e.employeeId); empByStore.set(e.storeCode, l); } }

    for (const store of stores.filter((s) => s.vertical === Vertical.ELECTRONICS)) {
      const ids = empByStore.get(store.storeCode) ?? [];
      for (let i = 0; i < 120; i++) {
        const f = elecFamilies[Math.floor(rand() * elecFamilies.length)];
        const qty = rand() > 0.8 ? 2 : 1;
        const up = Math.round(f.min + rand() * (f.max - f.min));
        const ga = up * qty; const tax = Math.round(ga * 0.18);
        const tp = rand();
        let tt: TransactionType = TransactionType.NORMAL;
        if (tp > 0.92) tt = TransactionType.SFS; if (tp > 0.95) tt = TransactionType.PAS; if (tp > 0.98) tt = TransactionType.JIOMART;
        salesRows.push({ transactionId: nextId("TXE"), transactionDate: addDays(aprilStart, Math.floor(rand() * 30)), storeCode: store.storeCode, vertical: Vertical.ELECTRONICS, storeFormat: store.storeFormat, employeeId: ids[Math.floor(rand() * ids.length)] ?? null, department: f.dept, articleCode: `${f.pre}${Math.floor(100000 + rand() * 899999)}`, productFamilyCode: f.code, brand: f.brands[Math.floor(rand() * f.brands.length)], quantity: qty, grossAmount: ga, taxAmount: tax, totalAmount: ga + tax, transactionType: tt, channel: rand() > 0.93 ? Channel.ONLINE : Channel.OFFLINE });
      }
    }
    for (const sc of ["2536", "TGL5", "T28V"]) {
      const store = stores.find((s) => s.storeCode === sc)!;
      const ids = empByStore.get(sc) ?? [];
      for (let i = 0; i < 120; i++) {
        const a = groceryArticles[Math.floor(rand() * groceryArticles.length)];
        const qty = 1 + Math.floor(rand() * 3); const up = 120 + Math.round(rand() * 280);
        const ga = qty * up; const tax = Math.round(ga * 0.05);
        salesRows.push({ transactionId: nextId("TXG"), transactionDate: addDays(new Date("2026-04-15"), Math.floor(rand() * 11)), storeCode: sc, vertical: Vertical.GROCERY, storeFormat: store.storeFormat, employeeId: ids[Math.floor(rand() * ids.length)] ?? null, department: "GROCERY", articleCode: a[1], productFamilyCode: null, brand: a[0], quantity: qty, grossAmount: ga, taxAmount: tax, totalAmount: ga + tax, transactionType: TransactionType.NORMAL, channel: Channel.OFFLINE });
      }
    }
    for (const store of stores.filter((s) => s.vertical === Vertical.FNL)) {
      const ids = empByStore.get(store.storeCode) ?? [];
      for (let i = 0; i < 100; i++) {
        const qty = 1 + Math.floor(rand() * 2); const up = 800 + Math.round(rand() * 4200);
        const ga = qty * up; const tax = Math.round(ga * 0.12);
        salesRows.push({ transactionId: nextId("TXF"), transactionDate: addDays(aprilStart, Math.floor(rand() * 30)), storeCode: store.storeCode, vertical: Vertical.FNL, storeFormat: store.storeFormat, employeeId: ids[Math.floor(rand() * ids.length)] ?? null, department: "APPAREL", articleCode: `FNL${Math.floor(100000 + rand() * 899999)}`, productFamilyCode: "FNL01", brand: ["Netplay", "Avaasa", "DNMX"][Math.floor(rand() * 3)], quantity: qty, grossAmount: ga, taxAmount: tax, totalAmount: ga + tax, transactionType: TransactionType.NORMAL, channel: rand() > 0.9 ? Channel.ONLINE : Channel.OFFLINE });
      }
    }
    await db.salesTransaction.createMany({ data: salesRows, skipDuplicates: true });

    const allStoreCodes = stores.map((s) => s.storeCode);
    let recalcError: string | null = null;
    try {
      await recalculateIncentives({ storeCodes: allStoreCodes, periodStart: aprilStart, periodEnd: aprilEnd });
    } catch (err) {
      recalcError = String(err);
      console.error("Recalculation error during seed:", err);
    }

    const ledgerCount = await db.incentiveLedger.count();
    const planCount = await db.incentivePlan.count({ where: { status: "ACTIVE" } });

    return NextResponse.json({
      message: recalcError ? `Seed complete but recalculation failed: ${recalcError}` : "Seed complete — incentives calculated",
      stats: { stores: stores.length, employees: employeeRows.length, sales: salesRows.length, targets: targetRows.length, attendance: attendanceRows.length, ledgerRows: ledgerCount, activePlans: planCount },
    });
  } catch (error) {
    console.error("Seed error:", error);
    return NextResponse.json({ error: `Seed operation failed: ${String(error)}` }, { status: 500 });
  }
}
