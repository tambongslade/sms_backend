// Super Manager Overview Service — read-only aggregated metrics for
// dashboards / charts. Every function is scoped to an academic year
// (defaulting to the current one) and returns chart-friendly shapes
// (counts, groupings, top-N lists, time-bucketed trends).

import prisma from '../../../config/db';
import { getCurrentAcademicYear } from '../../../utils/academicYear';
import { getClassMaxStudents, SUBCLASS_MAX_STUDENTS } from '../../../utils/capacity';

// -------- helpers --------

async function resolveYearId(academicYearId?: number): Promise<number | undefined> {
    if (academicYearId) return academicYearId;
    const current = await getCurrentAcademicYear();
    return current?.id;
}

function startOfMonth(d = new Date()): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

function toPct(numerator: number, denominator: number): number {
    if (!denominator) return 0;
    return Math.round((numerator / denominator) * 10000) / 100;
}

// ============================================================
// 1. DISCIPLINE OVERVIEW
// ============================================================
export async function getDisciplineOverview(academicYearId?: number) {
    const yearId = await resolveYearId(academicYearId);
    const enrollmentFilter = yearId ? { enrollment: { academic_year_id: yearId } } : undefined;
    const enrollmentAcademicYearFilter = yearId ? { academic_year_id: yearId } : undefined;

    const [
        issuesByType,
        issuesLast30d,
        latenessCount,
        classAbsenceCount,
        activeWarnings,
        pendingSummons,
        pendingSaturdayPunishments,
        disciplinaryActionsByType,
        disciplinaryActionsByStatus,
        seizedInCustody,
        seizedByStatus,
        recentRollCalls,
    ] = await Promise.all([
        prisma.disciplineIssue.groupBy({
            by: ['issue_type'],
            where: enrollmentFilter,
            _count: { id: true },
        }),
        prisma.disciplineIssue.count({
            where: {
                ...enrollmentFilter,
                created_at: { gte: daysAgo(30) },
            },
        }),
        prisma.studentAbsence.count({
            where: {
                absence_type: 'MORNING_LATENESS',
                is_excused: false,
                ...(yearId ? { enrollment: { academic_year_id: yearId } } : {}),
            },
        }),
        prisma.studentAbsence.count({
            where: {
                absence_type: 'CLASS_ABSENCE',
                is_excused: false,
                ...(yearId ? { enrollment: { academic_year_id: yearId } } : {}),
            },
        }),
        prisma.studentWarning.count({
            where: {
                resolved: false,
                ...(yearId ? { enrollment: { academic_year_id: yearId } } : {}),
            },
        }),
        prisma.parentSummons.count({
            where: {
                status: 'PENDING',
                ...(yearId ? { enrollment: { academic_year_id: yearId } } : {}),
            },
        }),
        prisma.saturdayPunishment.count({
            where: {
                status: 'PENDING',
                ...(yearId ? { enrollment: { academic_year_id: yearId } } : {}),
            },
        }),
        prisma.disciplinaryAction.groupBy({
            by: ['action_type'],
            where: yearId ? { enrollment: { academic_year_id: yearId } } : undefined,
            _count: { id: true },
        }),
        prisma.disciplinaryAction.groupBy({
            by: ['status'],
            where: yearId ? { enrollment: { academic_year_id: yearId } } : undefined,
            _count: { id: true },
        }),
        prisma.seizedItem.count({
            where: {
                status: 'IN_CUSTODY',
                ...(enrollmentAcademicYearFilter || {}),
            },
        }),
        prisma.seizedItem.groupBy({
            by: ['status'],
            where: enrollmentAcademicYearFilter,
            _count: { id: true },
        }),
        prisma.dMRollCall.count({
            where: {
                date: { gte: daysAgo(7) },
                ...(enrollmentAcademicYearFilter || {}),
            },
        }),
    ]);

    const totalIssues = issuesByType.reduce((s, i) => s + i._count.id, 0);

    return {
        summary: {
            totalIssues,
            issuesLast30Days: issuesLast30d,
            unexcusedLateness: latenessCount,
            unexcusedClassAbsences: classAbsenceCount,
            activeWarnings,
            pendingParentSummons: pendingSummons,
            pendingSaturdayPunishments,
            seizedItemsInCustody: seizedInCustody,
            rollCallsThisWeek: recentRollCalls,
        },
        issuesByType: issuesByType.map(i => ({ type: i.issue_type, count: i._count.id })),
        disciplinaryActions: {
            byType: disciplinaryActionsByType.map(a => ({ type: a.action_type, count: a._count.id })),
            byStatus: disciplinaryActionsByStatus.map(a => ({ status: a.status, count: a._count.id })),
        },
        seizedItemsByStatus: seizedByStatus.map(s => ({ status: s.status, count: s._count.id })),
        lastUpdated: new Date().toISOString(),
    };
}

