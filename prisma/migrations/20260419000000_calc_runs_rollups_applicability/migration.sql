-- Wave 1 foundations: CalculationRun + versioned ledger + aggregate rollups +
-- plan applicability + attendance upload batch.
--
-- Safe to re-run on an empty ledger. Existing incentive_ledger rows are left
-- with calculation_run_id = NULL; the next successful calculation run will
-- produce the first versioned snapshot.

-- CreateEnum
CREATE TYPE "CalcRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CalcRunTrigger" AS ENUM ('INGESTION', 'MANUAL_RECOMPUTE', 'SCHEDULED_CRON', 'PLAN_PUBLISH', 'ATTENDANCE_UPDATE', 'BACKFILL');

-- CreateTable: calculation_run
CREATE TABLE "calculation_run" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" INTEGER NOT NULL,
    "plan_version" INTEGER NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "scope_store_codes" TEXT[] NOT NULL,
    "status" "CalcRunStatus" NOT NULL DEFAULT 'PENDING',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "trigger" "CalcRunTrigger" NOT NULL,
    "triggered_by_user_id" TEXT,
    "inputs_hash" TEXT,
    "ledger_row_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,

    CONSTRAINT "calculation_run_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "calculation_run_plan_id_period_start_period_end_status_idx" ON "calculation_run"("plan_id", "period_start", "period_end", "status");
CREATE INDEX "calculation_run_plan_id_period_start_is_current_idx" ON "calculation_run"("plan_id", "period_start", "is_current");
CREATE INDEX "calculation_run_status_started_at_idx" ON "calculation_run"("status", "started_at");

-- Only one current run per (plan, period) at a time. Partial unique index
-- enforces this at the DB level; engine atomic-swap flips prior row to
-- is_current = false inside the same transaction.
CREATE UNIQUE INDEX "calculation_run_one_current_per_plan_period"
    ON "calculation_run"("plan_id", "period_start", "period_end")
    WHERE "is_current" = true;

ALTER TABLE "calculation_run" ADD CONSTRAINT "calculation_run_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "incentive_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: incentive_ledger gets a calculation_run_id column
ALTER TABLE "incentive_ledger" ADD COLUMN "calculation_run_id" UUID;

CREATE INDEX "incentive_ledger_calculation_run_id_idx" ON "incentive_ledger"("calculation_run_id");

ALTER TABLE "incentive_ledger" ADD CONSTRAINT "incentive_ledger_calculation_run_id_fkey"
    FOREIGN KEY ("calculation_run_id") REFERENCES "calculation_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: store_daily_rollup
