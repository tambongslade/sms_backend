-- Same drift as 20260915100000: approval_status/approver_id/approved_at/
-- approval_notes were added to schema.prisma by the merge that also wired up
-- the approval-workflow routes (deployed as 9d1b3fa), but no migration ever
-- captured them -- confirmed by grepping every migration.sql in this repo for
-- DisciplinaryApprovalStatus, no hits. Missed the first time around: I fixed
-- BrokenProperty/SaturdayPunishment's identical drift without checking this
-- table too, even though I was looking straight at this model. Caught by the
-- next sync cycle failing on `prisma.disciplinaryAction.findMany()` with the
-- same "column does not exist" error. The new approval endpoints were live
-- but would 500 on first use -- nothing had exercised them yet.

-- CreateEnum
CREATE TYPE "DisciplinaryApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING_APPROVAL', 'APPROVED', 'DECLINED');

-- AlterTable
ALTER TABLE "DisciplinaryAction"
    ADD COLUMN "approval_status" "DisciplinaryApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    ADD COLUMN "approver_id"     INTEGER,
    ADD COLUMN "approved_at"     TIMESTAMP(3),
    ADD COLUMN "approval_notes"  TEXT;

-- AddForeignKey
ALTER TABLE "DisciplinaryAction"
    ADD CONSTRAINT "DisciplinaryAction_approver_id_fkey"
    FOREIGN KEY ("approver_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "DisciplinaryAction_approval_status_approver_id_idx" ON "DisciplinaryAction"("approval_status", "approver_id");