// ============================================================
// 2. ATTENDANCE OVERVIEW
// ============================================================
export async function getAttendanceOverview(academicYearId?: number) {
    const yearId = await resolveYearId(academicYearId);

    const [
        rollCallStatusStudent,
        teacherPeriodStatus,
        totalRollCallsThisMonth,
        totalTeacherEvalThisMonth,
        teacherAbsencesLast30d,
        rollCallStatusTeacherStudent,
    ] = await Promise.all([
        prisma.dMRollCallEntry.groupBy({
            by: ['status'],
            where: yearId ? { dm_roll_call: { academic_year_id: yearId } } : undefined,
            _count: { id: true },
        }),
        prisma.teacherPeriodAttendance.groupBy({
            by: ['status'],
            where: {
                date: { gte: startOfMonth() },
                ...(yearId ? { academic_year_id: yearId } : {}),
            },
            _count: { id: true },
        }),
        prisma.dMRollCall.count({
            where: {
                date: { gte: startOfMonth() },
                ...(yearId ? { academic_year_id: yearId } : {}),
            },
        }),
        prisma.teacherPeriodAttendance.count({
            where: {
                date: { gte: startOfMonth() },
                ...(yearId ? { academic_year_id: yearId } : {}),
            },
        }),
        prisma.teacherAbsence.count({
            where: { created_at: { gte: daysAgo(30) } },
        }),
        prisma.teacherRollCallEntry.groupBy({
            by: ['status'],
            where: yearId ? { teacher_roll_call: { academic_year_id: yearId } } : undefined,
            _count: { id: true },
        }),
    ]);

    const studentTotal = rollCallStatusStudent.reduce((s, r) => s + r._count.id, 0);
    const studentPresent = rollCallStatusStudent.find(r => r.status === 'PRESENT')?._count.id || 0;
    const teacherTotal = teacherPeriodStatus.reduce((s, r) => s + r._count.id, 0);
    const teacherPresent = teacherPeriodStatus.find(r => r.status === 'PRESENT')?._count.id || 0;

    return {
        summary: {
            studentAttendanceRate: toPct(studentPresent, studentTotal),
            teacherAttendanceRateThisMonth: toPct(teacherPresent, teacherTotal),
            rollCallsThisMonth: totalRollCallsThisMonth,
            teacherEvaluationsThisMonth: totalTeacherEvalThisMonth,
            teacherAbsencesLast30Days: teacherAbsencesLast30d,
        },
        studentRollCallByStatus: rollCallStatusStudent.map(r => ({ status: r.status, count: r._count.id })),
        teacherAttendanceByStatus: teacherPeriodStatus.map(r => ({ status: r.status, count: r._count.id })),
        teacherRollCallByStatus: rollCallStatusTeacherStudent.map(r => ({ status: r.status, count: r._count.id })),
        lastUpdated: new Date().toISOString(),
    };
}

// ============================================================
// 3. ACADEMIC OVERVIEW
// ============================================================
export async function getAcademicOverview(academicYearId?: number) {
    const yearId = await resolveYearId(academicYearId);

    const [
        sequencesByStatus,
        totalMarks,
        pendingReports,
        reportsByStatus,
        subjectSchemes,
        logbookByStatus,
        recentLogbook,
        studentAveragesGrouped,
    ] = await Promise.all([
        prisma.examSequence.groupBy({
            by: ['status'],
            where: yearId ? { academic_year_id: yearId } : undefined,
            _count: { id: true },
        }),
        prisma.mark.count({
            where: yearId ? { exam_sequence: { academic_year_id: yearId } } : undefined,
        }),
        prisma.generatedReport.count({
            where: {
                status: 'PENDING',
                ...(yearId ? { academic_year_id: yearId } : {}),
            },
        }),
        prisma.generatedReport.groupBy({
            by: ['status'],
            where: yearId ? { academic_year_id: yearId } : undefined,
            _count: { id: true },
        }),
        prisma.subjectScheme.count({
            where: yearId ? { academic_year_id: yearId } : undefined,
        }),
        prisma.logbookEntry.groupBy({
            by: ['status'],
            where: { date_taught: { gte: daysAgo(30) } },
            _count: { id: true },
        }),
        prisma.logbookEntry.count({
            where: { date_taught: { gte: daysAgo(7) } },
        }),
        prisma.studentSequenceAverage.groupBy({
            by: ['status'],
            where: yearId ? { exam_sequence: { academic_year_id: yearId } } : undefined,
            _count: { id: true },
        }),
    ]);

    return {
        summary: {
            totalExamSequences: sequencesByStatus.reduce((s, e) => s + e._count.id, 0),
            openSequences: sequencesByStatus.find(s => s.status === 'OPEN')?._count.id || 0,
            marksRecorded: totalMarks,
            pendingReportCards: pendingReports,
            subjectSchemes,
            logbookEntriesLast7Days: recentLogbook,
        },
        sequencesByStatus: sequencesByStatus.map(s => ({ status: s.status, count: s._count.id })),
        reportsByStatus: reportsByStatus.map(r => ({ status: r.status, count: r._count.id })),
        logbookByStatusLast30Days: logbookByStatus.map(l => ({ status: l.status, count: l._count.id })),
        studentAveragesByStatus: studentAveragesGrouped.map(s => ({ status: s.status, count: s._count.id })),
        lastUpdated: new Date().toISOString(),
    };
}

