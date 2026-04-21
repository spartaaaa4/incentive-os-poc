import { endOfDay, startOfDay } from "date-fns";
import { TransactionType, Vertical } from "@prisma/client";
import { db } from "@/lib/db";
import { currentLedgerWhere } from "../calculations/currentLedger";

type SalesFilters = {
  vertical?: Vertical;
  storeCode?: string;
  employeeId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  transactionType?: TransactionType;
  search?: string;
  page?: number;
  pageSize?: number;
};

const excludedTypes = new Set<TransactionType>([
  TransactionType.SFS,
  TransactionType.PAS,
  TransactionType.JIOMART,
]);

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value ?? 0);
}

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
    .map((v) => v.trim())
    .some((token) => normalized.includes(token));
}

const familyCodeToSlabNames: Record<string, string[]> = {
  FF01: ["Laptops & Desktops"], FF03: ["Tablets"],
  FH01: ["Home Entertainment TVs"], FH07: ["Photography"],
  FK01: ["Wireless Phones"],
  FI01: ["SDA & Consumer Appliances"], FI02: ["SDA & Consumer Appliances"],
  FI04: ["SDA & Consumer Appliances"], FI05: ["SDA & Consumer Appliances"],
  FI06: ["SDA & Consumer Appliances"], FI07: ["SDA & Consumer Appliances"],
  FJ01: ["Large Appliances"], FJ02: ["Large Appliances"],
  FJ03: ["Large Appliances", "Large Washing Machines (LWC)"],
  FJ04: ["Large Appliances"], FJ05: ["Large Appliances"],
};

type SlabRow = {
  productFamily: string;
  brandFilter: string;
  priceFrom: unknown;
  priceTo: unknown;
  incentivePerUnit: unknown;
};

// Grocery campaign rate cache: storeCode → { rate, employeeCount }
type GroceryRateInfo = { rate: number; employeeCount: number };
let groceryRateCache: Map<string, GroceryRateInfo> | null = null;
let groceryRateCacheExpiry = 0;

let cachedSlabs: SlabRow[] | null = null;
let slabCacheExpiry = 0;
const SLAB_CACHE_TTL_MS = 60_000;

async function getElectronicsSlabs(): Promise<SlabRow[]> {
  if (cachedSlabs && Date.now() < slabCacheExpiry) return cachedSlabs;
  const plan = await db.incentivePlan.findFirst({
    where: { vertical: Vertical.ELECTRONICS, status: "ACTIVE" },
    include: { productIncentiveSlabs: true },
  });
  cachedSlabs = plan?.productIncentiveSlabs ?? [];
  slabCacheExpiry = Date.now() + SLAB_CACHE_TTL_MS;
  return cachedSlabs;
}

function computePerUnitIncentive(
  slabs: SlabRow[],
  familyCode: string | null,
  brand: string | null,
  grossAmount: number,
  quantity: number,
): number {
  if (!familyCode || !quantity) return 0;
  if (isElectronicsExcluded(brand, familyCode)) return 0;

  const unitPrice = grossAmount / quantity;
  const slabNames = familyCodeToSlabNames[familyCode];
  if (!slabNames) return 0;

  const slab = slabs.find(
    (s) =>
      slabNames.some((name) => s.productFamily === name) &&
      brandMatches(s.brandFilter, brand) &&
      unitPrice >= asNumber(s.priceFrom) &&
      unitPrice <= asNumber(s.priceTo),
  );

  return slab ? asNumber(slab.incentivePerUnit) * quantity : 0;
}

function computeStatus(
  txnType: TransactionType,
  vertical: Vertical,
  incentiveAmount: number,
  brand: string | null,
  familyCode: string | null,
): "Calculated" | "Pending" | "Excluded" {
  if (excludedTypes.has(txnType)) return "Excluded";
  if (vertical === Vertical.ELECTRONICS && isElectronicsExcluded(brand, familyCode)) return "Excluded";
  if (vertical === Vertical.ELECTRONICS) return incentiveAmount > 0 ? "Calculated" : "Pending";
  return "Calculated";
}

