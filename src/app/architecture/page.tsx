import { AppShell } from "@/components/layout/app-shell";

/**
 * Architecture overview — a single static page. No live DB reads; this is
 * reference material for anyone new to the codebase (devs, admins, auditors).
 * Keep it in sync with `prisma/schema.prisma` and the API surface in
 * `src/app/api/*` — this page is the "what shape is this system" answer.
 */

type Decision = {
  title: string;
  problem: string;
  choice: string;
  why: string;
  tradeoff: string;
  touchPoints: string[];
};

const decisions: Decision[] = [
  {
    title: "Async ingest + Postgres work queue",
    problem:
      "Reliance pushes ~1.5M sales txns/day via API. Running the recompute inside the POST would block the HTTP call for 30–120s and starve connections.",
    choice:
      "POST /api/ingest/sales inserts rows and returns 202 with a batchId. A RecomputeJob is enqueued. A cron worker claims oldest-PENDING using Postgres SELECT ... FOR UPDATE SKIP LOCKED and runs the engine.",
    why: "SKIP LOCKED is the idiomatic Postgres queue — multiple workers run concurrently without double-claiming, no extra infra (no BullMQ, no Redis) for the pilot. Ingest latency is sub-second even for 5K-row batches.",
    tradeoff:
      "Eventual consistency between ingest and read. Clients poll /api/ingest/sales/[batchId] for status. Swap-point to pg-boss / BullMQ is clean when scale forces it.",
    touchPoints: [
      "/api/ingest/sales",
      "/api/cron/run-jobs",
      "ingestion_batch",
      "recompute_job",
    ],
  },
  {
    title: "Idempotency at two levels",
    problem:
      "Reliance's firehose will retry. The same batch may arrive 2–3x. Row-level dedup alone is slow; batch-level dedup alone loses partial progress.",
    choice:
      "Batch-level: Idempotency-Key header → unique column on ingestion_batch. Retries replay the stored response (status + counts) instead of re-inserting. Row-level: transactionId is the PK on sales_transaction.",
    why: "Stripe-style. The two layers handle the two real retry modes: 'Reliance re-sent the whole batch' and 'half the batch got through, retry re-sends all rows.' Race between two concurrent same-key POSTs is caught via unique-violation → re-read → replay.",
    tradeoff: "Idempotency keys live forever in the batch table. Cheap storage vs. cheap retries.",
    touchPoints: ["ingestion_batch.idempotency_key", "sales_transaction.transaction_id"],
  },
  {
    title: "Pre-computed rollups (read/write split)",
    problem:
      "At 1.5M txns/day, groupBy + aggregate over sales_transaction for every leaderboard/dashboard/hero-card read would collapse within the first compliance deadline.",
    choice:
      "The calculation engine writes three rollup tables on every run: store_daily_rollup (daily trendlines), employee_period_rollup (mobile hero cards), store_period_rollup (leaderboard, admin dashboard). Reads never scan raw sales_transaction.",
    why: "Hot reads are single-indexed queries. rank_in_city is pre-computed inside the run, so leaderboards don't re-rank per request. Raw txns are available for drill-in and audit but not on the hot path.",
    tradeoff:
      "Rollups lag behind ingestion by one recompute cycle. Acceptable for incentive earnings (not real-time trading). Rollup schema change = full backfill.",
    touchPoints: [
      "employee_period_rollup",
      "store_period_rollup",
      "store_daily_rollup",
    ],
  },
  {
    title: "CalculationRun — atomic current-swap + replay",
    problem:
      "Plans change. Targets change. Attendance arrives late. A payout must be reproducible months later, and a bad run must not corrupt the live ledger.",
    choice:
      "Every recompute creates a new CalculationRun (UUID). Ledger + rollup rows tag the run. On success, the prior run for the same (plan, period) flips to SUPERSEDED and the new one flips isCurrent=true — atomic inside one transaction. Reads filter to isCurrent=true AND status=SUCCEEDED.",
    why: "History is preserved — auditors can replay any past period. Rolling back is flipping a boolean, not deleting rows. Failed runs never affect live data.",
    tradeoff:
      "Ledger grows fast (N_plans × N_periods × N_runs). Superseded rows will need a retention policy once storage bites.",
    touchPoints: [
      "calculation_run",
      "incentive_ledger.calculation_run_id",
      "src/server/calculations/runCoordinator.ts",
      "src/server/calculations/currentLedger.ts",
    ],
  },
  {
    title: "ApprovalRequest supersession chain",
    problem:
      "A plan/target submitted, then re-edited, then re-submitted. The prior approval request must not orphan. An approver must decide on the current version, not a stale one.",
    choice:
      "ApprovalRequest is append-only. Resubmits create a new row and set the old one's supersededById = new.id. Decisions can only land on the current (non-superseded) request.",
    why: "Full maker-checker history is queryable — 'who submitted what, when, against which version'. Concurrency-safe: two approvers can't both decide on the same chain because the supersession pointer serializes intent.",
    tradeoff:
      "Reads need a join to resolve 'the current request in this chain'. Indexed and cheap, but extra hop.",
    touchPoints: ["approval_request", "approval_request.superseded_by_id"],
  },
  {
    title: "Vertical-scoped RBAC",
    problem:
      "Reliance has three verticals (Electronics, Grocery, F&L). An Electronics admin must not see Grocery payouts. A super-admin needs to see everything.",
    choice:
      "EmployeeAdminAccess holds a verticals[] allow-list plus 6 granular flags. verticals=[] means super-admin (all verticals). requirePermission(user, flag, {vertical}) guards every mutation.",
    why: "Scope + capability are two axes; representing them in one table with an empty-array sentinel avoids a separate 'role' abstraction layer. Flags are additive — grant exactly what each admin needs, nothing more.",
    tradeoff: "Empty-array sentinel for super-admin is subtle. Well-documented in schema and permissions module.",
    touchPoints: [
      "employee_admin_access",
      "src/lib/permissions.ts",
      "src/middleware.ts",
    ],
  },
  {
    title: "PlanApplicability — concurrent plans per vertical",
    problem:
      "A single F&L SA can be earning from a weekly pool plan AND a short-lived campaign at the same time. Each vertical will run multiple concurrent plans.",
    choice:
      "PlanApplicability rows scope each IncentivePlan to (vertical, role?, department?). Zero rows = applies to the plan's vertical only (legacy fallback). Multiple rows = union of those rules. An employee matching N plans produces N ledger rows per period.",
    why: "Plans are composable without tenant-forking. The engine's plan-selection logic is a filter, not a branch. New plan shapes don't require schema changes — just new applicability rows.",
    tradeoff:
      "Misconfigured applicability can over-apply a plan. Mitigated by maker-checker approval flow before a plan goes ACTIVE.",
    touchPoints: ["plan_applicability", "incentive_plan", "src/server/services/incentives.ts"],
  },
  {
    title: "Dual auth — Bearer (mobile) + httpOnly cookie (web)",
    problem:
      "Mobile (React Native-ish SPA) needs a token it can store in secureLocalStorage and send as a header. Admin web needs a cookie the browser can't expose to JS (XSS defence).",
    choice:
      "POST /api/auth/login issues a 7-day JWT. Response includes both the raw token (for mobile) and sets an httpOnly ios_session cookie (for web). Every protected route accepts either.",
    why: "One auth surface, two transports. Middleware resolves whichever is present. No CSRF concern for mobile (Bearer, not cookie) and no JS exposure for web (httpOnly).",
    tradeoff:
      "Cookie + header both in flight on the admin web path. Explicit priority: Authorization header wins if both present.",
    touchPoints: ["/api/auth/login", "src/lib/auth.ts", "src/middleware.ts"],
  },
];