// ============================================================
// 4. FINANCIAL OVERVIEW
// ============================================================
export async function getFinancialOverview(academicYearId?: number) {
    const yearId = await resolveYearId(academicYearId);

    const [
        feeAgg,
        paymentsByMethod,
        expendituresByCategory,
        financeRequestsByStatus,
        totalRefunds,
        pendingFinanceRequests,
        recentPaymentsCount,
        controlPaymentsCount,
        activeFeeItems,
        feesRaw,
        classesMeta,
    ] = await Promise.all([
        prisma.schoolFees.aggregate({
            where: yearId ? { academic_year_id: yearId } : undefined,
            _sum: { amount_expected: true, amount_paid: true },
            _count: { id: true },
        }),
        prisma.paymentTransaction.groupBy({
            by: ['payment_method'],
            where: yearId ? { academic_year_id: yearId } : undefined,
            _sum: { amount: true },
            _count: { id: true },
        }),
        prisma.expenditure.groupBy({
            by: ['category'],
            where: { date: { gte: new Date(new Date().getFullYear(), 0, 1) } },
            _sum: { amount: true },
            _count: { id: true },
        }),
        prisma.financeRequest.groupBy({
            by: ['status'],
            _count: { id: true },
        }),
        prisma.refund.aggregate({
            where: yearId ? { school_fees: { academic_year_id: yearId } } : undefined,
            _sum: { amount: true },
            _count: { id: true },
        }),
        prisma.financeRequest.count({
            where: { status: 'PENDING' },
        }),
        prisma.paymentTransaction.count({
            where: {
                payment_date: { gte: daysAgo(7) },
                ...(yearId ? { academic_year_id: yearId } : {}),
            },
        }),
        prisma.controlPaymentTransaction.count({
            where: yearId ? { academic_year_id: yearId } : undefined,
        }),
        prisma.feeItem.count({
            where: {
                is_active: true,
                ...(yearId ? { academic_year_id: yearId } : {}),
            },
        }),
        prisma.schoolFees.findMany({
            where: yearId ? { academic_year_id: yearId } : undefined,
            select: {
                amount_expected: true,
                amount_paid: true,
                enrollment: {
                    select: { class_id: true, sub_class_id: true },
                },
                payment_transactions: {
                    select: { payment_method: true, amount: true },
                },
            },
        }),
        prisma.class.findMany({
            select: {
                id: true,
                name: true,
                first_term_fee: true,
                second_term_fee: true,
                third_term_fee: true,
                sub_classes: { select: { id: true, name: true } },
            },
        }),
    ]);

    const expected = feeAgg._sum.amount_expected || 0;
    const collected = feeAgg._sum.amount_paid || 0;
    const totalExpenditures = expendituresByCategory.reduce((s, e) => s + (e._sum.amount || 0), 0);
    const totalPayments = paymentsByMethod.reduce((s, p) => s + (p._sum.amount || 0), 0);

    // Per-class + per-subclass fee aggregation. Enrollments without a sub_class
    // fold into a synthetic "Unassigned" subclass bucket (id -1) so bursars can
    // see money owed by students awaiting subclass placement.
    const UNASSIGNED_SUBCLASS_ID = -1;
    const UNASSIGNED_SUBCLASS_NAME = 'Unassigned';

    interface SubClassAcc {
        subClassId: number;
        subClassName: string;
        expected: number;
        collected: number;
        studentCount: number;
        studentsPaid: number;
        studentsPartial: number;
        studentsUnpaid: number;
        methodTotals: Map<string, { totalAmount: number; transactionCount: number }>;
    }
    interface ClassAcc {
        classId: number;
        className: string;
        expected: number;
        collected: number;
        studentCount: number;
        studentsPaid: number;
        studentsPartial: number;
        studentsUnpaid: number;
        subMap: Map<number, SubClassAcc>;
    }

    // Installment schedule per class — 1st and 2nd term fees define the
    // amounts we'd expect a student to have paid at each installment. Payments
    // fill installments FIFO (1st → 2nd → the remainder).
    const installmentByClass = new Map<number, { first: number; second: number }>();
    for (const cls of classesMeta) {
        installmentByClass.set(cls.id, {
            first: cls.first_term_fee || 0,
            second: cls.second_term_fee || 0,
        });
    }

    let firstExpected = 0;
    let firstCollected = 0;
    let secondExpected = 0;
    let secondCollected = 0;

    const classById = new Map<number, ClassAcc>();
    // Prime the map from schema so classes with zero fee records still surface.
    for (const cls of classesMeta) {
        const subMap = new Map<number, SubClassAcc>();
        for (const sc of cls.sub_classes) {
            subMap.set(sc.id, {
                subClassId: sc.id,
                subClassName: sc.name,
                expected: 0,
                collected: 0,
                studentCount: 0,
                studentsPaid: 0,
                studentsPartial: 0,
                studentsUnpaid: 0,
                methodTotals: new Map(),
            });
        }
        classById.set(cls.id, {
            classId: cls.id,
            className: cls.name,
            expected: 0,
            collected: 0,
            studentCount: 0,
            studentsPaid: 0,
            studentsPartial: 0,
            studentsUnpaid: 0,
            subMap,
        });
    }

    for (const fee of feesRaw) {
        const classId = fee.enrollment?.class_id;
        if (classId == null) continue;
        const clsAcc = classById.get(classId);
        if (!clsAcc) continue;

        const subClassId = fee.enrollment?.sub_class_id ?? UNASSIGNED_SUBCLASS_ID;
        let subAcc = clsAcc.subMap.get(subClassId);
        if (!subAcc) {
            subAcc = {
                subClassId,
                subClassName: subClassId === UNASSIGNED_SUBCLASS_ID ? UNASSIGNED_SUBCLASS_NAME : `Subclass #${subClassId}`,
                expected: 0,
                collected: 0,
                studentCount: 0,
                studentsPaid: 0,
                studentsPartial: 0,
                studentsUnpaid: 0,
                methodTotals: new Map(),
            };
            clsAcc.subMap.set(subClassId, subAcc);
        }

        const exp = fee.amount_expected || 0;
        const paid = fee.amount_paid || 0;

        clsAcc.expected += exp;
        clsAcc.collected += paid;
        clsAcc.studentCount += 1;
        subAcc.expected += exp;
        subAcc.collected += paid;
        subAcc.studentCount += 1;

        const schedule = installmentByClass.get(classId) || { first: 0, second: 0 };
        firstExpected += schedule.first;
        firstCollected += Math.min(paid, schedule.first);
        secondExpected += schedule.second;
        secondCollected += Math.min(Math.max(0, paid - schedule.first), schedule.second);

        // Payment status buckets — "paid" means fully covered; "partial" is any
        // non-zero payment short of the expected amount; "unpaid" is nothing paid.
        const isPaid = exp > 0 && paid >= exp;
        const isPartial = paid > 0 && paid < exp;
        const isUnpaid = paid <= 0;
        if (isPaid) { clsAcc.studentsPaid += 1; subAcc.studentsPaid += 1; }
        else if (isPartial) { clsAcc.studentsPartial += 1; subAcc.studentsPartial += 1; }
        else if (isUnpaid) { clsAcc.studentsUnpaid += 1; subAcc.studentsUnpaid += 1; }

        for (const tx of fee.payment_transactions) {
            const key = tx.payment_method;
            const current = subAcc.methodTotals.get(key) || { totalAmount: 0, transactionCount: 0 };
            current.totalAmount += tx.amount || 0;
            current.transactionCount += 1;
            subAcc.methodTotals.set(key, current);
        }
    }

    const feesByClass = Array.from(classById.values())
        .map(cls => ({
            classId: cls.classId,
            className: cls.className,
            expected: cls.expected,
            collected: cls.collected,
            outstanding: Math.max(cls.expected - cls.collected, 0),
            collectionRate: toPct(cls.collected, cls.expected),
            studentCount: cls.studentCount,
            studentsPaid: cls.studentsPaid,
            studentsPartial: cls.studentsPartial,
            studentsUnpaid: cls.studentsUnpaid,
            subClasses: Array.from(cls.subMap.values())
                .filter(sc => sc.studentCount > 0 || sc.subClassId !== UNASSIGNED_SUBCLASS_ID)
                .map(sc => ({
                    subClassId: sc.subClassId,
                    subClassName: sc.subClassName,
                    expected: sc.expected,
                    collected: sc.collected,
                    outstanding: Math.max(sc.expected - sc.collected, 0),
                    collectionRate: toPct(sc.collected, sc.expected),
                    studentCount: sc.studentCount,
                    studentsPaid: sc.studentsPaid,
                    studentsPartial: sc.studentsPartial,
                    studentsUnpaid: sc.studentsUnpaid,
                    paymentsByMethod: Array.from(sc.methodTotals.entries())
                        .map(([method, v]) => ({
                            method,
                            totalAmount: v.totalAmount,
                            transactionCount: v.transactionCount,
                        }))
                        .sort((a, b) => b.totalAmount - a.totalAmount),
                }))
                .sort((a, b) => a.subClassName.localeCompare(b.subClassName)),
        }))
        .sort((a, b) => a.className.localeCompare(b.className));

    const buildInstallmentBucket = (exp: number, col: number) => ({
        expected: exp,
        collected: col,
        outstanding: Math.max(exp - col, 0),
        collectionRate: toPct(col, exp),
    });

    return {
        summary: {
            totalExpected: expected,
            totalCollected: collected,
            outstanding: Math.max(expected - collected, 0),
            collectionRate: toPct(collected, expected),
            paymentsLast7Days: recentPaymentsCount,
            totalExpendituresYTD: totalExpenditures,
            totalRefunds: totalRefunds._sum.amount || 0,
            refundCount: totalRefunds._count.id,
            pendingFinanceRequests,
            activeFeeItems,
            controlPaymentsRecorded: controlPaymentsCount,
            byInstallment: {
                first: buildInstallmentBucket(firstExpected, firstCollected),
                second: buildInstallmentBucket(secondExpected, secondCollected),
                total: buildInstallmentBucket(expected, collected),
            },
        },
        paymentsByMethod: paymentsByMethod.map(p => ({
            method: p.payment_method,
            transactionCount: p._count.id,
            totalAmount: p._sum.amount || 0,
            percentage: toPct(p._sum.amount || 0, totalPayments),
        })),
        expendituresByCategoryYTD: expendituresByCategory.map(e => ({
            category: e.category,
            count: e._count.id,
            totalAmount: e._sum.amount || 0,
        })),
        financeRequestsByStatus: financeRequestsByStatus.map(f => ({
            status: f.status,
            count: f._count.id,
        })),
        feesByClass,
        lastUpdated: new Date().toISOString(),
    };
}

