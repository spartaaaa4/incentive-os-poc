# Incentive OS — Plan & Context

Long-lived context file. Small commits don't go here; big-shape changes and
open architectural debt do. Update when a phase lands or a review produces
new findings.

---

## What's shipped

### Phase 1 — Admin identity & vertical-scoped RBAC

- `EmployeeAdminAccess` table: one row per admin, `verticals[]` allow-list
  (empty = super-admin — **landmine, see open issues**), 6 granular flags:
  `canViewAll`, `canEditIncentives`, `canSubmitApproval`, `canApprove`,
  `canManageUsers`, `canUploadData`.
- `EmployeeMaster.hasAdminAccess` denormalized flag, kept in sync by grant/
  revoke helpers.
- `requirePermission(user, flag, { vertical })` in `src/lib/permissions.ts`
  guards every mutation.
- JWT + httpOnly `ios_session` cookie dual auth; middleware (`src/middleware.ts`)
  resolves either.

### Phase 2 — ApprovalRequest chain + maker-checker UI

- `ApprovalRequest` table: entityType (PLAN / TARGET / PAYOUT reserved),
  `decision`, `supersededById` self-FK for resubmit chains, `seenBy` JSON,
  `changeSnapshot` JSON.
- Maker submits → approver sees in pending queue → decision lands only on
  the non-superseded row → resubmits create a new row linked back.

### Phase 3 — Admin user management

- `/admins` page: grant / revoke admin access.
- Guards: self-revoke blocked, last-super-admin blocked, scope guards.

### Phase 4 — Async ingest + queue + versioned calculation + rollup tier

- `POST /api/ingest/sales` (`src/app/api/ingest/sales/route.ts`): Zod-validated,
  `Idempotency-Key`-scoped, chunked `createMany({ skipDuplicates: true })` at
  1000 rows/chunk (65K param ceiling), max 5000 rows/batch. Returns 202 in
  sub-second.
- `IngestionBatch` + `RecomputeJob` tables.
- `/api/cron/run-jobs` worker: claims oldest PENDING via `UPDATE ... WHERE id
  = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)`, runs `recalculateByDateSpan`,
  flips batch COMPLETED / PARTIAL / FAILED.
- `requireIngestAuth()`: `INGEST_SERVICE_TOKEN` Bearer OR admin cookie with
  `canUploadData`.
- `CalculationRun` (UUID) table: every calculation pass is a row. Engine
  writes ledger + rollup rows tagged with `run_id`; atomic `isCurrent` swap
  on success (prior run → SUPERSEDED). Reads filter to `is_current=true AND
  status=SUCCEEDED` via `currentLedgerWhere()`
  (`src/server/calculations/currentLedger.ts`).
- Three rollup tables maintained by the engine:
  - `store_daily_rollup` — dashboard trendlines
  - `employee_period_rollup` — mobile hero cards
  - `store_period_rollup` — leaderboard, pre-computed `rank_in_city`
- `PlanApplicability` table scoping plans to `(vertical, role?, department?)`.
  **Schema exists but engine does not use it — see open issues.**

### Phase 4.5 — Reference pages on admin console

- `/architecture` — system diagram + 8 key decisions with tradeoffs.
- `/data-model` — tables grouped into 7 buckets with PK/FK/UK badges.

### Seed & access

- Named admin seed users (`prisma/seed.ts`, `adminSeedUsers` block), all
  password `"password"`:
  - `Anuj` — super-admin
  - `Priya` — Electronics maker (edit + submit + upload)
  - `Rahul` — Grocery maker
  - `Meera` — F&L ops (upload + view only)
  - `Vikram` — read-only auditor
  - `ApproverAll` / `ApproverElec` / `ApproverGroc` / `ApproverFnl` —
    approver-only (view + approve, no edit/submit)
- Dashboard perf: `@@index([isCurrent, status])` on `CalculationRun`, client
  response cache in `DashboardView`, `/api/attendance/status` now checks
  raw `Attendance` rows (not just `AttendanceUpload` batches).

### Git identity

- Both repos have local `user.name=spartaaaa4`, `user.email=wealth.anuj4@gmail.com`
  — Vercel will only build commits authored this way.

---

