// Enhanced Dashboard Service for Advanced Role-Specific Features
import prisma from '../../../config/db';
import { getCurrentAcademicYear } from '../../../utils/academicYear';
import { SUBCLASS_MAX_STUDENTS, getClassMaxStudents } from '../../../utils/capacity';

/**
 * Enhanced Super Manager Dashboard with comprehensive analytics
 */
export async function getEnhancedSuperManagerDashboard(academicYearId?: number): Promise<any> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

        const [
            schoolOverview,
            schoolFees,
            teacherAnalytics,
            reportAnalytics,
            formManagement,
            auditTrail,
            systemStatistics
        ] = await Promise.all([
            getSchoolOverview(yearId),
            getSchoolFeesBreakdown(yearId),
            getTeacherAnalytics(yearId),
            getReportAnalytics(yearId),
            getFormManagementStats(),
            getAuditTrail(),
            getSystemStatistics(yearId)
        ]);

        return {
            schoolOverview,
            schoolFees,
            teacherAnalytics,
            reportAnalytics,
            formManagement,
            auditTrail,
            systemStatistics,
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.error('Error fetching Enhanced Super Manager dashboard:', error);
        throw new Error('Failed to fetch enhanced dashboard data');
    }
}

/**
 * School Overview - Finance, Discipline, Teachers
 */
async function getSchoolOverview(yearId?: number) {
    const [financialData, disciplineData, teacherData] = await Promise.all([
        // Financial Overview
        prisma.schoolFees.aggregate({
            where: yearId ? { academic_year_id: yearId } : undefined,
            _sum: { amount_expected: true, amount_paid: true },
            _count: { id: true }
        }),

        // Discipline Overview
        prisma.disciplineIssue.groupBy({
            by: ['issue_type'],
            _count: { id: true },
            where: yearId ? {
                enrollment: { academic_year_id: yearId }
            } : undefined
        }),

        // Teacher Overview
        prisma.user.findMany({
            where: {
                user_roles: { some: { role: 'TEACHER' } }
            },
            include: {
                subject_teachers: { include: { subject: true } }
            }
        })
    ]);

    const collectionRate = financialData._sum.amount_expected ?
        (financialData._sum.amount_paid! / financialData._sum.amount_expected) * 100 : 0;

    return {
        finance: {
            totalExpected: financialData._sum.amount_expected || 0,
            totalCollected: financialData._sum.amount_paid || 0,
            collectionRate,
            totalAccounts: financialData._count.id
        },
        discipline: {
            totalIssues: disciplineData.reduce((sum, item) => sum + item._count.id, 0),
            issuesByType: disciplineData.map(item => ({
                type: item.issue_type,
                count: item._count.id
            }))
        },
        teachers: {
            totalTeachers: teacherData.length,
            averageSubjectsPerTeacher: teacherData.length > 0 ?
                teacherData.reduce((sum, t) => sum + t.subject_teachers.length, 0) / teacherData.length : 0
        }
    };
}

/**
 * School Fees Breakdown - Total plus per-installment (3 terms) with waterfall attribution.
 * Waterfall: a student's amount_paid fills first-term bucket, then second, then third.
 * First-term expected also absorbs miscellaneous_fee + new_or_old student_fee (billed upfront).
 */
