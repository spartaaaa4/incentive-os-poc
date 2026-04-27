-- Phase 5.1 — F&L pilot scope (Reliance Trends Incentive Policy v1, eff. 1 Mar 2026)
--
-- Three additive changes:
--   (1) Extend EmployeeRole enum: OMNI, PT (seen in W1 working file)
--   (2) New StoreWeeklyMetric table (PI + GM feeds, store-week granularity)
--   (3) No changes to existing tables — keeps the migration trivially
--       reversible if the pilot direction shifts.
--
-- Postgres-native enum extension uses ALTER TYPE ADD VALUE IF NOT EXISTS,
-- which is non-blocking and safe to run on a populated DB.

-- (1) Extend EmployeeRole enum.
ALTER TYPE "EmployeeRole" ADD VALUE IF NOT EXISTS 'OMNI';
ALTER TYPE "EmployeeRole" ADD VALUE IF NOT EXISTS 'PT';

-- (2) StoreWeeklyMetric — per-store-per-week external metric inputs.
CREATE TABLE "store_weekly_metric" (
    "id" SERIAL NOT NULL,
    "store_code" VARCHAR(32) NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "pilferage_index" DECIMAL(8,4),
    "pi_hold_flag" BOOLEAN NOT NULL DEFAULT false,
    "gm_target" DECIMAL(8,4),
    "gm_actual" DECIMAL(8,4),
    "gm_achieved" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "source" VARCHAR(32) NOT NULL DEFAULT 'API',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_weekly_metric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_weekly_metric_store_code_vertical_period_start_key"
    ON "store_weekly_metric"("store_code", "vertical", "period_start");

CREATE INDEX "store_weekly_metric_vertical_period_start_idx"
    ON "store_weekly_metric"("vertical", "period_start");

CREATE INDEX "store_weekly_metric_pi_hold_flag_period_start_idx"
    ON "store_weekly_metric"("pi_hold_flag", "period_start");
