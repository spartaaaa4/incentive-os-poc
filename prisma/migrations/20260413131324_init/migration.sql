-- CreateEnum
CREATE TYPE "Vertical" AS ENUM ('ELECTRONICS', 'GROCERY', 'FNL');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TEMPORARILY_CLOSED');

-- CreateEnum
CREATE TYPE "EmployeeRole" AS ENUM ('SM', 'DM', 'SA', 'BA');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('ACTIVE', 'NOTICE_PERIOD', 'DISCIPLINARY_ACTION', 'LONG_LEAVE_UNAUTHORISED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE_APPROVED', 'LEAVE_UNAPPROVED', 'HOLIDAY', 'WEEK_OFF');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('NORMAL', 'SFS', 'PAS', 'JIOMART');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('OFFLINE', 'ONLINE');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('MONTHLY', 'WEEKLY', 'CAMPAIGN');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ACTIVE');

-- CreateEnum
CREATE TYPE "FormulaType" AS ENUM ('PER_UNIT', 'CAMPAIGN_SLAB', 'WEEKLY_POOL');

-- CreateEnum
CREATE TYPE "CampaignDistributionRule" AS ENUM ('EQUAL');

-- CreateEnum
CREATE TYPE "CalculationStatus" AS ENUM ('IN_PROGRESS', 'FINAL');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('PLAN', 'TARGET', 'CAMPAIGN', 'CALCULATION');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CALCULATED');

-- CreateTable
CREATE TABLE "store_master" (
    "store_code" VARCHAR(32) NOT NULL,
    "store_name" TEXT NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "store_format" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "store_status" "StoreStatus" NOT NULL DEFAULT 'ACTIVE',
    "operational_since" DATE NOT NULL,

    CONSTRAINT "store_master_pkey" PRIMARY KEY ("store_code")
);

-- CreateTable
CREATE TABLE "employee_master" (
    "employee_id" VARCHAR(64) NOT NULL,
    "employee_name" TEXT NOT NULL,
    "role" "EmployeeRole" NOT NULL,
    "store_code" VARCHAR(32) NOT NULL,
    "payroll_status" "PayrollStatus" NOT NULL DEFAULT 'ACTIVE',
    "date_of_joining" DATE NOT NULL,
    "date_of_exit" DATE,

    CONSTRAINT "employee_master_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" SERIAL NOT NULL,
    "employee_id" VARCHAR(64) NOT NULL,
    "store_code" VARCHAR(32) NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_transaction" (
    "transaction_id" VARCHAR(96) NOT NULL,
    "transaction_date" DATE NOT NULL,
    "store_code" VARCHAR(32) NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "store_format" TEXT NOT NULL,
    "employee_id" VARCHAR(64),
    "department" TEXT,
    "article_code" TEXT NOT NULL,
    "product_family_code" TEXT,
    "brand" TEXT,
    "quantity" INTEGER NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "transaction_type" "TransactionType" NOT NULL,
    "channel" "Channel" NOT NULL,

    CONSTRAINT "sales_transaction_pkey" PRIMARY KEY ("transaction_id")
);