const ingestPath: Array<{ step: string; detail: string }> = [
  {
    step: "1. Reliance POS → POST /api/ingest/sales",
    detail:
      "Bearer INGEST_SERVICE_TOKEN. Body: { idempotencyKey, rows[] }. Max 5K rows/batch. Zod-validated per row.",
  },
  {
    step: "2. IngestionBatch created + rows chunked",
    detail:
      "idempotencyKey unique-locked. createMany({ skipDuplicates: true }) in chunks of 1000 (PG param limit). Rejects collected, not fail-all.",
  },
  {
    step: "3. RecomputeJob enqueued (status=PENDING)",
    detail: "Scope = (storeCodes touched, minTxnDate..maxTxnDate). Returns 202 { batchId, recomputeJobId }.",
  },
  {
    step: "4. Cron worker claims job (SKIP LOCKED)",
    detail:
      "/api/cron/run-jobs on Replit Scheduled Deployment. UPDATE ... WHERE id = (SELECT FOR UPDATE SKIP LOCKED LIMIT 1). Concurrent workers don't double-claim.",
  },
  {
    step: "5. Engine runs — recalculateByDateSpan()",
    detail:
      "For each matching (plan, period): new CalculationRun row → write ledger + rollups tagged with runId → atomic swap isCurrent.",
  },
  {
    step: "6. Batch closed — COMPLETED / PARTIAL / FAILED",
    detail: "PARTIAL if any rows rejected at ingest. Job errors mark both the job and the batch FAILED.",
  },
  {
    step: "7. Mobile/admin reads pick up new state",
    detail: "Reads query the rollup tables filtered to current run. Never scans sales_transaction on the hot path.",
  },
];

