-- Phase 6.1 — Grocery pilot scope (HR Sales + Category PIP)
--
-- Schema additions to support two new plan shapes RIL Grocery sent over:
--   1. HR Sales — store-achievement-driven slab matrix, monthly cycle,
--      with quality gates (Mystery Shopper × POP Compliance) and
--      attendance pro-rata.
--   2. Category PIP — article-level per-piece incentive, vendor-funded,
--      with a min-criteria threshold gate.
--
-- All changes are additive. Existing Electronics / Grocery campaign /
-- F&L flows are untouched. Postgres-native enum extensions use
-- ALTER TYPE ADD VALUE IF NOT EXISTS, safe on populated DB.

-- ────────────────────────────────────────────────────────────────────────
-- (1) Enum extensions and new enums
-- ────────────────────────────────────────────────────────────────────────

-- ASM (Assistant Store Manager) — distinct slab column in RIL's matrix.
ALTER TYPE "EmployeeRole" ADD VALUE IF NOT EXISTS 'ASM';

-- Grocery format-tier discriminator.
DO $$ BEGIN
  CREATE TYPE "FormatTier" AS ENUM ('LARGE_FORMAT', 'STORES');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grocery slab role buckets — covers both tiers.
DO $$ BEGIN
  CREATE TYPE "GroceryRoleBucket" AS ENUM (
    'SM', 'ASM', 'OTHER_MGRL', 'CSA', 'PT', 'SM_ASM', 'ASSOCIATES'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Quality rating (Green/Amber/Red) — shared by Mystery Shopper + POP.
DO $$ BEGIN
  CREATE TYPE "StoreRating" AS ENUM ('GREEN', 'AMBER', 'RED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sales-status canonical truth value (engine reads this).
DO $$ BEGIN
  CREATE TYPE "StoreSalesStatus" AS ENUM (
    'ALL_STAFF_QUALIFIED',
    'ONLY_ASSOCIATES_QUALIFIED',
    'NONE_QUALIFIED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Plan funding source (RIL P&L vs vendor).
DO $$ BEGIN
  CREATE TYPE "FundingSource" AS ENUM ('RIL', 'VENDOR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────
-- (2) IncentivePlan.fundingSource
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE "incentive_plan"
  ADD COLUMN IF NOT EXISTS "funding_source" "FundingSource" NOT NULL DEFAULT 'RIL';

CREATE INDEX IF NOT EXISTS "incentive_plan_funding_source_status_idx"
  ON "incentive_plan"("funding_source", "status");

-- ────────────────────────────────────────────────────────────────────────
-- (3) StoreMonthlyMetric — store-level monthly inputs (sales + ratings)
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "store_monthly_metric" (
  "id" SERIAL NOT NULL,
  "store_code" VARCHAR(32) NOT NULL,
  "vertical" "Vertical" NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "sales_budget_rs_lacs" DECIMAL(12,4),
  "sales_actual_rs_lacs" DECIMAL(12,4),
  "sales_achievement_pct" DECIMAL(8,4),
  "sales_bucket" VARCHAR(32),
  "mystery_shopper_rating" "StoreRating",
  "pop_compliance_rating" "StoreRating",
  "sales_status" "StoreSalesStatus",
  "note" TEXT,
  "source" VARCHAR(32) NOT NULL DEFAULT 'API',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "store_monthly_metric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "store_monthly_metric_store_code_vertical_period_start_key"
  ON "store_monthly_metric"("store_code", "vertical", "period_start");
CREATE INDEX IF NOT EXISTS "store_monthly_metric_vertical_period_start_idx"
  ON "store_monthly_metric"("vertical", "period_start");
CREATE INDEX IF NOT EXISTS "store_monthly_metric_sales_status_period_start_idx"
  ON "store_monthly_metric"("sales_status", "period_start");

-- ────────────────────────────────────────────────────────────────────────
-- (4) EmployeeMonthlyInput — per-employee per-month attendance + recon hooks
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "employee_monthly_input" (
  "id" SERIAL NOT NULL,
  "employee_id" VARCHAR(64) NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "attendance" INTEGER NOT NULL,
  "awl_days" INTEGER NOT NULL DEFAULT 0,
  "working_days" INTEGER NOT NULL,
  "ril_incentive_slab" DECIMAL(12,2),
  "ril_final_pay" DECIMAL(12,2),
  "source" VARCHAR(32) NOT NULL DEFAULT 'API',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_monthly_input_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_monthly_input_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employee_master"("employee_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "employee_monthly_input_employee_id_period_start_key"
  ON "employee_monthly_input"("employee_id", "period_start");
CREATE INDEX IF NOT EXISTS "employee_monthly_input_period_start_idx"
  ON "employee_monthly_input"("period_start");

-- ────────────────────────────────────────────────────────────────────────
-- (5) GrocerySalesSlab — slab matrix per (plan, formatTier, roleBucket, band)
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "grocery_sales_slab" (
  "id" SERIAL NOT NULL,
  "plan_id" INTEGER NOT NULL,
  "format_tier" "FormatTier" NOT NULL,
  "role_bucket" "GroceryRoleBucket" NOT NULL,
  "band_min_pct" DECIMAL(6,4) NOT NULL,
  "band_max_pct" DECIMAL(6,4),
  "amount_rs" DECIMAL(12,2) NOT NULL,
  "effective_from" DATE,
  "effective_to" DATE,
  CONSTRAINT "grocery_sales_slab_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "grocery_sales_slab_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "incentive_plan"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "grocery_sales_slab_plan_id_format_tier_role_bucket_band_min_key"
  ON "grocery_sales_slab"("plan_id", "format_tier", "role_bucket", "band_min_pct");
CREATE INDEX IF NOT EXISTS "grocery_sales_slab_plan_id_format_tier_role_bucket_idx"
  ON "grocery_sales_slab"("plan_id", "format_tier", "role_bucket");

-- ────────────────────────────────────────────────────────────────────────
-- (6) CategoryPipArticle — per-article PPI rates for Category PIP plans
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "category_pip_article" (
  "id" SERIAL NOT NULL,
  "plan_id" INTEGER NOT NULL,
  "article_code" TEXT NOT NULL,
  "article_desc" TEXT,
  "brand" TEXT,
  "rate_rs" DECIMAL(8,2) NOT NULL,
  "target_qty" INTEGER NOT NULL,
  "min_criteria_pct" DECIMAL(4,2) NOT NULL DEFAULT 0.80,
  "effective_from" DATE,
  "effective_to" DATE,
  CONSTRAINT "category_pip_article_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "category_pip_article_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "incentive_plan"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "category_pip_article_plan_id_article_code_key"
  ON "category_pip_article"("plan_id", "article_code");
CREATE INDEX IF NOT EXISTS "category_pip_article_plan_id_idx"
  ON "category_pip_article"("plan_id");