## Open architectural debt

From the most recent senior-architect review (run with the
`senior-architect-review` skill). Ordered by severity. File:line references
refer to the state at review time — verify before touching.

### Critical — correctness bugs that will fire in prod

1. **`isCurrent` supersession scope bug** — `runCoordinator.ts:253-263`.
   The supersede `WHERE` is `(planId, periodStart, periodEnd)`, ignoring
   `scopeStoreCodes`. Two concurrent runs for non-overlapping store groups
   in the same period will supersede each other; last-to-commit wins,
   the other's stores silently disappear from reads.
   Fix: `pg_advisory_xact_lock(hash('plan:'||planId||':'||periodStart))`
   at the top of `runCalculation`, or add `scopeStoreCodes && scope`
   array-overlap to the WHERE.

2. **Worker crash → jobs stuck RUNNING forever** — `run-jobs/route.ts:149-173`.
   No reaper, no visibility timeout. `attempts` column exists but nothing
   enforces a cap. Fix: `WHERE status='PENDING' OR (status='RUNNING' AND
   claimed_at < NOW() - INTERVAL '10m' AND attempts < 5)`.

3. **No DLQ / max-attempts** — `run-jobs/route.ts:98-117`. Any transient
   DB blip flips the job to FAILED permanently. Transient-vs-terminal
   distinction missing; retry with backoff below N attempts, DLQ past N.

4. **`PlanApplicability` is dead code** — schema at `schema.prisma:424-436`,
   referenced in `/architecture` and `/data-model` pages, **not read
   anywhere in `src/server/calculations/engines.ts`**. Either wire it
   (engine matches each employee against their applicable plans, emits
   one ledger row per plan) or rip the schema + reference-page claim.

5. **`GET /api/incentives` has no auth** — `incentives/route.ts:6`,
   middleware (`src/middleware.ts`) lists `/api/incentives` in
   `PUBLIC_ROUTES`. Takes `employeeId` as a query param and returns
   that employee's payout. Employee A can see employee B's payout by
   changing the URL. Emergency patch, not a future phase.

### Scale concerns (works today, won't at Reliance's firehose)

- **`recomputeStoreRanks` does N serial UPDATEs per transaction** —
  `runCoordinator.ts:303-337`. Replace with a single window-function
  `UPDATE ... FROM (SELECT RANK() OVER (PARTITION BY city ORDER BY
  achievement_pct DESC))`.
- **Upsert loops in `runCalculation` are serial** — `runCoordinator.ts:
  145-251`. Batch via `INSERT ... ON CONFLICT DO UPDATE` with ~500 rows
  per VALUES clause.
- **`sales_transaction` not partitioned** — 1.52M rows/day. Partition by
  `transaction_date` monthly **before prod data lands**; reversing
  post-load is painful.
- **`calculation_run` grows unbounded with `onDelete: Restrict`** —
  `schema.prisma:646, 678` — `EmployeePeriodRollup.lastRun` and
  `StorePeriodRollup.lastRun` are `Restrict` but
  `StoreDailyRollup.lastRun` at 618 is `SetNull`. Inconsistent, and
  nothing will ever delete a run. Need archive strategy.
- **No rate limit on `/api/ingest/sales`** — 5000 rows/batch cap but no
  per-token request/min limit.
- **Ingest/enqueue race** — `ingest/sales/route.ts:320-337` — if rows
  insert succeeds but `recomputeJob.create` throws, batch stays
  `RECEIVED`, no recovery scanner exists despite the comment at line 318.

### Operational blind spots

- No queue depth metric, no per-run latency histogram, no oldest-pending-
  age alarm. First incident will be invisible.
- No "why did this payout change" diff tooling. Ledger rows have
  `calculationRunId` and superseded runs persist, but nothing surfaces
  the delta to ops or the employee.
- No per-period lock — if ops pay out April on May 5 and a corrective
  April batch lands May 10, rollups mutate silently post-payout. No
  `period_locked_at` marker.

### Security / tenant-isolation

- **Super-admin sentinel is `verticals=[]`** — `schema.prisma:226`. A
  bug in the admin UI clearing the verticals array silently promotes
  a normal admin to super-admin. Replace with explicit
  `isSuperAdmin: boolean`.
