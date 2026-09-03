import prisma from '../config/db';
import { SyncLog, SyncStatus, SyncDirection, DeferredRecord } from './types';
import { DatabaseSyncer } from './database-syncer';
import { NetworkChecker } from './network-checker';

// Ordered so a table's dependencies are synced before it. The previous
// critical/operational/transactional grouping was not dependency-ordered and
// omitted Student and PeriodSet entirely, so on an empty database every
// Enrollment failed on Enrollment_student_id_fkey (1602 rows), taking
// SchoolFees, PaymentTransaction and Mark down with it.
//
// Order alone is not sufficient — Class references Class through
// next_class_id, so row order within a table matters too. The deferred-retry
// pass in performSync covers that, and any ordering mistake here.
const SYNC_TABLES: string[] = [
    // No foreign keys
    'AcademicYear',
    'User',
    'Subject',
    // -> User, AcademicYear
    'UserRole',
    // -> Subject, User
    'SubjectTeacher',
    // -> AcademicYear
    'Student',
    'PeriodSet',
    'Term',
    // -> PeriodSet
    'Period',
    'Class',
    // -> Term, Class
    'TermClass',
    // -> Class
    'SubClass',
    // -> SubClass, Subject, User
    'SubClassSubject',
    // -> User, AcademicYear, SubClass, Subject
    'RoleAssignment',
    // -> AcademicYear, Term
    'ExamSequence',
    // -> AcademicYear, Period, SubClass, Subject
    'TeacherPeriod',
    // -> Subject, Class, AcademicYear, User
    'SubjectScheme',
    // -> SubjectScheme
    'SchemeModule',
    // -> SchemeModule
    'SchemeChapter',
    // -> SchemeChapter, Term
    'SchemeLesson',
    // -> TeacherPeriod, SchemeLesson, User
    'LogbookEntry',
    // -> User, Student
    'ParentStudent',
    // -> AcademicYear, Student, Class, SubClass
    'Enrollment',
    // -> AcademicYear, Enrollment
    'SchoolFees',
    // -> AcademicYear, Enrollment, SchoolFees
    'PaymentTransaction',
    // -> Enrollment, ExamSequence, SubClassSubject
    'Mark',
    // -> User, Enrollment, TeacherPeriod
    'StudentAbsence',
    // -> User, TeacherPeriod
    'TeacherAbsence',
    // -> AcademicYear, ExamSequence, Student, SubClass
    'GeneratedReport',
    // -> AcademicYear, User
    'Announcement',
    // -> User (sender, receiver)
    'Message',
    // -> Subject, User
    'ChatChannel',
    // -> ChatChannel, User
    'ChatChannelMember',
    // -> ChatChannel, User, ChatMessage (self-ref via parent_message_id -> deferred pass)
    'ChatMessage',
    // -> ChatMessage, User
    'ChatMessageMention',
    // -> ChatMessage, User
    'ChatMessageReaction',
    // -> ChatMessage
    'ChatMessageAttachment',

    // ---- Student-level extensions (need Enrollment / Student) ----
    // -> Student
    'StudentPreviousSchool',
    // -> AcademicYear, Class, SubClass, Student, User
    'FeeItem',
    // -> AcademicYear, Enrollment
    'ControlSchoolFees',

    // ---- Discipline (all keyed on Enrollment + User) ----
    // -> Enrollment, User
    'BrokenProperty',
    'SaturdayPunishment',
    'StudentWarning',
    'ParentSummons',
    'DisciplineIssue',
    // -> DisciplineIssue, Enrollment, User
    'DisciplinaryAction',
    // -> Enrollment, AcademicYear, User
    'SeizedItem',
    // -> SeizedItem, User (self-cluster; deferred pass handles user resolution)
    'SeizedItemTransfer',
    // -> Enrollment, Period, User
    'NurseVisitLog',
    // -> Student
    'InterviewMark',

    // ---- Fees / finance extensions (SchoolFees + PaymentTransaction already synced) ----
    // -> FeeItem, Enrollment, User
    'FeeItemPayment',
    // -> SchoolFees, Enrollment, User
    'Refund',
    // -> ControlSchoolFees, AcademicYear, Enrollment, User
    'ControlPaymentTransaction',
    // -> User, AcademicYear
    'Expenditure',
    'BursarCashInjection',
    'ReamStockLedger',
    // -> User
    'FinanceRequest',
    'Task',
    'ReportRequest',

    // ---- Attendance (teacher-side; student-side StudentAbsence already synced) ----
    // -> SubClass, AcademicYear, User
    'DMRollCall',
    // -> DMRollCall, Enrollment, StudentAbsence
    'DMRollCallEntry',
    // -> TeacherPeriod, AcademicYear, User
    'TeacherRollCall',
    // -> TeacherRollCall, Enrollment, StudentAbsence
    'TeacherRollCallEntry',
    // -> TeacherPeriod, AcademicYear, User
    'TeacherPeriodAttendance',

    // ---- Payroll / HR ----
    // -> AcademicYear, User
    'PayPeriod',
    // -> User, AcademicYear
    'SalaryProfile',
    // -> SalaryProfile, PayPeriod, User
    'SalaryAllowance',
    'SalaryChangeRequest',
    'SalaryPayment',
    // -> SalaryPayment, User
    'SalaryWithholding',
    // -> User
    'LeaveRequest',
    'StaffLoan',
    // -> StaffLoan, User
    'StaffLoanRepayment',

    // ---- Inventory ----
    // -> User
    'InventoryItem',
    // -> InventoryItem, User
    'InventoryHolding',
    'InventoryTransfer',
    // -> InventoryItem, User, InventoryTransfer
    'InventoryLedger',

    // ---- Exam papers / quizzes / forms (curriculum content) ----
    // -> AcademicYear, Subject
    'ExamPaper',
    // -> Subject
    'Question',
    // -> ExamPaper, Question (composite PK, both parents already listed)
    'ExamPaperQuestion',
    // -> Subject, AcademicYear, User
    'QuizTemplate',
    // -> QuizTemplate
    'QuizQuestion',
    // -> QuizTemplate, Student, User, AcademicYear
    'QuizSubmission',
    // -> QuizSubmission, QuizQuestion
    'QuizResponse',
    // (no FKs)
    'FormTemplate',
    // -> FormTemplate, User
    'FormSubmission',
];