// ============================================================
// 5. STAFF (HR) OVERVIEW
// ============================================================
export async function getStaffOverview(academicYearId?: number) {
    const yearId = await resolveYearId(academicYearId);

    // "Staff" here = any user who holds at least one non-PARENT role. This
    // excludes parent-only accounts (which are portal users, not personnel)
    // but keeps parents who also work here (e.g. parent-teacher) in the count.
    const staffWhere = { user_roles: { some: { role: { not: 'PARENT' as const } } } };

    const [
        usersByRole,
        usersByStatus,
        totalUsers,
        teachers,
        newStaffThisMonth,
        assignmentsByRole,
    ] = await Promise.all([
        prisma.userRole.groupBy({
            by: ['role'],
            where: yearId ? { OR: [{ academic_year_id: yearId }, { academic_year_id: null }] } : undefined,
            _count: { user_id: true },
        }),
        prisma.user.groupBy({
            by: ['status'],
            where: staffWhere,
            _count: { id: true },
        }),
        prisma.user.count({ where: staffWhere }),
        prisma.user.findMany({
            where: { user_roles: { some: { role: 'TEACHER' } } },
            select: { id: true, total_hours_per_week: true },
        }),
        prisma.user.count({
            where: { created_at: { gte: startOfMonth() }, ...staffWhere },
        }),
        prisma.roleAssignment.groupBy({
            by: ['role_type'],
            where: yearId ? { academic_year_id: yearId } : undefined,
            _count: { id: true },
        }),
    ]);

    const totalTeachers = teachers.length;
    const avgHours = totalTeachers > 0
        ? teachers.reduce((s, t) => s + (t.total_hours_per_week || 0), 0) / totalTeachers
        : 0;

    return {
        summary: {
            totalUsers,
            totalTeachers,
            averageTeachingHours: Math.round(avgHours * 100) / 100,
            newStaffThisMonth,
            teachersWithFullSchedule: teachers.filter(t => (t.total_hours_per_week || 0) >= 40).length,
        },
        usersByRole: usersByRole.map(u => ({ role: u.role, count: u._count.user_id })),
        usersByStatus: usersByStatus.map(u => ({ status: u.status, count: u._count.id })),
        subclassAssignmentsByRole: assignmentsByRole.map(a => ({ role: a.role_type, count: a._count.id })),
        lastUpdated: new Date().toISOString(),
    };
}

