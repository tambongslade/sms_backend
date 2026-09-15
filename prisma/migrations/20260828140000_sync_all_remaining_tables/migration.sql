-- Big-bang: pull every remaining operational / content table into the sync
-- set. Prior sync migrations covered core identity, academic structure, chat
-- and scheme-of-work; this one covers discipline, teacher-side attendance,
-- fees + finance, HR/payroll, inventory, exam/quiz/forms, and general task/
-- report flows. Local-only tables (AuditLog, SyncLog, SyncMetadata,
-- StudentSequenceAverage, MobileNotification, UserSettings) are excluded on
-- purpose — the sync-manager comment covers why.
--
-- Same watermark warning as prior sync-expansion migrations (see
-- 20260817120000, 20260827120000, 20260827140000, 20260828120000): existing
-- rows land with server_id = NULL. That is deliberate — the null value lets
-- getLocalChanges push them once from whichever node owns them today. Do NOT
-- rewind the sync watermark on the VPS after this ships: rewinding re-runs
-- pullRemoteChanges with peerId attribution over the current NULL rows and
-- stamps them with the VPS's SERVER_ID, at which point the peer's
-- `server_id IS NULL OR server_id = <its own>` filter hides them from every
-- other node. This is the same fault the sync-manager comment records as
-- having hit 6370 production rows once already; the size of this batch makes
-- the same mistake proportionally worse.
--
-- Six tables need timestamps backfilled first:
--   - StaffLoanRepayment, InventoryLedger        (missing updated_at)
--   - InventoryHolding                            (missing created_at)
--   - SeizedItemTransfer, InventoryTransfer,      (missing both — logically
--     ExamPaperQuestion                            "initiated_at" or none)
-- Existing rows get CURRENT_TIMESTAMP so getLocalChanges' updated_at filter
-- treats them as "just written here" on the first pass, which is fine because
-- server_id is NULL too and both filters agree.

-- =========================================================================
-- Discipline
-- =========================================================================
ALTER TABLE "DisciplineIssue"    ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "DisciplinaryAction" ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "SaturdayPunishment" ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "StudentWarning"     ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "ParentSummons"      ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "SeizedItem"         ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "BrokenProperty"     ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;

ALTER TABLE "SeizedItemTransfer"
    ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "server_id"  TEXT,
    ADD COLUMN "checksum"   TEXT;

CREATE INDEX "DisciplineIssue_server_id_idx"    ON "DisciplineIssue"("server_id");
CREATE INDEX "DisciplinaryAction_server_id_idx" ON "DisciplinaryAction"("server_id");
CREATE INDEX "SaturdayPunishment_server_id_idx" ON "SaturdayPunishment"("server_id");
CREATE INDEX "StudentWarning_server_id_idx"     ON "StudentWarning"("server_id");
CREATE INDEX "ParentSummons_server_id_idx"      ON "ParentSummons"("server_id");
CREATE INDEX "SeizedItem_server_id_idx"         ON "SeizedItem"("server_id");
CREATE INDEX "BrokenProperty_server_id_idx"     ON "BrokenProperty"("server_id");
CREATE INDEX "SeizedItemTransfer_server_id_idx" ON "SeizedItemTransfer"("server_id");

-- =========================================================================
-- Teacher-side attendance / roll call / nurse
-- =========================================================================
ALTER TABLE "TeacherPeriodAttendance" ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "TeacherRollCall"         ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "TeacherRollCallEntry"    ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "DMRollCall"              ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "DMRollCallEntry"         ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "NurseVisitLog"           ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;

CREATE INDEX "TeacherPeriodAttendance_server_id_idx" ON "TeacherPeriodAttendance"("server_id");
CREATE INDEX "TeacherRollCall_server_id_idx"         ON "TeacherRollCall"("server_id");
CREATE INDEX "TeacherRollCallEntry_server_id_idx"    ON "TeacherRollCallEntry"("server_id");
CREATE INDEX "DMRollCall_server_id_idx"              ON "DMRollCall"("server_id");
CREATE INDEX "DMRollCallEntry_server_id_idx"         ON "DMRollCallEntry"("server_id");
CREATE INDEX "NurseVisitLog_server_id_idx"           ON "NurseVisitLog"("server_id");

-- =========================================================================
-- Fees + finance (the newer FeeItem / ControlSchoolFees / Refund / Expenditure
-- cluster — SchoolFees + PaymentTransaction were already synced earlier)
-- =========================================================================
ALTER TABLE "FeeItem"                  ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "FeeItemPayment"           ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "Refund"                   ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "FinanceRequest"           ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "Expenditure"              ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "BursarCashInjection"      ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "ControlSchoolFees"        ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "ControlPaymentTransaction" ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;

