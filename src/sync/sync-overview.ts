import { SYNC_TABLES } from './sync-manager';
import { getTableStats, TableStat } from './sync-stats';

export type { TableStat };

// Business areas shown on the Sync Status page. Every table in SYNC_TABLES that is
// not listed here lands in "Other", so a newly synced table is never invisible.
export const SYNC_CATEGORIES: { key: string; label: string; tables: string[] }[] = [
    { key: 'fees', label: 'Fees & Finance', tables: ['SchoolFees', 'PaymentTransaction', 'FeeItem', 'FeeItemPayment', 'Refund', 'ControlSchoolFees', 'ControlPaymentTransaction', 'Expenditure', 'BursarCashInjection', 'ReamStockLedger', 'FinanceRequest'] },
    { key: 'marks', label: 'Marks & Exams', tables: ['Mark', 'ExamSequence', 'GeneratedReport', 'InterviewMark', 'ExamPaper', 'Question', 'ExamPaperQuestion', 'ReportRequest'] },
    { key: 'timetable', label: 'Timetable', tables: ['PeriodSet', 'Period', 'TeacherPeriod', 'SubClassSubject', 'TeacherPeriodAttendance', 'TeacherRollCall', 'TeacherRollCallEntry'] },
    { key: 'personnel', label: 'Personnel Management', tables: ['User', 'UserRole', 'RoleAssignment', 'SubjectTeacher', 'PayPeriod', 'SalaryProfile', 'SalaryAllowance', 'SalaryChangeRequest', 'SalaryPayment', 'SalaryWithholding', 'LeaveRequest', 'StaffLoan', 'StaffLoanRepayment'] },
    { key: 'students', label: 'Students & Enrollment', tables: ['Student', 'Enrollment', 'ParentStudent', 'StudentPreviousSchool', 'NurseVisitLog'] },
    { key: 'attendance', label: 'Student Attendance', tables: ['StudentAbsence', 'TeacherAbsence', 'DMRollCall', 'DMRollCallEntry'] },
    { key: 'discipline', label: 'Discipline', tables: ['DisciplineIssue', 'DisciplinaryAction', 'BrokenProperty', 'SaturdayPunishment', 'StudentWarning', 'ParentSummons', 'SeizedItem', 'SeizedItemTransfer'] },
    { key: 'academic', label: 'Academic Structure', tables: ['AcademicYear', 'Term', 'TermClass', 'Class', 'SubClass', 'Subject'] },
    { key: 'curriculum', label: 'Schemes & Logbook', tables: ['SubjectScheme', 'SchemeModule', 'SchemeChapter', 'SchemeLesson', 'LogbookEntry', 'QuizTemplate', 'QuizQuestion', 'QuizSubmission', 'QuizResponse', 'FormTemplate'] },
    { key: 'communication', label: 'Messages & Announcements', tables: ['Announcement', 'Message', 'ChatChannel', 'ChatChannelMember', 'ChatMessage', 'ChatMessageMention', 'ChatMessageReaction', 'ChatMessageAttachment'] },
    { key: 'inventory', label: 'Inventory & Tasks', tables: ['InventoryItem', 'InventoryHolding', 'InventoryTransfer', 'InventoryLedger', 'Task'] },
];

// Row count and newest change time for every synced table of THIS server.
export const getLocalTableStats = () => getTableStats(SYNC_TABLES);

export type TableStatus = 'in_sync' | 'local_ahead' | 'online_ahead' | 'unknown';

export type TableComparison = {
    table: string;
    local: number | null;
    online: number | null;
    difference: number | null;
    status: TableStatus;
    localLatest: string | null;
    onlineLatest: string | null;
};

export type CategoryComparison = {
    key: string;
    label: string;
    status: 'in_sync' | 'out_of_sync' | 'unknown';
    tables: TableComparison[];
};

const compareTable = (table: string, local: TableStat | undefined, online: TableStat | undefined): TableComparison => {
    const l = local?.count ?? null;
    const o = online?.count ?? null;
    let status: TableStatus = 'unknown';
    if (l !== null && o !== null) status = l === o ? 'in_sync' : l > o ? 'local_ahead' : 'online_ahead';
    return {
        table,
        local: l,
        online: o,
        difference: l !== null && o !== null ? l - o : null,
        status,
        localLatest: local?.latest ?? null,
        onlineLatest: online?.latest ?? null,
    };
};

export function buildComparison(local: Record<string, TableStat>, online: Record<string, TableStat> | null): CategoryComparison[] {
    const listed = new Set(SYNC_CATEGORIES.flatMap(c => c.tables));
    const other = SYNC_TABLES.filter(t => !listed.has(t));
    const groups = [...SYNC_CATEGORIES, ...(other.length ? [{ key: 'other', label: 'Other', tables: other }] : [])];

    return groups
        .map(group => {
            const tables = group.tables
                .filter(t => SYNC_TABLES.includes(t))
                .map(t => compareTable(t, local[t], online ? online[t] : undefined));
            let status: CategoryComparison['status'] = 'in_sync';
            if (!online || tables.some(t => t.status === 'unknown')) status = 'unknown';
            if (tables.some(t => t.status === 'local_ahead' || t.status === 'online_ahead')) status = 'out_of_sync';
            return { key: group.key, label: group.label, status, tables };
        })
        .filter(group => group.tables.length > 0);
}
