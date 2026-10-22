import prisma from '../../../config/db';
import { getCurrentAcademicYear } from '../../../utils/academicYear';
import { SUBCLASS_MAX_STUDENTS } from '../../../utils/capacity';
import {
    activeEnrollmentWhere,
    countActiveStudents,
    countStaff,
    countStreams,
    countTeachers,
    teacherUserWhere,
} from '../../../utils/schoolCounts';

// Types for Principal operations
export interface SchoolAnalytics {
    totalStudents: number;
    totalTeachers: number;
    /** Number of streams (SubClasses), e.g. Form 1 A, Form 1 B ... */
    totalClasses: number;
    /** Number of class levels (Class rows), e.g. Form 1, Form 2 ... */
    totalClassLevels: number;
    totalSubjects: number;
    activeExamSequences: number;
    averageAttendanceRate: number;
    /** Mean of all recorded marks for the year, on the /20 scale (null when no marks yet). */
    overallAcademicPerformance: number | null;
    financialCollectionRate: number;
    disciplineIssuesThisMonth: number;
    newEnrollmentsThisMonth: number;
    /** Percentage of stream seats filled (students / (streams x seat cap)). */
    classCapacityUtilization: number;
}

export interface PerformanceMetrics {
    academicPerformance: {
        /** Percentage (0-100); null when no marks recorded yet. */
        overallPassRate: number | null;
        /** Mean of subject averages on the /20 scale; null when no marks recorded yet. */
        averageGrade: number | null;
        /** averageScore values below are on the /20 scale. Only subjects / streams with marks are listed. */
        subjectPerformance: Array<{
            subjectName: string;
            averageScore: number;
            passRate: number;
            totalStudents: number;
        }>;
        classPerformance: Array<{
            className: string;
            subClassName: string;
            averageScore: number;
            passRate: number;
            totalStudents: number;
            teacherName: string;
        }>;
    };
    attendanceMetrics: {
        overallAttendanceRate: number;
        classAttendanceRates: Array<{
            className: string;
            subClassName: string;
            attendanceRate: number;
            absenteeismTrend: string;
        }>;
        monthlyAttendanceTrends: Array<{
            month: string;
            attendanceRate: number;
            totalStudents: number;
        }>;
    };
    teacherPerformance: {
        totalTeachers: number;
        averageClassesPerTeacher: number;
        teacherEfficiency: Array<{
            teacherName: string;
            subjectsTeaching: number;
            averageStudentPerformance: number;
            classesManaged: number;
        }>;
    };
}

export interface FinancialOverview {
    totalExpectedRevenue: number;
    totalCollectedRevenue: number;
    collectionRate: number;
    pendingPayments: number;
    monthlyCollectionTrends: Array<{
        month: string;
        collected: number;
        expected: number;
        collectionRate: number;
    }>;
    paymentMethodBreakdown: Array<{
        method: string;
        amount: number;
        percentage: number;
        transactionCount: number;
    }>;
    outstandingDebts: Array<{
        studentName: string;
        className: string;
        amountOwed: number;
        daysOverdue: number;
    }>;
}

export interface DisciplineOverview {
    totalIssues: number;
    issuesThisMonth: number;
    resolvedIssues: number;
    pendingIssues: number;
    issuesByType: Array<{
        issueType: string;
        count: number;
    }>;
    studentsByIssueCount: Array<{
        studentName: string;
        className: string;
        issueCount: number;
        lastIssueDate: string;
    }>;
    monthlyTrends: Array<{
        month: string;
        totalIssues: number;
        resolvedIssues: number;
    }>;
}

export interface StaffOverview {
    totalStaff: number;
    teacherCount: number;
    administrativeStaff: number;
    /** Distinct staff users per role (parents excluded). A user with two roles appears under both. */
    staffByRole: Array<{
        role: string;
        count: number;
    }>;
    recentHires: Array<{
        name: string;
        role: string;
        hireDate: string;
        department: string;
    }>;
    staffPerformanceMetrics: Array<{
        staffName: string;
        role: string;
        performanceScore: number;
        responsibilities: number;
    }>;
}

export interface ApprovalRequest {
    id: number;
    type: 'EXPENSE' | 'ENROLLMENT' | 'STAFF_HIRING' | 'POLICY_CHANGE' | 'DISCIPLINARY_ACTION';
    requestedBy: string;
    requestedByRole: string;
    title: string;
    description: string;
    amount?: number;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    requestDate: string;
    dueDate?: string;
    details: any;
}

/**
 * Get comprehensive school analytics for Principal dashboard
 */
