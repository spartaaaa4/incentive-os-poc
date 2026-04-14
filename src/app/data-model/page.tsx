import { AppShell } from "@/components/layout/app-shell";

type TableDef = {
  name: string;
  group: string;
  fields: { name: string; type: string; key?: "PK" | "FK" }[];
  relations?: string[];
};

const tables: TableDef[] = [
  {
    name: "store_master",
    group: "Master Data",
    fields: [
      { name: "store_code", type: "VARCHAR(32)", key: "PK" },
      { name: "store_name", type: "VARCHAR" },
      { name: "vertical", type: "ENUM" },
      { name: "store_format", type: "VARCHAR" },
      { name: "state", type: "VARCHAR" },
      { name: "city", type: "VARCHAR" },
      { name: "store_status", type: "ENUM" },
      { name: "operational_since", type: "DATE" },
    ],
  },
  {
    name: "employee_master",
    group: "Master Data",
    fields: [
      { name: "employee_id", type: "VARCHAR(64)", key: "PK" },
      { name: "employee_name", type: "VARCHAR" },
      { name: "role", type: "ENUM (SM/DM/SA/BA)" },
      { name: "store_code", type: "VARCHAR(32)", key: "FK" },
      { name: "payroll_status", type: "ENUM" },
      { name: "date_of_joining", type: "DATE" },
      { name: "date_of_exit", type: "DATE?" },
    ],
    relations: ["store_master"],
  },
  {
    name: "attendance",
    group: "Master Data",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "employee_id", type: "VARCHAR(64)", key: "FK" },
      { name: "store_code", type: "VARCHAR(32)", key: "FK" },
      { name: "date", type: "DATE" },
      { name: "status", type: "ENUM" },
    ],
    relations: ["employee_master", "store_master"],
  },
  {
    name: "user_credential",
    group: "Master Data",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "employer_id", type: "VARCHAR(64) UNIQUE" },
      { name: "employee_id", type: "VARCHAR(64) UNIQUE", key: "FK" },
      { name: "password", type: "VARCHAR (bcrypt)" },
      { name: "is_active", type: "BOOLEAN" },
      { name: "created_at", type: "TIMESTAMP" },
      { name: "updated_at", type: "TIMESTAMP" },
      { name: "last_login_at", type: "TIMESTAMP?" },
    ],
    relations: ["employee_master"],
  },
  {
    name: "sales_transaction",
    group: "Transactional",
    fields: [
      { name: "transaction_id", type: "VARCHAR(96)", key: "PK" },
      { name: "transaction_date", type: "DATE" },
      { name: "store_code", type: "VARCHAR(32)", key: "FK" },
      { name: "vertical", type: "ENUM" },
      { name: "store_format", type: "VARCHAR" },
      { name: "employee_id", type: "VARCHAR(64)?", key: "FK" },
      { name: "department", type: "VARCHAR?" },
      { name: "article_code", type: "VARCHAR" },
      { name: "product_family_code", type: "VARCHAR?" },
      { name: "brand", type: "VARCHAR?" },
      { name: "quantity", type: "INTEGER" },
      { name: "gross_amount", type: "DECIMAL(14,2)" },
      { name: "tax_amount", type: "DECIMAL(14,2)" },
      { name: "total_amount", type: "DECIMAL(14,2)" },
      { name: "transaction_type", type: "ENUM" },
      { name: "channel", type: "ENUM" },
    ],
    relations: ["store_master", "employee_master"],
  },
  {
    name: "target",
    group: "Transactional",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "store_code", type: "VARCHAR(32)", key: "FK" },
      { name: "vertical", type: "ENUM" },
      { name: "department", type: "VARCHAR?" },
      { name: "product_family_code", type: "VARCHAR?" },
      { name: "product_family_name", type: "VARCHAR?" },
      { name: "target_value", type: "DECIMAL(14,2)" },
      { name: "period_type", type: "ENUM" },
      { name: "period_start / period_end", type: "DATE" },
      { name: "status", type: "ENUM" },
      { name: "submitted_by", type: "VARCHAR?" },
      { name: "approved_by", type: "VARCHAR?" },
      { name: "created_at", type: "TIMESTAMP" },
    ],
    relations: ["store_master"],
  },
  {
    name: "incentive_plan",
    group: "Configuration",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "plan_name", type: "VARCHAR" },
      { name: "vertical", type: "ENUM" },
      { name: "formula_type", type: "ENUM" },
      { name: "period_type", type: "ENUM" },
      { name: "status", type: "ENUM" },
      { name: "version", type: "INTEGER" },
      { name: "effective_from / effective_to", type: "DATE?" },
      { name: "created_by", type: "VARCHAR?" },
      { name: "submitted_by", type: "VARCHAR?" },
      { name: "approved_by", type: "VARCHAR?" },
      { name: "rejection_reason", type: "VARCHAR?" },
      { name: "config", type: "JSONB?" },
      { name: "created_at", type: "TIMESTAMP" },
      { name: "updated_at", type: "TIMESTAMP" },
    ],
  },
  {
    name: "product_incentive_slab",
    group: "Configuration",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "plan_id", type: "INTEGER", key: "FK" },
      { name: "product_family", type: "VARCHAR" },
      { name: "brand_filter", type: "VARCHAR" },
      { name: "price_from / price_to", type: "DECIMAL(14,2)" },
      { name: "incentive_per_unit", type: "DECIMAL(14,2)" },
      { name: "effective_from / effective_to", type: "DATE?" },
    ],
    relations: ["incentive_plan"],
  },
  {
    name: "achievement_multiplier",
    group: "Configuration",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "plan_id", type: "INTEGER", key: "FK" },
      { name: "achievement_from / achievement_to", type: "DECIMAL(8,2)" },
      { name: "multiplier_pct", type: "DECIMAL(8,2)" },
      { name: "effective_from / effective_to", type: "DATE?" },
    ],
    relations: ["incentive_plan"],
  },
  {
    name: "campaign_config",
    group: "Configuration",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "plan_id", type: "INTEGER", key: "FK" },
      { name: "campaign_name", type: "VARCHAR" },
      { name: "start_date / end_date", type: "DATE" },
      { name: "channel", type: "ENUM" },
      { name: "distribution_rule", type: "ENUM" },
      { name: "status", type: "ENUM" },
    ],
    relations: ["incentive_plan"],
  },
  {
    name: "campaign_article / store_target / payout_slab",
    group: "Configuration",
    fields: [
      { name: "campaign_id", type: "INTEGER", key: "FK" },
      { name: "article_code / store_code / achievement_%", type: "VARCHAR / DECIMAL" },
      { name: "per_piece_rate / target_value", type: "DECIMAL" },
    ],
    relations: ["campaign_config", "store_master"],
  },
  {
    name: "fnl_role_split",
    group: "Configuration",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "plan_id", type: "INTEGER", key: "FK" },
      { name: "num_sms / num_dms", type: "INTEGER" },
      { name: "sa_pool_pct / sm_share_pct / dm_share_per_dm_pct", type: "DECIMAL(8,2)" },
    ],
    relations: ["incentive_plan"],
  },
  {
    name: "incentive_ledger",
    group: "Output",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "plan_id", type: "INTEGER", key: "FK" },
      { name: "campaign_id", type: "INTEGER?", key: "FK" },
      { name: "employee_id", type: "VARCHAR(64)", key: "FK" },
      { name: "store_code", type: "VARCHAR(32)", key: "FK" },
      { name: "vertical", type: "ENUM" },
      { name: "period_start / period_end", type: "DATE" },
      { name: "base_incentive", type: "DECIMAL(14,2)" },
      { name: "multiplier_applied", type: "DECIMAL(8,2)?" },
      { name: "achievement_pct", type: "DECIMAL(8,2)?" },
      { name: "final_incentive", type: "DECIMAL(14,2)" },
      { name: "calculation_details", type: "JSONB?" },
      { name: "calculation_status", type: "ENUM" },
      { name: "calculated_at", type: "TIMESTAMP" },
    ],
    relations: ["incentive_plan", "campaign_config", "employee_master", "store_master"],
  },
  {
    name: "audit_log",
    group: "Output",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "entity_type", type: "ENUM" },
      { name: "entity_id", type: "INTEGER" },
      { name: "action", type: "ENUM" },
      { name: "old_value / new_value", type: "JSONB?" },
      { name: "performed_by", type: "VARCHAR" },
      { name: "performed_at", type: "TIMESTAMP" },
    ],
  },
];

