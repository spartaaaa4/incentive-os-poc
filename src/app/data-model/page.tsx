import { AppShell } from "@/components/layout/app-shell";

/**
 * Hand-maintained reflection of `prisma/schema.prisma`. When the schema
 * changes, update this file too — it is the reference page both devs and
 * auditors land on first. Grouping is by what-the-table-does, not by
 * which-service-writes-it. Column list is a summary, not exhaustive — open
 * the schema for every nullable / default / index.
 */

type Field = { name: string; type: string; key?: "PK" | "FK" | "UK" };
type TableDef = {
  name: string;
  group: Group;
  purpose?: string;
  fields: Field[];
  relations?: string[];
};

type Group =
  | "Master Data"
  | "Admin & Auth"
  | "Transactional"
  | "Configuration"
  | "Calculation & Rollups"
  | "Ingestion"
  | "Approval & Audit";

const tables: TableDef[] = [
  // ── Master Data ──────────────────────────────────────────────
  {
    name: "store_master",
    group: "Master Data",
    purpose: "One row per physical store.",
    fields: [
      { name: "store_code", type: "VARCHAR(32)", key: "PK" },
      { name: "store_name", type: "VARCHAR" },
      { name: "vertical", type: "ENUM (ELECTRONICS/GROCERY/FNL)" },
      { name: "store_format", type: "VARCHAR" },
      { name: "state / city", type: "VARCHAR" },
      { name: "store_status", type: "ENUM" },
      { name: "operational_since", type: "DATE" },
    ],
  },
  {
    name: "employee_master",
    group: "Master Data",
    purpose: "One row per employee. has_admin_access mirrors employee_admin_access presence.",
    fields: [
      { name: "employee_id", type: "VARCHAR(64)", key: "PK" },
      { name: "employee_name", type: "VARCHAR" },
      { name: "role", type: "ENUM (SM/DM/SA/BA)" },
      { name: "store_code", type: "VARCHAR(32)", key: "FK" },
      { name: "department", type: "VARCHAR?" },
      { name: "payroll_status", type: "ENUM" },
      { name: "has_admin_access", type: "BOOLEAN" },
      { name: "date_of_joining / date_of_exit", type: "DATE" },
    ],
    relations: ["store_master"],
  },
  {
    name: "attendance",
    group: "Master Data",
    purpose: "Per-employee × date attendance. Drives F&L eligibility.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "employee_id", type: "VARCHAR(64)", key: "FK" },
      { name: "store_code", type: "VARCHAR(32)", key: "FK" },
      { name: "date", type: "DATE" },
      { name: "status", type: "ENUM" },
      { name: "source", type: "VARCHAR? (upload)" },
      { name: "upload_id", type: "INTEGER?", key: "FK" },
      { name: "(employee_id, date)", type: "UNIQUE", key: "UK" },
    ],
    relations: ["employee_master", "store_master", "attendance_upload"],
  },
  {
    name: "attendance_upload",
    group: "Master Data",
    purpose: "Audit row per attendance CSV/API push. Triggers F&L recompute for its date span.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "uploaded_by", type: "VARCHAR" },
      { name: "file_name", type: "VARCHAR?" },
      { name: "row_count", type: "INTEGER" },
      { name: "period_start / period_end", type: "DATE?" },
      { name: "store_codes", type: "TEXT[]" },
      { name: "uploaded_at", type: "TIMESTAMP" },
    ],
  },

  // ── Admin & Auth ─────────────────────────────────────────────
  {
    name: "user_credential",
    group: "Admin & Auth",
    purpose: "Login credentials. One-to-one with employee_master.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "employer_id", type: "VARCHAR(64)", key: "UK" },
      { name: "employee_id", type: "VARCHAR(64)", key: "FK" },
      { name: "password", type: "VARCHAR (bcrypt)" },
      { name: "is_active", type: "BOOLEAN" },
      { name: "last_login_at", type: "TIMESTAMP?" },
      { name: "created_at / updated_at", type: "TIMESTAMP" },
    ],
    relations: ["employee_master"],
  },
  {
    name: "employee_admin_access",
    group: "Admin & Auth",
    purpose: "RBAC row. verticals=[] means super-admin (all verticals). Six granular flags.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "employee_id", type: "VARCHAR(64)", key: "UK" },
      { name: "verticals", type: "ENUM[]" },
      { name: "can_view_all", type: "BOOLEAN" },
      { name: "can_edit_incentives", type: "BOOLEAN" },
      { name: "can_submit_approval", type: "BOOLEAN" },
      { name: "can_approve", type: "BOOLEAN" },
      { name: "can_manage_users", type: "BOOLEAN" },
      { name: "can_upload_data", type: "BOOLEAN" },
      { name: "granted_by / granted_at", type: "VARCHAR / TIMESTAMP" },
    ],
    relations: ["employee_master"],
  },

  // ── Transactional ────────────────────────────────────────────
  {
    name: "sales_transaction",
    group: "Transactional",
    purpose: "Raw POS txn. Never scanned on the hot read path — drill-in only.",
    fields: [
      { name: "transaction_id", type: "VARCHAR(96)", key: "PK" },
      { name: "transaction_date", type: "DATE" },
      { name: "store_code", type: "VARCHAR(32)", key: "FK" },
      { name: "vertical", type: "ENUM" },
      { name: "employee_id", type: "VARCHAR(64)?", key: "FK" },
      { name: "department", type: "VARCHAR?" },
      { name: "article_code / product_family_code", type: "VARCHAR" },
      { name: "brand", type: "VARCHAR?" },
      { name: "quantity", type: "INTEGER" },
      { name: "gross / tax / total_amount", type: "DECIMAL(14,2)" },
      { name: "transaction_type", type: "ENUM (NORMAL/SFS/PAS/JIOMART)" },
      { name: "channel", type: "ENUM (OFFLINE/ONLINE)" },
    ],
    relations: ["store_master", "employee_master"],
  },
  {
    name: "target",
    group: "Transactional",
    purpose: "Store × vertical × period sales target. batch_key groups a CSV import into one ApprovalRequest.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "store_code", type: "VARCHAR(32)", key: "FK" },
      { name: "vertical", type: "ENUM" },
      { name: "department / product_family", type: "VARCHAR?" },
      { name: "target_value", type: "DECIMAL(14,2)" },
      { name: "period_type", type: "ENUM (MONTHLY/WEEKLY/CAMPAIGN)" },
      { name: "period_start / period_end", type: "DATE" },
      { name: "status", type: "ENUM (DRAFT/SUBMITTED/APPROVED/…)" },
      { name: "batch_key", type: "VARCHAR?" },
      { name: "submitted_by / approved_by", type: "VARCHAR?" },
    ],
    relations: ["store_master"],
  },

  // ── Configuration ────────────────────────────────────────────
  {
    name: "incentive_plan",
    group: "Configuration",
    purpose: "A versioned payout plan. One active plan may have multiple concurrent versions during transitions.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "plan_name", type: "VARCHAR" },
      { name: "vertical", type: "ENUM" },
      { name: "formula_type", type: "ENUM (PER_UNIT/CAMPAIGN_SLAB/WEEKLY_POOL)" },
      { name: "period_type", type: "ENUM" },
      { name: "status", type: "ENUM (DRAFT/SUBMITTED/APPROVED/ACTIVE/…)" },
      { name: "version", type: "INTEGER" },
      { name: "effective_from / effective_to", type: "DATE?" },
      { name: "config", type: "JSONB?" },
      { name: "created_by / submitted_by / approved_by", type: "VARCHAR?" },
    ],
  },
  {
    name: "plan_applicability",
    group: "Configuration",
    purpose: "Scopes a plan to (vertical, role?, department?). Union of rows = where the plan applies.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "plan_id", type: "INTEGER", key: "FK" },
      { name: "vertical", type: "ENUM" },
      { name: "role", type: "ENUM?" },
      { name: "department", type: "VARCHAR?" },
      { name: "priority", type: "INTEGER" },
    ],
    relations: ["incentive_plan"],
  },
  {
    name: "product_incentive_slab",
    group: "Configuration",
    purpose: "PER_UNIT formula — per-piece incentive by product family × brand × price band.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "plan_id", type: "INTEGER", key: "FK" },
      { name: "product_family / brand_filter", type: "VARCHAR" },
      { name: "price_from / price_to", type: "DECIMAL(14,2)" },
      { name: "incentive_per_unit", type: "DECIMAL(14,2)" },
      { name: "effective_from / effective_to", type: "DATE?" },
    ],
    relations: ["incentive_plan"],
  },
  {
    name: "achievement_multiplier",
    group: "Configuration",
    purpose: "Electronics multiplier tiers. e.g. 85–100% → 1.0x, 100–120% → 1.2x.",
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
    purpose: "Grocery short-window campaign. Owns articles, store targets, and payout slabs.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "plan_id", type: "INTEGER", key: "FK" },
      { name: "campaign_name", type: "VARCHAR" },
      { name: "start_date / end_date", type: "DATE" },
      { name: "channel", type: "ENUM" },
      { name: "distribution_rule", type: "ENUM (EQUAL)" },
      { name: "status", type: "ENUM" },
    ],
    relations: ["incentive_plan"],
  },
  {
    name: "campaign_article",
    group: "Configuration",
    purpose: "Articles covered by a campaign.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "campaign_id", type: "INTEGER", key: "FK" },
      { name: "article_code", type: "VARCHAR" },
      { name: "brand / description", type: "VARCHAR" },
      { name: "(campaign_id, article_code)", type: "UNIQUE", key: "UK" },
    ],
    relations: ["campaign_config"],
  },
  {
    name: "campaign_store_target",
    group: "Configuration",
    purpose: "Per-store target for a campaign.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "campaign_id", type: "INTEGER", key: "FK" },
      { name: "store_code", type: "VARCHAR(32)", key: "FK" },
      { name: "target_value", type: "DECIMAL(14,2)" },
      { name: "(campaign_id, store_code)", type: "UNIQUE", key: "UK" },
    ],
    relations: ["campaign_config", "store_master"],
  },
  {
    name: "campaign_payout_slab",
    group: "Configuration",
    purpose: "Per-piece payout rate by achievement band (campaign's equivalent of multiplier tiers).",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "campaign_id", type: "INTEGER", key: "FK" },
      { name: "achievement_from / achievement_to", type: "DECIMAL(8,2)" },
      { name: "per_piece_rate", type: "DECIMAL(10,2)" },
    ],
    relations: ["campaign_config"],
  },
  {
    name: "fnl_role_split",
    group: "Configuration",
    purpose: "F&L WEEKLY_POOL: how the pool divides across SA / SM / DM roles.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "plan_id", type: "INTEGER", key: "FK" },
      { name: "num_sms / num_dms", type: "INTEGER" },
      { name: "sa_pool_pct", type: "DECIMAL(8,2)" },
      { name: "sm_share_pct", type: "DECIMAL(8,2)" },
      { name: "dm_share_per_dm_pct", type: "DECIMAL(8,2)" },
      { name: "(plan_id, num_sms, num_dms)", type: "UNIQUE", key: "UK" },
    ],
    relations: ["incentive_plan"],
  },

  // ── Calculation & Rollups ────────────────────────────────────
  {
    name: "calculation_run",
    group: "Calculation & Rollups",
    purpose: "One row per recompute pass. Atomic isCurrent swap on success; prior run for the scope → SUPERSEDED. Replay-able.",
    fields: [
      { name: "id", type: "UUID", key: "PK" },
      { name: "plan_id / plan_version", type: "INTEGER", key: "FK" },
      { name: "vertical", type: "ENUM" },
      { name: "period_start / period_end", type: "DATE" },
      { name: "scope_store_codes", type: "TEXT[]" },
      { name: "status", type: "ENUM (PENDING/RUNNING/SUCCEEDED/FAILED/SUPERSEDED)" },
      { name: "is_current", type: "BOOLEAN" },
      { name: "trigger", type: "ENUM (INGESTION/MANUAL_RECOMPUTE/…)" },
      { name: "triggered_by_user_id", type: "VARCHAR?" },
      { name: "inputs_hash", type: "VARCHAR?" },
      { name: "ledger_row_count", type: "INTEGER" },
      { name: "started_at / completed_at", type: "TIMESTAMP" },
      { name: "error_message", type: "TEXT?" },
    ],
    relations: ["incentive_plan"],
  },
  {
    name: "incentive_ledger",
    group: "Calculation & Rollups",
    purpose: "Per-employee, per-run ledger row. Writable on every run; reads filter to is_current=true.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "plan_id", type: "INTEGER", key: "FK" },
      { name: "campaign_id", type: "INTEGER?", key: "FK" },
      { name: "calculation_run_id", type: "UUID?", key: "FK" },
      { name: "employee_id", type: "VARCHAR(64)", key: "FK" },
      { name: "store_code", type: "VARCHAR(32)", key: "FK" },
      { name: "vertical", type: "ENUM" },
      { name: "period_start / period_end", type: "DATE" },
      { name: "base_incentive / final_incentive", type: "DECIMAL(14,2)" },
      { name: "multiplier_applied / achievement_pct", type: "DECIMAL(8,2)?" },
      { name: "calculation_details", type: "JSONB?" },
      { name: "calculation_status", type: "ENUM (IN_PROGRESS/FINAL)" },
    ],
    relations: ["incentive_plan", "campaign_config", "calculation_run", "employee_master", "store_master"],
  },
  {
    name: "employee_period_rollup",
    group: "Calculation & Rollups",
    purpose: "Primary read for mobile hero cards. (employee_id, plan_id, period_start) is unique.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "employee_id", type: "VARCHAR(64)", key: "FK" },
      { name: "plan_id", type: "INTEGER", key: "FK" },
      { name: "store_code", type: "VARCHAR(32)" },
      { name: "vertical", type: "ENUM" },
      { name: "period_start / period_end", type: "DATE" },
      { name: "earned / eligible / potential / paid", type: "DECIMAL(14,2)" },
      { name: "achievement_pct / multiplier_applied", type: "DECIMAL(8,2)?" },
      { name: "last_run_id", type: "UUID", key: "FK" },
      { name: "(employee_id, plan_id, period_start)", type: "UNIQUE", key: "UK" },
    ],
    relations: ["incentive_plan", "calculation_run"],
  },
  {
    name: "store_period_rollup",
    group: "Calculation & Rollups",
    purpose: "Primary read for admin dashboard + mobile leaderboard. rank_in_city is pre-computed.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "store_code", type: "VARCHAR(32)" },
      { name: "plan_id", type: "INTEGER", key: "FK" },
      { name: "vertical / city / state", type: "ENUM / VARCHAR" },
      { name: "period_start / period_end", type: "DATE" },
      { name: "target_value / actual_sales", type: "DECIMAL(18,2)" },
      { name: "achievement_pct", type: "DECIMAL(8,2)" },
      { name: "total_incentive", type: "DECIMAL(14,2)" },
      { name: "employee_count / earning_count", type: "INTEGER" },
      { name: "rank_in_city", type: "INTEGER?" },
      { name: "last_run_id", type: "UUID", key: "FK" },
      { name: "(store_code, plan_id, period_start)", type: "UNIQUE", key: "UK" },
    ],
    relations: ["incentive_plan", "calculation_run"],
  },
  {
    name: "store_daily_rollup",
    group: "Calculation & Rollups",
    purpose: "Daily trendline for admin dashboard and ingest reconciliation.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "store_code", type: "VARCHAR(32)" },
      { name: "vertical", type: "ENUM" },
      { name: "day_key", type: "DATE" },
      { name: "txn_count / units_sold", type: "INTEGER" },
      { name: "gross_amount / net_amount", type: "DECIMAL(18,2)" },
      { name: "last_run_id", type: "UUID?", key: "FK" },
      { name: "(store_code, vertical, day_key)", type: "UNIQUE", key: "UK" },
    ],
    relations: ["calculation_run"],
  },

  // ── Ingestion ────────────────────────────────────────────────
  {
    name: "ingestion_batch",
    group: "Ingestion",
    purpose: "One row per ingest POST. idempotency_key UNIQUE makes retries replay the stored response.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "idempotency_key", type: "VARCHAR(128)", key: "UK" },
      { name: "source", type: "VARCHAR(32) (API/CSV/…)" },
      { name: "batch_ref", type: "VARCHAR(128)?" },
      { name: "submitted_by", type: "VARCHAR" },
      { name: "status", type: "ENUM (RECEIVED/PROCESSING/COMPLETED/PARTIAL/FAILED)" },
      { name: "rows_submitted / rows_accepted / rows_rejected", type: "INTEGER" },
      { name: "error_log", type: "JSONB? (capped at 100 entries)" },
      { name: "min_txn_date / max_txn_date", type: "DATE?" },
      { name: "store_codes", type: "TEXT[]" },
      { name: "created_at / completed_at", type: "TIMESTAMP" },
    ],
  },
  {
    name: "recompute_job",
    group: "Ingestion",
    purpose: "Queue row for deferred recompute. Cron worker claims via SELECT FOR UPDATE SKIP LOCKED.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "status", type: "ENUM (PENDING/RUNNING/COMPLETED/FAILED)" },
      { name: "trigger", type: "ENUM" },
      { name: "store_codes", type: "TEXT[]" },
      { name: "period_start / period_end", type: "DATE" },
      { name: "ingestion_batch_id", type: "INTEGER?", key: "FK" },
      { name: "enqueued_by", type: "VARCHAR" },
      { name: "claimed_at / completed_at", type: "TIMESTAMP?" },
      { name: "attempts", type: "INTEGER" },
      { name: "error_message", type: "TEXT?" },
    ],
    relations: ["ingestion_batch"],
  },

  // ── Approval & Audit ─────────────────────────────────────────
  {
    name: "approval_request",
    group: "Approval & Audit",
    purpose: "Maker-checker chain. Resubmits set old.supersededById = new.id — decisions land only on current (non-superseded) rows.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "entity_type", type: "ENUM (PLAN/TARGET/PAYOUT)" },
      { name: "entity_id", type: "INTEGER" },
      { name: "batch_key", type: "VARCHAR?" },
      { name: "vertical", type: "ENUM?" },
      { name: "title / summary", type: "VARCHAR" },
      { name: "change_snapshot", type: "JSONB?" },
      { name: "submission_note", type: "VARCHAR?" },
      { name: "submitted_by / submitted_at", type: "VARCHAR / TIMESTAMP" },
      { name: "seen_by", type: "JSONB ([{employeeId, at}])" },
      { name: "decision", type: "ENUM (PENDING/APPROVED/REJECTED/SUPERSEDED)" },
      { name: "decided_by / decided_at / decision_note", type: "VARCHAR? / TIMESTAMP? / VARCHAR?" },
      { name: "superseded_by_id", type: "INTEGER?", key: "FK" },
    ],
    relations: ["employee_master (submitter/decider)", "approval_request (self)"],
  },
  {
    name: "audit_log",
    group: "Approval & Audit",
    purpose: "Append-only event log. One row per state-change action.",
    fields: [
      { name: "id", type: "SERIAL", key: "PK" },
      { name: "entity_type", type: "ENUM (PLAN/TARGET/CAMPAIGN/CALCULATION)" },
      { name: "entity_id", type: "INTEGER" },
      { name: "action", type: "ENUM (CREATED/SUBMITTED/APPROVED/REJECTED/CALCULATED)" },
      { name: "old_value / new_value", type: "JSONB?" },
      { name: "performed_by", type: "VARCHAR" },
      { name: "performed_at", type: "TIMESTAMP" },
    ],
  },
];