export async function getSchoolAnalytics(academicYearId?: number): Promise<SchoolAnalytics> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        const [
            totalStudents,
            totalTeachers,
            totalClasses,
            totalSubjects,
            activeSequences,
            enrollmentsThisMonth,
            disciplineIssuesThisMonth,
            attendanceRecords,
            totalMarks,
            markSum,
            totalFees,
            totalPayments
        ] = await Promise.all([
            // Active students (shared definition, see utils/schoolCounts.ts)
            countActiveStudents(currentYear.id),

            // Teachers (TEACHER role for the year, or a timetable slot)
            countTeachers(currentYear.id),

            // "Classes" = streams (SubClasses), not class levels
            countStreams(),

            // Total subjects
            prisma.subject.count(),

            // Active exam sequences
            prisma.examSequence.count({
                where: {
                    academic_year_id: currentYear.id,
                    status: 'OPEN'
                }
            }),

            // New enrollments this month
            prisma.enrollment.count({
                where: {
                    ...activeEnrollmentWhere(currentYear.id),
                    created_at: {
                        gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                    }
                }
            }),

            // Discipline issues this month
            prisma.disciplineIssue.count({
                where: {
                    enrollment: {
                        academic_year_id: currentYear.id
                    },
                    created_at: {
                        gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                    }
                }
            }),

            // Attendance records for rate calculation
            prisma.studentAbsence.count({
                where: {
                    enrollment: {
                        academic_year_id: currentYear.id
                    },
                    created_at: {
                        gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                    }
                }
            }),

            // Total marks for performance calculation
            prisma.mark.count({
                where: {
                    enrollment: { academic_year_id: currentYear.id }
                }
            }),

            // Sum of all marks for average calculation
            prisma.mark.aggregate({
                where: {
                    enrollment: { academic_year_id: currentYear.id }
                },
                _sum: { score: true }
            }),

            // Financial data
            prisma.schoolFees.aggregate({
                where: { academic_year_id: currentYear.id },
                _sum: { amount_expected: true }
            }),

            prisma.paymentTransaction.aggregate({
                where: {
                    academic_year_id: currentYear.id
                },
                _sum: { amount: true }
            })
        ]);

        const totalClassLevels = await prisma.class.count();

        // Calculate derived metrics with null safety. Marks are on /20.
        const overallAcademicPerformance = totalMarks > 0 ?
            ((markSum?._sum?.score || 0) / totalMarks) : null;

        const averageAttendanceRate = totalStudents > 0 ?
            Math.max(0, 100 - ((attendanceRecords / totalStudents) * 10)) : 100;

        const financialCollectionRate = (totalFees?._sum?.amount_expected || 0) > 0 ?
            ((totalPayments?._sum?.amount || 0) / (totalFees?._sum?.amount_expected || 1)) * 100 : 0;

        const classCapacityUtilization = totalClasses > 0 ?
            (totalStudents / (totalClasses * SUBCLASS_MAX_STUDENTS)) * 100 : 0;

        return {
            totalStudents,
            totalTeachers,
            totalClasses,
            totalClassLevels,
            totalSubjects,
            activeExamSequences: activeSequences,
            averageAttendanceRate: Math.round(averageAttendanceRate * 100) / 100,
            overallAcademicPerformance: overallAcademicPerformance === null ? null : Math.round(overallAcademicPerformance * 100) / 100,
            financialCollectionRate: Math.round(financialCollectionRate * 100) / 100,
            disciplineIssuesThisMonth,
            newEnrollmentsThisMonth: enrollmentsThisMonth,
            classCapacityUtilization: Math.round(Math.min(100, classCapacityUtilization) * 100) / 100
        };
    } catch (error) {
        throw new Error(`Failed to fetch school analytics: ${error}`);
    }
}

/**
 * Get comprehensive performance metrics
 */