async function getSchoolFeesBreakdown(yearId?: number) {
    const fees = await prisma.schoolFees.findMany({
        where: yearId ? { academic_year_id: yearId } : undefined,
        select: {
            amount_expected: true,
            amount_paid: true,
            is_new_student: true,
            enrollment: {
                select: {
                    class: {
                        select: {
                            first_term_fee: true,
                            second_term_fee: true,
                            third_term_fee: true,
                            miscellaneous_fee: true,
                            new_student_fee: true,
                            old_student_fee: true
                        }
                    }
                }
            }
        }
    });

    let totalExpected = 0;
    let totalCollected = 0;
    let firstExpected = 0;
    let firstCollected = 0;
    let secondExpected = 0;
    let secondCollected = 0;
    let thirdExpected = 0;
    let thirdCollected = 0;

    for (const fee of fees) {
        const cls = fee.enrollment?.class;
        if (!cls) continue;

        const upfrontExtras =
            cls.miscellaneous_fee +
            (fee.is_new_student ? cls.new_student_fee : cls.old_student_fee);

        const firstBucket = cls.first_term_fee + upfrontExtras;
        const secondBucket = cls.second_term_fee;
        const thirdBucket = cls.third_term_fee;

        let remainingPaid = fee.amount_paid;
        const paidFirst = Math.min(remainingPaid, firstBucket);
        remainingPaid -= paidFirst;
        const paidSecond = Math.min(remainingPaid, secondBucket);
        remainingPaid -= paidSecond;
        const paidThird = Math.min(remainingPaid, thirdBucket);

        totalExpected += fee.amount_expected;
        totalCollected += fee.amount_paid;
        firstExpected += firstBucket;
        firstCollected += paidFirst;
        secondExpected += secondBucket;
        secondCollected += paidSecond;
        thirdExpected += thirdBucket;
        thirdCollected += paidThird;
    }

    const bucket = (expected: number, collected: number) => ({
        expected,
        collected,
        remaining: Math.max(expected - collected, 0),
        collectionRate: expected > 0 ? (collected / expected) * 100 : 0
    });

    return {
        total: bucket(totalExpected, totalCollected),
        firstTerm: bucket(firstExpected, firstCollected),
        secondTerm: bucket(secondExpected, secondCollected),
        thirdTerm: bucket(thirdExpected, thirdCollected)
    };
}

/**
 * Teacher Analytics - Profile, Hours, Attendance
 */
async function getTeacherAnalytics(yearId?: number) {
    const teachers = await prisma.user.findMany({
        where: {
            user_roles: { some: { role: 'TEACHER' } }
        },
        include: {
            subject_teachers: { include: { subject: true } },
            teacher_periods: true
        }
    });

    const teacherProfiles = teachers.map(teacher => ({
        id: teacher.id,
        name: teacher.name,
        matricule: teacher.matricule,
        email: teacher.email,
        totalHoursPerWeek: teacher.total_hours_per_week || 0,
        subjects: teacher.subject_teachers.map(st => ({
            id: st.subject.id,
            name: st.subject.name,
            category: st.subject.category
        })),
        periodsThisWeek: teacher.teacher_periods.length,
        attendanceRate: 85, // Placeholder - would calculate from actual data
        lastLogin: teacher.updated_at
    }));

    return {
        profiles: teacherProfiles,
        summary: {
            totalTeachers: teachers.length,
            averageHoursPerWeek: teachers.length > 0 ?
                teachers.reduce((sum, t) => sum + (t.total_hours_per_week || 0), 0) / teachers.length : 0,
            averageAttendanceRate: 85, // Placeholder
            teachersWithFullSchedule: teachers.filter(t => (t.total_hours_per_week || 0) >= 40).length
        }
    };
}

/**
 * Report Analytics - Deadlines, Submissions, Notifications
 */