export async function listSales(filters: SalesFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 100));
  const skip = (page - 1) * pageSize;

  const where = {
    ...(filters.vertical ? { vertical: filters.vertical } : {}),
    ...(filters.storeCode ? { storeCode: filters.storeCode } : {}),
    ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
    ...(filters.transactionType ? { transactionType: filters.transactionType } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          transactionDate: {
            ...(filters.dateFrom ? { gte: startOfDay(filters.dateFrom) } : {}),
            ...(filters.dateTo ? { lte: endOfDay(filters.dateTo) } : {}),
          },
        }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { transactionId: { contains: filters.search, mode: "insensitive" as const } },
            { employeeId: { contains: filters.search, mode: "insensitive" as const } },
            { articleCode: { contains: filters.search, mode: "insensitive" as const } },
            { storeCode: { contains: filters.search, mode: "insensitive" as const } },
            { employee: { employeeName: { contains: filters.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.salesTransaction.findMany({
      where,
      include: { store: true, employee: true },
      orderBy: [{ transactionDate: "desc" }, { transactionId: "desc" }],
      skip,
      take: pageSize,
    }),
    db.salesTransaction.count({ where }),
  ]);

  const slabs = await getElectronicsSlabs();

  // Build grocery rate cache from ledger calculationDetails (rate & employeeCount per store)
  const hasGrocery = rows.some((r) => r.vertical === Vertical.GROCERY);
  if (hasGrocery && (!groceryRateCache || Date.now() >= groceryRateCacheExpiry)) {
    groceryRateCache = new Map();
    const groceryLedger = await db.incentiveLedger.findMany({
      where: { vertical: Vertical.GROCERY, ...currentLedgerWhere() },
      select: { storeCode: true, calculationDetails: true },
      distinct: ["storeCode"],
      orderBy: { calculatedAt: "desc" },
    });
    for (const row of groceryLedger) {
      const details = row.calculationDetails as Record<string, unknown> | null;
      if (details) {
        groceryRateCache.set(row.storeCode, {
          rate: Number(details.rate) || 0,
          employeeCount: Number(details.employeeCount) || 1,
        });
      }
    }
    groceryRateCacheExpiry = Date.now() + SLAB_CACHE_TTL_MS;
  }

  const mapped = rows.map((row) => {
    const gross = asNumber(row.grossAmount);
    let incentiveAmount = 0;
    let incentiveLabel = "";

    if (row.vertical === Vertical.ELECTRONICS) {
      if (excludedTypes.has(row.transactionType)) {
        incentiveLabel = "Excluded";
      } else {
        incentiveAmount = computePerUnitIncentive(slabs, row.productFamilyCode, row.brand, gross, row.quantity);
        incentiveLabel = incentiveAmount > 0 ? `₹${new Intl.NumberFormat("en-IN").format(incentiveAmount)}` : "—";
      }
    } else if (row.vertical === Vertical.GROCERY) {
      const rateInfo = groceryRateCache?.get(row.storeCode);
      if (rateInfo && rateInfo.rate > 0) {
        // Per-transaction contribution: quantity × rate (store-level), ÷ employeeCount for individual share
        incentiveAmount = Math.round((row.quantity * rateInfo.rate) / rateInfo.employeeCount);
        incentiveLabel = incentiveAmount > 0 ? `₹${new Intl.NumberFormat("en-IN").format(incentiveAmount)}` : "Below target";
      } else {
        incentiveLabel = "Below target";
      }
    } else {
      incentiveLabel = "Weekly Pool";
    }

    return {
      transactionId: row.transactionId,
      transactionDate: row.transactionDate.toISOString().slice(0, 10),
      storeCode: row.storeCode,
      storeName: row.store.storeName,
      vertical: row.vertical,
      employeeId: row.employeeId,
      employeeName: row.employee?.employeeName ?? "—",
      department: row.department ?? "—",
      articleCode: row.articleCode,
      brand: row.brand ?? "—",
      quantity: row.quantity,
      grossAmount: gross,
      taxAmount: asNumber(row.taxAmount),
      totalAmount: asNumber(row.totalAmount),
      transactionType: row.transactionType,
      channel: row.channel,
      calculatedIncentive: incentiveLabel,
      incentiveAmount,
      status: computeStatus(row.transactionType, row.vertical, incentiveAmount, row.brand, row.productFamilyCode),
    };
  });

  return { rows: mapped, total, page, pageSize };
}
