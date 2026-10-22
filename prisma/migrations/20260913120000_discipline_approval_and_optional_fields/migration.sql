-- Discipline approval workflow + optional fields
-- 1. DisciplinaryAction: reason optional, add approval workflow fields
-- 2. BrokenProperty: estimated_cost optional, add photo_url
-- 3. SaturdayPunishment: add reason_category

-- Enums
CREATE TYPE "DisciplinaryApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING_APPROVAL', 'APPROVED', 'DECLINED');
CREATE TYPE "SaturdayPunishmentCategory" AS ENUM ('STANDARD', 'CUSTOM', 'EXTRAORDINARY');

-- DisciplinaryAction
ALTER TABLE "DisciplinaryAction"
  ALTER COLUMN "reason" DROP NOT NULL,
  ADD COLUMN "approval_status" "DisciplinaryApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "approver_id" INTEGER,
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "approval_notes" TEXT;

ALTER TABLE "DisciplinaryAction"
  ADD CONSTRAINT "DisciplinaryAction_approver_id_fkey"
  FOREIGN KEY ("approver_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DisciplinaryAction_approval_status_approver_id_idx"
  ON "DisciplinaryAction"("approval_status", "approver_id");

-- BrokenProperty
ALTER TABLE "BrokenProperty"
  ALTER COLUMN "estimated_cost" DROP NOT NULL,
  ADD COLUMN "photo_url" TEXT;

-- SaturdayPunishment
ALTER TABLE "SaturdayPunishment"
  ADD COLUMN "reason_category" "SaturdayPunishmentCategory" NOT NULL DEFAULT 'STANDARD';