CREATE INDEX "FeeItem_server_id_idx"                   ON "FeeItem"("server_id");
CREATE INDEX "FeeItemPayment_server_id_idx"            ON "FeeItemPayment"("server_id");
CREATE INDEX "Refund_server_id_idx"                    ON "Refund"("server_id");
CREATE INDEX "FinanceRequest_server_id_idx"            ON "FinanceRequest"("server_id");
CREATE INDEX "Expenditure_server_id_idx"               ON "Expenditure"("server_id");
CREATE INDEX "BursarCashInjection_server_id_idx"       ON "BursarCashInjection"("server_id");
CREATE INDEX "ControlSchoolFees_server_id_idx"         ON "ControlSchoolFees"("server_id");
CREATE INDEX "ControlPaymentTransaction_server_id_idx" ON "ControlPaymentTransaction"("server_id");

-- =========================================================================
-- HR / payroll
-- =========================================================================
ALTER TABLE "PayPeriod"            ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "SalaryProfile"        ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "SalaryAllowance"      ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "SalaryWithholding"    ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "SalaryPayment"        ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "SalaryChangeRequest"  ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "LeaveRequest"         ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "StaffLoan"            ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;

ALTER TABLE "StaffLoanRepayment"
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "server_id"  TEXT,
    ADD COLUMN "checksum"   TEXT;

CREATE INDEX "PayPeriod_server_id_idx"           ON "PayPeriod"("server_id");
CREATE INDEX "SalaryProfile_server_id_idx"       ON "SalaryProfile"("server_id");
CREATE INDEX "SalaryAllowance_server_id_idx"     ON "SalaryAllowance"("server_id");
CREATE INDEX "SalaryWithholding_server_id_idx"   ON "SalaryWithholding"("server_id");
CREATE INDEX "SalaryPayment_server_id_idx"       ON "SalaryPayment"("server_id");
CREATE INDEX "SalaryChangeRequest_server_id_idx" ON "SalaryChangeRequest"("server_id");
CREATE INDEX "LeaveRequest_server_id_idx"        ON "LeaveRequest"("server_id");
CREATE INDEX "StaffLoan_server_id_idx"           ON "StaffLoan"("server_id");
CREATE INDEX "StaffLoanRepayment_server_id_idx"  ON "StaffLoanRepayment"("server_id");

-- =========================================================================
-- Inventory (Item + Holding + Transfer + Ledger + ReamStockLedger)
-- =========================================================================
ALTER TABLE "InventoryItem"    ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "ReamStockLedger"  ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;

ALTER TABLE "InventoryHolding"
    ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "server_id"  TEXT,
    ADD COLUMN "checksum"   TEXT;

ALTER TABLE "InventoryTransfer"
    ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "server_id"  TEXT,
    ADD COLUMN "checksum"   TEXT;

ALTER TABLE "InventoryLedger"
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "server_id"  TEXT,
    ADD COLUMN "checksum"   TEXT;

CREATE INDEX "InventoryItem_server_id_idx"     ON "InventoryItem"("server_id");
CREATE INDEX "InventoryHolding_server_id_idx"  ON "InventoryHolding"("server_id");
CREATE INDEX "InventoryTransfer_server_id_idx" ON "InventoryTransfer"("server_id");
CREATE INDEX "InventoryLedger_server_id_idx"   ON "InventoryLedger"("server_id");
CREATE INDEX "ReamStockLedger_server_id_idx"   ON "ReamStockLedger"("server_id");

-- =========================================================================
-- Exam papers / quiz / forms / interview marks
-- =========================================================================
ALTER TABLE "ExamPaper"       ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "Question"        ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "QuizTemplate"    ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "QuizQuestion"    ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "QuizSubmission"  ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "QuizResponse"    ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "FormTemplate"    ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "FormSubmission"  ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "InterviewMark"   ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;

ALTER TABLE "ExamPaperQuestion"
    ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "server_id"  TEXT,
    ADD COLUMN "checksum"   TEXT;

CREATE INDEX "ExamPaper_server_id_idx"         ON "ExamPaper"("server_id");
CREATE INDEX "Question_server_id_idx"          ON "Question"("server_id");
CREATE INDEX "QuizTemplate_server_id_idx"      ON "QuizTemplate"("server_id");
CREATE INDEX "QuizQuestion_server_id_idx"      ON "QuizQuestion"("server_id");
CREATE INDEX "QuizSubmission_server_id_idx"    ON "QuizSubmission"("server_id");
CREATE INDEX "QuizResponse_server_id_idx"      ON "QuizResponse"("server_id");
CREATE INDEX "FormTemplate_server_id_idx"      ON "FormTemplate"("server_id");
CREATE INDEX "FormSubmission_server_id_idx"    ON "FormSubmission"("server_id");
CREATE INDEX "InterviewMark_server_id_idx"     ON "InterviewMark"("server_id");
CREATE INDEX "ExamPaperQuestion_server_id_idx" ON "ExamPaperQuestion"("server_id");

-- =========================================================================
-- Other operational
-- =========================================================================
ALTER TABLE "Task"                  ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "ReportRequest"         ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "StudentPreviousSchool" ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;

CREATE INDEX "Task_server_id_idx"                  ON "Task"("server_id");
CREATE INDEX "ReportRequest_server_id_idx"         ON "ReportRequest"("server_id");
CREATE INDEX "StudentPreviousSchool_server_id_idx" ON "StudentPreviousSchool"("server_id");
