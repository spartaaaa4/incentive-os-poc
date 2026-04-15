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

const stores: StoreSeed[] = [
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

async function main() {
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

  await prisma.storeMaster.createMany({
    data: stores.map((store) => ({
      ...store,
      storeStatus: "ACTIVE",
      operationalSince: new Date("2020-01-01"),
    })),
  });

  const names = ["Aarav", "Vivaan", "Aditya", "Saanvi", "Ananya", "Diya", "Rohan", "Karan", "Ishita", "Meera", "Rahul", "Nitin", "Priya", "Ayesha", "Sneha", "Dev", "Om", "Arjun", "Ritika", "Neha"];
  const employeeRows: Array<{
    employeeId: string;
    employeeName: string;
    role: EmployeeRole;
    storeCode: string;
    department: string | null;
    payrollStatus: PayrollStatus;
    dateOfJoining: Date;
    dateOfExit: Date | null;
  }> = [];

  // Demo-only: spread SAs across departments for seed data.
  // In production, department is set during employee onboarding.
  const elecDeptCycle = ["IT", "ENT", "Telecom", "Large Appliances", "Small Appliances", "AIOT"];

  let employeeCounter = 1;
  for (const store of stores) {
    const roles: EmployeeRole[] = [EmployeeRole.SM, EmployeeRole.DM, EmployeeRole.DM];
    for (let i = 0; i < 12; i++) roles.push(EmployeeRole.SA);
    if (store.vertical === Vertical.ELECTRONICS) {
      roles.push(EmployeeRole.BA, EmployeeRole.BA);
    } else {
      roles.push(EmployeeRole.SA, EmployeeRole.SA);
    }
    roles.forEach((role, index) => {
      const id = `E${String(employeeCounter++).padStart(3, "0")}`;
      // For seed data, assign Electronics SAs/BAs to departments
      let department: string | null = null;
      if (store.vertical === Vertical.ELECTRONICS) {
        if (role === EmployeeRole.SA || role === EmployeeRole.BA) {
          department = elecDeptCycle[index % elecDeptCycle.length];
        }
      }
      employeeRows.push({
        employeeId: id,
        employeeName: `${names[index % names.length]} ${store.city}`,
        role,
        storeCode: store.storeCode,
        department,
        payrollStatus: index % 31 === 0 ? PayrollStatus.NOTICE_PERIOD : PayrollStatus.ACTIVE,
        dateOfJoining: new Date("2023-01-01"),
        dateOfExit: null,
      });
    });
  }
  await prisma.employeeMaster.createMany({ data: employeeRows });
  const credentialData = await Promise.all(
    employeeRows.map(async (employee) => ({
      employerId: employee.employeeId,
      employeeId: employee.employeeId,
      password: await bcrypt.hash(generateDemoPassword(employee.employeeId), 10),
    })),
  );
  await prisma.userCredential.createMany({ data: credentialData });

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

  const electronicsDepartments = [
    ["IT", "FF01", "Laptop"],
    ["IT", "FF03", "Tablet"],
    ["IT", "FF04", "IT Peripheral"],
    ["ENT", "FH01", "High End TV"],
    ["ENT", "FH05", "Audio"],
    ["ENT", "FH07", "Photography"],
    ["Small Appliances", "FI01", "Garment Care"],
    ["Small Appliances", "FI02", "Home Care"],
    ["Small Appliances", "FI05", "Kitchen Care"],
    ["Small Appliances", "FI07", "Personal Care"],
    ["Telecom", "FK01", "Wireless Phone"],
    ["Large Appliances", "FJ01", "Air Care"],
    ["Large Appliances", "FJ02", "Food Preservation"],
    ["Large Appliances", "FJ03", "Laundry & Wash Care"],
    ["AIOT", "FG01", "Personal AV"],
    ["AIOT", "FG03", "Charging Solutions"],
  ];

  const aprilStart = new Date("2026-04-01");
  const aprilEnd = new Date("2026-04-30");
  const weeklySpans = [
    [new Date("2026-04-05"), new Date("2026-04-11"), 900000],
    [new Date("2026-04-12"), new Date("2026-04-18"), 1100000],
    [new Date("2026-04-19"), new Date("2026-04-25"), 1250000],
    [new Date("2026-04-26"), new Date("2026-05-02"), 1000000],
  ] as const;

  const targetRows: Prisma.TargetCreateManyInput[] = [];
  for (const store of stores.filter((item) => item.vertical === Vertical.ELECTRONICS)) {
    for (const dept of electronicsDepartments) {
      targetRows.push({
        storeCode: store.storeCode,
        vertical: Vertical.ELECTRONICS,
        department: dept[0],
        productFamilyCode: dept[1],
        productFamilyName: dept[2],
        targetValue: 600000 + Math.round(Math.random() * 400000),
        periodType: PeriodType.MONTHLY,
        periodStart: aprilStart,
        periodEnd: aprilEnd,
        status: ApprovalStatus.ACTIVE,
        submittedBy: "maker",
        approvedBy: "checker",
      });
    }
  }
  for (const [storeCode, targetValue] of [
    ["2536", 67000],
    ["TGL5", 226000],
    ["T28V", 167000],
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
  for (const store of stores.filter((item) => item.vertical === Vertical.FNL)) {
    for (const [weekStart, weekEnd, base] of weeklySpans) {
      targetRows.push({
        storeCode: store.storeCode,
        vertical: Vertical.FNL,
        department: null,
        productFamilyCode: null,
        productFamilyName: "Weekly Store Target",
        targetValue: base + Math.round(Math.random() * 200000),
        periodType: PeriodType.WEEKLY,
        periodStart: weekStart,
        periodEnd: weekEnd,
        status: ApprovalStatus.ACTIVE,
        submittedBy: "maker",
        approvedBy: "checker",
      });
    }
  }
  await prisma.target.createMany({ data: targetRows });

  const fnlEmployeeRows = employeeRows.filter((employee) =>
    stores.find((store) => store.storeCode === employee.storeCode)?.vertical === Vertical.FNL,
  );
  const attendanceRows: Prisma.AttendanceCreateManyInput[] = [];
  for (const employee of fnlEmployeeRows) {
    const random = rng(employee.employeeId.charCodeAt(1) + employee.employeeId.charCodeAt(2));
    for (let day = 0; day < 30; day++) {
      const date = addDays(new Date("2026-04-01"), day);
      const weekday = date.getUTCDay();
      let status: AttendanceStatus = AttendanceStatus.PRESENT;
      if (weekday === 0 || weekday === 6) {
        status = random() > 0.5 ? AttendanceStatus.WEEK_OFF : AttendanceStatus.HOLIDAY;
      } else if (random() > 0.92) {
        status = random() > 0.5 ? AttendanceStatus.ABSENT : AttendanceStatus.LEAVE_APPROVED;
      }
      attendanceRows.push({
        employeeId: employee.employeeId,
        storeCode: employee.storeCode,
        date,
        status,
      });
    }
  }
  await prisma.attendance.createMany({ data: attendanceRows, skipDuplicates: true });

  const salesRows: Prisma.SalesTransactionCreateManyInput[] = [];
  const random = rng(77);
  const electronicsFamilies = [
    { dept: "Telecom", code: "FK01", articlePrefix: "PH", brands: ["Samsung", "Oppo", "Vivo", "Xiaomi", "Realme", "OnePlus"], min: 8000, max: 54000 },
    { dept: "ENT", code: "FH01", articlePrefix: "TV", brands: ["Sony", "LG", "MI", "OnePlus", "Realme"], min: 18000, max: 85000 },
    { dept: "Large Appliances", code: "FJ01", articlePrefix: "AC", brands: ["Daikin", "Voltas", "LG", "Samsung"], min: 20000, max: 55000 },
    { dept: "Large Appliances", code: "FJ02", articlePrefix: "RF", brands: ["Samsung", "LG", "Whirlpool", "Godrej"], min: 15000, max: 50000 },
    { dept: "Large Appliances", code: "FJ03", articlePrefix: "WM", brands: ["Samsung", "LG", "Whirlpool", "IFB"], min: 12000, max: 50000 },
    { dept: "IT", code: "FF01", articlePrefix: "LP", brands: ["HP", "Dell", "Lenovo", "Apple", "Microsoft Surface"], min: 25000, max: 90000 },
    { dept: "ENT", code: "FH07", articlePrefix: "CM", brands: ["Canon", "Nikon", "Sony"], min: 12000, max: 60000 },
    { dept: "IT", code: "FF03", articlePrefix: "TB", brands: ["Samsung", "Apple", "Lenovo"], min: 9000, max: 45000 },
    { dept: "Small Appliances", code: "FI02", articlePrefix: "HC", brands: ["Philips", "Dyson", "Eureka Forbes"], min: 2000, max: 8000 },
    { dept: "Small Appliances", code: "FI05", articlePrefix: "KC", brands: ["Prestige", "Butterfly", "Philips"], min: 1500, max: 6000 },
  ];

  const employeeByStore = new Map<string, string[]>();
  for (const employee of employeeRows) {
    const list = employeeByStore.get(employee.storeCode) ?? [];
    if (employee.role === EmployeeRole.SA) list.push(employee.employeeId);
    employeeByStore.set(employee.storeCode, list);
  }

  for (const store of stores.filter((item) => item.vertical === Vertical.ELECTRONICS)) {
    const employeeIds = employeeByStore.get(store.storeCode) ?? [];
    for (let i = 0; i < 320; i++) {
      const family = electronicsFamilies[Math.floor(random() * electronicsFamilies.length)];
      const qty = random() > 0.8 ? 2 : 1;
      const unitPrice = Math.round(family.min + random() * (family.max - family.min));
      const grossAmount = unitPrice * qty;
      const tax = Math.round(grossAmount * 0.18);
      const txTypeProb = random();
      let transactionType: TransactionType = TransactionType.NORMAL;
      if (txTypeProb > 0.92) transactionType = TransactionType.SFS;
      if (txTypeProb > 0.95) transactionType = TransactionType.PAS;
      if (txTypeProb > 0.98) transactionType = TransactionType.JIOMART;
      salesRows.push({
        transactionId: nextId("TXE"),
        transactionDate: addDays(aprilStart, Math.floor(random() * 30)),
        storeCode: store.storeCode,
        vertical: Vertical.ELECTRONICS,
        storeFormat: store.storeFormat,
        employeeId: employeeIds[Math.floor(random() * employeeIds.length)] ?? null,
        department: family.dept,
        articleCode: `${family.articlePrefix}${Math.floor(100000 + random() * 899999)}`,
        productFamilyCode: family.code,
        brand: family.brands[Math.floor(random() * family.brands.length)],
        quantity: qty,
        grossAmount,
        taxAmount: tax,
        totalAmount: grossAmount + tax,
        transactionType,
        channel: random() > 0.93 ? Channel.ONLINE : Channel.OFFLINE,
      });
    }
  }

  const groceryStores = ["2536", "TGL5", "T28V"];
  for (const storeCode of groceryStores) {
    const store = stores.find((item) => item.storeCode === storeCode)!;
    const employeeIds = employeeByStore.get(storeCode) ?? [];
    for (let i = 0; i < 180; i++) {
      const article = groceryArticles[Math.floor(random() * groceryArticles.length)];
      const qty = 1 + Math.floor(random() * 3);
      const unitPrice = 120 + Math.round(random() * 280);
      const grossAmount = qty * unitPrice;
      const tax = Math.round(grossAmount * 0.05);
      salesRows.push({
        transactionId: nextId("TXG"),
        transactionDate: addDays(new Date("2026-04-15"), Math.floor(random() * 11)),
        storeCode,
        vertical: Vertical.GROCERY,
        storeFormat: store.storeFormat,
        employeeId: employeeIds[Math.floor(random() * employeeIds.length)] ?? null,
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
    }
  }

  for (const store of stores.filter((item) => item.vertical === Vertical.FNL)) {
    const employeeIds = employeeByStore.get(store.storeCode) ?? [];
    for (let i = 0; i < 240; i++) {
      const qty = 1 + Math.floor(random() * 2);
      const unitPrice = 800 + Math.round(random() * 4200);
      const grossAmount = qty * unitPrice;
      const tax = Math.round(grossAmount * 0.12);
      salesRows.push({
        transactionId: nextId("TXF"),
        transactionDate: addDays(aprilStart, Math.floor(random() * 30)),
        storeCode: store.storeCode,
        vertical: Vertical.FNL,
        storeFormat: store.storeFormat,
        employeeId: employeeIds[Math.floor(random() * employeeIds.length)] ?? null,
        department: "APPAREL",
        articleCode: `FNL${Math.floor(100000 + random() * 899999)}`,
        productFamilyCode: "FNL01",
        brand: ["Netplay", "Avaasa", "DNMX"][Math.floor(random() * 3)],
        quantity: qty,
        grossAmount,
        taxAmount: tax,
        totalAmount: grossAmount + tax,
        transactionType: TransactionType.NORMAL,
        channel: random() > 0.9 ? Channel.ONLINE : Channel.OFFLINE,
      });
    }
  }
  await prisma.salesTransaction.createMany({ data: salesRows, skipDuplicates: true });

  console.log(`Seed complete: ${stores.length} stores, ${employeeRows.length} employees, ${salesRows.length} sales rows.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
