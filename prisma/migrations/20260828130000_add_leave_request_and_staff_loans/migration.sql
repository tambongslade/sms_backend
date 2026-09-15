-- Create LeaveRequest, StaffLoan and StaffLoanRepayment.
--
-- These three models have existed in schema.prisma for a while, but no
-- migration has ever created them: they reached the VPS through `prisma db
-- push` (or by hand), which writes tables without recording a migration. Any
-- node built from migration history alone therefore does not have them, and
-- 20260828140000_sync_all_remaining_tables — which adds sync columns to all
-- three — died on the on-prem box with
--
--   ERROR: relation "LeaveRequest" does not exist  (42P01)
--
-- taking the whole 49-table batch down with it, since Prisma runs a migration
-- in one transaction. This migration fills the gap and is ordered ahead of it.
--
-- server_id / checksum are deliberately NOT created here. 20260828140000 adds
-- them to these tables like every other, and creating them here would make
-- that migration fail the other way ("column already exists") on a fresh
-- database replayed from scratch.
--
-- Every statement is idempotent, because the VPS already has these tables and
-- must be able to record this migration without it trying to build them twice.

-- ----- Enums -----
-- CREATE TYPE has no IF NOT EXISTS, so trap the duplicate instead.
DO $$ BEGIN
    CREATE TYPE "LoanStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'PAID_OFF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "LoanRepaymentMethod" AS ENUM ('SALARY_DEDUCTION', 'CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'BEREAVEMENT', 'UNPAID', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----- StaffLoan -----
CREATE TABLE IF NOT EXISTS "StaffLoan" (
    "id"                  SERIAL           NOT NULL,
    "borrower_id"         INTEGER          NOT NULL,
    "amount"              DOUBLE PRECISION NOT NULL,
    "duration_months"     INTEGER          NOT NULL,
    "monthly_installment" DOUBLE PRECISION NOT NULL,
    "reason"              TEXT,
    "status"              "LoanStatus"     NOT NULL DEFAULT 'PENDING',
    "repayment_method"    "LoanRepaymentMethod",
    "approver_id"         INTEGER,
    "approver_note"       TEXT,
    "approved_at"         TIMESTAMP(3),
    "cancelled_at"        TIMESTAMP(3),
    "paid_off_at"         TIMESTAMP(3),
    "created_at"          TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "StaffLoan_pkey" PRIMARY KEY ("id")
);

-- ----- StaffLoanRepayment -----
-- No updated_at here on purpose: upstream created this table without one, and
-- 20260828140000 adds it (with a CURRENT_TIMESTAMP backfill) exactly as it does
-- for the chat tables. Creating it here makes that migration fail with
-- "column updated_at of relation StaffLoanRepayment already exists".
CREATE TABLE IF NOT EXISTS "StaffLoanRepayment" (
    "id"             SERIAL                NOT NULL,
    "loan_id"        INTEGER               NOT NULL,
    "amount"         DOUBLE PRECISION      NOT NULL,
    "paid_on"        TIMESTAMP(3)          NOT NULL,
    "method"         "LoanRepaymentMethod" NOT NULL,
    "notes"          TEXT,
    "recorded_by_id" INTEGER               NOT NULL,
    "created_at"     TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffLoanRepayment_pkey" PRIMARY KEY ("id")
);

-- ----- LeaveRequest -----
CREATE TABLE IF NOT EXISTS "LeaveRequest" (
    "id"            SERIAL         NOT NULL,
    "requester_id"  INTEGER        NOT NULL,
    "leave_type"    "LeaveType"    NOT NULL,
    "start_date"    TIMESTAMP(3)   NOT NULL,
    "end_date"      TIMESTAMP(3)   NOT NULL,
    "reason"        TEXT           NOT NULL,
    "status"        "LeaveStatus"  NOT NULL DEFAULT 'PENDING',
    "approver_id"   INTEGER,
    "approver_note" TEXT,
    "decided_at"    TIMESTAMP(3),
    "cancelled_at"  TIMESTAMP(3),
    "created_at"    TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3)   NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- ----- Indexes -----
CREATE INDEX IF NOT EXISTS "StaffLoan_borrower_id_idx"          ON "StaffLoan"("borrower_id");
CREATE INDEX IF NOT EXISTS "StaffLoan_status_idx"               ON "StaffLoan"("status");
CREATE INDEX IF NOT EXISTS "StaffLoanRepayment_loan_id_idx"     ON "StaffLoanRepayment"("loan_id");
CREATE INDEX IF NOT EXISTS "LeaveRequest_requester_id_idx"      ON "LeaveRequest"("requester_id");
CREATE INDEX IF NOT EXISTS "LeaveRequest_status_idx"            ON "LeaveRequest"("status");

-- ----- Foreign keys -----
-- ADD CONSTRAINT has no IF NOT EXISTS either; check the catalogue first.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffLoan_borrower_id_fkey') THEN
        ALTER TABLE "StaffLoan" ADD CONSTRAINT "StaffLoan_borrower_id_fkey"
            FOREIGN KEY ("borrower_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffLoan_approver_id_fkey') THEN
        ALTER TABLE "StaffLoan" ADD CONSTRAINT "StaffLoan_approver_id_fkey"
            FOREIGN KEY ("approver_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffLoanRepayment_loan_id_fkey') THEN
        ALTER TABLE "StaffLoanRepayment" ADD CONSTRAINT "StaffLoanRepayment_loan_id_fkey"
            FOREIGN KEY ("loan_id") REFERENCES "StaffLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffLoanRepayment_recorded_by_id_fkey') THEN
        ALTER TABLE "StaffLoanRepayment" ADD CONSTRAINT "StaffLoanRepayment_recorded_by_id_fkey"
            FOREIGN KEY ("recorded_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaveRequest_requester_id_fkey') THEN
        ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_requester_id_fkey"
            FOREIGN KEY ("requester_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaveRequest_approver_id_fkey') THEN
        ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_approver_id_fkey"
            FOREIGN KEY ("approver_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