// ============================================================
// 6. COMMUNICATION OVERVIEW
// ============================================================
export async function getCommunicationOverview(academicYearId?: number) {
    const yearId = await resolveYearId(academicYearId);

    const [
        announcementsByAudience,
        totalAnnouncements,
        announcementsThisMonth,
        notificationsByCategory,
        notificationsByStatus,
        unreadNotifications,
        messagesLast7Days,
        chatMessagesLast7Days,
    ] = await Promise.all([
        prisma.announcement.groupBy({
            by: ['audience'],
            where: yearId ? { academic_year_id: yearId } : undefined,
            _count: { id: true },
        }),
        prisma.announcement.count({
            where: yearId ? { academic_year_id: yearId } : undefined,
        }),
        prisma.announcement.count({
            where: {
                date_posted: { gte: startOfMonth() },
                ...(yearId ? { academic_year_id: yearId } : {}),
            },
        }),
        prisma.mobileNotification.groupBy({
            by: ['category'],
            where: { date_sent: { gte: daysAgo(30) } },
            _count: { id: true },
        }),
        prisma.mobileNotification.groupBy({
            by: ['status'],
            where: { date_sent: { gte: daysAgo(30) } },
            _count: { id: true },
        }),
        prisma.mobileNotification.count({
            where: { read_at: null },
        }),
        prisma.message.count({
            where: { created_at: { gte: daysAgo(7) } },
        }),
        prisma.chatMessage.count({
            where: { created_at: { gte: daysAgo(7) } },
        }),
    ]);

    return {
        summary: {
            totalAnnouncements,
            announcementsThisMonth,
            unreadNotifications,
            messagesLast7Days,
            chatMessagesLast7Days,
        },
        announcementsByAudience: announcementsByAudience.map(a => ({ audience: a.audience, count: a._count.id })),
        notificationsLast30DaysByCategory: notificationsByCategory.map(n => ({ category: n.category, count: n._count.id })),
        notificationsLast30DaysByStatus: notificationsByStatus.map(n => ({ status: n.status, count: n._count.id })),
        lastUpdated: new Date().toISOString(),
    };
}

// ============================================================
// 7. HEALTH / NURSE OVERVIEW
// ============================================================
export async function getHealthOverview(academicYearId?: number) {
    const yearId = await resolveYearId(academicYearId);

    const [
        visitsThisMonth,
        visitsLast7Days,
        sentHomeThisMonth,
        totalVisits,
        studentsWithHealthConditions,
        recentVisitReasonsRaw,
    ] = await Promise.all([
        prisma.nurseVisitLog.count({
            where: {
                visit_date: { gte: startOfMonth() },
                ...(yearId ? { enrollment: { academic_year_id: yearId } } : {}),
            },
        }),
        prisma.nurseVisitLog.count({
            where: {
                visit_date: { gte: daysAgo(7) },
                ...(yearId ? { enrollment: { academic_year_id: yearId } } : {}),
            },
        }),
        prisma.nurseVisitLog.count({
            where: {
                sent_home: true,
                visit_date: { gte: startOfMonth() },
                ...(yearId ? { enrollment: { academic_year_id: yearId } } : {}),
            },
        }),
        prisma.nurseVisitLog.count({
            where: yearId ? { enrollment: { academic_year_id: yearId } } : undefined,
        }),
        prisma.student.count({
            where: { health_conditions: { isEmpty: false } },
        }),
        prisma.nurseVisitLog.findMany({
            where: {
                visit_date: { gte: daysAgo(30) },
                ...(yearId ? { enrollment: { academic_year_id: yearId } } : {}),
            },
            select: { reason: true },
            take: 500,
            orderBy: { visit_date: 'desc' },
        }),
    ]);

    // Top reasons frequency (case-insensitive first-word key)
    const reasonCounts = new Map<string, number>();
    for (const v of recentVisitReasonsRaw) {
        const key = (v.reason || 'unknown').trim().toLowerCase().slice(0, 40);
        reasonCounts.set(key, (reasonCounts.get(key) || 0) + 1);
    }
    const topReasons = Array.from(reasonCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([reason, count]) => ({ reason, count }));

    return {
        summary: {
            totalVisitsInYear: totalVisits,
            visitsThisMonth,
            visitsLast7Days,
            sentHomeThisMonth,
            studentsWithHealthConditions,
        },
        topReasonsLast30Days: topReasons,
        lastUpdated: new Date().toISOString(),
    };
}

