import { addDays } from "date-fns";
import bcrypt from "bcryptjs";
import {
  PrismaClient,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";
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

const prisma = new PrismaClient();

type StoreSeed = {
  storeCode: string;
  storeName: string;
  vertical: Vertical;
  storeFormat: string;
  state: string;
  city: string;
};

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

// ─── Stores ──────────────────────────────────────────────────────────────────

const stores: StoreSeed[] = [
  // Electronics — 5 stores across Karnataka & Maharashtra
  { storeCode: "3675", storeName: "Bijapur KA", vertical: Vertical.ELECTRONICS, storeFormat: "Reliance Digital", state: "Karnataka", city: "Bijapur" },
  { storeCode: "4201", storeName: "Andheri MH", vertical: Vertical.ELECTRONICS, storeFormat: "Reliance Digital", state: "Maharashtra", city: "Mumbai" },
  { storeCode: "4502", storeName: "Koramangala KA", vertical: Vertical.ELECTRONICS, storeFormat: "Reliance Digital", state: "Karnataka", city: "Bengaluru" },
  { storeCode: "4801", storeName: "Powai MH", vertical: Vertical.ELECTRONICS, storeFormat: "Reliance Digital", state: "Maharashtra", city: "Mumbai" },
  { storeCode: "5102", storeName: "Whitefield KA", vertical: Vertical.ELECTRONICS, storeFormat: "Reliance Digital", state: "Karnataka", city: "Bengaluru" },
  // Grocery — 5 stores in Kerala & Maharashtra
  { storeCode: "2536", storeName: "SIG-Pottammel", vertical: Vertical.GROCERY, storeFormat: "Signature", state: "Kerala", city: "Kozhikode" },
  { storeCode: "TGL5", storeName: "SMT-Edappal", vertical: Vertical.GROCERY, storeFormat: "Smart", state: "Kerala", city: "Malappuram" },
  { storeCode: "T28V", storeName: "SMT-Kalpetta", vertical: Vertical.GROCERY, storeFormat: "Smart", state: "Kerala", city: "Wayanad" },
  { storeCode: "GR04", storeName: "SMT-Bandra", vertical: Vertical.GROCERY, storeFormat: "Smart", state: "Maharashtra", city: "Mumbai" },
  { storeCode: "GR05", storeName: "SIG-Kochi", vertical: Vertical.GROCERY, storeFormat: "Signature", state: "Kerala", city: "Kochi" },
  // F&L — 5 stores
  { storeCode: "FL01", storeName: "Trends Indiranagar", vertical: Vertical.FNL, storeFormat: "Trends", state: "Karnataka", city: "Bengaluru" },
  { storeCode: "FL02", storeName: "TST Whitefield", vertical: Vertical.FNL, storeFormat: "TST", state: "Karnataka", city: "Bengaluru" },
  { storeCode: "FL03", storeName: "Trends Andheri", vertical: Vertical.FNL, storeFormat: "Trends", state: "Maharashtra", city: "Mumbai" },
  { storeCode: "FL04", storeName: "Trends HSR", vertical: Vertical.FNL, storeFormat: "Trends", state: "Karnataka", city: "Bengaluru" },
  { storeCode: "FL05", storeName: "TST Pune", vertical: Vertical.FNL, storeFormat: "TST", state: "Maharashtra", city: "Pune" },
];

// ─── Grocery campaign articles (from vendor brief §7.2) ─────────────────────

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

// ─── Electronics incentive slabs (vendor brief §6.4) ────────────────────────

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

// ─── Electronics: per-department family-level targets from vendor brief ──────
// Base targets from Store 3675 (Bijapur KA) — vendor brief §6.6 sample.
// Other stores use a scale factor for variety.

type FamilyTarget = { dept: string; code: string; name: string; target: number };

const baseElecTargets: FamilyTarget[] = [
  { dept: "IT", code: "FF01", name: "Laptop", target: 888104 },
  { dept: "IT", code: "FF03", name: "Tablet", target: 118305 },
  { dept: "IT", code: "FF04", name: "IT Peripheral", target: 18052 },
  { dept: "ENT", code: "FH01", name: "High End TV", target: 1303560 },
  { dept: "ENT", code: "FH05", name: "Audio", target: 228211 },
  { dept: "ENT", code: "FH07", name: "Photography", target: 45000 },
  { dept: "Telecom", code: "FK01", name: "Wireless Phone", target: 3532421 },
  { dept: "Small Appliances", code: "FI01", name: "Garment Care", target: 13966 },
  { dept: "Small Appliances", code: "FI02", name: "Home Care", target: 380967 },
  { dept: "Small Appliances", code: "FI05", name: "Kitchen Care", target: 44455 },
  { dept: "Small Appliances", code: "FI07", name: "Personal Care", target: 17481 },
  { dept: "Large Appliances", code: "FJ01", name: "Air Care", target: 1431617 },
  { dept: "Large Appliances", code: "FJ02", name: "Food Preservation", target: 923140 },
  { dept: "Large Appliances", code: "FJ03", name: "Laundry & Wash Care", target: 664132 },
  { dept: "AIOT", code: "FG01", name: "Personal AV", target: 66728 },
  { dept: "AIOT", code: "FG03", name: "Charging Solutions", target: 84751 },
];

// Scale factors: bigger city stores have higher targets
const storeScaleFactors: Record<string, number> = {
  "3675": 1.0,   // Bijapur — base (from brief)
  "4201": 1.4,   // Andheri Mumbai — large metro
  "4502": 1.3,   // Koramangala Bengaluru
  "4801": 1.5,   // Powai Mumbai — flagship
  "5102": 1.1,   // Whitefield Bengaluru
};

// Desired department-level achievement % per store — this is what makes the
// dashboard interesting: different multiplier bands visible across stores.
// Bands: <85% → 0%, 85-90% → 50%, 90-100% → 80%, 100-110% → 100%, 110-120% → 110%, 120%+ → 120%
const elecAchievementProfiles: Record<string, Record<string, number>> = {
  "3675": { // Bijapur — strong in Telecom & Large Appliances, weak in IT & AIOT
    "Telecom": 1.22, "Large Appliances": 1.08, "ENT": 1.03,
    "IT": 0.88, "Small Appliances": 0.82, "AIOT": 0.76,
  },
  "4201": { // Andheri — top performer, but ENT underperforming
    "Telecom": 1.15, "Large Appliances": 1.25, "IT": 1.12,
    "Small Appliances": 1.05, "ENT": 0.87, "AIOT": 0.93,
  },
  "4502": { // Koramangala — IT hub, IT crushing it, Large Appliances below threshold
    "IT": 1.32, "Telecom": 1.06, "ENT": 1.14,
    "Small Appliances": 0.95, "AIOT": 1.01, "Large Appliances": 0.79,
  },
  "4801": { // Powai — flagship, most depts above 100%, AIOT below
    "Telecom": 1.18, "Large Appliances": 1.12, "ENT": 1.09,
    "IT": 1.04, "Small Appliances": 1.02, "AIOT": 0.83,
  },
  "5102": { // Whitefield — average store, mixed results
    "Telecom": 0.96, "Large Appliances": 0.91, "ENT": 1.11,
    "IT": 0.86, "Small Appliances": 1.16, "AIOT": 1.05,
  },
};

// ─── Electronics product families for sales generation ──────────────────────

type ElecFamily = { dept: string; code: string; prefix: string; brands: string[]; min: number; max: number };

const electronicsFamilies: ElecFamily[] = [
  { dept: "Telecom", code: "FK01", prefix: "PH", brands: ["Samsung", "Oppo", "Vivo", "Xiaomi", "Realme", "OnePlus"], min: 8000, max: 54000 },
  { dept: "ENT", code: "FH01", prefix: "TV", brands: ["Sony", "LG", "MI", "OnePlus", "Realme"], min: 18000, max: 85000 },
  { dept: "ENT", code: "FH05", prefix: "AU", brands: ["Sony", "JBL", "Bose", "Boat"], min: 2000, max: 35000 },
  { dept: "ENT", code: "FH07", prefix: "CM", brands: ["Canon", "Nikon", "Sony"], min: 12000, max: 60000 },
  { dept: "IT", code: "FF01", prefix: "LP", brands: ["HP", "Dell", "Lenovo", "Apple", "Microsoft Surface"], min: 25000, max: 90000 },
  { dept: "IT", code: "FF03", prefix: "TB", brands: ["Samsung", "Apple", "Lenovo"], min: 9000, max: 45000 },
  { dept: "IT", code: "FF04", prefix: "IP", brands: ["Logitech", "HP", "Dell"], min: 500, max: 8000 },
  { dept: "Small Appliances", code: "FI01", prefix: "GC", brands: ["Philips", "Bajaj"], min: 1500, max: 5000 },
  { dept: "Small Appliances", code: "FI02", prefix: "HC", brands: ["Philips", "Dyson", "Eureka Forbes"], min: 2000, max: 8000 },
  { dept: "Small Appliances", code: "FI05", prefix: "KC", brands: ["Prestige", "Butterfly", "Philips"], min: 1500, max: 6000 },
  { dept: "Small Appliances", code: "FI07", prefix: "PC", brands: ["Philips", "Braun", "Havells"], min: 800, max: 4000 },
  { dept: "Large Appliances", code: "FJ01", prefix: "AC", brands: ["Daikin", "Voltas", "LG", "Samsung"], min: 20000, max: 55000 },
  { dept: "Large Appliances", code: "FJ02", prefix: "RF", brands: ["Samsung", "LG", "Whirlpool", "Godrej"], min: 15000, max: 50000 },
  { dept: "Large Appliances", code: "FJ03", prefix: "WM", brands: ["Samsung", "LG", "Whirlpool", "IFB"], min: 12000, max: 50000 },
  { dept: "AIOT", code: "FG01", prefix: "AV", brands: ["Boat", "JBL", "Noise"], min: 1500, max: 12000 },
  { dept: "AIOT", code: "FG03", prefix: "CS", brands: ["Anker", "Belkin", "Mi"], min: 500, max: 5000 },
];

// ─── Grocery: controlled per-store achievement ──────────────────────────────

const groceryDesiredAchievement: Record<string, number> = {
  "2536": 1.09,  // SIG-Pottammel → 109% → ₹2/piece slab
  "TGL5": 1.26,  // SMT-Edappal   → 126% → ₹3/piece slab
  "T28V": 0.92,  // SMT-Kalpetta  →  92% → below 100% → ₹0 (no incentive)
};

// ─── F&L: weekly targets and desired sales (Sun-Sat weeks in April 2026) ────
// April 2026: Apr 1 = Wednesday, so first full Sun-Sat is Apr 5-11

type FnlWeekPlan = { start: Date; end: Date; target: number; desiredSales: number };

const fnlWeeklyPlans: Record<string, FnlWeekPlan[]> = {
  "FL01": [ // Trends Indiranagar — 3 of 4 weeks qualify
    { start: new Date("2026-04-05"), end: new Date("2026-04-11"), target: 900000, desiredSales: 960000 },
    { start: new Date("2026-04-12"), end: new Date("2026-04-18"), target: 1100000, desiredSales: 1210000 },
    { start: new Date("2026-04-19"), end: new Date("2026-04-25"), target: 1250000, desiredSales: 1150000 }, // fails
    { start: new Date("2026-04-26"), end: new Date("2026-05-02"), target: 1000000, desiredSales: 1070000 },
  ],
  "FL02": [ // TST Whitefield — 2 of 4 weeks qualify
    { start: new Date("2026-04-05"), end: new Date("2026-04-11"), target: 850000, desiredSales: 790000 },  // fails
    { start: new Date("2026-04-12"), end: new Date("2026-04-18"), target: 1000000, desiredSales: 1120000 },
    { start: new Date("2026-04-19"), end: new Date("2026-04-25"), target: 1150000, desiredSales: 1230000 },
    { start: new Date("2026-04-26"), end: new Date("2026-05-02"), target: 950000, desiredSales: 910000 },  // fails
  ],
  "FL03": [ // Trends Andheri — 2 of 4 weeks qualify
    { start: new Date("2026-04-05"), end: new Date("2026-04-11"), target: 1000000, desiredSales: 1105000 },
    { start: new Date("2026-04-12"), end: new Date("2026-04-18"), target: 1200000, desiredSales: 1140000 }, // fails
    { start: new Date("2026-04-19"), end: new Date("2026-04-25"), target: 1300000, desiredSales: 1380000 },
    { start: new Date("2026-04-26"), end: new Date("2026-05-02"), target: 1100000, desiredSales: 1020000 }, // fails
  ],
  "FL04": [ // Trends HSR — 3 of 4 weeks qualify
    { start: new Date("2026-04-05"), end: new Date("2026-04-11"), target: 800000, desiredSales: 860000 },
    { start: new Date("2026-04-12"), end: new Date("2026-04-18"), target: 950000, desiredSales: 1015000 },
    { start: new Date("2026-04-19"), end: new Date("2026-04-25"), target: 1100000, desiredSales: 1180000 },
    { start: new Date("2026-04-26"), end: new Date("2026-05-02"), target: 900000, desiredSales: 870000 }, // fails
  ],
  "FL05": [ // TST Pune — 2 of 4 weeks qualify
    { start: new Date("2026-04-05"), end: new Date("2026-04-11"), target: 950000, desiredSales: 880000 },  // fails
    { start: new Date("2026-04-12"), end: new Date("2026-04-18"), target: 1100000, desiredSales: 1040000 }, // fails
    { start: new Date("2026-04-19"), end: new Date("2026-04-25"), target: 1200000, desiredSales: 1320000 },
    { start: new Date("2026-04-26"), end: new Date("2026-05-02"), target: 1000000, desiredSales: 1090000 },
  ],
};

// ─── Seed main ──────────────────────────────────────────────────────────────

async function main() {
  // Clear everything
  await prisma.auditLog.deleteMany();
  await prisma.incentiveLedger.deleteMany();
  await prisma.campaignPayoutSlab.deleteMany();
  await prisma.campaignStoreTarget.deleteMany();
  await prisma.campaignArticle.deleteMany();
  await prisma.campaignConfig.deleteMany();
  await prisma.fnlRoleSplit.deleteMany();
  await prisma.achievementMultiplier.deleteMany();
  await prisma.productIncentiveSlab.deleteMany();
  await prisma.incentivePlan.deleteMany();
  await prisma.target.deleteMany();
  await prisma.salesTransaction.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.userCredential.deleteMany();
  await prisma.employeeMaster.deleteMany();
  await prisma.storeMaster.deleteMany();

  // ── 1. Stores ─────────────────────────────────────────────────────────────

  await prisma.storeMaster.createMany({
    data: stores.map((store) => ({
      ...store,
      storeStatus: "ACTIVE" as const,
      operationalSince: new Date("2020-01-01"),
    })),
  });

  // ── 2. Employees ──────────────────────────────────────────────────────────

  const names = [
    "Aarav", "Vivaan", "Aditya", "Saanvi", "Ananya",
    "Diya", "Rohan", "Karan", "Ishita", "Meera",
    "Rahul", "Nitin", "Priya", "Ayesha", "Sneha",
    "Dev", "Om", "Arjun", "Ritika", "Neha",
  ];

  // Electronics departments: 2 SAs per department, round-robin
  const elecDepts = ["IT", "ENT", "Telecom", "Large Appliances", "Small Appliances", "AIOT"];

  type EmployeeRow = {
    employeeId: string;
    employeeName: string;
    role: EmployeeRole;
    storeCode: string;
    department: string | null;
    payrollStatus: PayrollStatus;
    dateOfJoining: Date;
    dateOfExit: Date | null;
  };

  const employeeRows: EmployeeRow[] = [];
  let employeeCounter = 1;

  for (const store of stores) {
    // SM, 2× DM, 12× SA, then vertical-specific extras
    const roles: EmployeeRole[] = [EmployeeRole.SM, EmployeeRole.DM, EmployeeRole.DM];
    for (let i = 0; i < 12; i++) roles.push(EmployeeRole.SA);
    if (store.vertical === Vertical.ELECTRONICS) {
      roles.push(EmployeeRole.BA, EmployeeRole.BA);
    } else {
      roles.push(EmployeeRole.SA, EmployeeRole.SA);
    }

    // Track SA index separately for department assignment
    let saIndex = 0;
    roles.forEach((role, index) => {
      const id = `E${String(employeeCounter++).padStart(3, "0")}`;

      // Demo-only department assignment. In production, set during onboarding.
      let department: string | null = null;
      if (store.vertical === Vertical.ELECTRONICS && (role === EmployeeRole.SA || role === EmployeeRole.BA)) {
        department = elecDepts[saIndex % elecDepts.length];
        saIndex++;
      }

      // Sprinkle in some non-ACTIVE statuses for realism:
      // - First employee of every 2nd store → NOTICE_PERIOD
      // - One SA per electronics store → DISCIPLINARY_ACTION (they won't earn incentive)
      let payrollStatus: PayrollStatus = PayrollStatus.ACTIVE;
      if (index === 0 && stores.indexOf(store) % 2 === 1) {
        payrollStatus = PayrollStatus.NOTICE_PERIOD;
      } else if (store.vertical === Vertical.ELECTRONICS && role === EmployeeRole.SA && saIndex === 5) {
        payrollStatus = PayrollStatus.DISCIPLINARY_ACTION;
      }

      employeeRows.push({
        employeeId: id,
        employeeName: `${names[index % names.length]} ${store.city}`,
        role,
        storeCode: store.storeCode,
        department,
        payrollStatus,
        dateOfJoining: new Date("2023-01-01"),
        dateOfExit: null,
      });
    });
  }

  await prisma.employeeMaster.createMany({ data: employeeRows });

  const credentialData = await Promise.all(
    employeeRows.map(async (emp) => ({
      employerId: emp.employeeId,
      employeeId: emp.employeeId,
      password: await bcrypt.hash(generateDemoPassword(emp.employeeId), 10),
    })),
  );
  await prisma.userCredential.createMany({ data: credentialData });

  // Build indexes for sales generation
  // storeCode → dept → [employeeIds of SAs with ACTIVE payroll]
  const saByStoreDept = new Map<string, Map<string, string[]>>();
  for (const emp of employeeRows) {
    if (emp.role !== EmployeeRole.SA || emp.payrollStatus !== PayrollStatus.ACTIVE) continue;
    if (!emp.department) continue;
    let deptMap = saByStoreDept.get(emp.storeCode);
    if (!deptMap) { deptMap = new Map(); saByStoreDept.set(emp.storeCode, deptMap); }
    const list = deptMap.get(emp.department) ?? [];
    list.push(emp.employeeId);
    deptMap.set(emp.department, list);
  }

  // storeCode → [all SA employeeIds] (for grocery/FNL where dept doesn't matter)
  const saByStore = new Map<string, string[]>();
  for (const emp of employeeRows) {
    if (emp.role !== EmployeeRole.SA || emp.payrollStatus !== PayrollStatus.ACTIVE) continue;
    const list = saByStore.get(emp.storeCode) ?? [];
    list.push(emp.employeeId);
    saByStore.set(emp.storeCode, list);
  }

  // ── 3. Incentive Plans ────────────────────────────────────────────────────

  const electronicsPlan = await prisma.incentivePlan.create({
    data: {
      planName: "Electronics Monthly Per Unit Plan",
      vertical: Vertical.ELECTRONICS,
      formulaType: "PER_UNIT",
      periodType: PeriodType.MONTHLY,
      status: ApprovalStatus.ACTIVE,
      version: 1,
      effectiveFrom: new Date("2026-04-01"),
      createdBy: "system",
      approvedBy: "checker",
      submittedBy: "maker",
    },
  });

  await prisma.productIncentiveSlab.createMany({
    data: electronicsSlabs.map((slab) => ({
      planId: electronicsPlan.id,
      productFamily: slab[0] as string,
      brandFilter: slab[1] as string,
      priceFrom: slab[2] as number,
      priceTo: slab[3] as number,
      incentivePerUnit: slab[4] as number,
      effectiveFrom: new Date("2026-04-01"),
    })),
  });

  await prisma.achievementMultiplier.createMany({
    data: [
      [0, 84.99, 0],
      [85, 89.99, 50],
      [90, 99.99, 80],
      [100, 109.99, 100],
      [110, 119.99, 110],
      [120, 999, 120],
    ].map((row) => ({
      planId: electronicsPlan.id,
      achievementFrom: row[0],
      achievementTo: row[1],
      multiplierPct: row[2],
      effectiveFrom: new Date("2026-04-01"),
    })),
  });

  const groceryPlan = await prisma.incentivePlan.create({
    data: {
      planName: "Grocery Category Campaign Plan",
      vertical: Vertical.GROCERY,
      formulaType: "CAMPAIGN_SLAB",
      periodType: PeriodType.CAMPAIGN,
      status: ApprovalStatus.ACTIVE,
      createdBy: "system",
      approvedBy: "checker",
      submittedBy: "maker",
    },
  });

  const campaign = await prisma.campaignConfig.create({
    data: {
      planId: groceryPlan.id,
      campaignName: "Kerala Cakes April Drive",
      startDate: new Date("2026-04-15"),
      endDate: new Date("2026-04-25"),
      channel: Channel.OFFLINE,
      distributionRule: "EQUAL",
      status: ApprovalStatus.ACTIVE,
    },
  });

  await prisma.campaignArticle.createMany({
    data: groceryArticles.map((item) => ({
      campaignId: campaign.id,
      brand: item[0],
      articleCode: item[1],
      description: item[2],
    })),
  });

  await prisma.campaignStoreTarget.createMany({
    data: [
      { campaignId: campaign.id, storeCode: "2536", targetValue: 67000 },
      { campaignId: campaign.id, storeCode: "TGL5", targetValue: 226000 },
      { campaignId: campaign.id, storeCode: "T28V", targetValue: 167000 },
    ],
  });

  await prisma.campaignPayoutSlab.createMany({
    data: [
      [100, 119.99, 2],
      [120, 129.99, 3],
      [130, 999, 4],
    ].map((row) => ({
      campaignId: campaign.id,
      achievementFrom: row[0],
      achievementTo: row[1],
      perPieceRate: row[2],
    })),
  });

  const fnlPlan = await prisma.incentivePlan.create({
    data: {
      planName: "F&L Weekly Store Pool",
      vertical: Vertical.FNL,
      formulaType: "WEEKLY_POOL",
      periodType: PeriodType.WEEKLY,
      status: ApprovalStatus.ACTIVE,
      config: { poolPct: 1, attendanceMinDays: 5, weekDefinition: "SUNDAY_TO_SATURDAY" },
      createdBy: "system",
      approvedBy: "checker",
      submittedBy: "maker",
    },
  });

  await prisma.fnlRoleSplit.createMany({
    data: [
      [1, 0, 70, 30, 0],
      [1, 1, 60, 24, 16],
      [1, 2, 60, 16, 12],
      [1, 3, 60, 12, 9.2],
      [1, 4, 60, 10, 7.6],
    ].map((row) => ({
      planId: fnlPlan.id,
      numSms: row[0],
      numDms: row[1],
      saPoolPct: row[2],
      smSharePct: row[3],
      dmSharePerDmPct: row[4],
    })),
  });

  // ── 4. Targets ────────────────────────────────────────────────────────────

  const aprilStart = new Date("2026-04-01");
  const aprilEnd = new Date("2026-04-30");

  const targetRows: Prisma.TargetCreateManyInput[] = [];

  // Electronics — vendor-brief targets scaled per store
  for (const store of stores.filter((s) => s.vertical === Vertical.ELECTRONICS)) {
    const scale = storeScaleFactors[store.storeCode] ?? 1;
    for (const ft of baseElecTargets) {
      targetRows.push({
        storeCode: store.storeCode,
        vertical: Vertical.ELECTRONICS,
        department: ft.dept,
        productFamilyCode: ft.code,
        productFamilyName: ft.name,
        targetValue: Math.round(ft.target * scale),
        periodType: PeriodType.MONTHLY,
        periodStart: aprilStart,
        periodEnd: aprilEnd,
        status: ApprovalStatus.ACTIVE,
        submittedBy: "maker",
        approvedBy: "checker",
      });
    }
  }

  // Grocery — campaign targets (from vendor brief, exact values)
  for (const [storeCode, targetValue] of [
    ["2536", 67000], ["TGL5", 226000], ["T28V", 167000],
  ] as const) {
    targetRows.push({
      storeCode,
      vertical: Vertical.GROCERY,
      department: null,
      productFamilyCode: null,
      productFamilyName: "Campaign Target",
      targetValue,
      periodType: PeriodType.CAMPAIGN,
      periodStart: new Date("2026-04-15"),
      periodEnd: new Date("2026-04-25"),
      status: ApprovalStatus.ACTIVE,
      submittedBy: "maker",
      approvedBy: "checker",
    });
  }

  // F&L — weekly targets from our designed plan
  for (const store of stores.filter((s) => s.vertical === Vertical.FNL)) {
    const weeks = fnlWeeklyPlans[store.storeCode];
    if (!weeks) continue;
    for (const w of weeks) {
      targetRows.push({
        storeCode: store.storeCode,
        vertical: Vertical.FNL,
        department: null,
        productFamilyCode: null,
        productFamilyName: "Weekly Store Target",
        targetValue: w.target,
        periodType: PeriodType.WEEKLY,
        periodStart: w.start,
        periodEnd: w.end,
        status: ApprovalStatus.ACTIVE,
        submittedBy: "maker",
        approvedBy: "checker",
      });
    }
  }

  await prisma.target.createMany({ data: targetRows });

  // ── 5. Attendance (F&L only) ──────────────────────────────────────────────

  const fnlEmployees = employeeRows.filter((e) =>
    stores.find((s) => s.storeCode === e.storeCode)?.vertical === Vertical.FNL,
  );
  const attendanceRows: Prisma.AttendanceCreateManyInput[] = [];

  for (const emp of fnlEmployees) {
    const rand = rng(emp.employeeId.charCodeAt(1) * 100 + emp.employeeId.charCodeAt(2));
    for (let day = 0; day < 32; day++) { // Apr 1 to May 2
      const date = addDays(new Date("2026-04-01"), day);
      const weekday = date.getUTCDay(); // 0=Sun, 6=Sat

      let status: AttendanceStatus;
      if (weekday === 0) {
        // Sundays: most get WEEK_OFF, some work
        status = rand() > 0.15 ? AttendanceStatus.WEEK_OFF : AttendanceStatus.PRESENT;
      } else if (weekday === 6) {
        // Saturdays: retail, most work
        status = rand() > 0.85 ? AttendanceStatus.WEEK_OFF : AttendanceStatus.PRESENT;
      } else {
        // Weekdays: ~90% present, ~5% approved leave, ~3% absent, ~2% unapproved
        const roll = rand();
        if (roll < 0.90) status = AttendanceStatus.PRESENT;
        else if (roll < 0.95) status = AttendanceStatus.LEAVE_APPROVED;
        else if (roll < 0.98) status = AttendanceStatus.ABSENT;
        else status = AttendanceStatus.LEAVE_UNAPPROVED;
      }

      attendanceRows.push({
        employeeId: emp.employeeId,
        storeCode: emp.storeCode,
        date,
        status,
      });
    }
  }
  await prisma.attendance.createMany({ data: attendanceRows, skipDuplicates: true });

  // ── 6. Sales Transactions ─────────────────────────────────────────────────

  const salesRows: Prisma.SalesTransactionCreateManyInput[] = [];
  const rand = rng(42);

  // ── 6a. Electronics — department-aware, target-driven ─────────────────────
  // For each store+department: generate sales to reach desired achievement %

  for (const store of stores.filter((s) => s.vertical === Vertical.ELECTRONICS)) {
    const scale = storeScaleFactors[store.storeCode] ?? 1;
    const profile = elecAchievementProfiles[store.storeCode];
    if (!profile) continue;

    // Group base targets by department and compute department totals
    const deptFamilies = new Map<string, FamilyTarget[]>();
    const deptTargetTotals = new Map<string, number>();
    for (const ft of baseElecTargets) {
      const families = deptFamilies.get(ft.dept) ?? [];
      families.push(ft);
      deptFamilies.set(ft.dept, families);
      deptTargetTotals.set(ft.dept, (deptTargetTotals.get(ft.dept) ?? 0) + Math.round(ft.target * scale));
    }

    for (const [dept, desiredPct] of Object.entries(profile)) {
      const deptTarget = deptTargetTotals.get(dept) ?? 0;
      // Compensate for ~8% non-NORMAL + ~7% ONLINE excluded from achievement
      const desiredSales = Math.round(deptTarget * desiredPct * 1.18);
      const families = (deptFamilies.get(dept) ?? []);
      const familyDefs = electronicsFamilies.filter((f) => families.some((ft) => ft.code === f.code));
      if (!familyDefs.length) continue;

      const deptSAs = saByStoreDept.get(store.storeCode)?.get(dept) ?? [];
      if (!deptSAs.length) continue;

      let cumSales = 0;
      let txCount = 0;

      while (cumSales < desiredSales && txCount < 1000) {
        const family = familyDefs[Math.floor(rand() * familyDefs.length)];
        const qty = rand() > 0.82 ? 2 : 1;
        const unitPrice = Math.round(family.min + rand() * (family.max - family.min));
        const grossAmount = unitPrice * qty;
        const tax = Math.round(grossAmount * 0.18);

        // ~8% non-NORMAL transactions (excluded from incentive calc)
        let transactionType: TransactionType = TransactionType.NORMAL;
        const txRoll = rand();
        if (txRoll > 0.96) transactionType = TransactionType.SFS;
        else if (txRoll > 0.94) transactionType = TransactionType.PAS;
        else if (txRoll > 0.92) transactionType = TransactionType.JIOMART;

        // ~7% ONLINE channel (excluded from incentive calc)
        const channel = rand() > 0.93 ? Channel.ONLINE : Channel.OFFLINE;

        // Assign to a SA in this department
        const empId = deptSAs[Math.floor(rand() * deptSAs.length)];

        salesRows.push({
          transactionId: nextId("TXE"),
          transactionDate: addDays(aprilStart, Math.floor(rand() * 30)),
          storeCode: store.storeCode,
          vertical: Vertical.ELECTRONICS,
          storeFormat: store.storeFormat,
          employeeId: empId,
          department: dept,
          articleCode: `${family.prefix}${Math.floor(100000 + rand() * 899999)}`,
          productFamilyCode: family.code,
          brand: family.brands[Math.floor(rand() * family.brands.length)],
          quantity: qty,
          grossAmount,
          taxAmount: tax,
          totalAmount: grossAmount + tax,
          transactionType,
          channel,
        });

        // Only NORMAL + OFFLINE count toward achievement, but we generate
        // total volume to roughly hit the desired number (the excluded ~15%
        // is baked into the surplus — good enough for demo)
        cumSales += grossAmount;
        txCount++;
      }
    }
  }

  // ── 6b. Grocery — controlled per-store achievement ────────────────────────

  const campaignStores = ["2536", "TGL5", "T28V"];
  for (const storeCode of campaignStores) {
    const store = stores.find((s) => s.storeCode === storeCode)!;
    const targetValue = storeCode === "2536" ? 67000 : storeCode === "TGL5" ? 226000 : 167000;
    const desiredPct = groceryDesiredAchievement[storeCode] ?? 1.0;
    const desiredSales = Math.round(targetValue * desiredPct);
    const employeeIds = saByStore.get(storeCode) ?? [];

    let cumSales = 0;
    let txCount = 0;

    while (cumSales < desiredSales && txCount < 2000) {
      const article = groceryArticles[Math.floor(rand() * groceryArticles.length)];
      const qty = 1 + Math.floor(rand() * 3);
      const unitPrice = 120 + Math.round(rand() * 280);
      const grossAmount = qty * unitPrice;
      const tax = Math.round(grossAmount * 0.05);

      salesRows.push({
        transactionId: nextId("TXG"),
        transactionDate: addDays(new Date("2026-04-15"), Math.floor(rand() * 11)),
        storeCode,
        vertical: Vertical.GROCERY,
        storeFormat: store.storeFormat,
        employeeId: employeeIds.length ? employeeIds[Math.floor(rand() * employeeIds.length)] : null,
        department: "GROCERY",
        articleCode: article[1],
        productFamilyCode: null,
        brand: article[0],
        quantity: qty,
        grossAmount,
        taxAmount: tax,
        totalAmount: grossAmount + tax,
        transactionType: TransactionType.NORMAL,
        channel: Channel.OFFLINE,
      });

      cumSales += grossAmount;
      txCount++;
    }
  }

  // Also generate some non-campaign sales for the other 2 grocery stores
  for (const storeCode of ["GR04", "GR05"]) {
    const store = stores.find((s) => s.storeCode === storeCode)!;
    const employeeIds = saByStore.get(storeCode) ?? [];
    for (let i = 0; i < 120; i++) {
      const qty = 1 + Math.floor(rand() * 3);
      const unitPrice = 80 + Math.round(rand() * 350);
      const grossAmount = qty * unitPrice;
      const tax = Math.round(grossAmount * 0.05);
      salesRows.push({
        transactionId: nextId("TXG"),
        transactionDate: addDays(new Date("2026-04-01"), Math.floor(rand() * 30)),
        storeCode,
        vertical: Vertical.GROCERY,
        storeFormat: store.storeFormat,
        employeeId: employeeIds.length ? employeeIds[Math.floor(rand() * employeeIds.length)] : null,
        department: "GROCERY",
        articleCode: `GEN${Math.floor(100000 + rand() * 899999)}`,
        productFamilyCode: null,
        brand: ["Amul", "Parle", "Britannia", "Haldirams"][Math.floor(rand() * 4)],
        quantity: qty,
        grossAmount,
        taxAmount: tax,
        totalAmount: grossAmount + tax,
        transactionType: TransactionType.NORMAL,
        channel: Channel.OFFLINE,
      });
    }
  }

  // ── 6c. F&L — weekly target-driven sales ──────────────────────────────────

  for (const store of stores.filter((s) => s.vertical === Vertical.FNL)) {
    const weeks = fnlWeeklyPlans[store.storeCode];
    if (!weeks) continue;
    const employeeIds = saByStore.get(store.storeCode) ?? [];

    for (const w of weeks) {
      const weekDays = 7;
      let cumSales = 0;
      let txCount = 0;

      while (cumSales < w.desiredSales && txCount < 600) {
        const qty = 1 + Math.floor(rand() * 2);
        const unitPrice = 800 + Math.round(rand() * 4200);
        const grossAmount = qty * unitPrice;
        const tax = Math.round(grossAmount * 0.12);

        // Distribute transactions across the week days
        const dayOffset = Math.floor(rand() * weekDays);
        const txDate = addDays(w.start, dayOffset);

        // ~10% ONLINE (excluded from incentive since F&L engine doesn't filter channel,
        // but realistic for reporting)
        const channel = rand() > 0.90 ? Channel.ONLINE : Channel.OFFLINE;

        salesRows.push({
          transactionId: nextId("TXF"),
          transactionDate: txDate,
          storeCode: store.storeCode,
          vertical: Vertical.FNL,
          storeFormat: store.storeFormat,
          employeeId: employeeIds.length ? employeeIds[Math.floor(rand() * employeeIds.length)] : null,
          department: "APPAREL",
          articleCode: `FNL${Math.floor(100000 + rand() * 899999)}`,
          productFamilyCode: "FNL01",
          brand: ["Netplay", "Avaasa", "DNMX", "Rio", "Performax"][Math.floor(rand() * 5)],
          quantity: qty,
          grossAmount,
          taxAmount: tax,
          totalAmount: grossAmount + tax,
          transactionType: TransactionType.NORMAL,
          channel,
        });

        cumSales += grossAmount;
        txCount++;
      }
    }
  }

  await prisma.salesTransaction.createMany({ data: salesRows, skipDuplicates: true });

  // ── Summary ───────────────────────────────────────────────────────────────

  const elecStores = stores.filter((s) => s.vertical === Vertical.ELECTRONICS);
  const grocStores = stores.filter((s) => s.vertical === Vertical.GROCERY);
  const fnlStores = stores.filter((s) => s.vertical === Vertical.FNL);
  const elecTxns = salesRows.filter((r) => r.vertical === Vertical.ELECTRONICS).length;
  const grocTxns = salesRows.filter((r) => r.vertical === Vertical.GROCERY).length;
  const fnlTxns = salesRows.filter((r) => r.vertical === Vertical.FNL).length;

  console.log(`Seed complete:`);
  console.log(`  Stores: ${stores.length} (${elecStores.length} elec, ${grocStores.length} groc, ${fnlStores.length} F&L)`);
  console.log(`  Employees: ${employeeRows.length}`);
  console.log(`  Sales: ${salesRows.length} (${elecTxns} elec, ${grocTxns} groc, ${fnlTxns} F&L)`);
  console.log(`  Targets: ${targetRows.length}`);
  console.log(`  Attendance: ${attendanceRows.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
