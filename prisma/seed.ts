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
// Apr 14 = Ambedkar Jayanti (HOLIDAY for all employees)
//
// Store outcomes per requirements:
//   FL01 — exceeds ALL 4 weeks (happy-path, 1SM+1DM+8SA, 60/24/16 split)
//   FL02 — alternating: exceeds W1, misses W2, exceeds W3, misses W4 (single-MOD, 70/30 split)
//   FL03 — exceeds W1-W3, misses W4 (3-DM store, 60/12/9.2% split)
//   FL04 — misses W1 by exactly 0.1%, exceeds W2 by exactly 0.1%, then comfortably W3-W4 (edge-case store)
//   FL05 — exceeds W1-W2, CLOSED W3 (0 sales → ₹0), exceeds W4

type FnlWeekPlan = { start: Date; end: Date; target: number; desiredSales: number };

const fnlWeeklyPlans: Record<string, FnlWeekPlan[]> = {
  "FL01": [ // Trends Indiranagar — all 4 weeks qualify
    { start: new Date("2026-04-05"), end: new Date("2026-04-11"), target:  900_000, desiredSales:   980_000 }, // +8.9%
    { start: new Date("2026-04-12"), end: new Date("2026-04-18"), target: 1_000_000, desiredSales: 1_100_000 }, // +10%
    { start: new Date("2026-04-19"), end: new Date("2026-04-25"), target: 1_200_000, desiredSales: 1_350_000 }, // +12.5%
    { start: new Date("2026-04-26"), end: new Date("2026-05-02"), target: 1_000_000, desiredSales: 1_080_000 }, // +8%
  ],
  "FL02": [ // TST Whitefield — alternating qualify/miss
    { start: new Date("2026-04-05"), end: new Date("2026-04-11"), target:   800_000, desiredSales:   900_000 }, // +12.5% EXCEEDS
    { start: new Date("2026-04-12"), end: new Date("2026-04-18"), target:   950_000, desiredSales:   900_000 }, // −5.3%  MISSES
    { start: new Date("2026-04-19"), end: new Date("2026-04-25"), target: 1_050_000, desiredSales: 1_150_000 }, // +9.5%  EXCEEDS
    { start: new Date("2026-04-26"), end: new Date("2026-05-02"), target:   900_000, desiredSales:   850_000 }, // −5.6%  MISSES
  ],
  "FL03": [ // Trends Andheri — W1-W3 qualify, W4 misses
    { start: new Date("2026-04-05"), end: new Date("2026-04-11"), target: 1_000_000, desiredSales: 1_100_000 }, // +10%
    { start: new Date("2026-04-12"), end: new Date("2026-04-18"), target: 1_150_000, desiredSales: 1_250_000 }, // +8.7%
    { start: new Date("2026-04-19"), end: new Date("2026-04-25"), target: 1_300_000, desiredSales: 1_420_000 }, // +9.2%
    { start: new Date("2026-04-26"), end: new Date("2026-05-02"), target: 1_100_000, desiredSales: 1_050_000 }, // −4.5% MISSES
  ],
  "FL04": [ // Trends HSR — edge cases: 0.1% miss, 0.1% hit, then comfortable
    { start: new Date("2026-04-05"), end: new Date("2026-04-11"), target: 1_000_000, desiredSales:   999_000 }, // 99.9%  MISSES by 0.1%
    { start: new Date("2026-04-12"), end: new Date("2026-04-18"), target: 1_000_000, desiredSales: 1_001_000 }, // 100.1% EXCEEDS by 0.1%
    { start: new Date("2026-04-19"), end: new Date("2026-04-25"), target: 1_100_000, desiredSales: 1_250_000 }, // +13.6%
    { start: new Date("2026-04-26"), end: new Date("2026-05-02"), target: 1_000_000, desiredSales: 1_150_000 }, // +15%
  ],
  "FL05": [ // TST Pune — W3 CLOSED (0 sales), rest qualify
    { start: new Date("2026-04-05"), end: new Date("2026-04-11"), target:   850_000, desiredSales:   960_000 }, // +12.9%
    { start: new Date("2026-04-12"), end: new Date("2026-04-18"), target: 1_000_000, desiredSales: 1_100_000 }, // +10%
    { start: new Date("2026-04-19"), end: new Date("2026-04-25"), target: 1_100_000, desiredSales:         0 }, // CLOSED → 0 sales → ₹0
    { start: new Date("2026-04-26"), end: new Date("2026-05-02"), target:   900_000, desiredSales: 1_000_000 }, // +11.1%
  ],
};