const readPath: Array<{ step: string; detail: string }> = [
  {
    step: "Mobile hero card (per employee × period)",
    detail:
      "GET /api/incentives → employee_period_rollup lookup by (employeeId, periodStart). One-row, indexed.",
  },
  {
    step: "Store leaderboard",
    detail:
      "GET /api/leaderboard → store_period_rollup filtered by (vertical, city, periodStart) ORDER BY rank_in_city. Pre-ranked.",
  },
  {
    step: "Admin dashboard daily trendline",
    detail:
      "store_daily_rollup filtered by (vertical, dayKey range). One row per store × vertical × day.",
  },
  {
    step: "Drill-in txn detail",
    detail:
      "sales_transaction by (storeCode, transactionDate) — only on drill-in, never on list/aggregate views.",
  },
];

export default function ArchitecturePage() {
  return (
    <AppShell
      title="Architecture"
      description="System shape, data flow, and the reasoning behind the major design decisions. Keep this page in sync with the schema and API surface."
    >
      <div className="space-y-10">
        {/* ── Tier summary ── */}
        <section>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
            System at a glance
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TierCard
              tone="blue"
              label="Ingest"
              title="Firehose + queue"
              bullets={[
                "POST /api/ingest/sales (service token)",
                "IngestionBatch with idempotency key",
                "RecomputeJob enqueued, 202 returned",
              ]}
            />
            <TierCard
              tone="amber"
              label="Compute"
              title="Async engine"
              bullets={[
                "Cron worker claims PENDING jobs (SKIP LOCKED)",
                "recalculateByDateSpan runs per (plan, period)",
                "Atomic isCurrent swap, history preserved",
              ]}
            />
            <TierCard
              tone="emerald"
              label="Read"
              title="Rollup-served"
              bullets={[
                "Mobile hero cards ← employee_period_rollup",
                "Leaderboards ← store_period_rollup (pre-ranked)",
                "Dashboards ← store_daily_rollup",
              ]}
            />
          </div>
        </section>

        {/* ── System diagram ── */}
        <section>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
            System diagram
          </h3>
          <div className="rounded-xl border border-slate-200 bg-white p-6 overflow-x-auto">
            <SystemDiagram />
            <p className="mt-4 text-xs text-slate-500 leading-relaxed">
              Solid arrows = synchronous request. Dashed arrows = deferred / queued. The write
              path (top) and read path (bottom) never cross — reads are served exclusively by
              pre-computed rollups, which are the durable output of each CalculationRun.
            </p>
          </div>
        </section>

        {/* ── Ingest path ── */}
        <section>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Ingest path (hot path for Reliance POS)
          </h3>
          <ol className="space-y-2">
            {ingestPath.map((s, i) => (
              <li
                key={i}
                className="rounded-lg border border-slate-200 bg-white p-3 flex gap-3"
              >
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900">
                    {s.step.replace(/^\d+\.\s*/, "")}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{s.detail}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Read path ── */}
        <section>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Read paths
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {readPath.map((r) => (
              <div
                key={r.step}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="text-sm font-medium text-slate-900">{r.step}</div>
                <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {r.detail}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Major decisions ── */}
        <section>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Major decisions
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {decisions.map((d) => (
              <div
                key={d.title}
                className="rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="text-sm font-semibold text-slate-900 mb-3">
                  {d.title}
                </div>
                <Row label="Problem" value={d.problem} />
                <Row label="Choice" value={d.choice} />
                <Row label="Why" value={d.why} />
                <Row label="Trade-off" value={d.tradeoff} />
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1.5">
                    Touches
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {d.touchPoints.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] font-mono bg-slate-100 text-slate-600 rounded px-1.5 py-0.5"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Scale posture ── */}
        <section>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Scale posture
          </h3>
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700 leading-relaxed space-y-2">
            <p>
              <strong className="text-slate-900">Target:</strong> ~1.5M sales txns/day
              across three verticals, multiple concurrent plans per vertical, live admin
              dashboard + mobile hero cards.
            </p>
            <p>
              <strong className="text-slate-900">Where we stand:</strong> ingest is async
              and idempotent; compute is decoupled via a Postgres work queue; reads are
              served from indexed rollups, not raw transactions.
            </p>
            <p>
              <strong className="text-slate-900">Known next steps before full
              production scale:</strong> partition sales_transaction by transaction_date
              (monthly); add retention policy for superseded CalculationRuns; move cron
              worker to a durable job runner (pg-boss/BullMQ) if throughput demands it;
              add observability (per-run metrics, queue depth, p95 recompute latency).
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="text-[10px] text-slate-400 uppercase tracking-wider">{label}</div>
      <div className="text-xs text-slate-700 leading-relaxed mt-0.5">{value}</div>
    </div>
  );
}

function TierCard({
  tone,
  label,
  title,
  bullets,
}: {
  tone: "blue" | "amber" | "emerald";
  label: string;
  title: string;
  bullets: string[];
}) {
  const toneMap = {
    blue: { border: "border-l-blue-500", badge: "bg-blue-50 text-blue-700" },
    amber: { border: "border-l-amber-500", badge: "bg-amber-50 text-amber-700" },
    emerald: { border: "border-l-emerald-500", badge: "bg-emerald-50 text-emerald-700" },
  }[tone];

  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 border-l-4 ${toneMap.border}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${toneMap.badge}`}>
          {label}
        </span>
      </div>
      <div className="text-sm font-semibold text-slate-900 mb-2">{title}</div>
      <ul className="space-y-1">
        {bullets.map((b) => (
          <li key={b} className="text-xs text-slate-600 leading-relaxed flex gap-1.5">
            <span className="text-slate-300">•</span>
            <span className="flex-1">{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Inline SVG system diagram. Pure presentation — no data-binding. Three
 * rows: ingest (blue), compute (amber), read (emerald). Solid arrows are
 * synchronous; dashed arrows are deferred/queued.
 */
function SystemDiagram() {
  return (
    <svg
      viewBox="0 0 920 420"
      className="w-full h-auto"
      role="img"
      aria-label="Incentive OS system architecture diagram"
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
        </marker>
        <marker
          id="arrow-dashed"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
        </marker>
      </defs>

      {/* ── External systems (left) ── */}
      <Box x={20} y={30} w={140} h={60} fill="#eff6ff" stroke="#93c5fd" label="Reliance POS" sub="firehose" />
      <Box x={20} y={110} w={140} h={60} fill="#eff6ff" stroke="#93c5fd" label="CSV Upload" sub="manual admin" />

      {/* ── Ingest tier ── */}
      <Box x={210} y={30} w={160} h={60} fill="#dbeafe" stroke="#3b82f6" label="POST /api/ingest/sales" sub="service token / cookie" />
      <Box x={210} y={110} w={160} h={60} fill="#dbeafe" stroke="#3b82f6" label="ingestion_batch" sub="idempotency_key UNIQUE" />

      {/* ── Queue ── */}
      <Box x={420} y={70} w={150} h={60} fill="#fef3c7" stroke="#f59e0b" label="recompute_job" sub="PENDING → RUNNING" />

      {/* ── Worker ── */}
      <Box x={600} y={30} w={150} h={60} fill="#fef3c7" stroke="#f59e0b" label="/api/cron/run-jobs" sub="SKIP LOCKED claim" />
      <Box x={600} y={110} w={150} h={60} fill="#fef3c7" stroke="#f59e0b" label="calculation engine" sub="recalculateByDateSpan" />

      {/* ── Durable storage: raw + runs ── */}
      <Box x={800} y={30} w={100} h={60} fill="#f1f5f9" stroke="#64748b" label="sales_txn" sub="raw (drill-in)" />
      <Box x={800} y={110} w={100} h={60} fill="#f1f5f9" stroke="#64748b" label="calculation_run" sub="versioned" />

      {/* ── Rollups (bottom-right) ── */}
      <Box x={600} y={220} w={150} h={50} fill="#d1fae5" stroke="#10b981" label="store_daily_rollup" />
      <Box x={600} y={280} w={150} h={50} fill="#d1fae5" stroke="#10b981" label="employee_period_rollup" />
      <Box x={600} y={340} w={150} h={50} fill="#d1fae5" stroke="#10b981" label="store_period_rollup" sub="rank_in_city pre-computed" />

      {/* ── Read clients (bottom-left) ── */}
      <Box x={20} y={220} w={140} h={50} fill="#ecfdf5" stroke="#10b981" label="Mobile app" sub="hero cards" />
      <Box x={20} y={280} w={140} h={50} fill="#ecfdf5" stroke="#10b981" label="Admin web" sub="dashboards" />

      {/* ── Read API ── */}
      <Box x={210} y={250} w={160} h={60} fill="#d1fae5" stroke="#10b981" label="/api/incentives" sub="/api/leaderboard" />
      <Box x={420} y={250} w={150} h={60} fill="#d1fae5" stroke="#10b981" label="rollup read model" sub="indexed lookups" />

      {/* ── Arrows: write path (solid) ── */}
      <Arrow x1={160} y1={60} x2={210} y2={60} />
      <Arrow x1={160} y1={140} x2={210} y2={140} />
      <Arrow x1={290} y1={90} x2={290} y2={110} />
      <Arrow x1={370} y1={140} x2={420} y2={100} />

      {/* dashed: queue → worker */}
      <ArrowDashed x1={570} y1={100} x2={600} y2={60} />
      {/* worker → engine */}
      <Arrow x1={675} y1={90} x2={675} y2={110} />
      {/* engine → sales_txn (read raw for aggregation) */}
      <Arrow x1={750} y1={125} x2={800} y2={80} />
      {/* engine → calculation_run */}
      <Arrow x1={750} y1={140} x2={800} y2={140} />
      {/* engine → rollups (down) */}
      <Arrow x1={675} y1={170} x2={675} y2={220} />

      {/* ── Arrows: read path (solid) ── */}
      <Arrow x1={160} y1={245} x2={210} y2={270} />
      <Arrow x1={160} y1={305} x2={210} y2={285} />
      <Arrow x1={370} y1={280} x2={420} y2={280} />
      <Arrow x1={570} y1={280} x2={600} y2={245} />
      <Arrow x1={570} y1={290} x2={600} y2={305} />
      <Arrow x1={570} y1={300} x2={600} y2={365} />

      {/* ── Tier labels ── */}
      <text x={920} y={22} textAnchor="end" fontSize="11" fontWeight="600" fill="#1e40af" letterSpacing="0.5">
        WRITE PATH
      </text>
      <text x={920} y={212} textAnchor="end" fontSize="11" fontWeight="600" fill="#065f46" letterSpacing="0.5">
        READ PATH
      </text>
      <line x1="0" y1="200" x2="920" y2="200" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 4" />
    </svg>
  );
}

function Box({
  x, y, w, h, fill, stroke, label, sub,
}: {
  x: number; y: number; w: number; h: number;
  fill: string; stroke: string; label: string; sub?: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={fill} stroke={stroke} strokeWidth="1.5" />
      <text x={x + w / 2} y={sub ? y + h / 2 - 2 : y + h / 2 + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="#0f172a">
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fontSize="10" fill="#475569">
          {sub}
        </text>
      )}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#64748b" strokeWidth="1.5" markerEnd="url(#arrow)" />
  );
}

function ArrowDashed({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#arrow-dashed)" />
  );
}
