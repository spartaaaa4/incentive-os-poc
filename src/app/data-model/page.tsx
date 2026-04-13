import { AppShell } from "@/components/layout/app-shell";

const tables = [
  "store_master",
  "employee_master",
  "attendance",
  "sales_transaction",
  "target",
  "incentive_plan",
  "product_incentive_slab",
  "achievement_multiplier",
  "campaign_config",
  "fnl_role_split",
  "incentive_ledger",
  "audit_log",
];

export default function DataModelPage() {
  return (
    <AppShell title="Data Model Reference">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tables.map((table) => (
          <div key={table} className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-semibold text-slate-900">{table}</h3>
            <p className="text-xs text-slate-500 mt-1">See prisma/schema.prisma for full field definitions.</p>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