CREATE TABLE "store_daily_rollup" (
    "id" SERIAL NOT NULL,
    "store_code" VARCHAR(32) NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "day_key" DATE NOT NULL,
    "txn_count" INTEGER NOT NULL DEFAULT 0,
    "gross_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "units_sold" INTEGER NOT NULL DEFAULT 0,
    "last_run_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_daily_rollup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_daily_rollup_store_code_vertical_day_key_key" ON "store_daily_rollup"("store_code", "vertical", "day_key");
CREATE INDEX "store_daily_rollup_vertical_day_key_idx" ON "store_daily_rollup"("vertical", "day_key");
CREATE INDEX "store_daily_rollup_day_key_idx" ON "store_daily_rollup"("day_key");

ALTER TABLE "store_daily_rollup" ADD CONSTRAINT "store_daily_rollup_last_run_id_fkey"
    FOREIGN KEY ("last_run_id") REFERENCES "calculation_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: employee_period_rollup
CREATE TABLE "employee_period_rollup" (
    "id" SERIAL NOT NULL,
    "employee_id" VARCHAR(64) NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "store_code" VARCHAR(32) NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "earned" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "eligible" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "potential" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "achievement_pct" DECIMAL(8,2),
    "multiplier_applied" DECIMAL(8,2),
    "last_run_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_period_rollup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_period_rollup_employee_id_plan_id_period_start_key" ON "employee_period_rollup"("employee_id", "plan_id", "period_start");
CREATE INDEX "employee_period_rollup_plan_id_period_start_period_end_idx" ON "employee_period_rollup"("plan_id", "period_start", "period_end");
CREATE INDEX "employee_period_rollup_store_code_vertical_period_start_idx" ON "employee_period_rollup"("store_code", "vertical", "period_start");
CREATE INDEX "employee_period_rollup_employee_id_period_start_idx" ON "employee_period_rollup"("employee_id", "period_start");

ALTER TABLE "employee_period_rollup" ADD CONSTRAINT "employee_period_rollup_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "incentive_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_period_rollup" ADD CONSTRAINT "employee_period_rollup_last_run_id_fkey"
    FOREIGN KEY ("last_run_id") REFERENCES "calculation_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: store_period_rollup
CREATE TABLE "store_period_rollup" (
    "id" SERIAL NOT NULL,
    "store_code" VARCHAR(32) NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "target_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "actual_sales" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "achievement_pct" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "total_incentive" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employee_count" INTEGER NOT NULL DEFAULT 0,
    "earning_count" INTEGER NOT NULL DEFAULT 0,
    "rank_in_city" INTEGER,
    "last_run_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_period_rollup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_period_rollup_store_code_plan_id_period_start_key" ON "store_period_rollup"("store_code", "plan_id", "period_start");
CREATE INDEX "store_period_rollup_vertical_city_period_start_achievement_idx" ON "store_period_rollup"("vertical", "city", "period_start", "achievement_pct" DESC);
CREATE INDEX "store_period_rollup_vertical_period_start_idx" ON "store_period_rollup"("vertical", "period_start");
CREATE INDEX "store_period_rollup_plan_id_period_start_idx" ON "store_period_rollup"("plan_id", "period_start");

ALTER TABLE "store_period_rollup" ADD CONSTRAINT "store_period_rollup_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "incentive_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_period_rollup" ADD CONSTRAINT "store_period_rollup_last_run_id_fkey"
    FOREIGN KEY ("last_run_id") REFERENCES "calculation_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: plan_applicability
CREATE TABLE "plan_applicability" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "role" "EmployeeRole",
    "department" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "plan_applicability_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "plan_applicability_vertical_role_department_idx" ON "plan_applicability"("vertical", "role", "department");
CREATE INDEX "plan_applicability_plan_id_idx" ON "plan_applicability"("plan_id");

ALTER TABLE "plan_applicability" ADD CONSTRAINT "plan_applicability_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "incentive_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: attendance_upload
CREATE TABLE "attendance_upload" (
    "id" SERIAL NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "file_name" TEXT,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "period_start" DATE,
    "period_end" DATE,
    "store_codes" TEXT[] NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_upload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_upload_uploaded_at_idx" ON "attendance_upload"("uploaded_at");

-- AlterTable: attendance gets source + upload_id for traceability
ALTER TABLE "attendance" ADD COLUMN "source" TEXT DEFAULT 'upload';
ALTER TABLE "attendance" ADD COLUMN "upload_id" INTEGER;

ALTER TABLE "attendance" ADD CONSTRAINT "attendance_upload_id_fkey"
    FOREIGN KEY ("upload_id") REFERENCES "attendance_upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A Postgres view that gives us a one-SQL "current ledger" surface without
-- every read having to join-through calculation_run. Reads can target this
-- view; writes must target the base table.
CREATE OR REPLACE VIEW "current_incentive_ledger" AS
SELECT l.*
FROM "incentive_ledger" l
LEFT JOIN "calculation_run" r ON l."calculation_run_id" = r."id"
WHERE
  -- Rows produced by a successful current run (the primary case going forward)
  (r."status" = 'SUCCEEDED' AND r."is_current" = true)
  -- OR legacy rows created before CalculationRun existed (calculation_run_id IS NULL)
  OR l."calculation_run_id" IS NULL;

COMMENT ON VIEW "current_incentive_ledger" IS 'Authoritative "latest answer" view over incentive_ledger. Reads scoped by run.is_current + status. Legacy unversioned rows (run_id IS NULL) still visible until reclaimed by a fresh calculation run.';