-- CreateTable
CREATE TABLE "target" (
    "id" SERIAL NOT NULL,
    "store_code" VARCHAR(32) NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "department" TEXT,
    "product_family_code" TEXT,
    "product_family_name" TEXT,
    "target_value" DECIMAL(14,2) NOT NULL,
    "period_type" "PeriodType" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_by" TEXT,
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_plan" (
    "id" SERIAL NOT NULL,
    "plan_name" TEXT NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "formula_type" "FormulaType" NOT NULL,
    "period_type" "PeriodType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_from" DATE,
    "effective_to" DATE,
    "created_by" TEXT,
    "submitted_by" TEXT,
    "approved_by" TEXT,
    "rejection_reason" TEXT,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incentive_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_incentive_slab" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "product_family" TEXT NOT NULL,
    "brand_filter" TEXT NOT NULL,
    "price_from" DECIMAL(14,2) NOT NULL,
    "price_to" DECIMAL(14,2) NOT NULL,
    "incentive_per_unit" DECIMAL(14,2) NOT NULL,
    "effective_from" DATE,
    "effective_to" DATE,

    CONSTRAINT "product_incentive_slab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement_multiplier" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "achievement_from" DECIMAL(8,2) NOT NULL,
    "achievement_to" DECIMAL(8,2) NOT NULL,
    "multiplier_pct" DECIMAL(8,2) NOT NULL,
    "effective_from" DATE,
    "effective_to" DATE,

    CONSTRAINT "achievement_multiplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_config" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "campaign_name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "channel" "Channel" NOT NULL DEFAULT 'OFFLINE',
    "distribution_rule" "CampaignDistributionRule" NOT NULL DEFAULT 'EQUAL',
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "campaign_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_article" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "article_code" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "campaign_article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_store_target" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "store_code" VARCHAR(32) NOT NULL,
    "target_value" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "campaign_store_target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_payout_slab" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "achievement_from" DECIMAL(8,2) NOT NULL,
    "achievement_to" DECIMAL(8,2) NOT NULL,
    "per_piece_rate" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "campaign_payout_slab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fnl_role_split" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "num_sms" INTEGER NOT NULL,
    "num_dms" INTEGER NOT NULL,
    "sa_pool_pct" DECIMAL(8,2) NOT NULL,
    "sm_share_pct" DECIMAL(8,2) NOT NULL,
    "dm_share_per_dm_pct" DECIMAL(8,2) NOT NULL DEFAULT 0,

    CONSTRAINT "fnl_role_split_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_ledger" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "campaign_id" INTEGER,
    "employee_id" VARCHAR(64) NOT NULL,
    "store_code" VARCHAR(32) NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "base_incentive" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "multiplier_applied" DECIMAL(8,2),
    "achievement_pct" DECIMAL(8,2),
    "final_incentive" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "calculation_details" JSONB,
    "calculation_status" "CalculationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incentive_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "entity_type" "AuditEntityType" NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "action" "AuditAction" NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "performed_by" TEXT NOT NULL DEFAULT 'system',
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_master_store_code_idx" ON "employee_master"("store_code");

-- CreateIndex
CREATE INDEX "attendance_store_code_date_idx" ON "attendance"("store_code", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_employee_id_date_key" ON "attendance"("employee_id", "date");

-- CreateIndex
CREATE INDEX "sales_transaction_store_code_transaction_date_idx" ON "sales_transaction"("store_code", "transaction_date");

-- CreateIndex
CREATE INDEX "sales_transaction_vertical_transaction_date_idx" ON "sales_transaction"("vertical", "transaction_date");

-- CreateIndex
CREATE INDEX "sales_transaction_transaction_type_channel_idx" ON "sales_transaction"("transaction_type", "channel");

-- CreateIndex
CREATE INDEX "target_store_code_vertical_period_start_period_end_idx" ON "target"("store_code", "vertical", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "target_status_period_type_idx" ON "target"("status", "period_type");

-- CreateIndex
CREATE INDEX "incentive_plan_vertical_status_effective_from_effective_to_idx" ON "incentive_plan"("vertical", "status", "effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "product_incentive_slab_plan_id_product_family_idx" ON "product_incentive_slab"("plan_id", "product_family");

-- CreateIndex
CREATE INDEX "achievement_multiplier_plan_id_achievement_from_achievement_idx" ON "achievement_multiplier"("plan_id", "achievement_from", "achievement_to");

-- CreateIndex
CREATE INDEX "campaign_config_plan_id_status_start_date_end_date_idx" ON "campaign_config"("plan_id", "status", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_article_campaign_id_article_code_key" ON "campaign_article"("campaign_id", "article_code");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_store_target_campaign_id_store_code_key" ON "campaign_store_target"("campaign_id", "store_code");

-- CreateIndex
CREATE INDEX "campaign_payout_slab_campaign_id_achievement_from_achieveme_idx" ON "campaign_payout_slab"("campaign_id", "achievement_from", "achievement_to");

-- CreateIndex
CREATE UNIQUE INDEX "fnl_role_split_plan_id_num_sms_num_dms_key" ON "fnl_role_split"("plan_id", "num_sms", "num_dms");

-- CreateIndex
CREATE INDEX "incentive_ledger_store_code_vertical_period_start_period_en_idx" ON "incentive_ledger"("store_code", "vertical", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "incentive_ledger_employee_id_period_start_period_end_idx" ON "incentive_ledger"("employee_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_performed_at_idx" ON "audit_log"("entity_type", "entity_id", "performed_at");

-- AddForeignKey
ALTER TABLE "employee_master" ADD CONSTRAINT "employee_master_store_code_fkey" FOREIGN KEY ("store_code") REFERENCES "store_master"("store_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee_master"("employee_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_store_code_fkey" FOREIGN KEY ("store_code") REFERENCES "store_master"("store_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transaction" ADD CONSTRAINT "sales_transaction_store_code_fkey" FOREIGN KEY ("store_code") REFERENCES "store_master"("store_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_transaction" ADD CONSTRAINT "sales_transaction_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee_master"("employee_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target" ADD CONSTRAINT "target_store_code_fkey" FOREIGN KEY ("store_code") REFERENCES "store_master"("store_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_incentive_slab" ADD CONSTRAINT "product_incentive_slab_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "incentive_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_multiplier" ADD CONSTRAINT "achievement_multiplier_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "incentive_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_config" ADD CONSTRAINT "campaign_config_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "incentive_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_article" ADD CONSTRAINT "campaign_article_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_store_target" ADD CONSTRAINT "campaign_store_target_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_store_target" ADD CONSTRAINT "campaign_store_target_store_code_fkey" FOREIGN KEY ("store_code") REFERENCES "store_master"("store_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_payout_slab" ADD CONSTRAINT "campaign_payout_slab_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fnl_role_split" ADD CONSTRAINT "fnl_role_split_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "incentive_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_ledger" ADD CONSTRAINT "incentive_ledger_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "incentive_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_ledger" ADD CONSTRAINT "incentive_ledger_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign_config"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_ledger" ADD CONSTRAINT "incentive_ledger_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee_master"("employee_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_ledger" ADD CONSTRAINT "incentive_ledger_store_code_fkey" FOREIGN KEY ("store_code") REFERENCES "store_master"("store_code") ON DELETE RESTRICT ON UPDATE CASCADE;
