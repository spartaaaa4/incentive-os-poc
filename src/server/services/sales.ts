import { endOfDay, startOfDay } from "date-fns";
import { TransactionType, Vertical } from "@prisma/client";
import { db } from "@/lib/db";

type SalesFilters = {
  vertical?: Vertical;
  storeCode?: string;
  employeeId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  transactionType?: TransactionType;
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

const familyCodeToName: Record<string, string> = {
  FF01: "Laptops & Desktops",
  FF03: "Tablets",
  FH07: "Photography",
  FK01: "Wireless Phones",
  FH01: "Home Entertainment TVs",
  FJ03: "Large Appliances",
};

type SlabRow = {
  productFamily: string;
  brandFilter: string;
  priceFrom: unknown;
  priceTo: unknown;
  incentivePerUnit: unknown;
};

let cachedSlabs: SlabRow[] | null = null;

async function getElectronicsSlabs(): Promise<SlabRow[]> {
  if (cachedSlabs) return cachedSlabs;
  const plan = await db.incentivePlan.findFirst({
    where: { vertical: Vertical.ELECTRONICS, status: "ACTIVE" },
    include: { productIncentiveSlabs: true },
  });
  cachedSlabs = plan?.productIncentiveSlabs ?? [];
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
  const familyName = familyCodeToName[familyCode] ?? familyCode;

  const slab = slabs.find(
    (s) =>
      s.productFamily.toLowerCase().includes(familyName.toLowerCase().replace(" & ", " ")) &&
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
  };

  const rows = await db.salesTransaction.findMany({
    where,
    include: {
      store: true,
      employee: true,
    },
    orderBy: { transactionDate: "desc" },
    take: 500,
  });

  const slabs = await getElectronicsSlabs();

  return rows.map((row) => {
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
      incentiveLabel = "Campaign";
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
}
