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

### Phase 4.6 — Structured eligibility / reason codes

Round-1 testing surfaced three different "₹0 with no explanation" bugs across
the three engines, each with its own filtering strategy. Closes them with a
single contract used by every engine and every consumer (mobile + admin).

**Contract — `src/server/calculations/eligibility.ts` (new)**

- `ReasonCode` enum (8 codes): `STORE_NOT_IN_CAMPAIGN`, `STORE_UNQUALIFIED`,
  `NOTICE_PERIOD`, `DISCIPLINARY_ACTION`, `EXITED_MID_PERIOD`,
  `INSUFFICIENT_ATTENDANCE`, `NEW_JOINER_PRORATA`, `DEPT_NO_SLABS`,
  `DEPT_BELOW_THRESHOLD`, `NO_PLAN_APPLICABLE`.
- `BLOCKING` vs `WARNING` severity. **STORE_UNQUALIFIED is BLOCKING**
  (decision: a week with no qualified store has no payout — that's a hard
  fact, not advisory). `NEW_JOINER_PRORATA` and `DEPT_BELOW_THRESHOLD` are
  `WARNING` (employee still earned something, just less).
- `buildEligibility(reasons[])` returns `{ status, reasons[],
  showAchievementNudge, showAttendanceCard }`. `showAchievementNudge=false`
  when blocking codes make a "reach 85%" nudge nonsensical (this is what
  closes the AIOT misleading-nudge bug — DEPT_NO_SLABS suppresses it).

**Engines — `src/server/calculations/engines.ts` (modified)**

- Electronics: query broadened to include `NOTICE_PERIOD` /
  `DISCIPLINARY_ACTION` employees (previously dropped at the query level →
  silent disappearance). Per-employee loop now emits reasons[] for NP, DA,
  EXITED, NEW_JOINER, `DEPT_NO_SLABS` (when raw base is 0 but a multiplier
  exists), and `DEPT_BELOW_THRESHOLD` (when multiplier=0 but target>0).
  Final earning still gated on `isActive`.
- Grocery: split fetch into `allCampaignEmployees` + `outOfCampaignEmployees`
  so out-of-campaign employees get a ledger row tagged
  `STORE_NOT_IN_CAMPAIGN`. Adds NP / DA reasons.
- F&L (most invasive): pulls attendance for all SAs upfront, **always emits a
  ledger row for every active employee** (earner or not, so the mobile/admin
  knows why they got ₹0). Emits `STORE_UNQUALIFIED`,
  `INSUFFICIENT_ATTENDANCE`, `NEW_JOINER_PRORATA`, `EXITED_MID_PERIOD`.

**Read assembly — `src/server/services/incentives.ts` (modified)**

- `reasonsFromDetails(details)` defensive parser of
  `calculationDetails.reasons[]` from the ledger.
- Empty-row branch returns `eligibility` with `NO_PLAN_APPLICABLE` instead of
  bare ₹0.
- `buildElectronicsDetail`, `buildGroceryDetail`, `buildFnlDetail` each
  return `{ eligibility, ineligibleReason (legacy string for backward compat),
  message (gated on showAchievementNudge) }`.
- F&L additionally returns per-week `eligibility` inside `weeks[]` plus a
  top-level `monthEligibility` (`STORE_UNQUALIFIED` if every week is
  ineligible).

**Mobile — `incentive-app`**

- New `Molecule/EligibilityNotice/` (jsx + scss). Renders `reasons[]` as a
  bulleted list, BLOCKING-first, status-tinted (AlertTriangle for INELIGIBLE,
  Info for PARTIAL).
- `ElectronicsView` / `GroceryView` / `FnlView` all render the structured
  notice when `payout.eligibility.reasons[]` exists; legacy single-string
  `ineligibleReason` renders as fallback for older API responses (forward
  compat).
- F&L `showAttendanceCard` is now gated on
  `eligibility.showAttendanceCard !== false` (skips for SM/DM, hides on
  store-unqualified weeks).
- Electronics hero mapper (`mappers/electronics.js`) reads
  `eligibility.showAchievementNudge` and suppresses `gapToNext` when false →
  closes the "reach 85%" nudge for AIOT employees with no slabs.

**Admin console — `src/components/dashboard/incentive-drilldown.tsx`**

- New `EligibilityCallout` (Antd `Alert`) renders inside `EmployeeDetailView`
  when `data.eligibility?.reasons?.length > 0`. BLOCKING reasons sort first,
  shows reason code as a tag for auditability. For F&L, prefers
  `monthEligibility` when every week is ineligible. The maker-checker now
  sees "₹0 because DISCIPLINARY_ACTION" instead of just "₹0".

**Quick win shipped alongside — operationalDays fallback**

`store?.operationalDaysInMonth ?? '—'` at the four sites that crashed when
the field was missing: `EmployeeHome/views/ElectronicsView.jsx:32`,
`StoreManagerHome.jsx:695, 742, 768`.

**Test comments resolved (round-1 `Testing.xlsx`)**

| Comment | Root cause | Fix |
|---|---|---|
| "Out-of-campaign Grocery employees see blank screen" | Engine dropped them, mobile rendered nothing | `STORE_NOT_IN_CAMPAIGN` reason + Grocery view callout |
| "AIOT shows 'reach 85%' but has no slabs" | Hero nudge derived locally from tiers, ignored backend | `DEPT_NO_SLABS` + `showAchievementNudge=false` |
| "F&L unqualified week — no explanation, just ₹0" | Engine never emitted ledger row | F&L always emits row + `STORE_UNQUALIFIED` reason |
| "NP/DA employees disappear from Electronics" | Query-level filter | Query broadened, reasons emitted |
| "operationalDays renders as 'undefined / 30'" | Optional field missing in fallback path | `?? '—'` at 4 call sites |

