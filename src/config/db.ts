import {
    PrismaClient, User, SchoolFees, ControlSchoolFees, AcademicYear, Gender, SubjectCategory, Role, Student, ParentStudent,
    PaymentTransaction, ControlPaymentTransaction, PaymentMethod, Announcement, MobileNotification, Audience, Class, SubClass,
    Mark, ExamSequence, Term, Subject, SubjectTeacher, SubClassSubject, StudentAbsence, TeacherAbsence,
    DisciplineIssue, RoleAssignment, AssignmentRole,
    Period, TeacherPeriod, ExamPaper, ExamPaperQuestion, Question, QuestionType, NotificationStatus,
    DayOfWeek, Enrollment, StudentSequenceAverage, AverageStatus, UserRole, ExamSequenceStatus, ReportStatus, UserStatus,
    ReportType, Prisma, QuizTemplate, QuizQuestion, QuizSubmission, QuizResponse, QuizStatus,
    SyncMetadata, SyncLog, FeeItem, FeeItemPayment, FeeItemScope,
    Refund, RefundMethod,
    FinanceRequest, FinanceRequestType, FinanceRequestStatus,
    Expenditure, ExpenditureCategory,
    SaturdayPunishment, BrokenProperty, PunishmentStatus, DisciplineType, AbsenceType,
    DisciplinaryAction, DisciplinaryActionType, DisciplinaryActionStatus,
    ReportRequest, ReportRequestStatus,
    StudentPreviousSchool, StudentWarning, ParentSummons, DMRollCall, DMRollCallEntry,
    HealthCondition, MakeupStatus, SummonsTrigger, SummonsStatus, RollCallSlot, DMRollCallStatus, WarningReason,
    NurseVisitLog, TeacherPeriodAttendance, TeacherPeriodAttendanceStatus,
    SalaryProfile, SalaryChangeRequest, SalaryAllowance, PayPeriod, SalaryPayment, SalaryWithholding, BursarCashInjection,
    SalaryType, SalaryProfileStatus, SalaryAllowanceType, SalaryApprovalStatus, PayPeriodStatus, SalaryPaymentStatus, WithholdingScope, BursarCashInjectionSource,
    ReamStockLedger, ReamStockEntryType,
    Task, TaskPriority, TaskStatus, NotificationCategory, NotificationPriority,
    UserSettings, Theme,
    StaffLoan, StaffLoanRepayment, LoanStatus, LoanRepaymentMethod,
    LeaveRequest, LeaveStatus, LeaveType
} from '@prisma/client';
import * as dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config();

// Set the DATABASE_URL based on the environment
if (process.env.NODE_ENV === 'production') {
    process.env.DATABASE_URL = process.env.DATABASE_URL_PRODUCTION;
} else {
    process.env.DATABASE_URL = process.env.DATABASE_URL_DEVELOPMENT;
}

console.log(`Using database URL for ${process.env.NODE_ENV} environment`);

const prisma = new PrismaClient();

// Sync attribution: stamp server_id on every write to a synced table so the
// sync manager can tell "record was written by THIS server" apart from
// "record was pulled from a peer" and avoid echo loops. The sync module
// bypasses this by passing server_id explicitly (from the remote payload).
// Must stay in step with SYNC_TABLES in src/sync/sync-manager.ts: a table that
// syncs without being stamped here has server_id null on every local write, so
// the echo-loop filter in getLocalChanges cannot tell its own rows from a
// peer's and pushes them straight back.
const SYNCED_MODELS = new Set([
    'User', 'AcademicYear', 'Class', 'SubClass', 'Subject', 'Enrollment',
    'Mark', 'StudentAbsence', 'TeacherAbsence', 'PaymentTransaction',
    'GeneratedReport', 'Announcement',
    // Added so sync can bootstrap a node: without Student every Enrollment
    // failed on its foreign key, which cascaded to fees, payments and marks.
    'Student', 'PeriodSet', 'Term', 'Period', 'SubClassSubject',
    'ExamSequence', 'TeacherPeriod', 'ParentStudent', 'SchoolFees',
]);

prisma.$use(async (params, next) => {
    if (!params.model || !SYNCED_MODELS.has(params.model)) return next(params);
    const localId = process.env.SERVER_ID || 'local';

    if (params.action === 'create' || params.action === 'update') {
        if (params.args?.data && !('server_id' in params.args.data)) {
            params.args.data.server_id = localId;
        }
    } else if (params.action === 'upsert') {
        if (params.args?.create && !('server_id' in params.args.create)) {
            params.args.create.server_id = localId;
        }
        if (params.args?.update && !('server_id' in params.args.update)) {
            params.args.update.server_id = localId;
        }
    } else if (params.action === 'createMany' || params.action === 'updateMany') {
        const data = params.args?.data;
        if (Array.isArray(data)) {
            for (const row of data) {
                if (row && !('server_id' in row)) row.server_id = localId;
            }
        } else if (data && !('server_id' in data)) {
            data.server_id = localId;
        }
    }

    return next(params);
});

export {
    User, SchoolFees, ControlSchoolFees, AcademicYear, Gender, SubjectCategory, Role, Student, ParentStudent,
    PaymentTransaction, ControlPaymentTransaction, PaymentMethod, Announcement, MobileNotification, Audience, Class, SubClass,
    Mark, ExamSequence, Term, Subject, SubjectTeacher, SubClassSubject, StudentAbsence, TeacherAbsence,
    DisciplineIssue, RoleAssignment, AssignmentRole,
    Period, TeacherPeriod, ExamPaper, ExamPaperQuestion, Question, QuestionType, NotificationStatus,
    DayOfWeek, Enrollment, StudentSequenceAverage, AverageStatus, UserRole, ExamSequenceStatus, ReportStatus, UserStatus,
    ReportType, Prisma, QuizTemplate, QuizQuestion, QuizSubmission, QuizResponse, QuizStatus,
    SyncMetadata, SyncLog, FeeItem, FeeItemPayment, FeeItemScope,
    Refund, RefundMethod,
    FinanceRequest, FinanceRequestType, FinanceRequestStatus,
    Expenditure, ExpenditureCategory,
    SaturdayPunishment, BrokenProperty, PunishmentStatus, DisciplineType, AbsenceType,
    DisciplinaryAction, DisciplinaryActionType, DisciplinaryActionStatus,
    ReportRequest, ReportRequestStatus,
    StudentPreviousSchool, StudentWarning, ParentSummons, DMRollCall, DMRollCallEntry,
    HealthCondition, MakeupStatus, SummonsTrigger, SummonsStatus, RollCallSlot, DMRollCallStatus, WarningReason,
    NurseVisitLog, TeacherPeriodAttendance, TeacherPeriodAttendanceStatus,
    SalaryProfile, SalaryChangeRequest, SalaryAllowance, PayPeriod, SalaryPayment, SalaryWithholding, BursarCashInjection,
    SalaryType, SalaryProfileStatus, SalaryAllowanceType, SalaryApprovalStatus, PayPeriodStatus, SalaryPaymentStatus, WithholdingScope, BursarCashInjectionSource,
    ReamStockLedger, ReamStockEntryType,
    Task, TaskPriority, TaskStatus, NotificationCategory, NotificationPriority,
    UserSettings, Theme,
    StaffLoan, StaffLoanRepayment, LoanStatus, LoanRepaymentMethod,
    LeaveRequest, LeaveStatus, LeaveType
};

export default prisma; 