const groups: Group[] = [
  "Master Data",
  "Admin & Auth",
  "Transactional",
  "Configuration",
  "Calculation & Rollups",
  "Ingestion",
  "Approval & Audit",
];

const groupColors: Record<Group, string> = {
  "Master Data": "border-l-blue-500",
  "Admin & Auth": "border-l-slate-500",
  Transactional: "border-l-emerald-500",
  Configuration: "border-l-amber-500",
  "Calculation & Rollups": "border-l-purple-500",
  Ingestion: "border-l-sky-500",
  "Approval & Audit": "border-l-rose-500",
};

const groupLabels: Record<Group, string> = {
  "Master Data": "bg-blue-50 text-blue-700",
  "Admin & Auth": "bg-slate-100 text-slate-700",
  Transactional: "bg-emerald-50 text-emerald-700",
  Configuration: "bg-amber-50 text-amber-700",
  "Calculation & Rollups": "bg-purple-50 text-purple-700",
  Ingestion: "bg-sky-50 text-sky-700",
  "Approval & Audit": "bg-rose-50 text-rose-700",
};

function keyBadge(key: "PK" | "FK" | "UK") {
  const map = {
    PK: "bg-blue-100 text-blue-800",
    FK: "bg-slate-200 text-slate-700",
    UK: "bg-amber-100 text-amber-800",
  };
  return `${map[key]} text-[10px] px-1 rounded font-semibold`;
}