**Reversibility note.** The contract is additive — old mobile builds keep
working via the legacy `ineligibleReason` string field. Reason codes can be
added without a migration (the JSON column carries them). Severity changes
are not free: flipping `STORE_UNQUALIFIED` from BLOCKING to WARNING later
would resurface the achievement nudge on already-paid weeks; if we change
severity, do it in a release note.

### Phase 4.7 — Partial-fix slice (UI gating on eligibility)

Phase 4.6 made the eligibility data flow correct end-to-end. This slice
makes the surrounding UI react to it — the four "callout is there but the
widget next to it still lies" bugs from round-1 testing.

**F&L weeks-qualified counter (E183) — `incentive-app/src/api/transformers/fnl.js`**

`recentWeeks[].storeQualified` and `weekPayouts[].storeQualifies` now read
`Boolean(w.storeQualified)` from the API response (backend uses strict
`actualSales > targetValue`) instead of recomputing locally as
`actualSales >= targetValue`. The local recomputation flagged 0/0 weeks as
qualified, so the hero pill said "3/3 weeks qualified" even when no week
qualified. `monthAggregate.weeksQualified` now derives correctly from the
fixed flag. Per-week `eligibility` is also forwarded into `weekPayouts[]`
and `recentWeeks[]` so downstream code (selector, accordion list) can show
per-week status without a second API call.

**F&L week tab labelling (E183) — `incentive-app/.../FnlView.jsx`**

New `weekOfMonthLabel(weekStart)` derives the label from the period's start
date (`floor((day - 1) / 7) + 1`, capped at 5). Replaces `i + 1` in the
period selector. If the engine ever fails to emit a week's row (sparse
targets, partial recompute), W3 will still render as "W3", not as "W2".
Phase 4.6 already made the engine emit a row per (employee, week), so the
density bug is unlikely in practice — this is the belt-and-braces label
fix.

**Electronics ineligible-widget gating (E008) — `.../views/ElectronicsView.jsx`**

`const isIneligible = payout?.eligibility?.status === 'INELIGIBLE'` gates
three widgets:

- `DepartmentMultipliers`
- `WeeklyChallenge`
- `QuestCard`

Hidden when an employee is on NOTICE_PERIOD / DISCIPLINARY_ACTION / EXITED.
The EligibilityNotice above the hero carries the explanation; the muted
multiplier strip and the "0% to next tier" challenge card were louder than
the actual reason. Badges remain visible (achievements earned earlier are
still real).

**Grocery store-not-in-campaign gating (E137 BIG GAP) — `.../views/GroceryView.jsx`**

`const storeNotInCampaign = reasons.some(r => r.code === 'STORE_NOT_IN_CAMPAIGN')`
gates four widgets:

- `VerticalHero` (campaign card)
- `QuestCard`
- `Accordion` (Payout slabs + Eligible articles)

Hidden when the store isn't part of the active Grocery campaign. Streak,
Momentum, and Badges stay (they're past-period signals, not campaign-bound).
This closes the BIG GAP from round-1 testing — out-of-scope stores no
longer see a "0% target reached" hero card that implies they could have
hit it.

When we move to multiple concurrent Grocery campaigns (PlanApplicability
already supports it on the schema side), this gate becomes per-campaign
rather than view-global.

**Files touched (this slice)**

- `incentive-app/src/api/transformers/fnl.js` — backend storeQualified flag is authoritative
- `incentive-app/src/containers/EmployeeHome/views/FnlView.jsx` — weekOfMonthLabel
- `incentive-app/src/containers/EmployeeHome/views/ElectronicsView.jsx` — isIneligible gate
- `incentive-app/src/containers/EmployeeHome/views/GroceryView.jsx` — storeNotInCampaign gate

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

2. ~~**Worker crash → jobs stuck RUNNING forever**~~ — **FIXED.**
   `run-jobs/route.ts` now reclaims RUNNING jobs older than 10 min and caps
   retries at `MAX_ATTEMPTS=5`. See the "claim oldest PENDING or stuck
   RUNNING" query in `claimNextJob()`.

3. ~~**No DLQ / max-attempts**~~ — **FIXED** alongside #2. Transient
   failures re-queue to PENDING (cron cadence = de-facto backoff) instead of
   flipping FAILED on first blip. Terminal failures past the attempt cap
   stay FAILED — that's the DLQ marker (Phase 6 ops UI will filter
   `status=FAILED AND attempts>=5` and expose requeue).

4. **`PlanApplicability` is dead code** — schema at `schema.prisma:424-436`,
   referenced in `/architecture` and `/data-model` pages, **not read
   anywhere in `src/server/calculations/engines.ts`**. Either wire it
   (engine matches each employee against their applicable plans, emits
   one ledger row per plan) or rip the schema + reference-page claim.

5. ~~**`GET /api/incentives` has no auth**~~ — **FIXED.** Removed from
   `middleware.PUBLIC_ROUTES`; handler now authenticates and enforces:
   self-read; SM/DM/BA/CENTRAL roles for management reads (coarse — Phase 5
   tightens to store-scope); admin console with `canViewAll` scoped to
   target vertical; otherwise 403. Cross-vertical reads with no single
   vertical scope require super-admin.

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