// ============================================================
// 8. REAM (PAPER) STOCK OVERVIEW
// ============================================================
export async function getReamStockOverview(academicYearId?: number) {
    const yearId = await resolveYearId(academicYearId);

    const [
        receiptAgg,
        issuanceAgg,
        receiptsLast30d,
        issuancesLast30d,
        topRecipientsRaw,
        studentsCollected,
        newStudentEnrollments,
    ] = await Promise.all([
        prisma.reamStockLedger.aggregate({
            where: { type: 'RECEIPT' },
            _sum: { quantity: true },
        }),
        prisma.reamStockLedger.aggregate({
            where: { type: 'ISSUANCE' },
            _sum: { quantity: true },
        }),
        prisma.reamStockLedger.aggregate({
            where: { type: 'RECEIPT', created_at: { gte: daysAgo(30) } },
            _sum: { quantity: true },
            _count: { id: true },
        }),
        prisma.reamStockLedger.aggregate({
            where: { type: 'ISSUANCE', created_at: { gte: daysAgo(30) } },
            _sum: { quantity: true },
            _count: { id: true },
        }),
        prisma.reamStockLedger.groupBy({
            by: ['recipient_user_id', 'recipient_name'],
            where: { type: 'ISSUANCE', created_at: { gte: daysAgo(90) } },
            _sum: { quantity: true },
            orderBy: { _sum: { quantity: 'desc' } },
            take: 10,
        }),
        // Per-student ream collection (secretary/bursar flag on Enrollment)
        prisma.enrollment.count({
            where: {
                ream_of_paper_collected: true,
                ...(yearId ? { academic_year_id: yearId } : {}),
            },
        }),
        // Denominator: new students eligible to hand in a ream this year
        prisma.enrollment.count({
            where: {
                ...(yearId ? { academic_year_id: yearId } : {}),
                student: yearId ? { first_enrollment_year_id: yearId } : undefined,
            },
        }),
    ]);

    const ledgerReceipts = receiptAgg._sum.quantity || 0;
    const totalIssued = issuanceAgg._sum.quantity || 0;
    // Reams collected from students count as stock received, alongside ledger receipts.
    const totalReceived = ledgerReceipts + studentsCollected;

    return {
        summary: {
            currentStock: totalReceived - totalIssued,
            totalReceived,
            totalIssued,
            ledgerReceipts,
            reamsCollectedFromStudents: studentsCollected,
            receiptsLast30Days: receiptsLast30d._count.id,
            reamsReceivedLast30Days: receiptsLast30d._sum.quantity || 0,
            issuancesLast30Days: issuancesLast30d._count.id,
            reamsIssuedLast30Days: issuancesLast30d._sum.quantity || 0,
            newStudentsThisYear: newStudentEnrollments,
            studentCollectionRate: toPct(studentsCollected, newStudentEnrollments),
        },
        topRecipientsLast90Days: topRecipientsRaw.map(r => ({
            recipientUserId: r.recipient_user_id,
            recipientName: r.recipient_name,
            reamsIssued: r._sum.quantity || 0,
        })),
        lastUpdated: new Date().toISOString(),
    };
}

// ============================================================
// 9. SALARY OVERVIEW
// ============================================================
export async function getSalaryOverview(academicYearId?: number) {
    const yearId = await resolveYearId(academicYearId);

    const [
        profilesByStatus,
        profilesByType,
        pendingChangeRequests,
        pendingAllowances,
        pendingWithholdings,
        payPeriodsByStatus,
        latestPayPeriod,
        salaryPaymentsAgg,
        cashInjectionsAgg,
    ] = await Promise.all([
        prisma.salaryProfile.groupBy({
            by: ['status'],
            where: yearId ? { academic_year_id: yearId } : undefined,
            _count: { id: true },
        }),
        prisma.salaryProfile.groupBy({
            by: ['salary_type'],
            where: yearId ? { academic_year_id: yearId } : undefined,
            _count: { id: true },
        }),
        prisma.salaryChangeRequest.count({ where: { status: 'PENDING' } }),
        prisma.salaryAllowance.count({ where: { status: 'PENDING' } }),
        prisma.salaryWithholding.count({ where: { status: 'PENDING' } }),
        prisma.payPeriod.groupBy({
            by: ['status'],
            where: yearId ? { academic_year_id: yearId } : undefined,
            _count: { id: true },
        }),
        prisma.payPeriod.findFirst({
            where: yearId ? { academic_year_id: yearId } : undefined,
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            select: {
                id: true,
                year: true,
                month: true,
                pay_date: true,
                status: true,
            },
        }),
        prisma.salaryPayment.aggregate({
            where: yearId ? { pay_period: { academic_year_id: yearId } } : undefined,
            _sum: { net_amount: true, withheld_amount: true, base_amount: true },
            _count: { id: true },
        }),
        prisma.bursarCashInjection.aggregate({
            where: yearId ? { academic_year_id: yearId } : undefined,
            _sum: { amount: true },
            _count: { id: true },
        }),
    ]);

    return {
        summary: {
            activeProfiles: profilesByStatus.find(p => p.status === 'ACTIVE')?._count.id || 0,
            pendingApprovalProfiles: profilesByStatus.find(p => p.status === 'PENDING_APPROVAL')?._count.id || 0,
            pendingChangeRequests,
            pendingAllowances,
            pendingWithholdings,
            totalPayoutYear: salaryPaymentsAgg._sum.net_amount || 0,
            totalWithheldYear: salaryPaymentsAgg._sum.withheld_amount || 0,
            totalPaymentsRecorded: salaryPaymentsAgg._count.id,
            cashInjectionsTotal: cashInjectionsAgg._sum.amount || 0,
            cashInjectionsCount: cashInjectionsAgg._count.id,
            latestPayPeriod,
        },
        profilesByStatus: profilesByStatus.map(p => ({ status: p.status, count: p._count.id })),
        profilesByType: profilesByType.map(p => ({ type: p.salary_type, count: p._count.id })),
        payPeriodsByStatus: payPeriodsByStatus.map(p => ({ status: p.status, count: p._count.id })),
        lastUpdated: new Date().toISOString(),
    };
}