export default function DataModelPage() {
  return (
    <AppShell
      title="Data Model"
      description="Every table in the Prisma schema, grouped by purpose. For full detail (defaults, nullability, indexes) see prisma/schema.prisma."
    >
      <div className="space-y-8">
        {/* ── Legend ── */}
        <div className="flex gap-2 flex-wrap">
          {groups.map((g) => (
            <span
              key={g}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${groupLabels[g]}`}
            >
              {g} · {tables.filter((t) => t.group === g).length}
            </span>
          ))}
        </div>

        {/* ── Tables by group ── */}
        {groups.map((group) => (
          <div key={group}>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
              {group}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {tables
                .filter((t) => t.group === group)
                .map((table) => (
                  <div
                    key={table.name}
                    className={`rounded-xl border border-slate-200 bg-white p-4 border-l-4 ${groupColors[group]}`}
                  >
                    <h4 className="font-semibold text-slate-900 text-sm mb-1">
                      {table.name}
                    </h4>
                    {table.purpose && (
                      <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                        {table.purpose}
                      </p>
                    )}
                    <div className="space-y-1">
                      {table.fields.map((f) => (
                        <div
                          key={f.name}
                          className="flex items-center justify-between text-xs gap-2"
                        >
                          <span className="text-slate-700 flex items-center gap-1.5 min-w-0">
                            {f.key && <span className={keyBadge(f.key)}>{f.key}</span>}
                            <span className="truncate">{f.name}</span>
                          </span>
                          <span className="text-slate-400 font-mono text-[11px] flex-shrink-0">
                            {f.type}
                          </span>
                        </div>
                      ))}
                    </div>
                    {table.relations && table.relations.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-slate-100">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">
                          References
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {table.relations.map((r) => (
                            <span
                              key={r}
                              className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}

        {/* ── Legend footer ── */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 space-y-1">
          <div>
            <span className={keyBadge("PK")}>PK</span>{" "}
            <span className="ml-1">primary key</span>
            <span className="mx-3 text-slate-300">|</span>
            <span className={keyBadge("FK")}>FK</span>{" "}
            <span className="ml-1">foreign key</span>
            <span className="mx-3 text-slate-300">|</span>
            <span className={keyBadge("UK")}>UK</span>{" "}
            <span className="ml-1">unique key or composite unique index</span>
          </div>
          <div className="text-slate-500">
            Total: <strong>{tables.length} tables</strong> across{" "}
            <strong>{groups.length} groups</strong>.
          </div>
        </div>
      </div>
    </AppShell>
  );
}