// Deferred records are retried until a pass applies nothing new. The cap is a
// backstop against a pathological cycle, not an expected limit — a correctly
// ordered run converges in one or two passes.
const MAX_DEFERRED_PASSES = 5;

export class SyncManager {
    private dbSyncer: DatabaseSyncer;
    private networkChecker: NetworkChecker;
    private syncInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.dbSyncer = new DatabaseSyncer();
        this.networkChecker = new NetworkChecker();
    }

    async startAutoSync(intervalMinutes: number = 5) {
        // setInterval(fn, 0) fires on every event-loop turn, so AUTO_SYNC_INTERVAL=0
        // — the intuitive way to switch sync off — instead span the sync loop as
        // fast as the CPU allowed. Treat any non-positive interval as "disabled".
        if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
            console.log('Auto-sync disabled (AUTO_SYNC_INTERVAL <= 0)');
            return;
        }

        console.log(`Starting auto-sync every ${intervalMinutes} minutes`);

        this.syncInterval = setInterval(async () => {
            if (await this.networkChecker.isOnline()) {
                await this.performSync();
            } else {
                console.log('Network offline - skipping sync');
            }
        }, intervalMinutes * 60 * 1000);
    }

    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    async performSync(): Promise<SyncLog> {
        const syncLog: SyncLog = {
            id: Date.now().toString(),
            startTime: new Date(),
            status: SyncStatus.IN_PROGRESS,
            direction: SyncDirection.BIDIRECTIONAL,
            recordsProcessed: 0,
            conflicts: [],
            errors: []
        };

        try {
            // No peer configured means there is nothing to sync with. Bail out
            // before touching the tables so a manual /sync/trigger returns one
            // clear reason rather than one push failure per local record.
            if (!this.dbSyncer.isRemoteConfigured()) {
                syncLog.status = SyncStatus.FAILED;
                syncLog.endTime = new Date();
                syncLog.errors.push('REMOTE_SYNC_URL is not configured — no peer to sync with');
                console.warn('Sync skipped: REMOTE_SYNC_URL is not configured');
                await this.saveSyncLog(syncLog);
                return syncLog;
            }

            console.log('Starting database sync...');

            // 1. Get last sync timestamp
            const lastSync = await this.getLastSyncTimestamp();

            // 2. Sync every table in dependency order, collecting records whose
            //    referenced rows have not arrived yet.
            const deferred = await this.syncAllTables(lastSync, syncLog);

            // 3. Retry those until a pass stops making progress. This is what
            //    resolves self-references (Class -> Class) and anything the
            //    static ordering gets wrong.
            await this.drainDeferred(deferred, syncLog);

            // 4. Only move the cursor past this window when the run was clean.
            // getLastSyncTimestamp/updateSyncTimestamp is a single global "since"
            // cursor, not per-table, and it used to advance unconditionally. A
            // table that failed outright (LAN drop -> connect ETIMEDOUT, seen
            // repeatedly against the VPS) throws before pushLocalChanges or
            // pullRemoteChanges ever runs, so nothing for that table was pushed
            // or pulled this window -- but the next run's `since` still started
            // after it, so whatever changed on either side during the outage
            // (a student created on the VPS while the LAN was down, say) is
            // skipped forever, not just delayed. Not hypothetical: SyncMetadata
            // shows dozens of 15-90 minute gaps, several on tables including
            // Student and Enrollment, over the last two weeks.
            //
            // Holding the cursor back on any error means the next run rescans
            // the same window, including tables that already succeeded -- safe,
            // because every apply here is upsert-by-id-or-natural-key and
            // idempotent, so re-processing an already-synced record is a no-op.
            const hadErrors = syncLog.errors.length > 0;
            if (!hadErrors) {
                await this.updateSyncTimestamp();
            }

            // Per-table failures are collected into syncLog.errors rather than
            // thrown, so reporting COMPLETED unconditionally hid them: a sync
            // that skipped half its tables still looked healthy. Surface those
            // as PARTIAL so monitoring (§10) can actually alert on them.
            syncLog.status = hadErrors ? SyncStatus.PARTIAL : SyncStatus.COMPLETED;
            syncLog.endTime = new Date();

            if (hadErrors) {
                console.warn(
                    `Sync PARTIAL: ${syncLog.recordsProcessed} records processed, ` +
                    `${syncLog.errors.length} issue(s), cursor held back for retry:`
                );
                for (const err of syncLog.errors) console.warn(`  - ${err}`);
            } else {
                console.log(`Sync completed: ${syncLog.recordsProcessed} records processed`);
            }

        } catch (error: any) {
            syncLog.status = SyncStatus.FAILED;
            syncLog.errors.push(error.message);
            console.error('Sync failed:', error);
        }

        await this.saveSyncLog(syncLog);
        return syncLog;
    }

    // Walks SYNC_TABLES in dependency order and returns the records held back
    // because something they reference has not arrived yet.
    private async syncAllTables(lastSync: Date, syncLog: SyncLog): Promise<DeferredRecord[]> {
        const deferred: DeferredRecord[] = [];

        for (const table of SYNC_TABLES) {
            try {
                const result = await this.dbSyncer.syncTable(table, lastSync);
                syncLog.recordsProcessed += result.recordsProcessed;
                syncLog.conflicts.push(...result.conflicts);
                // syncTable collects per-record failures into result.errors rather
                // than throwing, so without this they were dropped entirely: a run
                // where every single insert failed still reported COMPLETED with a
                // clean error list. The catch below only ever saw thrown exceptions.
                syncLog.errors.push(...result.errors);
                deferred.push(...result.deferred);
            } catch (error: any) {
                syncLog.errors.push(`${table}: ${error.message}`);
            }
        }

        return deferred;
    }

    // Retries held-back records until a pass applies nothing new. Whatever is
    // left after that genuinely cannot be placed — it points at a table this
    // module does not sync — so it becomes a reported error rather than
    // vanishing.
    private async drainDeferred(deferred: DeferredRecord[], syncLog: SyncLog) {
        let pending = deferred;

        for (let pass = 1; pending.length > 0 && pass <= MAX_DEFERRED_PASSES; pass++) {
            const { applied, remaining } = await this.dbSyncer.retryDeferred(pending);
            console.log(
                `Deferred pass ${pass}: applied ${applied}, ${remaining.length} still waiting`
            );
            syncLog.recordsProcessed += applied;

            // No progress means every remaining record is blocked on something
            // this run will never produce. Further passes cannot help.
            if (applied === 0) {
                pending = remaining;
                break;
            }
            pending = remaining;
        }

        if (pending.length === 0) return;

        // Collapse to one line per table+constraint; thousands of identical FK
        // failures are one problem, not thousands.
        const grouped = new Map<string, number>();
        for (const item of pending) {
            const key = `${item.table}: ${item.lastError}`;
            grouped.set(key, (grouped.get(key) ?? 0) + 1);
        }
        for (const [key, count] of grouped) {
            syncLog.errors.push(`${key} (${count} record${count === 1 ? '' : 's'} unplaced)`);
        }
    }

    private async getLastSyncTimestamp(): Promise<Date> {
        const lastSync = await prisma.syncMetadata.findFirst({
            orderBy: { timestamp: 'desc' }
        });

        return lastSync?.timestamp || new Date(0);
    }

    private async updateSyncTimestamp() {
        await prisma.syncMetadata.create({
            data: {
                timestamp: new Date(),
                server_type: process.env.SERVER_TYPE || 'local'
            }
        });
    }

    private async saveSyncLog(syncLog: SyncLog) {
        await prisma.syncLog.create({
            data: {
                sync_id: syncLog.id,
                start_time: syncLog.startTime,
                end_time: syncLog.endTime,
                status: syncLog.status,
                direction: syncLog.direction,
                records_processed: syncLog.recordsProcessed,
                conflicts: JSON.stringify(syncLog.conflicts),
                errors: JSON.stringify(syncLog.errors)
            }
        });
    }

    async getSyncStatus() {
        const lastSync = await prisma.syncLog.findFirst({
            orderBy: { start_time: 'desc' }
        });

        const isOnline = await this.networkChecker.isOnline();

        return {
            lastSync: lastSync?.start_time,
            lastSyncStatus: lastSync?.status,
            isOnline,
            autoSyncEnabled: this.syncInterval !== null
        };
    }
}