// ============================================================
// 10. TASKS OVERVIEW
// ============================================================
export async function getTasksOverview() {
    const [
        tasksByStatus,
        tasksByPriority,
        tasksByCategoryRaw,
        overdueTasks,
        totalTasks,
        tasksCompletedLast30d,
        tasksCreatedLast30d,
    ] = await Promise.all([
        prisma.task.groupBy({ by: ['status'], _count: { id: true } }),
        prisma.task.groupBy({ by: ['priority'], _count: { id: true } }),
        prisma.task.groupBy({
            by: ['category'],
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 15,
        }),
        prisma.task.count({
            where: {
                deadline: { lt: new Date() },
                status: { in: ['PENDING', 'IN_PROGRESS'] },
            },
        }),
        prisma.task.count(),
        prisma.task.count({
            where: {
                status: 'COMPLETED',
                completed_at: { gte: daysAgo(30) },
            },
        }),
        prisma.task.count({
            where: { created_at: { gte: daysAgo(30) } },
        }),
    ]);

    const completed = tasksByStatus.find(t => t.status === 'COMPLETED')?._count.id || 0;

    return {
        summary: {
            totalTasks,
            overdueTasks,
            completionRate: toPct(completed, totalTasks),
            tasksCreatedLast30Days: tasksCreatedLast30d,
            tasksCompletedLast30Days: tasksCompletedLast30d,
        },
        tasksByStatus: tasksByStatus.map(t => ({ status: t.status, count: t._count.id })),
        tasksByPriority: tasksByPriority.map(t => ({ priority: t.priority, count: t._count.id })),
        tasksByCategory: tasksByCategoryRaw.map(t => ({ category: t.category, count: t._count.id })),
        lastUpdated: new Date().toISOString(),
    };
}

// ============================================================
// 11. INVENTORY OVERVIEW
// ============================================================
export async function getInventoryOverview() {
    const [
        totalItems,
        activeItems,
        holdingsAgg,
        transfersByStatus,
        pendingTransfers,
        ledgerLast30d,
        topItemsRaw,
    ] = await Promise.all([
        prisma.inventoryItem.count(),
        prisma.inventoryItem.count({ where: { is_active: true } }),
        prisma.inventoryHolding.aggregate({
            _sum: { quantity: true },
            _count: { id: true },
        }),
        prisma.inventoryTransfer.groupBy({
            by: ['status'],
            _count: { id: true },
        }),
        prisma.inventoryTransfer.count({ where: { status: 'PENDING' } }),
        prisma.inventoryLedger.count({
            where: { created_at: { gte: daysAgo(30) } },
        }),
        prisma.inventoryHolding.groupBy({
            by: ['item_id'],
            _sum: { quantity: true },
            orderBy: { _sum: { quantity: 'desc' } },
            take: 10,
        }),
    ]);

    // Enrich top items with item names
    const topItemIds = topItemsRaw.map(t => t.item_id);
    const itemMeta = topItemIds.length
        ? await prisma.inventoryItem.findMany({
              where: { id: { in: topItemIds } },
              select: { id: true, name: true, unit: true },
          })
        : [];
    const metaById = new Map(itemMeta.map(m => [m.id, m]));

    return {
        summary: {
            totalItems,
            activeItems,
            totalHoldings: holdingsAgg._sum.quantity || 0,
            distinctHoldings: holdingsAgg._count.id,
            pendingTransfers,
            ledgerEntriesLast30Days: ledgerLast30d,
        },
        transfersByStatus: transfersByStatus.map(t => ({ status: t.status, count: t._count.id })),
        topItemsByQuantity: topItemsRaw.map(t => ({
            itemId: t.item_id,
            name: metaById.get(t.item_id)?.name,
            unit: metaById.get(t.item_id)?.unit,
            totalQuantity: t._sum.quantity || 0,
        })),
        lastUpdated: new Date().toISOString(),
    };
}