const groupColors: Record<string, string> = {
  "Master Data": "border-l-blue-500",
  Transactional: "border-l-emerald-500",
  Configuration: "border-l-amber-500",
  Output: "border-l-purple-500",
};

const groupLabels: Record<string, string> = {
  "Master Data": "bg-blue-50 text-blue-700",
  Transactional: "bg-emerald-50 text-emerald-700",
  Configuration: "bg-amber-50 text-amber-700",
  Output: "bg-purple-50 text-purple-700",
};

function keyBadge(key: "PK" | "FK") {
  return key === "PK"
    ? "bg-blue-100 text-blue-800 text-[10px] px-1 rounded"
    : "bg-slate-100 text-slate-600 text-[10px] px-1 rounded";
}

export default function DataModelPage() {
  const groups = ["Master Data", "Transactional", "Configuration", "Output"];

  return (
    <AppShell title="Data Model Reference">
      <div className="space-y-8">
        <div className="flex gap-4 flex-wrap">
          {groups.map((g) => (
            <span key={g} className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${groupLabels[g]}`}>
              {g}
            </span>
          ))}
        </div>

        {groups.map((group) => (
          <div key={group}>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">{group}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {tables
                .filter((t) => t.group === group)
                .map((table) => (
                  <div key={table.name} className={`rounded-xl border border-slate-200 bg-white p-4 border-l-4 ${groupColors[group]}`}>
                    <h4 className="font-semibold text-slate-900 text-sm mb-2">{table.name}</h4>
                    <div className="space-y-1">
                      {table.fields.map((f) => (
                        <div key={f.name} className="flex items-center justify-between text-xs">
                          <span className="text-slate-700 flex items-center gap-1.5">
                            {f.key && <span className={keyBadge(f.key)}>{f.key}</span>}
                            {f.name}
                          </span>
                          <span className="text-slate-400 font-mono">{f.type}</span>
                        </div>
                      ))}
                    </div>
                    {table.relations && table.relations.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-slate-100">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">References</p>
                        <div className="flex flex-wrap gap-1">
                          {table.relations.map((r) => (
                            <span key={r} className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{r}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