- **`INGEST_SERVICE_TOKEN` has no rotation story** — single shared
  secret. Add `INGEST_SERVICE_TOKEN_NEXT` accepted in parallel during
  rotation windows.
- **`errorLog` JSON contains raw Zod messages** — `ingest/sales/
  route.ts:165-167`. Zod includes the offending value; `employeeId`
  can land in the JSON and leak to any admin with DB read.
- **JWT has no revocation** — no `tokenVersion` on `UserCredential`.
  Terminated employee or lost phone = wait for expiry or rotate the
  signing key (blows up everyone).
- **`AuditLog` is mutable** — no trigger, no checksum, no signed WAL.

### Mobile app blind spots

- **Stale rollup during in-flight recompute** — some rows have new
  `lastRunId`, some have old. UI shows partial numbers during a run.
  Need "recomputing…" state signal.
- **Session expiry mid-session** — JWT expiry = queued requests 401 en
  masse, likely logs the user out. No refresh-token pattern.
- **Employee moving stores mid-period** — `EmployeeMaster.storeCode` is
  single-valued; no `employee_store_history`. Sales before the move
  get attributed to the new store's rollup.

---

## Remaining phases (my reconstruction of the original 6-7 phase plan)

Not formally written down anywhere before this file; piecing it together
from the completed todo + the open debt above. If a real Phase 5/6/7
existed in the prior plan-mode session and differed, override this.

### Phase 5 — Payout lifecycle

- `period_locked_at` on `IncentivePlan` or `CalculationRun`.
- Payout batch entity + payroll file export.
- "Why did this change" diff view surfacing superseded-run deltas.
- **Fix `GET /api/incentives` auth** (slot here or emergency-patch sooner).

### Phase 6 — Observability

- Queue metrics table/view (`pending_count`, `running_count`,
  `oldest_pending_age`, `avg_claim_to_complete_ms_1h`).
- `/admin/ops` page exposing it.
- DLQ UI with requeue button.
- Per-run telemetry: rows written, wall-time, scope size.

### Phase 7 — Scale hardening

- Advisory lock + `scopeStoreCodes` overlap in `runCalculation`
  (critical bug #1 above).
- Worker reaper + `attempts` cap + backoff retry (critical #2, #3).
- Wire or rip `PlanApplicability` (critical #4).
- Partition `sales_transaction` monthly.
- Window-function rewrite of `recomputeStoreRanks`.
- Batched `INSERT ... ON CONFLICT` in `runCalculation`.
- Rate-limit `/api/ingest/sales`.
- `tokenVersion` for JWT revocation.
- `INGEST_SERVICE_TOKEN_NEXT` overlap window.
- Redact Zod errors before persisting to `error_log`.

### Recommended sequencing

1. **Emergency-patch subset** (critical issues 1, 2, 3, 4, 5 from above) —
   ~2 days. Don't pilot without these.
2. **Phase 5 payout lifecycle** — the auditor question.
3. **Phase 6 observability** — before pilot goes live, not after.
4. **Phase 7 scale hardening rest** — before 10× traffic; post-pilot ok.

---

## Repo layout

- Backend + admin web: `github.com/spartaaaa4/incentive-os-poc`
- Mobile app: `github.com/nayyaratul/incentive-app` (+ `spartaa` remote →
  `spartaaaa4/incentive-app-mobile`)
- Deploy: Replit (build runs `prisma generate && prisma db push
  --accept-data-loss && next build`). Vercel also in the picture — only
  builds commits authored as `spartaaaa4 <wealth.anuj4@gmail.com>`.
- Env: `DATABASE_URL` (Supabase Postgres), `JWT_SECRET`, `CRON_SECRET`,
  `INGEST_SERVICE_TOKEN`, `ALLOWED_ORIGIN`, `ENABLE_SEED`.

## How to keep this file useful

- Add a new entry under **What's shipped** when a phase lands. One
  paragraph. File:line references where they help.
- When a review surfaces new debt, append to **Open architectural debt**
  with severity, file:line, and the fix direction. Don't delete — move
  to shipped when fixed.
- Don't log small commits here. The git log is the source of truth
  for those.