// ============================================================
// 12. AUDIT OVERVIEW
// ============================================================
export async function getAuditOverview() {
    const since = daysAgo(30);

    const [byAction, byTable, totalLast30d, activeUsersLast30d] = await Promise.all([
        prisma.auditLog.groupBy({
            by: ['action'],
            where: { created_at: { gte: since } },
            _count: { id: true },
        }),
        prisma.auditLog.groupBy({
            by: ['table_name'],
            where: { created_at: { gte: since } },
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 15,
        }),
        prisma.auditLog.count({ where: { created_at: { gte: since } } }),
        prisma.auditLog.groupBy({
            by: ['user_id'],
            where: { created_at: { gte: since } },
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 10,
        }),
    ]);

    // Enrich top users with names
    const userIds = activeUsersLast30d.map(u => u.user_id);
    const userMeta = userIds.length
        ? await prisma.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, name: true, matricule: true },
          })
        : [];
    const nameById = new Map(userMeta.map(u => [u.id, u]));

    return {
        summary: {
            totalModificationsLast30Days: totalLast30d,
            distinctActiveUsersLast30Days: activeUsersLast30d.length,
        },
        actionsLast30Days: byAction.map(a => ({ action: a.action, count: a._count.id })),
        topTablesLast30Days: byTable.map(t => ({ table: t.table_name, count: t._count.id })),
        topActiveUsersLast30Days: activeUsersLast30d.map(u => ({
            userId: u.user_id,
            name: nameById.get(u.user_id)?.name,
            matricule: nameById.get(u.user_id)?.matricule,
            actions: u._count.id,
        })),
        lastUpdated: new Date().toISOString(),
    };
}

// ============================================================
// 13. ENROLLMENT / CLASSES SNAPSHOT
// ============================================================
export async function getEnrollmentOverview(academicYearId?: number) {
    const yearId = await resolveYearId(academicYearId);

    const [
        totalEnrollments,
        unassignedEnrollments,
        newEnrollmentsThisMonth,
        classes,
        genderRows,
        studentsByStatus,
    ] = await Promise.all([
        prisma.enrollment.count({
            where: yearId ? { academic_year_id: yearId } : undefined,
        }),
        prisma.enrollment.count({
            where: {
                sub_class_id: null,
                ...(yearId ? { academic_year_id: yearId } : {}),
            },
        }),
        prisma.enrollment.count({
            where: {
                created_at: { gte: startOfMonth() },
                ...(yearId ? { academic_year_id: yearId } : {}),
            },
        }),
        prisma.class.findMany({
            select: {
                id: true,
                name: true,
                max_students: true,
                sub_classes: {
                    select: {
                        id: true,
                        name: true,
                        enrollments: {
                            where: yearId ? { academic_year_id: yearId } : undefined,
                            select: { id: true },
                        },
                    },
                },
            },
        }),
        prisma.student.groupBy({
            by: ['gender'],
            where: yearId
                ? { enrollments: { some: { academic_year_id: yearId } } }
                : undefined,
            _count: { id: true },
        }),
        prisma.student.groupBy({
            by: ['status'],
            _count: { id: true },
        }),
    ]);

    const classUtilization = classes.map(cls => {
        const current = cls.sub_classes.reduce((s, sc) => s + sc.enrollments.length, 0);
        const maxStudents = getClassMaxStudents(cls.sub_classes.length);
        const subClasses = cls.sub_classes.map(sc => ({
            subClassId: sc.id,
            subClassName: sc.name,
            maxStudents: SUBCLASS_MAX_STUDENTS,
            currentStudents: sc.enrollments.length,
            utilizationRate: toPct(sc.enrollments.length, SUBCLASS_MAX_STUDENTS),
        }));
        return {
            classId: cls.id,
            className: cls.name,
            maxStudents,
            currentStudents: current,
            utilizationRate: toPct(current, maxStudents),
            subClasses,
        };
    });

    const avgUtilization = classUtilization.length
        ? Math.round(
              (classUtilization.reduce((s, c) => s + c.utilizationRate, 0) / classUtilization.length) * 100,
          ) / 100
        : 0;

    return {
        summary: {
            totalEnrollments,
            unassignedEnrollments,
            newEnrollmentsThisMonth,
            averageClassUtilization: avgUtilization,
            assignmentRate: toPct(totalEnrollments - unassignedEnrollments, totalEnrollments),
        },
        classUtilization,
        genderSplit: genderRows.map(g => ({ gender: g.gender, count: g._count.id })),
        studentsByStatus: studentsByStatus.map(s => ({ status: s.status, count: s._count.id })),
        lastUpdated: new Date().toISOString(),
    };
}

// ============================================================
// 14. UNIFIED SUPER MANAGER SNAPSHOT
// ============================================================
export async function getSuperManagerSnapshot(academicYearId?: number) {
    const yearId = await resolveYearId(academicYearId);

    const [
        discipline,
        attendance,
        academic,
        financial,
        staff,
        communication,
        health,
        reamStock,
        salary,
        tasks,
        inventory,
        audit,
        enrollment,
    ] = await Promise.all([
        getDisciplineOverview(yearId),
        getAttendanceOverview(yearId),
        getAcademicOverview(yearId),
        getFinancialOverview(yearId),
        getStaffOverview(yearId),
        getCommunicationOverview(yearId),
        getHealthOverview(yearId),
        getReamStockOverview(yearId),
        getSalaryOverview(yearId),
        getTasksOverview(),
        getInventoryOverview(),
        getAuditOverview(),
        getEnrollmentOverview(yearId),
    ]);

    return {
        academicYearId: yearId,
        discipline: discipline.summary,
        attendance: attendance.summary,
        academic: academic.summary,
        financial: financial.summary,
        staff: staff.summary,
        communication: communication.summary,
        health: health.summary,
        reamStock: reamStock.summary,
        salary: salary.summary,
        tasks: tasks.summary,
        inventory: inventory.summary,
        audit: audit.summary,
        enrollment: enrollment.summary,
        lastUpdated: new Date().toISOString(),
    };
}