// ─── F&L: explicit employee definitions ─────────────────────────────────────
// Non-FNL stores continue to use the generic employee loop (E001-E170).
// FNL stores use these explicit definitions (E171-E220) so that every edge-case
// scenario is precisely controlled: correct role counts, payroll statuses, join
// and exit dates.
//
// Store configs (drives fnlRoleSplit lookup):
//   FL01: 1 SM + 1 DM + 8 SA + 1 BA  → split [1,1] = 60%/24%/16%
//   FL02: 1 SM + 0 DM + 5 SA + 1 NP-SA + 1 mid-joiner-SA → split [1,0] = 70%/30%
//   FL03: 1 SM + 3 DM + 10 SA + 1 DA-SA + 1 LLU-SA → split [1,3] = 60%/12%/9.2%
//   FL04: 1 SM + 2 DM + 6 SA  → split [1,2] = 60%/16%/12%
//   FL05: 1 SM + 1 DM + 4 SA  → split [1,1] = 60%/24%/16%

type FnlEmpDef = {
  employeeId: string;
  employeeName: string;
  role: EmployeeRole;
  storeCode: string;
  payrollStatus: PayrollStatus;
  dateOfJoining: Date;
  dateOfExit: Date | null;
  attendanceScenario: string; // for controlled attendance generation
};