export async function getPerformanceMetrics(academicYearId?: number): Promise<PerformanceMetrics> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        // Get subject performance
        const subjectPerformance = await prisma.subject.findMany({
            include: {
                sub_class_subjects: {
                    include: {
                        marks: {
                            where: {
                                enrollment: { academic_year_id: currentYear.id }
                            }
                        },
                        sub_class: {
                            include: {
                                enrollments: {
                                    where: { academic_year_id: currentYear.id }
                                }
                            }
                        }
                    }
                }
            }
        });

        // Process subject performance data
        const processedSubjectPerformance = subjectPerformance.map(subject => {
            const allMarks = subject.sub_class_subjects.flatMap(scs => scs.marks);
            const totalStudents = subject.sub_class_subjects.reduce(
                (sum, scs) => sum + scs.sub_class.enrollments.length, 0
            );

            const averageScore = allMarks.length > 0 ?
                allMarks.reduce((sum, mark) => sum + (mark.score ?? 0), 0) / allMarks.length : 0;

            const passRate = allMarks.length > 0 ?
                (allMarks.filter(mark => (mark.score ?? 0) >= 10).length / allMarks.length) * 100 : 0;

            return {
                subjectName: subject.name,
                averageScore: Math.round(averageScore * 100) / 100,
                passRate: Math.round(passRate * 100) / 100,
                totalStudents,
                markCount: allMarks.length
            };
        });

        // Get class performance
        const classPerformance = await prisma.subClass.findMany({
            where: {
                enrollments: {
                    some: { academic_year_id: currentYear.id }
                }
            },
            include: {
                class: true,
                enrollments: {
                    where: { academic_year_id: currentYear.id },
                    include: {
                        marks: true
                    }
                },
                teacher_periods: {
                    include: {
                        teacher: true
                    },
                    take: 1
                }
            }
        });

        const processedClassPerformance = classPerformance.map(subClass => {
            const allMarks = subClass.enrollments.flatMap(enrollment => enrollment.marks);
            const averageScore = allMarks.length > 0 ?
                allMarks.reduce((sum, mark) => sum + (mark.score ?? 0), 0) / allMarks.length : 0;

            const passRate = allMarks.length > 0 ?
                (allMarks.filter(mark => (mark.score ?? 0) >= 10).length / allMarks.length) * 100 : 0;

            const teacherName = subClass.teacher_periods[0]?.teacher?.name || 'No Teacher Assigned';

            return {
                markCount: allMarks.length,
                className: subClass.class.name,
                subClassName: subClass.name,
                averageScore: Math.round(averageScore * 100) / 100,
                passRate: Math.round(passRate * 100) / 100,
                totalStudents: subClass.enrollments.length,
                teacherName
            };
        });

        // Get attendance metrics (simplified)
        const totalEnrollments = await prisma.enrollment.count({
            where: { academic_year_id: currentYear.id }
        });

        const totalAbsences = await prisma.studentAbsence.count({
            where: {
                enrollment: {
                    academic_year_id: currentYear.id
                }
            }
        });

        const overallAttendanceRate = totalEnrollments > 0 ?
            Math.max(0, 100 - ((totalAbsences / totalEnrollments) * 5)) : 100;

        // Get teacher performance metrics
        const teachers = await prisma.user.findMany({
            where: teacherUserWhere(currentYear.id),
            include: {
                teacher_periods: {
                    where: { academic_year_id: currentYear.id },
                    include: {
                        sub_class: {
                            include: {
                                enrollments: {
                                    where: { academic_year_id: currentYear.id },
                                    include: { marks: true }
                                }
                            }
                        },
                        subject: true
                    }
                }
            }
        });

        const teacherPerformanceMetrics = teachers.map(teacher => {
            const uniqueSubjects = new Set(teacher.teacher_periods.map(tp => tp.subject.id));
            const uniqueSubClasses = new Set(teacher.teacher_periods.map(tp => tp.sub_class_id));
            const allMarks = teacher.teacher_periods.flatMap(tp =>
                tp.sub_class.enrollments.flatMap(enrollment => enrollment.marks)
            );

            const averageStudentPerformance = allMarks.length > 0 ?
                allMarks.reduce((sum, mark) => sum + (mark.score ?? 0), 0) / allMarks.length : 0;

            return {
                teacherName: teacher.name,
                subjectsTeaching: uniqueSubjects.size,
                averageStudentPerformance: Math.round(averageStudentPerformance * 100) / 100,
                classesManaged: uniqueSubClasses.size
            };
        });

        // Only subjects that actually have marks feed the school-wide figures;
        // averaging in 0 for unmarked subjects dragged the numbers down.
        const markedSubjects = processedSubjectPerformance.filter(sp => sp.markCount > 0);
        const round2 = (n: number) => Math.round(n * 100) / 100;

        return {
            academicPerformance: {
                overallPassRate: markedSubjects.length > 0 ?
                    round2(markedSubjects.reduce((sum, sp) => sum + sp.passRate, 0) / markedSubjects.length) : null,
                // Mean of subject averages, on the /20 scale (null when no marks yet)
                averageGrade: markedSubjects.length > 0 ?
                    round2(markedSubjects.reduce((sum, sp) => sum + sp.averageScore, 0) / markedSubjects.length) : null,
                subjectPerformance: markedSubjects.map(({ markCount, ...rest }) => rest),
                classPerformance: processedClassPerformance
                    .filter(cp => cp.markCount > 0)
                    .map(({ markCount, ...rest }) => rest)
            },
            attendanceMetrics: {
                overallAttendanceRate: Math.round(overallAttendanceRate * 100) / 100,
                classAttendanceRates: [], // Simplified for now
                monthlyAttendanceTrends: [] // Simplified for now
            },
            teacherPerformance: {
                totalTeachers: teachers.length,
                averageClassesPerTeacher: teacherPerformanceMetrics.length > 0 ?
                    round2(teacherPerformanceMetrics.reduce((sum, t) => sum + t.classesManaged, 0) / teacherPerformanceMetrics.length) : 0,
                teacherEfficiency: teacherPerformanceMetrics
            }
        };
    } catch (error) {
        throw new Error(`Failed to fetch performance metrics: ${error}`);
    }
}

