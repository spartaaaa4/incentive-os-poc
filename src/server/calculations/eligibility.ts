/**
 * Eligibility contract — shared between calculation engines, the
 * employee-detail service, and the mobile/admin renderers.
 *
 * Each engine emits zero or more reasons into a ledger row's
 * `calculationDetails.reasons[]` (the row may have `final = 0` for
 * blocking reasons but it still gets written so the mobile app has
 * something to render). `incentives.ts` reads those reasons back, picks
 * the worst severity, and assembles the public `eligibility` block.
 *
 * Reversibility note: these codes become a public contract once we have
 * prod data. Renaming a code requires a translation layer at the read
 * path, NOT a rename in place — `calculationDetails` is JSON, so the
 * old string lives on in historical rows forever.
 */

export type EligibilityStatus =
  | "ELIGIBLE"
  | "PARTIALLY_ELIGIBLE"
  | "INELIGIBLE";

export type ReasonCode =
  // Payroll-driven (employee can't earn regardless of performance)
  | "NOTICE_PERIOD"
  | "DISCIPLINARY_ACTION"
  | "NEW_JOINER_PRORATA"
  | "EXITED_MID_PERIOD"
  // Plan-driven (the employee's department / store has no path to earn)
  | "DEPT_NO_SLABS"          // AIOT-style: dept has no slabs in this plan
  | "DEPT_BELOW_THRESHOLD"   // dept achievement below the lowest multiplier tier
  | "STORE_NOT_IN_CAMPAIGN"  // Grocery: store is not in this campaign's storeTargets
  | "STORE_UNQUALIFIED"      // F&L: store didn't beat the weekly target (BLOCKING)
  // Attendance-driven (F&L SA only)
  | "INSUFFICIENT_ATTENDANCE"
  // Phase 5.1 — F&L pilot scope (Reliance Trends Incentive Policy v1):
  // Two new store-level gates plus a leave-aware attendance reason. PI
  // (pilferage index) on hold blocks the entire store-week; GM not achieved
  // blocks SM/DM only and is INFO for CSA. LEAVE_IN_WEEK fires when the
  // employee took ANY leave during the 7-day incentive week — the policy
  // is explicit that approved leave still disqualifies.
  | "STORE_PI_HOLD"               // F&L: PI ≥ 0.30% — store on hold (BLOCKING)
  | "STORE_GM_NOT_ACHIEVED"       // F&L: gross margin not met (BLOCKING for SM/DM, WARNING for CSA)
  | "LEAVE_IN_WEEK"               // F&L: any leave during incentive week (BLOCKING)
  | "ROLE_NOT_ELIGIBLE_FOR_INCENTIVE" // F&L: role outside the policy's named set (BLOCKING)
  // Phase 6.1 — Grocery HR Sales pilot. Three new gates plus a soft
  // "missing input" reason. The achievement gate fires when the store's
  // sales-vs-budget falls below the lowest payable band (varies by tier:
  // <85% for Large Format, <95% for Stores). The two quality-gate codes
  // fire on Mystery Shopper / POP Compliance ratings — PARTIAL blocks
  // managers only, FULL blocks everyone. MONTHLY_INPUT_MISSING is a
  // WARNING the engine emits when EmployeeMonthlyInput is absent for a
  // role that needs it (default-attendance applied; ops should chase the
  // missing feed).
  | "BELOW_MIN_ACHIEVEMENT"           // Grocery HR: sales bucket below floor (BLOCKING)
  | "QUALITY_GATE_FAILED_PARTIAL"     // Grocery HR: ratings degraded — managers blocked (engine emits only for SM/ASM/DM)
  | "QUALITY_GATE_FAILED_FULL"        // Grocery HR: nobody earns (BLOCKING)
  | "MONTHLY_INPUT_MISSING"           // Grocery HR: no EmployeeMonthlyInput row (WARNING)
  // Phase 6.1 — Grocery Category PIP. Below-min-criteria threshold is
  // BLOCKING (no partial credit for the campaign). ARTICLES_NOT_SOLD is a
  // WARNING used when the employee's attribution scope produced zero
  // qualifying article transactions in the period.
  | "BELOW_MIN_CRITERIA"              // Grocery PIP: qty sold below 80% of target (BLOCKING)
  | "ARTICLES_NOT_SOLD"               // Grocery PIP: zero qualifying article transactions (WARNING)
  // Catch-all
  | "NO_PLAN_APPLICABLE";

export type ReasonSeverity = "BLOCKING" | "WARNING";

export interface EligibilityReason {
  code: ReasonCode;
  severity: ReasonSeverity;
  message: string;
  payload?: Record<string, unknown>;
}

export interface Eligibility {
  status: EligibilityStatus;
  reasons: EligibilityReason[];
  /** Hide "reach X% to unlock" nudges when ineligibility makes them moot. */
  showAchievementNudge: boolean;
  /** F&L-only: hide the 5-day attendance card for NP / DA / non-SA. */
  showAttendanceCard: boolean;
}

/**
 * Severity policy — single source of truth so engines and reducers agree.
 * STORE_UNQUALIFIED is BLOCKING per product call: when the store fails the
 * weekly bar, the employee is INELIGIBLE for the week, not PARTIALLY.
 */
