# Incentive OS — Production Plan

Strategy document for evolving the Incentive OS PoC into a production-grade platform that can author and run Reliance Retail's full incentive catalog (Brands, Electronics/Digital, Grocery, F&L). Split into two parts:

- **Part A** — the long-term configuration architecture (where we're going)
- **Part B** — pilot-critical changes (what must ship before pilot sign-off to avoid visible shape changes later)

---

# Part A — Long-Term Configuration Architecture

## 1. The core problem

The PoC treats **vertical = engine**: three hand-coded functions in `engines.ts` (Electronics, Grocery, F&L). The reference PDFs describe ~40+ distinct plan variants across ~30 brands and 3 store formats. The real dimension of variation is **not the vertical** — it's the *recipe* of rules.

- Electronics (Digital) alone has 6 parallel programs (Sales, SDA, Support Staff, SM/DM, RM/CM, CEO Club)
- Brands has 5 model families (Achievement-Kitty, BSC + Service Charge Pool, Role-Tier Fixed, Per-Bill, SIS)
- Grocery has 10 programs running in parallel per store per month, with cross-program disqualifiers

If we keep extending the hardcoded-engine pattern, we will end up with 40 engines, ops cannot self-serve, every new brand launch requires an engineering deploy, and audit is impossible.

**The real product is not a calculator. It is a plan-authoring system where the calculator is a generic interpreter.**

## 2. Plan taxonomy — the 8 primitives

Every plan in the reference docs decomposes into the same primitives:

| Primitive | What it answers | Examples |
|---|---|---|
| **Scope** | Who/what is the plan attached to? | Brand (Superdry), Vertical (Grocery), Role (Cashier), Store format (SmartNet), Department (Wireless Phones) |
| **Eligibility** | Who can earn? | SA+TL only; Managers only; Min 15 days attendance; Active on payroll; Store open ≥15/30 days; Not on notice period |
| **Metric** | What do we measure? | NSV, GSV, NSV+OtherIncome, EBITDA, PMI, BSC score, orders/day, scan speed, bills closed, bill-value tier, PSPD kg, UPI %, SLA % |
| **Target & Period** | Against what benchmark? | Monthly store target, Weekly dept target, Quarterly, vs. LFL last year, vs. AOP, vs. state target |
| **Gate** | Minimum to earn anything | 85%, 90%, 95%, 100%, BSC≥2.0, scan≥9.5/min, ≥40 orders |
| **Formula** | How the amount is computed | Slab % × sales, Fixed by role×tier, Per-bill × count, Base × multiplier, Pool %, Points-weighted share, Linear step (₹1000/%) |
| **Distribution** | How it reaches individuals | Kitty → Role split → FC perf; Fixed role split; Equal; Designation-weighted; Points-weighted (L1/L2/L3/M4); Direct-to-individual; % of team earnings |
| **Modifiers** | What adjusts the final number | Compliance modifier (100/75/50%), Vacancy deduction, Attendance pro-rata, Part-timer ×50%, NSO protection, Audit RED/AMBER/GREEN, Food-safety fail ×50% |

Plus cross-cutting **disqualifiers** (dry-shrink breach, expired items, POP red, shrink >0.25%, wrong employee ID on sale) that act as kill-switches *across* plans.

## 3. Target data model (new — current Prisma schema does not model this)

```
Plan
├─ id, name, version, status (draft/approved/active/archived)
├─ scope: { vertical, brand?, storeFormats[], roles[], departments[] }
├─ period: { frequency: monthly|weekly|quarterly, calendar anchor }
├─ effectiveFrom, effectiveTo
├─ components[]                ← a plan is 1..N components
│    ├─ component.type: KITTY | FIXED_ROLE_TIER | PER_BILL | BSC | POOL_SHARE | LINEAR_STEP | PER_UNIT
│    ├─ metric: { source, aggregation, filters }
│    ├─ target: { type: absolute|lfl|aop, value|formula }
│    ├─ gate: { threshold, belowGateBehavior }
│    ├─ formula: { slabs[] | table | expression }
│    ├─ distribution: { strategy, params }   ← pluggable
│    └─ modifiers[]             ← ordered pipeline
├─ addOns[]                     ← independent bonus rules (WOW Bill, HVI, Star-of-Month)
├─ disqualifiers[]              ← kill-switch predicates
└─ approvalTrail                ← maker-checker (already exists; extend)
```

Key insight: **Superdry's plan and West Elm's plan are the same template with different numbers plus one extra add-on (HVI).** Neither should require code.

## 4. Rule primitives library (the finite executable pieces)

**Metric sources** — `sales.net`, `sales.gross`, `ebitda`, `pmi`, `bills.count_by_value_band`, `orders.picked`, `sla.order_to_invoice`, `scan_speed`, `kpi_score`, `bsc_weighted`, `pspd_kg`, `attendance.days`, `audit.mystery_score`, `compliance.pop`, `shrink.dry`, `upi.transaction_pct`

**Gate evaluators** — `threshold_pct`, `threshold_absolute`, `compound_and` (e.g. store≥100% AND SDA≥90%), `score_band` (RED/AMBER/GREEN)

**Formula types** — `slab_percent` (kitty %), `role_tier_table` (Sephora, Digital support), `per_unit_by_band` (Electronics products, SGH sunglasses), `per_bill_by_value` (LensCrafters), `linear_step` (Digital SM/DM: ₹25k base + ₹1k/%), `base_times_multiplier` (BSC), `pool_percent_of_metric` (F&V 3% of EBITDA, Service Charge 50%)

**Distribution strategies** — `kitty_role_split_by_headcount`, `kitty_role_split_with_vacancy_deductions` (TANK family), `equal_split`, `individual_performance_weighted`, `designation_weighted_points` (Muji, Service Charge L1/L2/L3/M4), `percent_of_team_earnings` (LensCrafters managers), `direct_individual` (Sephora BA, WOW Bill)

**Modifier pipeline — order matters:**
1. Eligibility filter (pre-calc kill)
2. Disqualifier check (dry-shrink, expired items → zero)
3. Gate (below gate → zero)
4. Formula → raw amount
5. Multipliers (achievement %, BSC multiplier)
6. Vacancy deductions (TANK-style)
7. Distribution to individuals
8. Per-individual modifiers (attendance pro-rata, part-timer 50%, notice-period zero, NSO protection floor)
9. Compliance modifier (100/75/50%)
10. Audit cap — role-aware (RED zeroes managers but not CSA)

Engineering builds these ~25 primitives once. Ops composes 40+ plans from them without deploys.

## 5. Plan-authoring UX (the real product surface)

- **Plan list** — filter by vertical/brand/status; clone-from-existing as primary creation path
- **Plan editor** — Scope → Period → Components → Add-ons → Disqualifiers → Modifiers → Preview
- **Component builder** — pick type from library, fill typed form
- **Preview/simulate** — upload last month's actuals or pick a store, run plan dry, see payout per employee before approving. **Killer feature.**
- **Diff view** — "what changed vs v3" — critical for audit
- **Maker-checker** — extend existing to cover plan versions not just targets
- **Activate/retire** — versioned; historical calcs always use the version effective on the transaction date

## 6. Gaps the PDFs expose that the PoC doesn't model at all

1. **Ideal team composition per brand-store** — TANK vacancy math requires expected SM/ASM/FC count. Needs `StoreRoleBlueprint`.
2. **Multiple parallel metrics per plan** — Hamleys uses NSV + Play Area + Membership + Birthday Parties.
3. **Cross-plan disqualifiers** — Grocery dry-shrink kills Sales *and* EBITDA store-wide.
4. **Audit/Mystery/POP scoring** with role-differentiated effects (AMBER: CSAs paid, managers zeroed).
5. **Weekly vs. monthly vs. quarterly periods** — including monthly-calc-quarterly-paid (BSC).
6. **Pool-based distribution** — Service Charge (L1/L2/L3/M4 points), F&V (3% EBITDA split across 16 roles each with its own % + per-person cap).
7. **Add-ons stacked on primary** — WOW Bill, HVI, RAP/OAP, Sephora Collection, Contact Lens Top-3.
8. **Per-individual modifiers** — notice-period exclusion, new-joiner pro-rata, new-RGM Q1 deferral, multi-store-RGM averaging, part-timer 50%, DOJ tie-breakers.
9. **Campaigns (Category-Led, Golden Event, Star/Cashier of Month)** — short-lived, vendor-funded, own lifecycle.
10. **TBC items** — many slab ranges, HVI thresholds, SIS model, high-value attribution rules — config system must hold "draft" plans pending business input.

## 7. Phased plan

**Phase 1 — Data model & primitives (~3 wks)** — Introduce `Plan`, `PlanComponent`, `PlanModifier`, `PlanAddOn`, `PlanDisqualifier`, `StoreRoleBlueprint`, `ComplianceEvent`. Migrate existing three engines into this model *as data*.

**Phase 2 — Generic interpreter (~3 wks)** — Replace `engines.ts` with `runPlan(plan, period, storeScope)`. Implement the ~25 primitives. Existing tests become regression tests.

**Phase 3 — Plan authoring UI (~4 wks)** — Clone-from-existing, component forms, preview/simulate, diff, approvals. Demo centerpiece for "onboard a new brand in 15 minutes."

**Phase 4 — Cover the PDF catalog (ongoing)** — Configure 40 plans as data. 3 reference plans per sprint. TBC flagged as `draft`.

**Phase 5 — Compliance & audit surface** — Cross-plan disqualifier ledger, audit-score ingestion (RED/AMBER/GREEN), role-differentiated effects. Legal/operational protection.

## 8. Pushback

Don't let Reliance demand every TBC from the PDFs before launch. The value of the config system is that it ships with ~60% of plans live and absorbs the rest as data. The pitch: *"We don't need your Hamleys slabs today — the day your commercial team finalizes them, your ops lead enters them in the UI and it's live next period."*

---

# Part B — Pilot-Critical Changes (Ship Before Sign-Off)

**Principle:** pilots lock mental models. Whatever Reliance sees and approves becomes the "shape" of the product in their minds. Any change to that shape later — even an additive one — reads as scope creep or a different product. So:

> Ship minimum internals, but expose production-shape UX contracts now.

Fix anything that changes the **shape** of a screen, the **identity** of an object (Plan vs Vertical), or the **vocabulary** (period, component, eligibility) users build their mental model around. Defer anything that only changes numbers inside those shapes.

## B1. Must change before pilot (visible contracts)

### 1. Kill the "one-number hero card" assumption
Current mobile shows one payout figure per employee. Production stacks components:
- Digital SM = Revenue + PMI + KPI (RCP/EOL) — three components
- Grocery CSA = Sales + EBITDA + Ops Excellence + JioMart + UPI — up to five
- Sephora BA = Fixed tier payout + WOW Bill + Sephora Collection + Star of Month

**Fix now:** Render hero as a **list of components** with a sum at the top, even if the pilot shows only one component per role. Shape must be a list, not a scalar.

### 2. Expose an Eligibility/Compliance strip
Dry-shrink, mystery audit RED/AMBER, POP, expired items, shrink >0.25%, food-safety audit can zero out a fully-earned payout. If pilot never surfaces this dimension, the first post-launch "₹0 — store got AMBER audit" reads as a bug.

**Fix now:** Compliance/eligibility chip on the hero (always GREEN in pilot is fine). Reserve the UI real estate. Admin dashboard gets a compliance column.

### 3. Make `Plan` a first-class entity, even with 3 hardcoded plans
Right now "vertical" *is* the plan. Production has 5–22 brand-specific plan variants per vertical. If pilot ties approvals/history/audit to "vertical," shifting to "plan" later breaks every admin screen.

**Fix now:** Introduce `Plan` in schema. Current three engines become `Plan v1` records. Approvals, targets, ledger entries, audit log all FK to `plan_id` + `plan_version`. UI can stay simple; the data model is future-proof.

### 4. Period type must be visible
F&L is weekly. Sunglass Hut/LensCrafters are weekly. BSC is monthly-calculated-quarterly-paid. If pilot silently assumes monthly everywhere, adding weekly later changes every date label and period picker.

**Fix now:** Every screen that shows "March 2026" shows "March 2026 (Monthly)" or "Week of 18 Mar (Weekly)". Period picker is period-aware.

### 5. Role taxonomy as data, not enum
Pilot roles: SM/SA/BA/DM. Production adds RGM, ARM, FOH, BOH, Cashier, Stock Boy, CRM, LPE, MO, Sr.FC, F&V Champ, Transport Exec, JM Picker, Sephora Captain, DMIT, Cluster Manager, Market Manager, more. Hardcoded dropdowns and role-based UI logic will break.

**Fix now:** Role table with attributes (is_manager, is_back_office, grade_points, default_weight). UI driven from it.

### 6. Target subject granularity
Sephora: managers' target = store, BAs' target = individual. Grocery F&V: target = PSPD kg per-store-per-day. Current pilot only shows "store target vs store actual." If next brand is Sephora, individual BA view is a different screen.

**Fix now:** Target has a `subjectType` (store | department | individual). Achievement card renders accordingly. Pilot uses store/department only, but field exists.

### 7. Show the kitty when relevant
Brands Achievement-Kitty: "store earns ₹X kitty, split among employees." Today the mobile shows "your payout = ₹Y" with no context. First "why did Ramesh get more than me?" has no UI answer.

**Fix now:** For kitty plans, add "Store kitty: ₹X, your share: ₹Y (role split Z%)" row. Even one-line disclosure preserves shape.

### 8. Calculation trace / explainability
"Why is my payout ₹1,847?" — regulator and employee both ask. If pilot shows the number without drill-down, retrofitting a breakdown screen changes every tap target.

**Fix now:** Tap on payout → breakdown: Metric, Target, Achievement %, Slab/Formula, Modifiers, Result. Pilot breakdown can be shallow; the interaction pattern is what matters.

### 9. Approval scope extension
Approvals today cover targets (+ plans per Apr 15 work). Production needs plan versions, manual adjustments, compliance overrides, campaign activation, disqualification waivers. If admin UI says "Approve Target," widening later means every stakeholder re-learns the screen.

**Fix now:** Queue renamed to "Approvals" with `entityType` column. Pilot shows Plan + Target. Schema supports the rest.

### 10. Employee-ID hygiene at data entry
Digital: "no corrections for wrong IDs; Brand Promoter sales under SM's ID." Grocery has similar strict attribution. If pilot allows sloppy attribution, fixing post-pilot means data cleanup + a workflow change.

**Fix now:** Sales ingestion rejects rows without valid employee ID. No silent fallback. Rule documented in admin.

## B2. Can defer (internal plumbing, no visible change)

- Generic plan interpreter — ship hardcoded engines that *read* Plan records (same output, future refactor invisible)
- Full primitives library (add as each new plan demands)
- Plan authoring UI (post-pilot — ops doesn't need it yet)
- Multi-metric plans (Hamleys NSV + PlayArea) — configure when needed
- Vacancy deductions (TANK family) — model-only for now
- Cross-plan disqualifier engine — the chip from B1.2 can be driven by a simple field initially
- Role-weighted pool distribution (Service Charge, F&V) — current `FnlRoleSplit` covers pilot
- Per-bill + per-unit formula types (LensCrafters, SGH) — defer
- BSC multiplier table — defer
- NSO protection, notice-period, new-joiner rules — defer, but reserve a `modifiers[]` array on payout records so they slot in later

## B3. The rule, restated

Before any pilot demo, walk every screen and ask three questions:

1. **Shape:** does this screen assume a scalar where production has a list? A single metric where production has many? One period where production varies?
2. **Identity:** am I labeling this as a Vertical/Engine when it's really a Plan?
3. **Vocabulary:** am I using words ("store achievement", "your payout") that will mean something subtly different next quarter when Sephora/LensCrafters/Grocery F&V land?

If any answer is yes, fix before sign-off. Everything else can change under the hood without Reliance noticing.