async function getReportAnalytics(yearId?: number) {
    const [reports, sequences] = await Promise.all([
        prisma.generatedReport.findMany({
            where: yearId ? { academic_year_id: yearId } : undefined,
            include: {
                exam_sequence: true,
                student: true,
                sub_class: true
            },
            orderBy: { created_at: 'desc' }
        }),

        prisma.examSequence.findMany({
            where: yearId ? { academic_year_id: yearId } : undefined,
            orderBy: { created_at: 'desc' }
        })
    ]);

    const reportsByStatus = reports.reduce((acc, report) => {
        acc[report.status] = (acc[report.status] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    return {
        totalReports: reports.length,
        reportsByStatus,
        pendingReports: reportsByStatus.PENDING || 0,
        overdueReports: reports.filter(r =>
            r.status === 'PENDING' &&
            new Date(r.created_at).getTime() < Date.now() - 7 * 24 * 60 * 60 * 1000
        ).length,
        recentReports: reports.slice(0, 10).map(r => ({
            id: r.id,
            type: r.report_type,
            status: r.status,
            studentName: r.student?.name,
            subClassName: r.sub_class?.name,
            createdAt: r.created_at,
            sequenceName: `Sequence ${r.exam_sequence?.sequence_number}` || 'Unknown'
        })),
        upcomingDeadlines: sequences.filter(s => s.status === 'OPEN').map(s => ({
            id: s.id,
            name: `Sequence ${s.sequence_number}`,
            status: s.status,
            academicYearId: s.academic_year_id
        }))
    };
}

/**
 * Form Management Statistics
 */
async function getFormManagementStats() {
    const [forms, submissions] = await Promise.all([
        prisma.formTemplate.findMany({
            include: {
                form_submissions: true
            }
        }),

        prisma.formSubmission.groupBy({
            by: ['status'],
            _count: { id: true }
        })
    ]);

    return {
        totalForms: forms.length,
        activeForms: forms.filter(f => f.is_active).length,
        formsWithDeadlines: forms.filter(f => f.deadline).length,
        submissionsByStatus: submissions.map(s => ({
            status: s.status,
            count: s._count.id
        })),
        recentForms: forms.slice(0, 5).map(f => ({
            id: f.id,
            title: f.title,
            assignedRole: f.assigned_role,
            isActive: f.is_active,
            deadline: f.deadline,
            submissionCount: f.form_submissions.length
        }))
    };
}

/**
 * Audit Trail - System Modifications
 */
async function getAuditTrail() {
    const auditLogs = await prisma.auditLog.findMany({
        orderBy: { created_at: 'desc' },
        take: 20,
        include: {
            user: true
        }
    });

    return {
        recentModifications: auditLogs.map(log => ({
            id: log.id,
            action: log.action,
            tableName: log.table_name,
            recordId: log.record_id,
            userId: log.user_id,
            userName: log.user.name,
            userMatricule: log.user.matricule,
            createdAt: log.created_at,
            oldValues: log.old_values,
            newValues: log.new_values
        })),
        modificationsByAction: auditLogs.reduce((acc, log) => {
            acc[log.action] = (acc[log.action] || 0) + 1;
            return acc;
        }, {} as Record<string, number>)
    };
}

/**
 * System Statistics
 */
async function getSystemStatistics(yearId?: number) {
    const [userStats, classStats, enrollmentStats] = await Promise.all([
        prisma.userRole.groupBy({
            by: ['role'],
            _count: { user_id: true }
        }),

        prisma.class.findMany({
            include: {
                sub_classes: {
                    include: {
                        enrollments: yearId ? {
                            where: { academic_year_id: yearId }
                        } : true
                    }
                }
            }
        }),

        yearId ? prisma.enrollment.count({
            where: { academic_year_id: yearId }
        }) : prisma.enrollment.count()
    ]);

    const usersByRole = userStats.map(stat => ({
        role: stat.role,
        count: stat._count.user_id
    }));

    const classUtilization = classStats.map(cls => {
        const currentStudents = cls.sub_classes.reduce(
            (sum, sc) => sum + sc.enrollments.length, 0
        );
        const maxStudents = getClassMaxStudents(cls.sub_classes.length);
        return {
            id: cls.id,
            name: cls.name,
            maxStudents,
            currentStudents,
            utilizationRate: maxStudents > 0 ? (currentStudents / maxStudents) * 100 : 0
        };
    });

    return {
        usersByRole,
        totalEnrollments: enrollmentStats,
        classUtilization,
        averageClassUtilization: classUtilization.length > 0 ?
            classUtilization.reduce((sum, c) => sum + c.utilizationRate, 0) / classUtilization.length : 0
    };
}

/**
 * Enhanced Bursar Dashboard with Student Registration & Payment Analytics
 */
export async function getEnhancedBursarDashboard(academicYearId?: number): Promise<any> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

        const [
            financialOverview,
            studentRegistration,
            paymentAnalytics,
            parentManagement
        ] = await Promise.all([
            getBursarFinancialOverview(yearId),
            getStudentRegistrationStats(yearId),
            getPaymentAnalytics(yearId),
            getParentManagementStats()
        ]);

        return {
            financialOverview,
            studentRegistration,
            paymentAnalytics,
            parentManagement,
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.error('Error fetching Enhanced Bursar dashboard:', error);
        throw new Error('Failed to fetch enhanced Bursar dashboard data');
    }
}

async function getBursarFinancialOverview(yearId?: number) {
    const [feeRows, paymentsData] = await Promise.all([
        prisma.schoolFees.findMany({
            where: yearId ? { academic_year_id: yearId } : undefined,
            select: {
                enrollment_id: true,
                amount_expected: true,
                amount_paid: true
            }
        }),

        prisma.paymentTransaction.findMany({
            where: yearId ? { academic_year_id: yearId } : undefined,
            orderBy: { payment_date: 'desc' },
            take: 10,
            include: {
                enrollment: {
                    include: { student: true }
                }
            }
        })
    ]);

    // Aggregate outstanding balance per enrollment to count distinct students owing.
    const owingByEnrollment = new Map<number, number>();
    for (const row of feeRows) {
        const balance = (row.amount_expected || 0) - (row.amount_paid || 0);
        if (balance > 0) {
            owingByEnrollment.set(
                row.enrollment_id,
                (owingByEnrollment.get(row.enrollment_id) || 0) + balance
            );
        }
    }
    const studentsOwingCount = owingByEnrollment.size;
    const totalAmountOwed = Array.from(owingByEnrollment.values()).reduce((s, v) => s + v, 0);

    return {
        studentsOwingCount,
        totalAmountOwed,
        totalAccounts: feeRows.length,
        recentPayments: paymentsData.map(p => ({
            id: p.id,
            amount: p.amount,
            paymentMethod: p.payment_method,
            paymentDate: p.payment_date,
            receiptNumber: p.receipt_number,
            studentName: p.enrollment.student.name,
            studentMatricule: p.enrollment.student.matricule
        }))
    };
}

async function getStudentRegistrationStats(yearId?: number) {
    const [newStudents, enrollments, awaitingAssignment] = await Promise.all([
        prisma.student.count({
            where: {
                created_at: {
                    gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                }
            }
        }),

        yearId ? prisma.enrollment.count({
            where: { academic_year_id: yearId }
        }) : prisma.enrollment.count(),

        yearId ? prisma.enrollment.count({
            where: {
                academic_year_id: yearId,
                sub_class_id: null
            }
        }) : 0
    ]);

    return {
        newStudentsThisMonth: newStudents,
        totalEnrollments: enrollments,
        studentsAwaitingSubclassAssignment: awaitingAssignment,
        registrationCompletionRate: enrollments > 0 ?
            ((enrollments - awaitingAssignment) / enrollments) * 100 : 0
    };
}

async function getPaymentAnalytics(yearId?: number) {
    const paymentStats = await prisma.paymentTransaction.groupBy({
        by: ['payment_method'],
        _count: { id: true },
        _sum: { amount: true },
        where: yearId ? { academic_year_id: yearId } : undefined
    });

    const totalAmount = paymentStats.reduce((sum, stat) => sum + (stat._sum.amount || 0), 0);

    return {
        paymentMethodBreakdown: paymentStats.map(stat => ({
            method: stat.payment_method,
            transactionCount: stat._count.id,
            totalAmount: stat._sum.amount || 0,
            percentage: totalAmount > 0 ? ((stat._sum.amount || 0) / totalAmount) * 100 : 0
        })),
        totalTransactions: paymentStats.reduce((sum, stat) => sum + stat._count.id, 0),
        totalAmount
    };
}

async function getParentManagementStats() {
    const [parentStudentLinks, recentLinks] = await Promise.all([
        prisma.parentStudent.count(),

        prisma.parentStudent.findMany({
            where: {
                created_at: {
                    gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                }
            },
            include: {
                parent: true,
                student: true
            }
        })
    ]);

    return {
        totalParentLinks: parentStudentLinks,
        newLinksThisMonth: recentLinks.length,
        recentLinks: recentLinks.map(link => ({
            parentName: link.parent.name,
            parentPhone: link.parent.phone,
            studentName: link.student.name,
            studentMatricule: link.student.matricule,
            linkedAt: link.created_at
        }))
    };
}

/**
 * Enhanced VP Dashboard with Interview Management
 */
export async function getEnhancedVPDashboard(userId: number, academicYearId?: number): Promise<any> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

        const [
            studentManagement,
            interviewStats,
            subclassManagement,
            teacherTracking
        ] = await Promise.all([
            getVPStudentManagement(yearId),
            getInterviewStatistics(userId, yearId),
            getSubclassManagementStats(userId, yearId),
            getTeacherTrackingStats()
        ]);

        return {
            studentManagement,
            interviewStats,
            subclassManagement,
            teacherTracking,
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.error('Error fetching Enhanced VP dashboard:', error);
        throw new Error('Failed to fetch enhanced VP dashboard data');
    }
}

async function getVPStudentManagement(yearId?: number) {
    const [unassignedStudents, totalEnrollments, classCapacity] = await Promise.all([
        yearId ? prisma.enrollment.findMany({
            where: {
                academic_year_id: yearId,
                sub_class_id: null,
                student: { status: { not: 'WITHDRAWN' } }
            },
            include: {
                student: true,
                class: true
            }
        }) : [],

        yearId ? prisma.enrollment.count({
            where: { academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' } } }
        }) : 0,

        prisma.class.findMany({
            include: {
                sub_classes: {
                    include: {
                        enrollments: yearId ? {
                            where: { academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' } } }
                        } : true
                    }
                }
            }
        })
    ]);

    return {
        unassignedStudents: unassignedStudents.map(enrollment => ({
            studentId: enrollment.student.id,
            studentName: enrollment.student.name,
            studentMatricule: enrollment.student.matricule,
            className: enrollment.class.name,
            enrollmentDate: enrollment.enrollment_date,
            hasInterview: false // Would check InterviewMark table
        })),
        totalUnassigned: unassignedStudents.length,
        totalEnrollments,
        assignmentRate: totalEnrollments > 0 ?
            ((totalEnrollments - unassignedStudents.length) / totalEnrollments) * 100 : 0,
        classCapacityStatus: classCapacity.map(cls => {
            const currentEnrollment = cls.sub_classes.reduce((sum, sc) => sum + sc.enrollments.length, 0);
            const maxCapacity = getClassMaxStudents(cls.sub_classes.length);
            return {
                className: cls.name,
                maxCapacity,
                currentEnrollment,
                availableSpaces: Math.max(0, maxCapacity - currentEnrollment)
            };
        })
    };
}

async function getInterviewStatistics(vpId: number, yearId?: number) {
    const interviews = await prisma.interviewMark.findMany({
        where: { vp_id: vpId },
        include: { student: true }
    });

    return {
        totalInterviews: interviews.length,
        averageScore: interviews.length > 0 ?
            interviews.reduce((sum, i) => sum + i.marks, 0) / interviews.length : 0,
        recentInterviews: interviews.slice(-10).map(interview => ({
            studentName: interview.student.name,
            studentMatricule: interview.student.matricule,
            marks: interview.marks,
            notes: interview.notes,
            interviewDate: interview.created_at
        }))
    };
}

async function getSubclassManagementStats(userId: number, yearId?: number) {
    const assignments = await prisma.roleAssignment.findMany({
        where: {
            user_id: userId,
            role_type: 'VICE_PRINCIPAL',
            academic_year_id: yearId
        },
        include: {
            sub_class: {
                include: {
                    enrollments: yearId ? {
                        where: { academic_year_id: yearId }
                    } : true
                }
            }
        }
    });

    return {
        assignedSubclasses: assignments.length,
        totalStudentsSupervised: assignments.reduce(
            (sum, assignment) => sum + (assignment.sub_class?.enrollments.length || 0), 0
        )
    };
}

async function getTeacherTrackingStats() {
    const teachers = await prisma.user.findMany({
        where: {
            user_roles: { some: { role: 'TEACHER' } }
        }
    });

    return {
        totalTeachers: teachers.length,
        averageAttendanceRate: 85, // Placeholder
        teachersOnLeave: 2 // Placeholder
    };
} 