/**
 * Get financial overview for principal
 */
export async function getFinancialOverview(academicYearId?: number): Promise<FinancialOverview> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        const [
            totalExpected,
            totalCollected,
            pendingPaymentsCount,
            paymentMethods,
            outstandingFees
        ] = await Promise.all([
            // Total expected revenue
            prisma.schoolFees.aggregate({
                where: { academic_year_id: currentYear.id },
                _sum: { amount_expected: true }
            }),

            // Total collected revenue
            prisma.paymentTransaction.aggregate({
                where: {
                    academic_year_id: currentYear.id
                },
                _sum: { amount: true }
            }),

            // Pending payments count
            prisma.schoolFees.count({
                where: {
                    academic_year_id: currentYear.id,
                    payment_transactions: {
                        none: {}
                    }
                }
            }),

            // Payment methods breakdown
            prisma.paymentTransaction.groupBy({
                by: ['payment_method'],
                where: {
                    academic_year_id: currentYear.id
                },
                _sum: { amount: true },
                _count: { id: true }
            }),

            // Outstanding debts
            prisma.schoolFees.findMany({
                where: {
                    academic_year_id: currentYear.id,
                    payment_transactions: {
                        none: {}
                    }
                },
                include: {
                    enrollment: {
                        include: {
                            student: true,
                            sub_class: {
                                include: { class: true }
                            }
                        }
                    }
                },
                take: 10,
                orderBy: { created_at: 'asc' }
            })
        ]);

        const totalExpectedRevenue = totalExpected._sum.amount_expected || 0;
        const totalCollectedRevenue = totalCollected._sum.amount || 0;
        const collectionRate = totalExpectedRevenue > 0 ?
            (totalCollectedRevenue / totalExpectedRevenue) * 100 : 0;

        // Process payment methods
        const totalPaymentAmount = paymentMethods.reduce((sum, pm) => sum + (pm._sum.amount || 0), 0);
        const paymentMethodBreakdown = paymentMethods.map(pm => ({
            method: pm.payment_method,
            amount: pm._sum.amount || 0,
            percentage: totalPaymentAmount > 0 ? ((pm._sum.amount || 0) / totalPaymentAmount) * 100 : 0,
            transactionCount: pm._count.id
        }));

        // Process outstanding debts
        const processedOutstandingDebts = outstandingFees.map(fee => {
            const daysSinceCreated = Math.floor(
                (new Date().getTime() - new Date(fee.created_at).getTime()) / (1000 * 60 * 60 * 24)
            );

            return {
                studentName: fee.enrollment.student.name,
                className: `${fee.enrollment.sub_class?.class.name} - ${fee.enrollment.sub_class?.name}`,
                amountOwed: fee.amount_expected,
                daysOverdue: daysSinceCreated
            };
        });

        return {
            totalExpectedRevenue,
            totalCollectedRevenue,
            collectionRate: Math.round(collectionRate * 100) / 100,
            pendingPayments: pendingPaymentsCount,
            monthlyCollectionTrends: [], // Simplified for now
            paymentMethodBreakdown,
            outstandingDebts: processedOutstandingDebts
        };
    } catch (error) {
        throw new Error(`Failed to fetch financial overview: ${error}`);
    }
}

/**
 * Get discipline overview for principal
 */
