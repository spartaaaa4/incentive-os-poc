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
    blockingCodes.has("NO_PLAN_APPLICABLE");

  return {
    status,
    reasons,
    showAchievementNudge: !nudgeNeverHelps,
    showAttendanceCard: opts.showAttendanceCard ?? false,
  };
}
