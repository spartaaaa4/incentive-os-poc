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

function computeSalesStatus(txnType: TransactionType, vertical: Vertical): "Calculated" | "Pending" | "Excluded" {
  if (excludedTypes.has(txnType)) return "Excluded";
  if (vertical === Vertical.ELECTRONICS) return "Calculated";
  return "Pending";
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
    take: 400,
  });

  return rows.map((row) => ({
    transactionId: row.transactionId,
    transactionDate: row.transactionDate.toISOString().slice(0, 10),
    storeCode: row.storeCode,
    storeName: row.store.storeName,
    vertical: row.vertical,
    employeeId: row.employeeId,
    employeeName: row.employee?.employeeName ?? "-",
    department: row.department ?? "-",
    articleCode: row.articleCode,
    brand: row.brand ?? "-",
    quantity: row.quantity,
    grossAmount: asNumber(row.grossAmount),
    taxAmount: asNumber(row.taxAmount),
    totalAmount: asNumber(row.totalAmount),
    transactionType: row.transactionType,
    channel: row.channel,
    calculatedIncentive: row.vertical === Vertical.ELECTRONICS ? "Per Unit" : row.vertical === Vertical.GROCERY ? "Campaign" : "Weekly Pool",
    status: computeSalesStatus(row.transactionType, row.vertical),
  }));
}