const BLOCKING_CODES = new Set<ReasonCode>([
  "NOTICE_PERIOD",
  "DISCIPLINARY_ACTION",
  "EXITED_MID_PERIOD",
  "DEPT_NO_SLABS",
  "STORE_NOT_IN_CAMPAIGN",
  "STORE_UNQUALIFIED",
  "INSUFFICIENT_ATTENDANCE",
  "NO_PLAN_APPLICABLE",
  // Phase 5.1 — F&L pilot. STORE_PI_HOLD and LEAVE_IN_WEEK are unconditional
  // BLOCKING. STORE_GM_NOT_ACHIEVED is role-conditional: BLOCKING for SM/DM
  // (the engine emits it only for those roles); CSA never sees it as a
  // reason — for CSA the store can fail GM and they still earn.
  "STORE_PI_HOLD",
  "STORE_GM_NOT_ACHIEVED",
  "LEAVE_IN_WEEK",
  "ROLE_NOT_ELIGIBLE_FOR_INCENTIVE",
  // Phase 6.1 — Grocery HR Sales / Category PIP. BELOW_MIN_ACHIEVEMENT and
  // BELOW_MIN_CRITERIA are unconditional BLOCKING (the store / employee
  // didn't clear the floor). QUALITY_GATE_FAILED_PARTIAL is role-conditional
  // (engine emits it only for SM/ASM/DM); QUALITY_GATE_FAILED_FULL is
  // unconditional. MONTHLY_INPUT_MISSING and ARTICLES_NOT_SOLD are WARNINGs
  // — not in this set.
  "BELOW_MIN_ACHIEVEMENT",
  "QUALITY_GATE_FAILED_PARTIAL",
  "QUALITY_GATE_FAILED_FULL",
  "BELOW_MIN_CRITERIA",
]);

export function severityFor(code: ReasonCode): ReasonSeverity {
  return BLOCKING_CODES.has(code) ? "BLOCKING" : "WARNING";
}

export function makeReason(
  code: ReasonCode,
  message: string,
  payload?: Record<string, unknown>,
): EligibilityReason {
  return { code, severity: severityFor(code), message, payload };
}

/**
 * Reduce a reasons[] list to a top-level status. ANY blocking reason →
 * INELIGIBLE. Warnings only → PARTIALLY_ELIGIBLE. Empty → ELIGIBLE.
 */
export function statusFromReasons(reasons: EligibilityReason[]): EligibilityStatus {
  if (reasons.some((r) => r.severity === "BLOCKING")) return "INELIGIBLE";
  if (reasons.length > 0) return "PARTIALLY_ELIGIBLE";
  return "ELIGIBLE";
}

/**
 * Build the full eligibility block from a list of reasons + a couple of
 * rendering hints. Centralized so the three vertical detail builders
 * stay consistent.
 */
export function buildEligibility(
  reasons: EligibilityReason[],
  opts: {
    /** F&L: show the 5-day card only when the role/payroll situation makes it meaningful. */
    showAttendanceCard?: boolean;
  } = {},
): Eligibility {
  const status = statusFromReasons(reasons);

  // Hide "reach 85%" nudges when the *real* reason for ₹0 is something
  // else (NP / DA / no slabs). The nudge would be misleading.
  const blockingCodes = new Set(
    reasons.filter((r) => r.severity === "BLOCKING").map((r) => r.code),
  );
  const nudgeNeverHelps =
    blockingCodes.has("NOTICE_PERIOD") ||
    blockingCodes.has("DISCIPLINARY_ACTION") ||
    blockingCodes.has("EXITED_MID_PERIOD") ||
    blockingCodes.has("DEPT_NO_SLABS") ||
    blockingCodes.has("STORE_NOT_IN_CAMPAIGN") ||
    blockingCodes.has("NO_PLAN_APPLICABLE") ||
    // Phase 5.1: PI HOLD / GM-fail / approved-leave-during-week are not
    // recoverable inside the same week. Suppress the "reach 100% to unlock"
    // nudge — it'd just be misleading.
    blockingCodes.has("STORE_PI_HOLD") ||
    blockingCodes.has("STORE_GM_NOT_ACHIEVED") ||
    blockingCodes.has("LEAVE_IN_WEEK") ||
    blockingCodes.has("ROLE_NOT_ELIGIBLE_FOR_INCENTIVE") ||
    // Phase 6.1: Grocery quality-gate failures are not recoverable inside
    // the same month. Below-min-achievement *is* technically recoverable
    // ("hit 95% to unlock") but suppress the nudge anyway — the period is
    // the month, and by the time the employee sees this the month is
    // closing. Below-min-criteria for PIP is suppressed for the same reason.
    blockingCodes.has("QUALITY_GATE_FAILED_PARTIAL") ||
    blockingCodes.has("QUALITY_GATE_FAILED_FULL") ||
    blockingCodes.has("BELOW_MIN_ACHIEVEMENT") ||
    blockingCodes.has("BELOW_MIN_CRITERIA");

  return {
    status,
    reasons,
    showAchievementNudge: !nudgeNeverHelps,
    showAttendanceCard: opts.showAttendanceCard ?? false,
  };
}