const fnlEmployeeDefs: FnlEmpDef[] = [
  // ── FL01: Trends Indiranagar (1SM + 1DM + 8SA + 1BA = 11) ─────────────────
  // Happy-path store. E178 is the "threshold & disqualification" test SA.
  // E181 is Brand Associate — role never eligible for FNL incentives.
  { employeeId: "E171", employeeName: "Arjun Bengaluru",  role: EmployeeRole.SM, storeCode: "FL01", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E172", employeeName: "Priya Bengaluru",  role: EmployeeRole.DM, storeCode: "FL01", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E173", employeeName: "Rahul Bengaluru",  role: EmployeeRole.SA, storeCode: "FL01", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E174", employeeName: "Neha Bengaluru",   role: EmployeeRole.SA, storeCode: "FL01", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E175", employeeName: "Dev Bengaluru",    role: EmployeeRole.SA, storeCode: "FL01", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E176", employeeName: "Sneha Bengaluru",  role: EmployeeRole.SA, storeCode: "FL01", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E177", employeeName: "Karan Bengaluru",  role: EmployeeRole.SA, storeCode: "FL01", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  // E178: W1 = 5P+1ABSENT+1WO → 5 PRESENT days → ELIGIBLE (meets >=5 threshold)
  //        W2 = 5P+1HOLIDAY+1WO → 5 PRESENT days → ELIGIBLE
  { employeeId: "E178", employeeName: "Ishita Bengaluru", role: EmployeeRole.SA, storeCode: "FL01", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "THRESHOLD_TEST" },
  { employeeId: "E179", employeeName: "Rohan Bengaluru",  role: EmployeeRole.SA, storeCode: "FL01", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E180", employeeName: "Diya Bengaluru",   role: EmployeeRole.SA, storeCode: "FL01", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  // E181: Brand Associate — role=BA, never eligible for FNL payout regardless of attendance
  { employeeId: "E181", employeeName: "Meera Bengaluru",  role: EmployeeRole.BA, storeCode: "FL01", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },

  // ── FL02: TST Whitefield (1SM + 5SA + 1NP-SA + 1 mid-joiner-SA = 8, 0 DMs) ─
  // 0 DMs → triggers 70% SA / 30% SM single-MOD split.
  // E188: NOTICE_PERIOD SA — perfect attendance every week, but payroll status blocks payout.
  // E189: mid-period joiner (joined Week 2 = Apr 12) — ineligible W1, eligible W2+.
  { employeeId: "E182", employeeName: "Aarav Bengaluru",  role: EmployeeRole.SM, storeCode: "FL02", payrollStatus: PayrollStatus.ACTIVE,        dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E183", employeeName: "Vivaan Bengaluru", role: EmployeeRole.SA, storeCode: "FL02", payrollStatus: PayrollStatus.ACTIVE,        dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E184", employeeName: "Aditya Bengaluru", role: EmployeeRole.SA, storeCode: "FL02", payrollStatus: PayrollStatus.ACTIVE,        dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E185", employeeName: "Saanvi Bengaluru", role: EmployeeRole.SA, storeCode: "FL02", payrollStatus: PayrollStatus.ACTIVE,        dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E186", employeeName: "Ananya Bengaluru", role: EmployeeRole.SA, storeCode: "FL02", payrollStatus: PayrollStatus.ACTIVE,        dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E187", employeeName: "Diya Bengaluru",   role: EmployeeRole.SA, storeCode: "FL02", payrollStatus: PayrollStatus.ACTIVE,        dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  // E188: NOTICE_PERIOD — in engine's activeEmployees (counts for split denominator)
  //   but NOT in disbursableEmployees → ₹0 regardless of attendance
  { employeeId: "E188", employeeName: "Rohan Bengaluru",  role: EmployeeRole.SA, storeCode: "FL02", payrollStatus: PayrollStatus.NOTICE_PERIOD, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  // E189: joined 2026-04-12 (first day of Week 2) → engine excludes from W1 (dateOfJoining > periodEnd)
  //   W2+: standard attendance, ACTIVE → eligible when store qualifies
  { employeeId: "E189", employeeName: "Karan Bengaluru",  role: EmployeeRole.SA, storeCode: "FL02", payrollStatus: PayrollStatus.ACTIVE,        dateOfJoining: new Date("2026-04-12"), dateOfExit: null, attendanceScenario: "MID_PERIOD_JOINER" },

  // ── FL03: Trends Andheri (1SM + 3DM + 10SA + 1DA-SA + 1LLU-SA = 16) ────────
  // 3 DMs → split [1,3] = 60%/12%/9.2% per DM.
  // E202: 5P+1LA+1WO in W3 → 5 PRESENT days → ELIGIBLE (leave doesn't disqualify if >=5 present).
  // E203: exits mid-W3 (Apr 21) — only 2 PRESENT days in W3 → ineligible W3; excluded W4.
  // E204: DISCIPLINARY_ACTION — counted in activeEmployees for split math but NOT disbursable.
  // E205: LONG_LEAVE_UNAUTHORISED — completely excluded from activeEmployees (not even counted).
  { employeeId: "E190", employeeName: "Vivaan Mumbai",  role: EmployeeRole.SM, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "STANDARD" },
  { employeeId: "E191", employeeName: "Aditya Mumbai",  role: EmployeeRole.DM, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "STANDARD" },
  { employeeId: "E192", employeeName: "Saanvi Mumbai",  role: EmployeeRole.DM, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "STANDARD" },
  { employeeId: "E193", employeeName: "Ananya Mumbai",  role: EmployeeRole.DM, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "STANDARD" },
  { employeeId: "E194", employeeName: "Rahul Mumbai",   role: EmployeeRole.SA, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "STANDARD" },
  { employeeId: "E195", employeeName: "Nitin Mumbai",   role: EmployeeRole.SA, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "STANDARD" },
  { employeeId: "E196", employeeName: "Priya Mumbai",   role: EmployeeRole.SA, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "STANDARD" },
  { employeeId: "E197", employeeName: "Ayesha Mumbai",  role: EmployeeRole.SA, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "STANDARD" },
  { employeeId: "E198", employeeName: "Sneha Mumbai",   role: EmployeeRole.SA, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "STANDARD" },
  { employeeId: "E199", employeeName: "Dev Mumbai",     role: EmployeeRole.SA, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "STANDARD" },
  { employeeId: "E200", employeeName: "Om Mumbai",      role: EmployeeRole.SA, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "STANDARD" },
  { employeeId: "E201", employeeName: "Arjun Mumbai",   role: EmployeeRole.SA, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "STANDARD" },
  // E202: W3 = 5P+1WO+1LEAVE_APPROVED → 5 PRESENT days → eligible W3
  { employeeId: "E202", employeeName: "Ritika Mumbai",  role: EmployeeRole.SA, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "LEAVE_APPROVED_TRAP" },
  // E203: exits 2026-04-21 (W3). Engine excludes from W4. W3 attendance = 2P → ineligible W3.
  { employeeId: "E203", employeeName: "Neha Mumbai",    role: EmployeeRole.SA, storeCode: "FL03", payrollStatus: PayrollStatus.ACTIVE,                  dateOfJoining: new Date("2023-01-01"), dateOfExit: new Date("2026-04-21"), attendanceScenario: "EXITS_WEEK3" },
  // E204: DISCIPLINARY_ACTION — in activeEmployees (contributes to SA denomination) but not disbursable
  { employeeId: "E204", employeeName: "Aarav Mumbai",   role: EmployeeRole.SA, storeCode: "FL03", payrollStatus: PayrollStatus.DISCIPLINARY_ACTION,     dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "STANDARD" },
  // E205: LONG_LEAVE_UNAUTHORISED — completely excluded from activeEmployees (doesn't count toward split)
  { employeeId: "E205", employeeName: "Meera Mumbai",   role: EmployeeRole.SA, storeCode: "FL03", payrollStatus: PayrollStatus.LONG_LEAVE_UNAUTHORISED,  dateOfJoining: new Date("2023-01-01"), dateOfExit: null,                  attendanceScenario: "LONG_LEAVE" },

  // ── FL04: Trends HSR (1SM + 2DM + 6SA = 9) ──────────────────────────────────
  // 2 DMs → split [1,2] = 60%/16%/12%.
  // E214: perfect W1-W3. W4: 5P+1LEAVE_UNAPPROVED+1WO → 5 PRESENT days → still eligible W4.
  { employeeId: "E206", employeeName: "Om Bengaluru",     role: EmployeeRole.SM, storeCode: "FL04", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E207", employeeName: "Arjun Bengaluru",  role: EmployeeRole.DM, storeCode: "FL04", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E208", employeeName: "Ritika Bengaluru", role: EmployeeRole.DM, storeCode: "FL04", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E209", employeeName: "Aarav Bengaluru",  role: EmployeeRole.SA, storeCode: "FL04", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E210", employeeName: "Vivaan Bengaluru", role: EmployeeRole.SA, storeCode: "FL04", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E211", employeeName: "Aditya Bengaluru", role: EmployeeRole.SA, storeCode: "FL04", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E212", employeeName: "Saanvi Bengaluru", role: EmployeeRole.SA, storeCode: "FL04", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  { employeeId: "E213", employeeName: "Ananya Bengaluru", role: EmployeeRole.SA, storeCode: "FL04", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "STANDARD" },
  // E214: W1-W3 standard (eligible). W4: 5P+1LEAVE_UNAPPROVED+1WO → 5P → still eligible.
  { employeeId: "E214", employeeName: "Diya Bengaluru",   role: EmployeeRole.SA, storeCode: "FL04", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "LATE_DISQUALIFICATION" },

  // ── FL05: TST Pune (1SM + 1DM + 4SA = 6) ─────────────────────────────────────
  // W3 = TEMPORARILY_CLOSED → 0 sales generated → actual < target → ₹0 for all.
  // Attendance W3: all WEEK_OFF (store closed, no customers).
  { employeeId: "E215", employeeName: "Rahul Pune",  role: EmployeeRole.SM, storeCode: "FL05", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "FL05_CLOSED_W3" },
  { employeeId: "E216", employeeName: "Nitin Pune",  role: EmployeeRole.DM, storeCode: "FL05", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "FL05_CLOSED_W3" },
  { employeeId: "E217", employeeName: "Priya Pune",  role: EmployeeRole.SA, storeCode: "FL05", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "FL05_CLOSED_W3" },
  { employeeId: "E218", employeeName: "Ayesha Pune", role: EmployeeRole.SA, storeCode: "FL05", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "FL05_CLOSED_W3" },
  { employeeId: "E219", employeeName: "Sneha Pune",  role: EmployeeRole.SA, storeCode: "FL05", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "FL05_CLOSED_W3" },
  { employeeId: "E220", employeeName: "Dev Pune",    role: EmployeeRole.SA, storeCode: "FL05", payrollStatus: PayrollStatus.ACTIVE, dateOfJoining: new Date("2023-01-01"), dateOfExit: null, attendanceScenario: "FL05_CLOSED_W3" },
];

// ─── F&L: per-employee daily attendance generator ───────────────────────────
// Generates records for Apr 1 – May 2 2026 (32 days) respecting each scenario.
//
// Standard pattern (Sun = WEEK_OFF, Apr 14 = HOLIDAY, all other days = PRESENT):
//   W1 Apr 5-11:  6P + 1WO
//   W2 Apr 12-18: 5P + 1H  + 1WO  ← Apr 14 holiday keeps this at exactly 5P
//   W3 Apr 19-25: 6P + 1WO
//   W4 Apr 26-May 2: 6P + 1WO

function generateFnlAttendance(
  emp: FnlEmpDef
): Array<{ employeeId: string; storeCode: string; date: Date; status: AttendanceStatus }> {
  const rows: Array<{ employeeId: string; storeCode: string; date: Date; status: AttendanceStatus }> = [];

  const APR_1  = new Date("2026-04-01");
  const APR_14 = new Date("2026-04-14"); // Ambedkar Jayanti — HOLIDAY for all

  for (let day = 0; day < 32; day++) { // Apr 1 – May 2
    const date = addDays(APR_1, day);
    const dateStr = date.toISOString().slice(0, 10);

    // Mid-period joiner: skip days before their joining date
    if (date < emp.dateOfJoining) continue;
    // Exited employee: skip days after exit date
    if (emp.dateOfExit && date > emp.dateOfExit) continue;

    const weekday = date.getUTCDay(); // 0=Sun, 6=Sat
    let status: AttendanceStatus;

    switch (emp.attendanceScenario) {

      case "LONG_LEAVE":
        // Employee on long unauthorised leave — all days LEAVE_UNAPPROVED
        status = AttendanceStatus.LEAVE_UNAPPROVED;
        break;

      case "FL05_CLOSED_W3":
        // Week 3 (Apr 19-25): store TEMPORARILY_CLOSED → WEEK_OFF all days
        if (dateStr >= "2026-04-19" && dateStr <= "2026-04-25") {
          status = AttendanceStatus.WEEK_OFF;
        } else {
          status = standardStatus(weekday, date, APR_14);
        }
        break;

      case "THRESHOLD_TEST": {
        // E178 (FL01):
        //   W1 (Apr 5-11): Apr 10 (Fri) = ABSENT → 5P+1A+1WO → ABSENT disqualifies
        //   All other weeks: standard (W2 gives exactly 5P+1H+1WO = eligible at minimum)
        if (dateStr === "2026-04-10") {
          status = AttendanceStatus.ABSENT;
        } else {
          status = standardStatus(weekday, date, APR_14);
        }
        break;
      }

      case "LEAVE_APPROVED_TRAP": {
        // E202 (FL03):
        //   W3 (Apr 19-25): Apr 25 (Sat) = LEAVE_APPROVED → 5P+1WO+1LA → LA disqualifies
        //   All other weeks: standard
        if (dateStr === "2026-04-25") {
          status = AttendanceStatus.LEAVE_APPROVED;
        } else {
          status = standardStatus(weekday, date, APR_14);
        }
        break;
      }

      case "EXITS_WEEK3": {
        // E203 (FL03): exits 2026-04-21. Days Apr 19(Sun)=WO, Apr 20(P), Apr 21(P).
        // No records after Apr 21 (handled by dateOfExit check above).
        status = standardStatus(weekday, date, APR_14);
        break;
      }

      case "LATE_DISQUALIFICATION": {
        // E214 (FL04):
        //   W4 (Apr 26-May 2): Apr 29 (Wed) = LEAVE_UNAPPROVED → 5P+1LU+1WO → LU disqualifies
        //   W1-W3: standard
        if (dateStr === "2026-04-29") {
          status = AttendanceStatus.LEAVE_UNAPPROVED;
        } else {
          status = standardStatus(weekday, date, APR_14);
        }
        break;
      }

      case "MID_PERIOD_JOINER":
        // E189 (FL02): joined Apr 12 (W2 start).
        // Days before Apr 12 are skipped above via dateOfJoining guard.
        status = standardStatus(weekday, date, APR_14);
        break;

      case "STANDARD":
      default:
        status = standardStatus(weekday, date, APR_14);
        break;
    }

    rows.push({ employeeId: emp.employeeId, storeCode: emp.storeCode, date, status });
  }

  return rows;
}

function standardStatus(weekday: number, date: Date, holiday: Date): AttendanceStatus {
  if (date.getTime() === holiday.getTime()) return AttendanceStatus.HOLIDAY;
  if (weekday === 0) return AttendanceStatus.WEEK_OFF; // Sunday
  return AttendanceStatus.PRESENT;
}

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
    // FNL stores use explicit employee definitions (fnlEmployeeDefs) — skip here
    if (store.vertical === Vertical.FNL) continue;

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

  // FNL employees: explicit definitions (E171-E220) with all edge-case scenarios
  // Non-FNL loop generated E001-E170 (10 stores × 17 employees)
  for (const emp of fnlEmployeeDefs) {
    employeeRows.push({
      employeeId: emp.employeeId,
      employeeName: emp.employeeName,
      role: emp.role,
      storeCode: emp.storeCode,
      department: null, // FNL has no department dimension
      payrollStatus: emp.payrollStatus,
      dateOfJoining: emp.dateOfJoining,
      dateOfExit: emp.dateOfExit,
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

  // ── 2a. Admin console seed users ─────────────────────────────────────────
  //
  // Explicit, named accounts that can sign into the admin web app. Unlike the
  // bulk E001–E220 employees above (which get autogenerated passwords via
  // `generateDemoPassword`), these have memorable IDs + passwords so the
  // product/ops team can demo the console without looking up credentials.
  //
  // `verticals: []` in EmployeeAdminAccess = super-admin (no vertical filter).
  // Granular flags gate each mutation; see `src/lib/permissions.ts`.
  //
  // Parking all of them at an Electronics store is deliberate: these are
  // "HQ staff" conceptually, but EmployeeMaster requires a storeCode FK.
  const adminSeedStore = "4502"; // Koramangala, Bengaluru (Electronics)
  const adminSeedUsers: Array<{
    employeeId: string;
    employeeName: string;
    password: string;
    role: EmployeeRole;
    department: string | null;
    access: {
      verticals: Vertical[];
      canViewAll: boolean;
      canEditIncentives: boolean;
      canSubmitApproval: boolean;
      canApprove: boolean;
      canManageUsers: boolean;
      canUploadData: boolean;
    };
  }> = [
    {
      employeeId: "Anuj",
      employeeName: "Anuj Saxena",
      password: "password",
      role: EmployeeRole.SM,
      department: null,
      // Super-admin: verticals=[] means no vertical filter; every flag on.
      access: {
        verticals: [],
        canViewAll: true,
        canEditIncentives: true,
        canSubmitApproval: true,
        canApprove: true,
        canManageUsers: true,
        canUploadData: true,
      },
    },
    {
      employeeId: "Priya",
      employeeName: "Priya Ramesh",
      password: "password",
      role: EmployeeRole.SM,
      department: null,
      // Electronics vertical head — can edit plans & approve, but can't
      // manage other admins.
      access: {
        verticals: [Vertical.ELECTRONICS],
        canViewAll: true,
        canEditIncentives: true,
        canSubmitApproval: true,
        canApprove: true,
        canManageUsers: false,
        canUploadData: true,
      },
    },
    {
      employeeId: "Rahul",
      employeeName: "Rahul Kumar",
      password: "password",
      role: EmployeeRole.SM,
      department: null,
      // Grocery vertical head — same shape as Priya, different vertical.
      access: {
        verticals: [Vertical.GROCERY],
        canViewAll: true,
        canEditIncentives: true,
        canSubmitApproval: true,
        canApprove: true,
        canManageUsers: false,
        canUploadData: true,
      },
    },
    {
      employeeId: "Meera",
      employeeName: "Meera Nair",
      password: "password",
      role: EmployeeRole.DM,
      department: null,
      // F&L ops — upload attendance + view data, but cannot change plan
      // config or approve.
      access: {
        verticals: [Vertical.FNL],
        canViewAll: true,
        canEditIncentives: false,
        canSubmitApproval: false,
        canApprove: false,
        canManageUsers: false,
        canUploadData: true,
      },
    },
    {
      employeeId: "Vikram",
      employeeName: "Vikram Shah",
      password: "password",
      role: EmployeeRole.DM,
      department: null,
      // Read-only viewer across all verticals — for finance/audit personas.
      access: {
        verticals: [],
        canViewAll: true,
        canEditIncentives: false,
        canSubmitApproval: false,
        canApprove: false,
        canManageUsers: false,
        canUploadData: false,
      },
    },
    // ── Approver-only personas ───────────────────────────────────────────
    // Maker-checker split: these accounts can APPROVE but not edit/submit.
    // Priya/Rahul (above) are makers for their verticals; these are the
    // corresponding checkers. One cross-vertical approver + three
    // vertical-scoped approvers.
    {
      employeeId: "ApproverAll",
      employeeName: "Anita Desai",
      password: "password",
      role: EmployeeRole.SM,
      department: null,
      // Cross-vertical approver (e.g. CHRO / finance controller).
      access: {
        verticals: [],
        canViewAll: true,
        canEditIncentives: false,
        canSubmitApproval: false,
        canApprove: true,
        canManageUsers: false,
        canUploadData: false,
      },
    },
    {
      employeeId: "ApproverElec",
      employeeName: "Suresh Iyer",
      password: "password",
      role: EmployeeRole.SM,
      department: null,
      access: {
        verticals: [Vertical.ELECTRONICS],
        canViewAll: true,
        canEditIncentives: false,
        canSubmitApproval: false,
        canApprove: true,
        canManageUsers: false,
        canUploadData: false,
      },
    },
    {
      employeeId: "ApproverGroc",
      employeeName: "Deepa Menon",
      password: "password",
      role: EmployeeRole.SM,
      department: null,
      access: {
        verticals: [Vertical.GROCERY],
        canViewAll: true,
        canEditIncentives: false,
        canSubmitApproval: false,
        canApprove: true,
        canManageUsers: false,
        canUploadData: false,
      },
    },
    {
      employeeId: "ApproverFnl",
      employeeName: "Arjun Pillai",
      password: "password",
      role: EmployeeRole.SM,
      department: null,
      access: {
        verticals: [Vertical.FNL],
        canViewAll: true,
        canEditIncentives: false,
        canSubmitApproval: false,
        canApprove: true,
        canManageUsers: false,
        canUploadData: false,
      },
    },
  ];

  for (const admin of adminSeedUsers) {
    await prisma.employeeMaster.create({
      data: {
        employeeId: admin.employeeId,
        employeeName: admin.employeeName,
        role: admin.role,
        storeCode: adminSeedStore,
        department: admin.department,
        payrollStatus: PayrollStatus.ACTIVE,
        dateOfJoining: new Date("2023-01-01"),
        dateOfExit: null,
        hasAdminAccess: true,
      },
    });
    await prisma.userCredential.create({
      data: {
        employerId: admin.employeeId,
        employeeId: admin.employeeId,
        password: await bcrypt.hash(admin.password, 10),
        isActive: true,
      },
    });
    await prisma.employeeAdminAccess.create({
      data: {
        employeeId: admin.employeeId,
        verticals: admin.access.verticals,
        canViewAll: admin.access.canViewAll,
        canEditIncentives: admin.access.canEditIncentives,
        canSubmitApproval: admin.access.canSubmitApproval,
        canApprove: admin.access.canApprove,
        canManageUsers: admin.access.canManageUsers,
        canUploadData: admin.access.canUploadData,
        grantedBy: "seed",
      },
    });
  }

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

  // ── 4b. Audit log for FL04 Week 1 target — full maker-checker lifecycle ──────
  // Scenario: maker submits a target that checker rejects ("Target seems too low"),
  // maker revises and resubmits, checker approves on second pass.
  // Flow: CREATED → SUBMITTED → REJECTED → CREATED (re-draft) → SUBMITTED → APPROVED
  const fl04W1Target = await prisma.target.findFirst({
    where: {
      storeCode: "FL04",
      vertical: Vertical.FNL,
      periodStart: new Date("2026-04-05"),
    },
  });
  if (fl04W1Target) {
    const auditBase = { entityType: "TARGET" as const, entityId: fl04W1Target.id };
    await prisma.auditLog.createMany({
      data: [
        {
          ...auditBase,
          action: "CREATED",
          oldValue: undefined,
          newValue: { status: "DRAFT", targetValue: 950_000, note: "Initial draft — first estimate" },
          performedBy: "maker_user",
          performedAt: new Date("2026-03-28T09:00:00Z"),
        },
        {
          ...auditBase,
          action: "SUBMITTED",
          oldValue: { status: "DRAFT" },
          newValue: { status: "SUBMITTED", targetValue: 950_000 },
          performedBy: "maker_user",
          performedAt: new Date("2026-03-28T09:30:00Z"),
        },
        {
          ...auditBase,
          action: "REJECTED",
          oldValue: { status: "SUBMITTED" },
          newValue: {
            status: "REJECTED",
            rejectionReason: "Target seems too low for historical performance — HSR W1 last year was ₹10.2L. Revise upward.",
          },
          performedBy: "checker_user",
          performedAt: new Date("2026-03-29T11:15:00Z"),
        },
        {
          ...auditBase,
          action: "CREATED",
          oldValue: { status: "REJECTED", targetValue: 950_000 },
          newValue: { status: "DRAFT", targetValue: 1_000_000, note: "Revised per checker feedback — raised to ₹10L" },
          performedBy: "maker_user",
          performedAt: new Date("2026-03-30T10:00:00Z"),
        },
        {
          ...auditBase,
          action: "SUBMITTED",
          oldValue: { status: "DRAFT" },
          newValue: { status: "SUBMITTED", targetValue: 1_000_000 },
          performedBy: "maker_user",
          performedAt: new Date("2026-03-30T10:05:00Z"),
        },
        {
          ...auditBase,
          action: "APPROVED",
          oldValue: { status: "SUBMITTED" },
          newValue: { status: "APPROVED", targetValue: 1_000_000, approvedNote: "Looks right. Approved." },
          performedBy: "checker_user",
          performedAt: new Date("2026-03-31T14:00:00Z"),
        },
      ],
    });
  }

  // ── 5. Attendance (F&L only) — deterministic, controlled per scenario ────────
  // Each FNL employee's attendance is generated by generateFnlAttendance() which
  // applies the correct pattern for their attendanceScenario. This ensures all
  // edge cases (threshold, approved-leave trap, late disqualification, etc.) fire
  // exactly as designed. No randomness here — every ineligibility reason is tested.

  const attendanceRows: Prisma.AttendanceCreateManyInput[] = [];

  for (const emp of fnlEmployeeDefs) {
    const empAttendance = generateFnlAttendance(emp);
    for (const row of empAttendance) {
      attendanceRows.push({
        employeeId: row.employeeId,
        storeCode: row.storeCode,
        date: row.date,
        status: row.status,
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

  // ── 6c. F&L — exact-sum weekly sales ─────────────────────────────────────────
  // Each store/week generates exactly `desiredSales` in gross_amount so that
  // achievement percentages match the edge-case design precisely.
  //
  // Structure per week (40 transactions):
  //   1  boundary transaction on Sunday (week start) — tests week-boundary inclusion
  //   1  boundary transaction on Saturday (week end)  — tests week-boundary inclusion
  //   2  unattributed (employeeId = NULL)              — count toward store total
  //   3  channel = ONLINE                              — FNL includes online in total
  //  33  regular attributed OFFLINE transactions
  //   1  "adjustment" final transaction to hit exact desiredSales total
  //
  // FL05 Week 3 (TEMPORARILY_CLOSED): desiredSales = 0 → no transactions generated.

  const fnlBrands = ["Netplay", "Avaasa", "DNMX", "Rio", "Performax", "YouWeCan", "Forca"];
  const fnlSeq = { n: 1 }; // local sequence for FNL transaction IDs

  for (const store of stores.filter((s) => s.vertical === Vertical.FNL)) {
    const weeks = fnlWeeklyPlans[store.storeCode];
    if (!weeks) continue;
    // ACTIVE SAs only for attributed transactions
    const activeSaIds = fnlEmployeeDefs
      .filter((e) => e.storeCode === store.storeCode && e.role === EmployeeRole.SA && e.payrollStatus === PayrollStatus.ACTIVE)
      .map((e) => e.employeeId);

    for (let wi = 0; wi < weeks.length; wi++) {
      const w = weeks[wi];
      if (w.desiredSales === 0) continue; // CLOSED week — no transactions

      const weekLabel = `W${wi + 1}`;
      let cumSales = 0;

      // Helper to push one FNL transaction
      const pushTx = (
        date: Date,
        grossAmount: number,
        empId: string | null,
        ch: typeof Channel.OFFLINE | typeof Channel.ONLINE,
      ) => {
        const tax = Math.round(grossAmount * 0.12);
        salesRows.push({
          transactionId: `TXF-${store.storeCode}-${weekLabel}-${String(fnlSeq.n++).padStart(3, "0")}`,
          transactionDate: date,
          storeCode: store.storeCode,
          vertical: Vertical.FNL,
          storeFormat: store.storeFormat,
          employeeId: empId,
          department: null,
          articleCode: `FNL${Math.floor(100_000 + rand() * 899_999)}`,
          productFamilyCode: null,
          brand: fnlBrands[Math.floor(rand() * fnlBrands.length)],
          quantity: 1 + Math.floor(rand() * 2),
          grossAmount,
          taxAmount: tax,
          totalAmount: grossAmount + tax,
          transactionType: TransactionType.NORMAL,
          channel: ch,
        });
        cumSales += grossAmount;
      };

      const sunday   = w.start;                    // boundary day 1
      const saturday = addDays(w.start, 6);         // boundary day 2 (= w.end)

      // 1. Sunday boundary transaction
      pushTx(sunday, 1_500 + Math.round(rand() * 3_000), activeSaIds[0] ?? null, Channel.OFFLINE);
      // 2. Saturday boundary transaction
      pushTx(saturday, 1_500 + Math.round(rand() * 3_000), activeSaIds[activeSaIds.length - 1] ?? null, Channel.OFFLINE);
      // 3–4. Two unattributed (NULL employee) transactions
      pushTx(addDays(w.start, 2), 2_000 + Math.round(rand() * 4_000), null, Channel.OFFLINE);
      pushTx(addDays(w.start, 4), 2_000 + Math.round(rand() * 4_000), null, Channel.OFFLINE);
      // 5–7. Three ONLINE transactions (FNL engine includes channel=ONLINE in gross total)
      for (let o = 0; o < 3; o++) {
        const dayOff = 1 + Math.floor(rand() * 5);
        pushTx(addDays(w.start, dayOff), 1_800 + Math.round(rand() * 3_500), activeSaIds[o % activeSaIds.length] ?? null, Channel.ONLINE);
      }
      // 8–40. 33 regular attributed OFFLINE transactions
      for (let t = 0; t < 33; t++) {
        const dayOff = Math.floor(rand() * 7);
        const empId  = activeSaIds[Math.floor(rand() * activeSaIds.length)] ?? null;
        const gross  = 1_200 + Math.round(rand() * 5_800);
        pushTx(addDays(w.start, dayOff), gross, empId, Channel.OFFLINE);
      }
      // 41. Adjustment transaction to hit exactly desiredSales
      const remaining = w.desiredSales - cumSales;
      if (remaining > 0) {
        pushTx(addDays(w.start, 3), remaining, activeSaIds[Math.floor(rand() * activeSaIds.length)] ?? null, Channel.OFFLINE);
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

  const fnlAttendanceRows = attendanceRows.length;
  console.log(`Seed complete:`);
  console.log(`  Stores: ${stores.length} (${elecStores.length} elec, ${grocStores.length} groc, ${fnlStores.length} F&L)`);
  console.log(`  Employees: ${employeeRows.length} (${fnlEmployeeDefs.length} FNL with explicit edge-case scenarios)`);
  console.log(`  Sales: ${salesRows.length} (${elecTxns} elec, ${grocTxns} groc, ${fnlTxns} F&L — FNL sums exact)`);
  console.log(`  Targets: ${targetRows.length} (FNL: 20 weekly)`);
  console.log(`  Attendance: ${fnlAttendanceRows} FNL records (deterministic scenarios)`);
  console.log(`  Audit log: FL04 W1 target — 6-entry DRAFT→SUBMITTED→REJECTED→DRAFT→SUBMITTED→APPROVED`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
