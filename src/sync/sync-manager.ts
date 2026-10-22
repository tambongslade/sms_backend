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
    // -> Student  (U13 transfer-out; table from migration 20261020400000_add_student_transfer)
    'StudentTransfer',
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

// Cross-tick failure ceiling. After MAX_STRIKES consecutive failures a record
// is quarantined: still attempted every tick (auto-recovery when the underlying
// data problem gets fixed on either side), but no longer blocks its table's
// cursor from advancing. Anything below this counts as a blocker -- one
// unquarantined failure is enough to pin the whole table's cursor. Matches the
// deferred-passes philosophy: "genuinely can't be placed."
const MAX_STRIKES = 5;

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

            // 1. Sync every table in dependency order. Each table reads its own
            //    cursor (SyncCursor) and captures its own start-time; those
            //    start-times are held aside so cursors can be advanced AFTER
            //    the deferred retry pass, once we know which records are truly
            //    still failing.
            const { deferred, tableRuns } = await this.syncAllTables(syncLog);

            // 2. Retry deferred records until a pass stops making progress.
            //    Resolves self-references (Class -> Class) and static-ordering
            //    misses. Records that still fail after this pass get a
            //    cross-tick strike (SyncFailure).
            await this.drainDeferred(deferred, syncLog);

            // 3. For each table: advance its cursor to the captured start-time
            //    if -- and only if -- no unquarantined failures remain for that
            //    table. A single failing record with strikes < MAX_STRIKES
            //    holds the cursor for that one table; every other table
            //    advances on its own schedule. This is the whole point of the
            //    per-table cursor.
            for (const run of tableRuns) {
                await this.maybeAdvanceCursor(run.table, run.startTime);
            }

            // Per-table failures are collected into syncLog.errors rather than
            // thrown, so reporting COMPLETED unconditionally hid them: a sync
            // that skipped half its tables still looked healthy. Surface those
            // as PARTIAL so monitoring (§10) can actually alert on them.
            syncLog.status = syncLog.errors.length > 0
                ? SyncStatus.PARTIAL
                : SyncStatus.COMPLETED;
            syncLog.endTime = new Date();

            if (syncLog.errors.length > 0) {
                console.warn(
                    `Sync PARTIAL: ${syncLog.recordsProcessed} records processed, ` +
                    `${syncLog.errors.length} issue(s):`
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

    // Walks SYNC_TABLES in dependency order. For each table: capture a
    // start-time BEFORE reading its cursor and fetching its batch (so records
    // created mid-tick with a later updated_at cannot be skipped when we later
    // advance the cursor), then push+pull. Returns the deferred records for
    // the retry pass plus a per-table run record the caller uses to decide
    // cursor advances after the deferred pass has settled.
    private async syncAllTables(syncLog: SyncLog): Promise<{
        deferred: DeferredRecord[];
        tableRuns: { table: string; startTime: Date }[];
    }> {
        const deferred: DeferredRecord[] = [];
        const tableRuns: { table: string; startTime: Date }[] = [];

        for (const table of SYNC_TABLES) {
            const startTime = new Date();
            try {
                const cursor = await this.getTableCursor(table);
                const result = await this.dbSyncer.syncTable(table, cursor);
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
            tableRuns.push({ table, startTime });
        }

        return { deferred, tableRuns };
    }

    // Retries held-back records until a pass applies nothing new. Records
    // that clear the retry get their SyncFailure row deleted (any transient
    // problem is over). Records still unplaced after MAX_DEFERRED_PASSES get
    // a cross-tick strike bump -- five straight ticks in this state and they
    // quarantine, letting their table's cursor advance while they keep being
    // logged and retried every tick for auto-recovery.
    private async drainDeferred(deferred: DeferredRecord[], syncLog: SyncLog) {
        // Snapshot the initial pending set so we can identify which records
        // got applied by the retry pass. Anything applied gets its SyncFailure
        // row cleared; anything still pending at the end gets a strike.
        const initialKeys = new Set(deferred.map(d => this.failureKey(d.table, Number(d.record.id))));

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

        // Success side: records that started pending but aren't in the final
        // set got placed. Clear their failure rows.
        const finalKeys = new Set(pending.map(p => this.failureKey(p.table, p.record.id)));
        for (const key of initialKeys) {
            if (!finalKeys.has(key)) {
                const [table, idStr] = key.split('#');
                await this.dbSyncer.recordSuccess(table, Number(idStr), 'pull');
            }
        }

        if (pending.length === 0) return;

        // Failure side: bump strikes for each record that made it through the
        // whole deferred pass and still failed. Once strikes hit MAX_STRIKES,
        // the record is quarantined and stops holding back its table's cursor.
        for (const item of pending) {
            await this.dbSyncer.recordFailure(item.table, Number(item.record.id), 'pull', item.lastError);
        }

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

    private failureKey(table: string, recordId: number): string {
        return `${table}#${recordId}`;
    }

    // Per-table cursor read. Falls back to the legacy global SyncMetadata
    // timestamp on first-run-per-table so no table regresses to epoch after
    // deploy: whatever the last global tick reached becomes each table's
    // starting cursor. If neither exists (fresh install), epoch is the safe
    // default -- the sync will just re-scan everything, all writes are
    // idempotent via findLocalMatch.
    private async getTableCursor(tableName: string): Promise<Date> {
        const row = await prisma.syncCursor.findUnique({ where: { table_name: tableName } });
        if (row) return row.cursor;

        const legacy = await prisma.syncMetadata.findFirst({ orderBy: { timestamp: 'desc' } });
        const seed = legacy?.timestamp || new Date(0);
        await prisma.syncCursor.create({ data: { table_name: tableName, cursor: seed } });
        return seed;
    }

    // Advance a table's cursor iff no unquarantined failures remain for it.
    // Never regresses -- if the caller's captured startTime is somehow earlier
    // than the stored cursor (clock skew, concurrent run), the write is a
    // no-op rather than a rewind.
    private async maybeAdvanceCursor(tableName: string, newCursor: Date) {
        const blockers = await prisma.syncFailure.count({
            where: { table_name: tableName, strikes: { lt: MAX_STRIKES } }
        });
        if (blockers > 0) return;

        const existing = await prisma.syncCursor.findUnique({ where: { table_name: tableName } });
        if (existing && existing.cursor >= newCursor) return;

        await prisma.syncCursor.upsert({
            where: { table_name: tableName },
            update: { cursor: newCursor },
            create: { table_name: tableName, cursor: newCursor }
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