export async function getDisciplineOverview(academicYearId?: number): Promise<DisciplineOverview> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        // One base filter for every discipline figure on the dashboard, so the
        // "Discipline Issues" card and the "Total Issues" panel agree.
        //
        // The previous "resolved" query filtered `NOT: { reviewed_by_id: null }`
        // on a NON-nullable column; Prisma rejects that, so this whole function
        // threw, getPrincipalDashboard swallowed it (allSettled) and the panel
        // rendered 0 while the card (a separate query) showed the real count.
        const baseWhere = { enrollment: { academic_year_id: currentYear.id } };
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const [
            totalIssues,
            issuesThisMonth,
            resolvedIssues,
            issuesByType
        ] = await Promise.all([
            prisma.disciplineIssue.count({ where: baseWhere }),
            prisma.disciplineIssue.count({ where: { ...baseWhere, created_at: { gte: monthStart } } }),
            // Resolved = an action was recorded on the issue (free-text
            // action_taken, or at least one DisciplinaryAction row).
            prisma.disciplineIssue.count({
                where: {
                    ...baseWhere,
                    OR: [
                        { action_taken: { not: null } },
                        { disciplinary_actions: { some: {} } }
                    ]
                }
            }),
            prisma.disciplineIssue.groupBy({
                by: ['issue_type'],
                where: baseWhere,
                _count: { id: true }
            })
        ]);

        const pendingIssues = totalIssues - resolvedIssues;

        const processedIssuesByType = issuesByType
            .map(issue => ({
                issueType: issue.issue_type,
                count: issue._count.id,
            }))
            .sort((a, b) => b.count - a.count);

        return {
            totalIssues,
            issuesThisMonth,
            resolvedIssues,
            pendingIssues,
            issuesByType: processedIssuesByType,
            studentsByIssueCount: [], // Simplified for now
            monthlyTrends: [] // Simplified for now
        };
    } catch (error) {
        throw new Error(`Failed to fetch discipline overview: ${error}`);
    }
}

/**
 * Get staff overview for principal
 */
export async function getStaffOverview(academicYearId?: number): Promise<StaffOverview> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        // Staff excludes parent-only accounts (the old query counted every user
        // with any role, so ~950 parents were reported as "staff").
        const yearScope = {
            OR: [
                { academic_year_id: currentYear.id },
                { academic_year_id: null }
            ]
        };

        const [
            totalStaff,
            teacherCount,
            roleDistribution
        ] = await Promise.all([
            countStaff(currentYear.id),
            countTeachers(currentYear.id),
            prisma.userRole.findMany({
                where: { ...yearScope, role: { not: 'PARENT' } },
                select: { role: true, user_id: true },
                distinct: ['role', 'user_id']
            })
        ]);

        const roleCounts = new Map<string, number>();
        for (const r of roleDistribution) {
            roleCounts.set(r.role, (roleCounts.get(r.role) || 0) + 1);
        }
        const staffByRole = Array.from(roleCounts.entries())
            .map(([role, count]) => ({ role, count }))
            .sort((a, b) => b.count - a.count);

        // Staff who are not teachers (a teacher who also holds an admin role
        // is counted as a teacher).
        const administrativeStaff = Math.max(0, totalStaff - teacherCount);

        return {
            totalStaff,
            teacherCount,
            administrativeStaff,
            staffByRole,
            recentHires: [], // Simplified for now
            staffPerformanceMetrics: [] // Simplified for now
        };
    } catch (error) {
        throw new Error(`Failed to fetch staff overview: ${error}`);
    }
}

/**
 * Get principal dashboard data
 */
export async function getPrincipalDashboard(academicYearId?: number): Promise<any> {
    try {
        // Use Promise.allSettled to handle individual failures gracefully
        const results = await Promise.allSettled([
            getSchoolAnalytics(academicYearId),
            getPerformanceMetrics(academicYearId),
            getFinancialOverview(academicYearId),
            getDisciplineOverview(academicYearId),
            getStaffOverview(academicYearId)
        ]);

        // Extract results, using null for failed components
        const [analyticsResult, performanceResult, financialResult, disciplineResult, staffResult] = results;

        return {
            schoolAnalytics: analyticsResult.status === 'fulfilled' ? analyticsResult.value : null,
            performanceMetrics: performanceResult.status === 'fulfilled' ? performanceResult.value : null,
            financialOverview: financialResult.status === 'fulfilled' ? financialResult.value : null,
            disciplineOverview: disciplineResult.status === 'fulfilled' ? disciplineResult.value : null,
            staffOverview: staffResult.status === 'fulfilled' ? staffResult.value : null,
            quickActions: [
                'Review Performance Reports',
                'Approve Budget Requests',
                'Monitor Staff Performance',
                'Address Discipline Issues',
                'Review Financial Status'
            ],
            errors: results
                .map((result, index) => result.status === 'rejected' ?
                    { component: ['analytics', 'performance', 'financial', 'discipline', 'staff'][index], error: result.reason?.message } : null)
                .filter(err => err !== null)
        };
    } catch (error) {
        throw new Error(`Failed to fetch principal dashboard: ${error}`);
    }
} 