// src/api/v1/services/parentService.ts
import {
    Prisma,
    Student,
    User,
    AcademicYear,
    Enrollment,
    QuizStatus,
    HealthCondition
} from '@prisma/client';
import prisma from '../../../config/db';
import { getCurrentAcademicYear, getAcademicYearId } from '../../../utils/academicYear';
import * as notificationService from './notificationService';

export interface ParentDashboardData {
    totalChildren: number;
    childrenEnrolled: number;
    pendingFees: number;
    totalFeesOwed: number;
    latestGrades: number;
    disciplineIssues: number;
    unreadMessages: number;
    upcomingEvents: number;
    children: ChildOverview[];
}

export interface ChildOverview {
    id: number;
    name: string;
    matricule?: string;
    class_name?: string;
    subclass_name?: string;
    enrollment_status: string;
    photo?: string;
    attendance_rate: number;
    latest_marks: MarkSummary[];
    pending_fees: number;
    discipline_issues: number;
    recent_absences: number;
}

export interface MarkSummary {
    subject_name: string;
    latest_mark: number;
    sequence: string;
    date: Date;
}

export interface ChildDetails {
    id: number;
    name: string;
    matricule: string;
    date_of_birth: Date;
    class_info?: {
        class_name: string;
        subclass_name: string;
        class_master?: string;
    };
    attendance: {
        present_days: number;
        absent_days: number;
        late_days: number;
        attendance_rate: number;
    };
    academic_performance: {
        subjects: SubjectPerformance[];
        overall_average: number;
        position_in_class?: number;
    };
    fees: {
        total_expected: number;
        total_paid: number;
        outstanding_balance: number;
        due_date?: Date | null;
        days_overdue?: number;
        urgency?: 'PAID' | 'OK' | 'DUE_SOON' | 'OVERDUE';
        last_payment_date?: Date;
        payment_history: PaymentRecord[];
        items?: Array<{
            id: number;
            name: string;
            description: string | null;
            scope: string;
            amount_expected: number;
            amount_paid: number;
            outstanding: number;
            status: 'PAID' | 'PARTIAL' | 'UNPAID';
        }>;
    };
    discipline: {
        total_issues: number;
        recent_issues: DisciplineRecord[];
    };
    reports: {
        available_reports: ReportCard[];
    };
}

export interface SubjectPerformance {
    subject_name: string;
    teacher_name: string;
    marks: {
        sequence: string;
        mark: number;
        total: number;
        date: Date;
    }[];
    average: number;
}

export interface PaymentRecord {
    id: number;
    amount: number;
    payment_date: Date;
    payment_method: string;
    receipt_number?: string;
    recorded_by: string;
}

export interface DisciplineRecord {
    id: number;
    type: string;
    description: string;
    date_occurred: Date;
    status: string;
    resolved_at?: Date;
}

export interface ReportCard {
    id: number;
    sequence_name: string;
    academic_year: string;
    generated_at: Date;
    download_url: string;
}

/**
 * Get comprehensive parent dashboard data
 */
export async function getParentDashboard(parentId: number, academicYearId?: number): Promise<ParentDashboardData> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

        // Get all children linked to this parent
        const parentStudentLinks = await prisma.parentStudent.findMany({
            where: { parent_id: parentId },
            include: {
                student: {
                    include: {
                        enrollments: {
                            where: yearId ? { academic_year_id: yearId } : {},
                            include: {
                                sub_class: {
                                    include: { class: true }
                                },
                                marks: {
                                    include: {
                                        sub_class_subject: {
                                            include: {
                                                subject: true
                                            }
                                        }
                                    },
                                    orderBy: { created_at: 'desc' },
                                    take: 5
                                },
                                discipline_issues: true,
                                school_fees: true,
                                absences: {
                                    where: {
                                        created_at: {
                                            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        const children: ChildOverview[] = [];
        let totalFeesOwed = 0;
        let totalDisciplineIssues = 0;
        let totalLatestGrades = 0;

        for (const link of parentStudentLinks) {
            const student = link.student;
            const currentEnrollment = student.enrollments[0]; // Current year enrollment

            // Calculate attendance rate (placeholder - implement actual logic)
            const attendanceRate = 85; // percentage

            // Get latest marks
            const latestMarks: MarkSummary[] = currentEnrollment?.marks?.slice(0, 3).map(mark => ({
                subject_name: mark.sub_class_subject.subject.name,
                latest_mark: (mark.score ?? 0) || 0,
                sequence: 'Recent', // TODO: Get sequence from exam_sequence
                date: mark.created_at
            })) || [];

            // Calculate pending fees
            const pendingFees = currentEnrollment?.school_fees?.reduce((total, fee) =>
                total + (fee.amount_expected - fee.amount_paid), 0
            ) || 0;

            // Count discipline issues
            const disciplineIssues = currentEnrollment?.discipline_issues?.length || 0;

            // Count recent absences
            const recentAbsences = currentEnrollment?.absences?.length || 0;

            const childOverview: ChildOverview = {
                id: student.id,
                name: student.name,
                matricule: student.matricule || undefined,
                class_name: currentEnrollment?.sub_class?.class?.name,
                subclass_name: currentEnrollment?.sub_class?.name,
                enrollment_status: student.status,
                photo: currentEnrollment?.photo || undefined,
                attendance_rate: attendanceRate,
                latest_marks: latestMarks,
                pending_fees: pendingFees,
                discipline_issues: disciplineIssues,
                recent_absences: recentAbsences
            };

            children.push(childOverview);
            totalFeesOwed += pendingFees;
            totalDisciplineIssues += disciplineIssues;
            totalLatestGrades += latestMarks.length;
        }

        // Get unread messages for parent
        const unreadMessages = await notificationService.getUnreadNotificationCount(parentId);

        // Get upcoming events (placeholder)
        const upcomingEvents = 3;

        return {
            totalChildren: children.length,
            childrenEnrolled: children.filter(child => child.enrollment_status === 'ASSIGNED_TO_CLASS').length,
            pendingFees: children.filter(child => child.pending_fees > 0).length,
            totalFeesOwed,
            latestGrades: totalLatestGrades,
            disciplineIssues: totalDisciplineIssues,
            unreadMessages,
            upcomingEvents,
            children
        };
    } catch (error) {
        console.error('Error fetching parent dashboard:', error);
        throw new Error('Failed to fetch parent dashboard data');
    }
}

/**
 * Get detailed information about a specific child
 */
export async function getChildDetails(parentId: number, studentId: number, academicYearId?: number): Promise<ChildDetails> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

        // Verify parent-student relationship
        console.log(`DEBUG: Looking for parent-student relationship: parentId=${parentId}, studentId=${studentId}`);

        const parentStudentLink = await prisma.parentStudent.findFirst({
            where: {
                parent_id: parentId,
                student_id: studentId
            }
        });

        if (!parentStudentLink) {
            // Debug: Log all relationships for this parent
            const allParentRelationships = await prisma.parentStudent.findMany({
                where: { parent_id: parentId },
                include: { student: { select: { id: true, name: true, matricule: true } } }
            });
            console.log(`DEBUG: All relationships for parent ${parentId}:`, allParentRelationships);

            throw new Error('Parent-student relationship not found');
        }

        // Get basic student data first
        const student = await prisma.student.findUnique({
            where: { id: studentId }
        });

        if (!student) {
            throw new Error('Student not found');
        }

        // Get enrollments separately to avoid complex conditional includes
        const enrollments = await prisma.enrollment.findMany({
            where: {
                student_id: studentId,
                ...(yearId ? { academic_year_id: yearId } : {})
            },
            include: {
                sub_class: {
                    include: {
                        class: true,
                        class_master: { select: { name: true } }
                    }
                },
                marks: {
                    include: {
                        sub_class_subject: {
                            include: {
                                subject: true
                            }
                        }
                    },
                    orderBy: { created_at: 'desc' }
                },
                school_fees: {
                    include: {
                        payment_transactions: {
                            include: {
                                recorded_by: { select: { name: true } }
                            },
                            orderBy: { created_at: 'desc' }
                        }
                    }
                },
                discipline_issues: {
                    orderBy: { created_at: 'desc' }
                },
                absences: {
                    orderBy: { created_at: 'desc' },
                    take: 30
                }
            }
        });

        // Get reports separately (handle potential missing table gracefully)
        let reports = [];
        try {
            reports = await prisma.generatedReport.findMany({
                where: {
                    student_id: studentId,
                    ...(yearId ? { academic_year_id: yearId } : {})
                },
                include: {
                    exam_sequence: {
                        select: {
                            sequence_number: true,
                            term: {
                                select: {
                                    name: true,
                                },
                            },
                        },
                    },
                    academic_year: {
                        select: { name: true }
                    }
                },
                orderBy: { created_at: 'desc' }
            });
        } catch (error) {
            console.log('Note: GeneratedReport query failed, continuing without reports:', error);
            reports = [];
        }

        const currentEnrollment = enrollments[0];

        // Calculate attendance data
        const totalSchoolDays = 180; // Academic year days
        const allAbsences = currentEnrollment?.absences ?? [];
        const lateDays = allAbsences.filter(a => a.absence_type === 'MORNING_LATENESS').length;
        const absentDays = allAbsences.filter(a => a.absence_type === 'CLASS_ABSENCE').length;
        const presentDays = Math.max(0, totalSchoolDays - absentDays);
        const attendanceRate = (presentDays / totalSchoolDays) * 100;

        // Process academic performance
        const subjectPerformanceMap = new Map<number, SubjectPerformance>();

        currentEnrollment?.marks?.forEach(mark => {
            try {
                // Safe access to nested relations
                const subjectId = mark.sub_class_subject?.subject?.id;
                const subjectName = mark.sub_class_subject?.subject?.name;

                if (!subjectId || !subjectName) {
                    console.log('Warning: Missing subject data for mark:', mark.id);
                    return;
                }

                if (!subjectPerformanceMap.has(subjectId)) {
                    subjectPerformanceMap.set(subjectId, {
                        subject_name: subjectName,
                        teacher_name: 'Teacher Name', // TODO: Get from teacher assignment
                        marks: [],
                        average: 0
                    });
                }

                const performance = subjectPerformanceMap.get(subjectId)!;
                performance.marks.push({
                    sequence: 'Sequence', // TODO: Get from exam_sequence
                    mark: (mark.score ?? 0) || 0,
                    total: 20, // TODO: Get from exam configuration
                    date: mark.created_at
                });
            } catch (error) {
                console.log('Warning: Error processing mark:', mark.id, error);
            }
        });

        // Calculate averages
        const subjects = Array.from(subjectPerformanceMap.values()).map(subject => {
            const totalMarks = subject.marks.reduce((sum, mark) => sum + mark.mark, 0);
            subject.average = subject.marks.length > 0 ? totalMarks / subject.marks.length : 0;
            return subject;
        });

        const overallAverage = subjects.length > 0
            ? subjects.reduce((sum, subject) => sum + subject.average, 0) / subjects.length
            : 0;

        // Process fees data (with error handling)
        let fees, totalExpected = 0, totalPaid = 0, outstandingBalance = 0;
        let paymentHistory: PaymentRecord[] = [];
        let lastPaymentDate: Date | undefined;

        try {
            fees = currentEnrollment?.school_fees?.[0];
            totalExpected = fees?.amount_expected || 0;
            totalPaid = fees?.amount_paid || 0;
            outstandingBalance = totalExpected - totalPaid;

            paymentHistory = fees?.payment_transactions?.map(transaction => ({
                id: transaction.id,
                amount: transaction.amount,
                payment_date: transaction.payment_date,
                payment_method: transaction.payment_method,
                receipt_number: transaction.receipt_number || undefined,
                recorded_by: transaction.recorded_by?.name || 'Unknown'
            })) || [];

            lastPaymentDate = paymentHistory.length > 0 ? paymentHistory[0].payment_date : undefined;
        } catch (error) {
            console.log('Warning: Error processing fees data:', error);
        }

        // Process discipline data - Fix the property names to match schema
        const disciplineRecords: DisciplineRecord[] = currentEnrollment?.discipline_issues?.map(issue => ({
            id: issue.id,
            type: issue.issue_type, // Fixed: use issue_type instead of type
            description: issue.description,
            date_occurred: issue.created_at, // Fixed: use created_at as date_occurred since schema doesn't have date_occurred
            status: 'PENDING', // Fixed: hardcode status since schema doesn't have this field
            resolved_at: undefined // Fixed: schema doesn't have resolved_at field
        })) || [];

        // Process report cards
        const reportCards: ReportCard[] = reports?.map(report => ({
            id: report.id,
            sequence_name: `${report.exam_sequence?.term?.name || 'Term'} - Sequence ${report.exam_sequence?.sequence_number || 'N/A'}`,
            academic_year: report.academic_year?.name || 'Unknown Year',
            generated_at: report.created_at,
            download_url: `/api/v1/report-cards/${report.id}/download`
        })) || [];

        return {
            id: student.id,
            name: student.name,
            matricule: student.matricule,
            date_of_birth: student.date_of_birth,
            class_info: currentEnrollment?.sub_class ? {
                class_name: currentEnrollment.sub_class.class.name,
                subclass_name: currentEnrollment.sub_class.name,
                class_master: currentEnrollment.sub_class.class_master?.name
            } : undefined,
            attendance: {
                present_days: presentDays,
                absent_days: absentDays,
                late_days: lateDays,
                attendance_rate: attendanceRate
            },
            academic_performance: {
                subjects,
                overall_average: overallAverage,
                position_in_class: undefined // TODO: Calculate position
            },
            fees: {
                total_expected: totalExpected,
                total_paid: totalPaid,
                outstanding_balance: outstandingBalance,
                last_payment_date: lastPaymentDate,
                payment_history: paymentHistory
            },
            discipline: {
                total_issues: disciplineRecords.length,
                recent_issues: disciplineRecords.slice(0, 5)
            },
            reports: {
                available_reports: reportCards
            }
        };
    } catch (error) {
        console.error('Error fetching child details:', error);
        throw new Error('Failed to fetch child details');
    }
}

/**
 * Send a message from a parent to a school staff member.
 */
export async function sendMessageToStaff(
    parentId: number,
    data: {
        recipient_id: number;
        subject: string;
        message: string;
        priority?: 'LOW' | 'MEDIUM' | 'HIGH';
        student_id?: number;
    }
): Promise<any> {
    try {
        // If student_id is provided, verify parent-student relationship
        if (data.student_id) {
            const parentStudentLink = await prisma.parentStudent.findFirst({
                where: {
                    parent_id: parentId,
                    student_id: data.student_id
                }
            });

            if (!parentStudentLink) {
                throw new Error('Parent-student relationship not found');
            }
        }

        // Create a message record
        const message = await prisma.message.create({
            data: {
                sender_id: parentId,
                receiver_id: data.recipient_id,
                subject: data.subject,
                content: data.message,
                // The student_id can be stored in a metadata field if you add one to the Message model
                // or handled differently depending on requirements.
            }
        });

        return message;
    } catch (error) {
        console.error('Error sending message to staff:', error);
        throw new Error('Failed to send message to staff');
    }
}

/**
 * Get all quiz results for a specific child
 */
export async function getChildQuizResults(parentId: number, studentId: number, academicYearId?: number): Promise<any[]> {
    try {
        // Verify parent-student relationship first
        const parentStudentLink = await prisma.parentStudent.findFirst({
            where: {
                parent_id: parentId,
                student_id: studentId
            }
        });

        if (!parentStudentLink) {
            throw new Error('Parent-student relationship not found');
        }

        // Check if student exists
        const student = await prisma.student.findUnique({
            where: { id: studentId },
            include: { enrollments: true }
        });

        if (!student) {
            throw new Error('Student not found');
        }

        // If no specific academic year provided, try to use current year first, then any year
        let yearId = academicYearId;
        if (!yearId) {
            const currentYear = await getCurrentAcademicYear();
            yearId = currentYear?.id;
        }

        // Build query conditions
        const whereConditions: any = {
            student_id: studentId
        };

        // Only add academic year filter if we have a valid year ID
        if (yearId) {
            whereConditions.academic_year_id = yearId;
        }

        const submissions = await prisma.quizSubmission.findMany({
            where: whereConditions,
            include: {
                quiz: {
                    include: {
                        subject: true
                    }
                }
            },
            orderBy: {
                submitted_at: 'desc'
            }
        });

        return submissions.map(s => ({
            submissionId: s.id,
            quizTitle: s.quiz.title,
            subject: s.quiz.subject.name,
            score: s.score,
            totalMarks: s.total_marks,
            percentage: s.percentage,
            status: s.status,
            submittedAt: s.submitted_at
        }));
    } catch (error: any) {
        console.error('Error fetching child quiz results:', error);
        throw new Error(`Failed to fetch quiz results: ${error.message}`);
    }
}

/**
 * Get quiz results for parent's children
 */
export async function getChildrenQuizResults(parentId: number, academicYearId?: number): Promise<any[]> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

        // Get all children linked to this parent
        const parentStudentLinks = await prisma.parentStudent.findMany({
            where: { parent_id: parentId },
            include: {
                student: {
                    select: {
                        id: true,
                        name: true,
                        matricule: true
                    }
                }
            }
        });

        if (parentStudentLinks.length === 0) {
            return [];
        }

        const studentIds = parentStudentLinks.map(link => link.student.id);

        // Get completed quiz submissions for all children
        const quizSubmissions = await prisma.quizSubmission.findMany({
            where: {
                student_id: { in: studentIds },
                ...(yearId && { academic_year_id: yearId }),
                status: QuizStatus.COMPLETED
            },
            include: {
                quiz: {
                    include: {
                        subject: true
                    }
                },
                student: {
                    select: {
                        id: true,
                        name: true,
                        matricule: true
                    }
                }
            },
            orderBy: { submitted_at: 'desc' }
        });

        // Format the results
        return quizSubmissions.map(submission => ({
            submission_id: submission.id,
            student_name: submission.student.name,
            student_id: submission.student.id,
            student_matricule: submission.student.matricule,
            quiz_title: submission.quiz.title,
            subject: submission.quiz.subject.name,
            score: submission.score || 0,
            total_marks: submission.total_marks || submission.quiz.total_marks,
            percentage: submission.percentage || 0,
            submitted_at: submission.submitted_at,
            time_taken: submission.time_taken
        }));
    } catch (error) {
        console.error('Error fetching children quiz results:', error);
        throw new Error('Failed to fetch quiz results');
    }
}

/**
 * Get school announcements relevant to parents
 */
export async function getSchoolAnnouncements(parentId: number, limit: number = 10): Promise<any[]> {
    try {
        const announcements = await prisma.announcement.findMany({
            where: {
                audience: { in: ['BOTH', 'EXTERNAL'] }
            },
            orderBy: { created_at: 'desc' },
            take: limit,
            include: {
                created_by: { select: { name: true, matricule: true } }
            }
        });

        return announcements.map(announcement => ({
            id: announcement.id,
            title: announcement.title,
            content: announcement.message,
            author: announcement.created_by?.name || 'Anonymous',
            created_at: announcement.created_at
        }));
    } catch (error) {
        console.error('Error fetching announcements:', error);
        throw new Error('Failed to fetch announcements');
    }
}

/**
 * Get detailed analytics for a specific child.
 */
export async function getChildAnalytics(parentId: number, studentId: number, academicYearId?: number): Promise<any> {
    try {
        // Verify parent-student relationship first
        const parentStudentLink = await prisma.parentStudent.findFirst({
            where: {
                parent_id: parentId,
                student_id: studentId
            }
        });

        if (!parentStudentLink) {
            throw new Error('Parent-student relationship not found');
        }

        // Try to get academic year ID
        let yearId = academicYearId;
        if (!yearId) {
            const currentYear = await getCurrentAcademicYear();
            yearId = currentYear?.id;
        }

        // Fetch student and enrollment details - try specific year first, then any enrollment
        let student = await prisma.student.findUnique({
            where: { id: studentId },
            include: {
                enrollments: yearId ? { where: { academic_year_id: yearId } } : true
            }
        });

        if (!student) {
            throw new Error('Student not found');
        }

        // If no enrollments found for specific year, try to get any enrollment
        if (student.enrollments.length === 0 && yearId) {
            student = await prisma.student.findUnique({
                where: { id: studentId },
                include: { enrollments: { orderBy: { created_at: 'desc' } } }
            });
        }

        // If still no enrollments, provide basic analytics
        if (!student || student.enrollments.length === 0) {
            return {
                studentInfo: {
                    id: studentId,
                    name: student?.name || 'Unknown',
                    classInfo: null
                },
                performanceAnalytics: {
                    overall_average: 0,
                    total_assessments: 0,
                    improvement_trend: 'No data',
                    performance_grade: 'N/A',
                    strengths: [],
                    areas_for_improvement: []
                },
                attendanceAnalytics: {
                    overall_attendance_rate: 0,
                    total_absences: 0,
                    monthly_trends: [],
                    attendance_status: 'No data',
                    recent_absences: []
                },
                quizAnalytics: {
                    total_quizzes: 0,
                    average_score: 0,
                    improvement_trend: 'No data',
                    subject_performance: [],
                    recent_quizzes: []
                },
                subjectTrends: [],
                comparativeAnalytics: {
                    class_comparison: 'No enrollment data',
                    relative_performance: 'N/A'
                }
            };
        }

        const enrollment = student.enrollments[0];
        const actualYearId = enrollment.academic_year_id;

        const marks = await prisma.mark.findMany({ where: { enrollment_id: enrollment.id } });

        const [
            performanceAnalytics,
            attendanceAnalytics,
            quizAnalytics,
            subjectTrends,
            comparativeAnalytics
        ] = await Promise.all([
            calculatePerformanceAnalytics(marks),
            calculateAttendanceAnalytics(enrollment.id, actualYearId),
            calculateQuizAnalytics(studentId, actualYearId),
            calculateSubjectTrends(marks),
            calculateComparativeAnalytics(studentId, enrollment.sub_class_id, actualYearId)
        ]);

        return {
            studentInfo: {
                id: student.id,
                name: student.name,
                classInfo: enrollment.sub_class_id ? {
                    className: 'Class Info Not Available',
                    subclassName: 'Subclass Info Not Available'
                } : null,
            },
            performanceAnalytics,
            attendanceAnalytics,
            quizAnalytics,
            subjectTrends,
            comparativeAnalytics,
        };
    } catch (error: any) {
        console.error('Error generating child analytics:', error);
        throw new Error(`Failed to generate analytics: ${error.message}`);
    }
}

/**
 * Calculate performance analytics from marks
 */
async function calculatePerformanceAnalytics(marks: any[]): Promise<any> {
    if (marks.length === 0) {
        return {
            overall_average: 0,
            total_assessments: 0,
            improvement_trend: 'No data',
            performance_grade: 'N/A',
            strengths: [],
            areas_for_improvement: []
        };
    }

    // Group marks by subject - Fix typing by properly typing the accumulator
    const subjectMarks: Record<string, number[]> = marks.reduce((acc, mark) => {
        const subjectName = mark.sub_class_subject?.subject?.name;
        if (!subjectName) return acc; // Skip marks without subject info
        if (!acc[subjectName]) {
            acc[subjectName] = [];
        }
        acc[subjectName].push((mark.score ?? 0) || 0);
        return acc;
    }, {} as Record<string, number[]>);

    // Calculate overall average
    const totalMarks = marks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0);
    const overallAverage = totalMarks / marks.length;

    // Calculate improvement trend (compare first half vs second half of marks)
    const midpoint = Math.floor(marks.length / 2);
    const firstHalfAvg = marks.slice(0, midpoint).reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / midpoint;
    const secondHalfAvg = marks.slice(midpoint).reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / (marks.length - midpoint);

    let improvementTrend = 'Stable';
    if (secondHalfAvg > firstHalfAvg + 2) {
        improvementTrend = 'Improving';
    } else if (secondHalfAvg < firstHalfAvg - 2) {
        improvementTrend = 'Declining';
    }

    // Calculate subject averages for strengths/weaknesses
    const subjectAverages = Object.entries(subjectMarks).map(([subject, marksList]) => ({
        subject,
        average: marksList.reduce((sum: number, mark: number) => sum + mark, 0) / marksList.length
    }));

    // Sort by performance
    subjectAverages.sort((a, b) => b.average - a.average);

    const strengths = subjectAverages.slice(0, 3).map(s => ({
        subject: s.subject,
        average: s.average.toFixed(1)
    }));

    const areasForImprovement = subjectAverages.slice(-3).map(s => ({
        subject: s.subject,
        average: s.average.toFixed(1),
        recommendation: generateRecommendation(s.average)
    }));

    return {
        overall_average: overallAverage.toFixed(2),
        total_assessments: marks.length,
        improvement_trend: improvementTrend,
        performance_grade: getPerformanceGrade(overallAverage),
        strengths,
        areas_for_improvement: areasForImprovement,
        subject_breakdown: subjectAverages
    };
}

/**
 * Calculate attendance analytics
 */
async function calculateAttendanceAnalytics(enrollmentId: number, academicYearId: number): Promise<any> {
    // Get absence records
    const absences = await prisma.studentAbsence.findMany({
        where: {
            enrollment_id: enrollmentId
        },
        orderBy: { created_at: 'asc' }
    });

    const totalSchoolDays = 180; // Estimate for academic year
    const classAbsences = absences.filter(a => a.absence_type === 'CLASS_ABSENCE');
    const lateArrivals = absences.filter(a => a.absence_type === 'MORNING_LATENESS');
    const excused = absences.filter(a => a.is_excused);
    const unexcused = absences.filter(a => !a.is_excused);
    const totalAbsences = absences.length;
    const attendanceRate = ((totalSchoolDays - classAbsences.length) / totalSchoolDays) * 100;

    // Calculate trends
    const currentMonth = new Date().getMonth();
    const monthlyAttendance = [];

    for (let month = 0; month < currentMonth + 1; month++) {
        const monthAbsences = absences.filter(absence =>
            new Date(absence.created_at).getMonth() === month
        ).length;

        const monthAttendanceRate = ((20 - monthAbsences) / 20) * 100; // ~20 school days per month
        monthlyAttendance.push({
            month: getMonthName(month),
            attendance_rate: monthAttendanceRate.toFixed(1),
            absences: monthAbsences
        });
    }

    return {
        overall_attendance_rate: attendanceRate.toFixed(1),
        total_absences: totalAbsences,
        class_absences: classAbsences.length,
        morning_lateness: lateArrivals.length,
        excused_count: excused.length,
        unexcused_count: unexcused.length,
        at_risk: unexcused.length >= 3, // 3+ unexcused = summons trigger threshold
        monthly_trends: monthlyAttendance,
        attendance_status: getAttendanceStatus(attendanceRate),
        recent_absences: absences.slice(-10).reverse().map(absence => ({
            id: absence.id,
            date: absence.created_at.toISOString().split('T')[0],
            type: absence.absence_type,
            is_excused: absence.is_excused,
            excuse_reason: absence.excuse_reason ?? null,
            excused_at: absence.excused_at ?? null,
            makeup_status: absence.makeup_status,
            makeup_completed_at: absence.makeup_completed_at ?? null
        }))
    };
}

/**
 * Calculate quiz performance analytics
 */
async function calculateQuizAnalytics(studentId: number, academicYearId: number): Promise<any> {
    const quizSubmissions = await prisma.quizSubmission.findMany({
        where: {
            student_id: studentId,
            academic_year_id: academicYearId,
            status: QuizStatus.COMPLETED
        },
        include: {
            quiz: {
                include: {
                    subject: true
                }
            }
        },
        orderBy: { submitted_at: 'asc' }
    });

    if (quizSubmissions.length === 0) {
        return {
            total_quizzes: 0,
            average_score: 0,
            improvement_trend: 'No data',
            subject_performance: [],
            recent_quizzes: []
        };
    }

    const totalQuizzes = quizSubmissions.length;
    const averageScore = quizSubmissions.reduce((sum, sub) => sum + (sub.percentage || 0), 0) / totalQuizzes;

    // Calculate improvement trend
    const midpoint = Math.floor(totalQuizzes / 2);
    const firstHalfAvg = quizSubmissions.slice(0, midpoint).reduce((sum, sub) => sum + (sub.percentage || 0), 0) / midpoint;
    const secondHalfAvg = quizSubmissions.slice(midpoint).reduce((sum, sub) => sum + (sub.percentage || 0), 0) / (totalQuizzes - midpoint);

    let improvementTrend = 'Stable';
    if (secondHalfAvg > firstHalfAvg + 5) {
        improvementTrend = 'Improving';
    } else if (secondHalfAvg < firstHalfAvg - 5) {
        improvementTrend = 'Declining';
    }

    // Subject-wise quiz performance
    const subjectPerformance = quizSubmissions.reduce((acc, submission) => {
        const subjectName = submission.quiz.subject.name;
        if (!acc[subjectName]) {
            acc[subjectName] = [];
        }
        acc[subjectName].push(submission.percentage || 0);
        return acc;
    }, {} as Record<string, number[]>);

    const subjectAnalytics = Object.entries(subjectPerformance).map(([subject, scores]) => ({
        subject,
        average: (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1),
        quiz_count: scores.length,
        best_score: Math.max(...scores).toFixed(1),
        latest_score: scores[scores.length - 1].toFixed(1)
    }));

    return {
        total_quizzes: totalQuizzes,
        average_score: averageScore.toFixed(1),
        improvement_trend: improvementTrend,
        subject_performance: subjectAnalytics,
        recent_quizzes: quizSubmissions.slice(-5).map(sub => ({
            quiz_title: sub.quiz.title,
            subject: sub.quiz.subject.name,
            score: sub.percentage?.toFixed(1),
            date: sub.submitted_at?.toISOString().split('T')[0]
        }))
    };
}

/**
 * Calculate subject-wise performance trends
 */
async function calculateSubjectTrends(marks: any[]): Promise<any[]> {
    // Group marks by subject and sort by date - Fix typing
    const subjectMarks: Record<string, any[]> = marks.reduce((acc, mark) => {
        const subjectName = mark.sub_class_subject?.subject?.name;
        if (!subjectName) return acc; // Skip marks without subject info
        if (!acc[subjectName]) {
            acc[subjectName] = [];
        }
        acc[subjectName].push({
            mark: (mark.score ?? 0) || 0,
            date: mark.created_at,
            sequence: mark.exam_sequence?.name || 'Unknown'
        });
        return acc;
    }, {} as Record<string, any[]>);

    // Calculate trends for each subject
    return Object.entries(subjectMarks).map(([subject, subjectMarksList]) => {
        // Sort by date
        subjectMarksList.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const currentAverage = subjectMarksList.reduce((sum, mark) => sum + mark.mark, 0) / subjectMarksList.length;

        // Calculate trend (linear regression approximation)
        let trend = 'Stable';
        if (subjectMarksList.length >= 3) {
            const firstThird = subjectMarksList.slice(0, Math.ceil(subjectMarksList.length / 3));
            const lastThird = subjectMarksList.slice(-Math.ceil(subjectMarksList.length / 3));

            const firstAvg = firstThird.reduce((sum, mark) => sum + mark.mark, 0) / firstThird.length;
            const lastAvg = lastThird.reduce((sum, mark) => sum + mark.mark, 0) / lastThird.length;

            if (lastAvg > firstAvg + 2) {
                trend = 'Improving';
            } else if (lastAvg < firstAvg - 2) {
                trend = 'Declining';
            }
        }

        return {
            subject,
            current_average: currentAverage.toFixed(1),
            trend,
            total_assessments: subjectMarksList.length,
            highest_mark: Math.max(...subjectMarksList.map(m => m.mark)),
            lowest_mark: Math.min(...subjectMarksList.map(m => m.mark)),
            recent_marks: subjectMarksList.slice(-3).map(mark => ({
                mark: mark.mark,
                sequence: mark.sequence,
                date: mark.date.toISOString().split('T')[0]
            }))
        };
    });
}

/**
 * Calculate comparative analytics (student vs class average)
 */
async function calculateComparativeAnalytics(studentId: number, subClassId: number | null, academicYearId: number): Promise<any> {
    if (!subClassId) {
        return {
            class_comparison: 'No class assignment',
            relative_performance: 'N/A'
        };
    }

    // Get all students in the same subclass
    const classmates = await prisma.enrollment.findMany({
        where: {
            sub_class_id: subClassId,
            academic_year_id: academicYearId
        },
        include: {
            marks: {
                include: {
                    sub_class_subject: {
                        include: {
                            subject: true
                        }
                    }
                }
            }
        }
    });

    const studentMarks = classmates.find(c => c.student_id === studentId)?.marks || [];
    const studentAverage = studentMarks.length > 0
        ? studentMarks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / studentMarks.length
        : 0;

    // Calculate class average
    const allMarks = classmates.flatMap(c => c.marks);
    const classAverage = allMarks.length > 0
        ? allMarks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / allMarks.length
        : 0;

    // Calculate ranking
    const studentAverages = classmates.map(c => {
        const marks = c.marks;
        return {
            student_id: c.student_id,
            average: marks.length > 0 ? marks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / marks.length : 0
        };
    }).sort((a, b) => b.average - a.average);

    const studentRank = studentAverages.findIndex(s => s.student_id === studentId) + 1;

    return {
        class_comparison: {
            student_average: studentAverage.toFixed(1),
            class_average: classAverage.toFixed(1),
            difference: (studentAverage - classAverage).toFixed(1),
            performance_status: studentAverage >= classAverage ? 'Above Average' : 'Below Average'
        },
        ranking: {
            position: studentRank,
            total_students: classmates.length,
            percentile: ((classmates.length - studentRank + 1) / classmates.length * 100).toFixed(0)
        }
    };
}

// Helper functions
function getPerformanceGrade(average: number): string {
    if (average >= 17) return 'Excellent (A)';
    if (average >= 14) return 'Very Good (B)';
    if (average >= 12) return 'Good (C)';
    if (average >= 10) return 'Fair (D)';
    return 'Needs Improvement (F)';
}

function generateRecommendation(average: number): string {
    if (average < 10) return 'Focus on fundamentals and seek additional help';
    if (average < 12) return 'Practice more exercises and review concepts';
    if (average < 14) return 'Work on consistency and exam techniques';
    return 'Maintain current performance level';
}

function getAttendanceStatus(rate: number): string {
    if (rate >= 95) return 'Excellent';
    if (rate >= 90) return 'Good';
    if (rate >= 85) return 'Fair';
    return 'Needs Improvement';
}

function getMonthName(month: number): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[month];
}

/**
 * Resolve a student by matricule. The parent portal is unauthenticated —
 * knowing the matricule is treated as sufficient to view a student's data.
 */
export async function resolveStudentByMatricule(matricule: string): Promise<Student> {
    const student = await prisma.student.findUnique({ where: { matricule } });
    if (!student) {
        const err: any = new Error('Student not found for the provided matricule');
        err.statusCode = 404;
        throw err;
    }
    return student;
}

/**
 * Find the first linked parent user id for a student (by matricule).
 * Used when parent-side endpoints need a sender/actor identity
 * (e.g. sending a message, opening a DM channel).
 */
export async function resolveLinkedParentIdByMatricule(matricule: string): Promise<number> {
    const student = await resolveStudentByMatricule(matricule);
    const link = await prisma.parentStudent.findFirst({
        where: { student_id: student.id },
        orderBy: { id: 'asc' }
    });
    if (!link) {
        const err: any = new Error('No parent is linked to this student');
        err.statusCode = 404;
        throw err;
    }
    return link.parent_id;
}

/**
 * Combined snapshot for a parent about a specific child looked up by matricule:
 * profile, current enrollment, academic performance (marks by sequence),
 * discipline issues, and health profile.
 */
export async function getChildOverviewByMatricule(
    matricule: string,
    academicYearId?: number
) {
    const student = await resolveStudentByMatricule(matricule);
    const yearId = academicYearId ?? (await getCurrentAcademicYear())?.id;

    const enrollment = await prisma.enrollment.findFirst({
        where: {
            student_id: student.id,
            ...(yearId ? { academic_year_id: yearId } : {})
        },
        include: {
            academic_year: { select: { id: true, name: true } },
            class: { select: { id: true, name: true } },
            sub_class: {
                select: {
                    id: true,
                    name: true,
                    class: { select: { id: true, name: true } },
                    class_master: { select: { id: true, name: true, matricule: true } }
                }
            }
        }
    });

    const profile = {
        id: student.id,
        matricule: student.matricule,
        name: student.name,
        dateOfBirth: student.date_of_birth,
        gender: student.gender,
        status: student.status,
        healthConditions: student.health_conditions,
        medicalNotes: student.medical_notes
    };

    const classInfo = enrollment
        ? {
            academicYearId: enrollment.academic_year_id,
            academicYearName: enrollment.academic_year?.name,
            className: enrollment.class?.name,
            subclassId: enrollment.sub_class?.id ?? null,
            subclassName: enrollment.sub_class?.name ?? null,
            classMaster: enrollment.sub_class?.class_master?.name ?? null
        }
        : null;

    const [academic, discipline, health] = await Promise.all([
        getChildAcademicResultsCore(student.id, enrollment?.id, enrollment?.academic_year_id ?? yearId),
        getChildDisciplineRecordsCore(enrollment?.id),
        getChildHealthProfileCore(student.id, enrollment?.id, enrollment?.academic_year_id ?? yearId)
    ]);

    return {
        student: profile,
        enrollment: classInfo,
        academic,
        discipline,
        health
    };
}

async function getChildAcademicResultsCore(
    studentId: number,
    enrollmentId: number | undefined,
    academicYearId: number | undefined
) {
    if (!enrollmentId) {
        return {
            hasEnrollment: false,
            sequences: [] as any[],
            overallAverage: 0,
            totalAssessments: 0
        };
    }

    const marks = await prisma.mark.findMany({
        where: { enrollment_id: enrollmentId },
        include: {
            sub_class_subject: {
                include: {
                    subject: { select: { id: true, name: true, category: true } }
                }
            },
            exam_sequence: {
                select: {
                    id: true,
                    sequence_number: true,
                    term: { select: { id: true, name: true } }
                }
            },
            teacher: { select: { id: true, name: true } }
        },
        orderBy: [
            { exam_sequence_id: 'asc' },
            { created_at: 'asc' }
        ]
    });

    const sequenceMap = new Map<number, any>();
    for (const mark of marks) {
        const seqId = mark.exam_sequence_id;
        if (!sequenceMap.has(seqId)) {
            sequenceMap.set(seqId, {
                examSequenceId: seqId,
                sequenceNumber: mark.exam_sequence?.sequence_number,
                termName: mark.exam_sequence?.term?.name,
                termId: mark.exam_sequence?.term?.id,
                subjects: [] as any[],
                average: 0
            });
        }
        sequenceMap.get(seqId).subjects.push({
            subjectId: mark.sub_class_subject?.subject?.id,
            subjectName: mark.sub_class_subject?.subject?.name,
            category: mark.sub_class_subject?.subject?.category,
            coefficient: mark.sub_class_subject?.coefficient,
            teacher: mark.teacher?.name,
            score: mark.score,
            recordedAt: mark.created_at
        });
    }

    const sequences = Array.from(sequenceMap.values()).map(seq => {
        const validScores = seq.subjects
            .map((s: any) => s.score)
            .filter((v: number | null | undefined): v is number => typeof v === 'number');
        const avg = validScores.length > 0
            ? validScores.reduce((a: number, b: number) => a + b, 0) / validScores.length
            : 0;
        seq.average = Number(avg.toFixed(2));
        return seq;
    });

    const allScores = marks
        .map(m => m.score)
        .filter((v): v is number => typeof v === 'number');
    const overall = allScores.length > 0
        ? Number((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2))
        : 0;

    let sequenceAverages: any[] = [];
    if (academicYearId) {
        sequenceAverages = await prisma.studentSequenceAverage.findMany({
            where: { enrollment_id: enrollmentId },
            include: {
                exam_sequence: {
                    select: {
                        sequence_number: true,
                        term: { select: { name: true } }
                    }
                }
            },
            orderBy: { exam_sequence_id: 'asc' }
        });
    }

    return {
        hasEnrollment: true,
        totalAssessments: marks.length,
        overallAverage: overall,
        sequences,
        sequenceAverages: sequenceAverages.map(sa => ({
            examSequenceId: sa.exam_sequence_id,
            sequenceNumber: sa.exam_sequence?.sequence_number,
            termName: sa.exam_sequence?.term?.name,
            average: sa.average,
            rank: sa.rank,
            totalStudents: sa.total_students,
            decision: sa.decision
        }))
    };
}

async function getChildDisciplineRecordsCore(enrollmentId: number | undefined) {
    if (!enrollmentId) {
        return { totalIssues: 0, issues: [] as any[] };
    }
    const issues = await prisma.disciplineIssue.findMany({
        where: { enrollment_id: enrollmentId },
        include: {
            assigned_by: { select: { id: true, name: true } },
            reviewed_by: { select: { id: true, name: true } }
        },
        orderBy: { created_at: 'desc' }
    });
    return {
        totalIssues: issues.length,
        issues: issues.map(i => ({
            id: i.id,
            issueType: i.issue_type,
            description: i.description,
            notes: i.notes,
            actionTaken: i.action_taken,
            assignedBy: i.assigned_by?.name,
            reviewedBy: i.reviewed_by?.name,
            createdAt: i.created_at
        }))
    };
}

async function getChildHealthProfileCore(
    studentId: number,
    enrollmentId: number | undefined,
    academicYearId: number | undefined
) {
    const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: {
            health_conditions: true,
            medical_notes: true
        }
    });

    if (!enrollmentId) {
        return {
            healthConditions: student?.health_conditions ?? [],
            medicalNotes: student?.medical_notes ?? null,
            totalVisits: 0,
            recentVisits: [] as any[]
        };
    }

    const visits = await prisma.nurseVisitLog.findMany({
        where: {
            enrollment: {
                student_id: studentId,
                ...(academicYearId ? { academic_year_id: academicYearId } : {})
            }
        },
        include: {
            logged_by: { select: { id: true, name: true } },
            period: { select: { id: true, day_of_week: true, start_time: true, end_time: true } }
        },
        orderBy: { visit_date: 'desc' },
        take: 20
    });

    return {
        healthConditions: student?.health_conditions ?? [],
        medicalNotes: student?.medical_notes ?? null,
        totalVisits: visits.length,
        recentVisits: visits.map(v => ({
            id: v.id,
            visitDate: v.visit_date,
            reason: v.reason,
            treatmentGiven: v.treatment_given,
            medicationGiven: v.medication_given,
            notes: v.notes,
            sentHome: v.sent_home,
            loggedBy: v.logged_by?.name,
            period: v.period
                ? { dayOfWeek: v.period.day_of_week, startTime: v.period.start_time, endTime: v.period.end_time }
                : null
        }))
    };
}

/**
 * Report cards available for a child (by matricule). Lists finalized/completed
 * report records the parent can attempt to download.
 */
export async function listChildReportCardsByMatricule(
    matricule: string,
    academicYearId?: number
) {
    const student = await resolveStudentByMatricule(matricule);
    const yearId = academicYearId ?? (await getCurrentAcademicYear())?.id;

    const reports = await prisma.generatedReport.findMany({
        where: {
            student_id: student.id,
            report_type: 'SINGLE_STUDENT' as any,
            ...(yearId ? { academic_year_id: yearId } : {})
        },
        include: {
            academic_year: { select: { id: true, name: true } },
            exam_sequence: {
                select: {
                    id: true,
                    sequence_number: true,
                    term: { select: { id: true, name: true } }
                }
            }
        },
        orderBy: { created_at: 'desc' }
    });

    return {
        student: {
            id: student.id,
            matricule: student.matricule,
            name: student.name
        },
        reports: reports.map(r => ({
            id: r.id,
            examSequenceId: r.exam_sequence_id,
            sequenceNumber: r.exam_sequence?.sequence_number,
            termName: r.exam_sequence?.term?.name,
            academicYearId: r.academic_year_id,
            academicYearName: r.academic_year?.name,
            status: r.status,
            generatedAt: r.updated_at,
            errorMessage: r.error_message
        }))
    };
}

// ---------------------------------------------------------------------------
// Matricule-scoped parent portal functions (no authentication required).
// Each function resolves the student from the matricule and returns data
// for that single child only.
// ---------------------------------------------------------------------------

/**
 * Single-child dashboard summary — the matricule identifies the student.
 * Returns the same shape as one entry in the legacy multi-child dashboard.
 */
export async function getChildDashboardByMatricule(
    matricule: string,
    academicYearId?: number
): Promise<ChildOverview & { fees: { totalExpected: number; totalPaid: number; outstanding: number } }> {
    const student = await resolveStudentByMatricule(matricule);
    const yearId = academicYearId ?? (await getCurrentAcademicYear())?.id;

    const enrollment = await prisma.enrollment.findFirst({
        where: {
            student_id: student.id,
            ...(yearId ? { academic_year_id: yearId } : {})
        },
        include: {
            sub_class: { include: { class: true } },
            marks: {
                include: { sub_class_subject: { include: { subject: true } } },
                orderBy: { created_at: 'desc' },
                take: 5
            },
            discipline_issues: true,
            school_fees: true,
            absences: {
                where: { created_at: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }
            }
        }
    });

    const latestMarks: MarkSummary[] = enrollment?.marks?.slice(0, 3).map(m => ({
        subject_name: m.sub_class_subject.subject.name,
        latest_mark: (m.score ?? 0) || 0,
        sequence: 'Recent',
        date: m.created_at
    })) || [];

    const totalExpected = enrollment?.school_fees?.reduce((s, f) => s + f.amount_expected, 0) || 0;
    const totalPaid = enrollment?.school_fees?.reduce((s, f) => s + f.amount_paid, 0) || 0;
    const outstanding = totalExpected - totalPaid;

    return {
        id: student.id,
        name: student.name,
        matricule: student.matricule || undefined,
        class_name: enrollment?.sub_class?.class?.name,
        subclass_name: enrollment?.sub_class?.name,
        enrollment_status: student.status,
        photo: enrollment?.photo || undefined,
        attendance_rate: 85,
        latest_marks: latestMarks,
        pending_fees: outstanding,
        discipline_issues: enrollment?.discipline_issues?.length || 0,
        recent_absences: enrollment?.absences?.length || 0,
        fees: { totalExpected, totalPaid, outstanding }
    };
}

/**
 * Full child details by matricule — same shape as legacy getChildDetails
 * but resolves the student from matricule and skips the parent-link check.
 */
export async function getChildDetailsByMatricule(
    matricule: string,
    academicYearId?: number
): Promise<ChildDetails> {
    const student = await resolveStudentByMatricule(matricule);
    const yearId = academicYearId ?? (await getCurrentAcademicYear())?.id;

    const enrollments = await prisma.enrollment.findMany({
        where: {
            student_id: student.id,
            ...(yearId ? { academic_year_id: yearId } : {})
        },
        include: {
            sub_class: {
                include: {
                    class: true,
                    class_master: { select: { name: true } }
                }
            },
            marks: {
                include: { sub_class_subject: { include: { subject: true } } },
                orderBy: { created_at: 'desc' }
            },
            school_fees: {
                include: {
                    payment_transactions: {
                        include: { recorded_by: { select: { name: true } } },
                        orderBy: { created_at: 'desc' }
                    }
                }
            },
            discipline_issues: { orderBy: { created_at: 'desc' } },
            absences: { orderBy: { created_at: 'desc' }, take: 30 }
        }
    });

    let reports: any[] = [];
    try {
        reports = await prisma.generatedReport.findMany({
            where: {
                student_id: student.id,
                ...(yearId ? { academic_year_id: yearId } : {})
            },
            include: {
                exam_sequence: {
                    select: {
                        sequence_number: true,
                        term: { select: { name: true } }
                    }
                },
                academic_year: { select: { name: true } }
            },
            orderBy: { created_at: 'desc' }
        });
    } catch {
        reports = [];
    }

    const currentEnrollment = enrollments[0];

    const totalSchoolDays = 180;
    const allAbsences = currentEnrollment?.absences ?? [];
    const lateDays = allAbsences.filter(a => a.absence_type === 'MORNING_LATENESS').length;
    const absentDays = allAbsences.filter(a => a.absence_type === 'CLASS_ABSENCE').length;
    const presentDays = Math.max(0, totalSchoolDays - absentDays);
    const attendanceRate = (presentDays / totalSchoolDays) * 100;

    const subjectPerformanceMap = new Map<number, SubjectPerformance>();
    currentEnrollment?.marks?.forEach(mark => {
        const subjectId = mark.sub_class_subject?.subject?.id;
        const subjectName = mark.sub_class_subject?.subject?.name;
        if (!subjectId || !subjectName) return;
        if (!subjectPerformanceMap.has(subjectId)) {
            subjectPerformanceMap.set(subjectId, {
                subject_name: subjectName,
                teacher_name: 'Teacher Name',
                marks: [],
                average: 0
            });
        }
        subjectPerformanceMap.get(subjectId)!.marks.push({
            sequence: 'Sequence',
            mark: (mark.score ?? 0) || 0,
            total: 20,
            date: mark.created_at
        });
    });

    const subjects = Array.from(subjectPerformanceMap.values()).map(subject => {
        const total = subject.marks.reduce((s, m) => s + m.mark, 0);
        subject.average = subject.marks.length > 0 ? total / subject.marks.length : 0;
        return subject;
    });

    const overallAverage = subjects.length > 0
        ? subjects.reduce((s, sub) => s + sub.average, 0) / subjects.length
        : 0;

    const fees = currentEnrollment?.school_fees?.[0];
    const totalExpected = fees?.amount_expected || 0;
    const totalPaid = fees?.amount_paid || 0;
    const outstandingBalance = totalExpected - totalPaid;
    const dueDate = fees?.due_date ?? null;
    const now = new Date();
    const daysOverdue = dueDate && outstandingBalance > 0
        ? Math.max(0, Math.floor((now.getTime() - new Date(dueDate).getTime()) / (24 * 60 * 60 * 1000)))
        : 0;
    const feeUrgency: 'PAID' | 'OK' | 'DUE_SOON' | 'OVERDUE' = outstandingBalance <= 0
        ? 'PAID'
        : daysOverdue > 0
            ? 'OVERDUE'
            : dueDate && (new Date(dueDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000) <= 14
                ? 'DUE_SOON'
                : 'OK';

    const paymentHistory: PaymentRecord[] = fees?.payment_transactions?.map(t => ({
        id: t.id,
        amount: t.amount,
        payment_date: t.payment_date,
        payment_method: t.payment_method,
        receipt_number: t.receipt_number || undefined,
        recorded_by: t.recorded_by?.name || 'Unknown'
    })) || [];

    // Itemized fee breakdown (tuition vs transport vs PTA etc.)
    // Fee items match the student's academic year via ALL / CLASS / SUBCLASS / STUDENT scope.
    const feeItemsBreakdown = currentEnrollment
        ? await buildFeeItemsBreakdown(currentEnrollment.id, student.id, currentEnrollment.class_id, currentEnrollment.sub_class_id, currentEnrollment.academic_year_id)
        : [];

    const disciplineRecords: DisciplineRecord[] = currentEnrollment?.discipline_issues?.map(i => ({
        id: i.id,
        type: i.issue_type,
        description: i.description,
        date_occurred: i.created_at,
        status: 'PENDING',
        resolved_at: undefined
    })) || [];

    const reportCards: ReportCard[] = reports.map(r => ({
        id: r.id,
        sequence_name: `${r.exam_sequence?.term?.name || 'Term'} - Sequence ${r.exam_sequence?.sequence_number || 'N/A'}`,
        academic_year: r.academic_year?.name || 'Unknown Year',
        generated_at: r.created_at,
        download_url: `/api/v1/report-cards/${r.id}/download`
    }));

    return {
        id: student.id,
        name: student.name,
        matricule: student.matricule,
        date_of_birth: student.date_of_birth,
        class_info: currentEnrollment?.sub_class ? {
            class_name: currentEnrollment.sub_class.class.name,
            subclass_name: currentEnrollment.sub_class.name,
            class_master: currentEnrollment.sub_class.class_master?.name
        } : undefined,
        attendance: {
            present_days: presentDays,
            absent_days: absentDays,
            late_days: lateDays,
            attendance_rate: attendanceRate
        },
        academic_performance: {
            subjects,
            overall_average: overallAverage,
            position_in_class: undefined
        },
        fees: {
            total_expected: totalExpected,
            total_paid: totalPaid,
            outstanding_balance: outstandingBalance,
            due_date: dueDate,
            days_overdue: daysOverdue,
            urgency: feeUrgency,
            last_payment_date: paymentHistory[0]?.payment_date,
            payment_history: paymentHistory,
            items: feeItemsBreakdown
        },
        discipline: {
            total_issues: disciplineRecords.length,
            recent_issues: disciplineRecords.slice(0, 5)
        },
        reports: { available_reports: reportCards }
    };
}

/**
 * Quiz results for a single child (by matricule).
 */
export async function getChildQuizResultsByMatricule(
    matricule: string,
    academicYearId?: number
): Promise<any[]> {
    const student = await resolveStudentByMatricule(matricule);
    const yearId = academicYearId ?? (await getCurrentAcademicYear())?.id;

    const submissions = await prisma.quizSubmission.findMany({
        where: {
            student_id: student.id,
            ...(yearId ? { academic_year_id: yearId } : {})
        },
        include: { quiz: { include: { subject: true } } },
        orderBy: { submitted_at: 'desc' }
    });

    return submissions.map(s => ({
        submissionId: s.id,
        quizTitle: s.quiz.title,
        subject: s.quiz.subject.name,
        score: s.score,
        totalMarks: s.total_marks,
        percentage: s.percentage,
        status: s.status,
        submittedAt: s.submitted_at
    }));
}

/**
 * Analytics for a single child (by matricule).
 */
export async function getChildAnalyticsByMatricule(
    matricule: string,
    academicYearId?: number
): Promise<any> {
    const student = await resolveStudentByMatricule(matricule);
    const yearId = academicYearId ?? (await getCurrentAcademicYear())?.id;

    let studentWithEnrollments = await prisma.student.findUnique({
        where: { id: student.id },
        include: {
            enrollments: yearId ? { where: { academic_year_id: yearId } } : true
        }
    });

    if (studentWithEnrollments && studentWithEnrollments.enrollments.length === 0 && yearId) {
        studentWithEnrollments = await prisma.student.findUnique({
            where: { id: student.id },
            include: { enrollments: { orderBy: { created_at: 'desc' } } }
        });
    }

    if (!studentWithEnrollments || studentWithEnrollments.enrollments.length === 0) {
        return {
            studentInfo: { id: student.id, name: student.name, classInfo: null },
            performanceAnalytics: {
                overall_average: 0,
                total_assessments: 0,
                improvement_trend: 'No data',
                performance_grade: 'N/A',
                strengths: [],
                areas_for_improvement: []
            },
            attendanceAnalytics: {
                overall_attendance_rate: 0,
                total_absences: 0,
                monthly_trends: [],
                attendance_status: 'No data',
                recent_absences: []
            },
            quizAnalytics: {
                total_quizzes: 0,
                average_score: 0,
                improvement_trend: 'No data',
                subject_performance: [],
                recent_quizzes: []
            },
            subjectTrends: [],
            comparativeAnalytics: {
                class_comparison: 'No enrollment data',
                relative_performance: 'N/A'
            }
        };
    }

    const enrollment = studentWithEnrollments.enrollments[0];
    const actualYearId = enrollment.academic_year_id;
    const marks = await prisma.mark.findMany({ where: { enrollment_id: enrollment.id } });

    const [
        performanceAnalytics,
        attendanceAnalytics,
        quizAnalytics,
        subjectTrends,
        comparativeAnalytics
    ] = await Promise.all([
        calculatePerformanceAnalytics(marks),
        calculateAttendanceAnalytics(enrollment.id, actualYearId),
        calculateQuizAnalytics(student.id, actualYearId),
        calculateSubjectTrends(marks),
        calculateComparativeAnalytics(student.id, enrollment.sub_class_id, actualYearId)
    ]);

    return {
        studentInfo: {
            id: student.id,
            name: student.name,
            classInfo: enrollment.sub_class_id ? {
                className: 'Class Info Not Available',
                subclassName: 'Subclass Info Not Available'
            } : null
        },
        performanceAnalytics,
        attendanceAnalytics,
        quizAnalytics,
        subjectTrends,
        comparativeAnalytics
    };
}

/**
 * Send a message from the child's linked parent to a staff member.
 * Sender identity is derived from the first ParentStudent link on the matricule.
 */
export async function sendMessageToStaffFromMatricule(
    matricule: string,
    data: {
        recipient_id: number;
        subject: string;
        message: string;
        priority?: 'LOW' | 'MEDIUM' | 'HIGH';
    }
): Promise<any> {
    const parentId = await resolveLinkedParentIdByMatricule(matricule);
    return prisma.message.create({
        data: {
            sender_id: parentId,
            receiver_id: data.recipient_id,
            subject: data.subject,
            content: data.message
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// PARENT INBOX (threading + read receipts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fire an in-app notification to a receiver ONLY if they currently hold the
 * PARENT role. Used at generic staff-side Message.create sites where we can't
 * cheaply tell whether the receiver is a parent or another staff member — the
 * role check keeps the notification narrowly scoped to the parent inbox
 * feature. Failures are swallowed so notification hiccups can never break the
 * underlying message-send flow.
 */
export async function notifyIfReceiverIsParent(
    receiverId: number,
    senderId: number,
    messageId: number,
    subject: string,
    senderName?: string
): Promise<void> {
    try {
        const isParent = await prisma.userRole.findFirst({
            where: { user_id: receiverId, role: 'PARENT' as any },
            select: { id: true },
        });
        if (!isParent) return;
        const title = senderName ? `New message from ${senderName}` : 'New message';
        await notificationService.sendNotification({
            user_id: receiverId,
            sender_id: senderId,
            title,
            message: subject ? `${title}: ${subject}` : title,
            category: 'GENERAL',
            priority: 'HIGH',
            entity_type: 'Message',
            entity_id: messageId,
            action_url: `/parents/messages/${messageId}`,
        });
    } catch (err) {
        console.error('notifyIfReceiverIsParent failed:', err);
    }
}

/**
 * Paginated inbox for the parent linked to `matricule`. Returns messages the
 * parent RECEIVED, newest first, with sender name + reply count. Set
 * `unreadOnly` to filter to messages the parent has not yet marked as read.
 */
export async function getParentInboxByMatricule(
    matricule: string,
    opts: { page?: number; limit?: number; unreadOnly?: boolean } = {}
): Promise<{ data: any[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
    const parentId = await resolveLinkedParentIdByMatricule(matricule);
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.MessageWhereInput = {
        receiver_id: parentId,
        deleted_by_receiver: false,
        ...(opts.unreadOnly ? { read_at: null } : {}),
    };

    const [total, rows] = await Promise.all([
        prisma.message.count({ where }),
        prisma.message.findMany({
            where,
            orderBy: { created_at: 'desc' },
            skip,
            take: limit,
            include: {
                sender: { select: { id: true, name: true, matricule: true } },
                _count: { select: { replies: true } },
            },
        }),
    ]);

    const data = rows.map(row => ({
        id: row.id,
        subject: row.subject,
        content: row.content,
        sender_id: row.sender_id,
        sender_name: row.sender?.name ?? null,
        sender_matricule: row.sender?.matricule ?? null,
        parent_message_id: row.parent_message_id,
        read_at: row.read_at,
        status: row.status,
        created_at: row.created_at,
        reply_count: row._count?.replies ?? 0,
    }));

    return {
        data,
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1,
        },
    };
}

/**
 * Reply to an existing message. The parent must be either the sender or the
 * receiver of the referenced message. The reply is written with
 * sender_id = parent, receiver_id = the OTHER party on the original thread,
 * subject prefixed with `Re: ` (only once) and parent_message_id linking back.
 */
export async function replyToMessageAsParent(
    matricule: string,
    messageId: number,
    body: string
): Promise<any> {
    if (!body || !body.trim()) {
        const err: any = new Error('Reply body is required');
        err.statusCode = 400;
        throw err;
    }
    const parentId = await resolveLinkedParentIdByMatricule(matricule);
    const original = await prisma.message.findUnique({
        where: { id: messageId },
        include: { sender: { select: { id: true, name: true } } },
    });
    if (!original) {
        const err: any = new Error('Message not found');
        err.statusCode = 404;
        throw err;
    }
    if (original.sender_id !== parentId && original.receiver_id !== parentId) {
        const err: any = new Error('Not authorized to reply to this message');
        err.statusCode = 403;
        throw err;
    }

    const otherPartyId = original.sender_id === parentId ? original.receiver_id : original.sender_id;
    const rePrefixed = /^re:\s*/i.test(original.subject)
        ? original.subject
        : `Re: ${original.subject}`;

    return prisma.message.create({
        data: {
            sender_id: parentId,
            receiver_id: otherPartyId,
            subject: rePrefixed,
            content: body.trim(),
            parent_message_id: original.id,
        },
    });
}

/**
 * Mark an incoming message as read. Only the receiver can mark. Idempotent —
 * repeated calls just refresh read_at.
 */
export async function markParentMessageAsRead(
    matricule: string,
    messageId: number
): Promise<any> {
    const parentId = await resolveLinkedParentIdByMatricule(matricule);
    const msg = await prisma.message.findUnique({
        where: { id: messageId },
        select: { id: true, receiver_id: true },
    });
    if (!msg) {
        const err: any = new Error('Message not found');
        err.statusCode = 404;
        throw err;
    }
    if (msg.receiver_id !== parentId) {
        const err: any = new Error('Not authorized to mark this message as read');
        err.statusCode = 403;
        throw err;
    }
    return prisma.message.update({
        where: { id: messageId },
        data: { read_at: new Date(), status: 'READ' as any },
    });
}

/**
 * Return the full thread for a message: the target message, its ancestor
 * chain (walked via parent_message_id up to the root), and its direct
 * replies. The parent must be either the sender or receiver of the target
 * message.
 */
export async function getParentMessageThread(
    matricule: string,
    messageId: number
): Promise<{ message: any; ancestors: any[]; replies: any[] }> {
    const parentId = await resolveLinkedParentIdByMatricule(matricule);

    const senderSelect = { select: { id: true, name: true, matricule: true } };
    const receiverSelect = { select: { id: true, name: true, matricule: true } };

    const target = await prisma.message.findUnique({
        where: { id: messageId },
        include: { sender: senderSelect, receiver: receiverSelect },
    });
    if (!target) {
        const err: any = new Error('Message not found');
        err.statusCode = 404;
        throw err;
    }
    if (target.sender_id !== parentId && target.receiver_id !== parentId) {
        const err: any = new Error('Not authorized to view this thread');
        err.statusCode = 403;
        throw err;
    }

    // Walk ancestors up via parent_message_id. Guard against pathological
    // loops with a hard cap.
    const ancestors: any[] = [];
    let cursor = target.parent_message_id;
    const guard = new Set<number>();
    while (cursor && !guard.has(cursor) && ancestors.length < 50) {
        guard.add(cursor);
        const anc: any = await prisma.message.findUnique({
            where: { id: cursor },
            include: { sender: senderSelect, receiver: receiverSelect },
        });
        if (!anc) break;
        ancestors.unshift(anc);
        cursor = anc.parent_message_id;
    }

    const replies = await prisma.message.findMany({
        where: { parent_message_id: target.id },
        orderBy: { created_at: 'asc' },
        include: { sender: senderSelect, receiver: receiverSelect },
    });

    return { message: target, ancestors, replies };
}

// ─────────────────────────────────────────────────────────────────────────────
// FEE ITEMS BREAKDOWN
// ─────────────────────────────────────────────────────────────────────────────

async function buildFeeItemsBreakdown(
    enrollmentId: number,
    studentId: number,
    classId: number | null,
    subClassId: number | null,
    academicYearId: number
) {
    const items = await prisma.feeItem.findMany({
        where: {
            academic_year_id: academicYearId,
            is_active: true,
            OR: [
                { scope: 'ALL' },
                ...(classId ? [{ scope: 'CLASS' as const, class_id: classId }] : []),
                ...(subClassId ? [{ scope: 'SUBCLASS' as const, sub_class_id: subClassId }] : []),
                { scope: 'STUDENT' as const, student_id: studentId },
            ],
        },
        orderBy: { id: 'asc' },
    });

    if (items.length === 0) return [];

    const payments = await prisma.feeItemPayment.findMany({
        where: {
            enrollment_id: enrollmentId,
            fee_item_id: { in: items.map(i => i.id) },
        },
    });

    return items.map(item => {
        const paidForItem = payments
            .filter(p => p.fee_item_id === item.id)
            .reduce((sum, p) => sum + p.amount, 0);
        const outstanding = Math.max(0, item.amount - paidForItem);
        const status: 'PAID' | 'PARTIAL' | 'UNPAID' =
            outstanding <= 0 ? 'PAID' : paidForItem > 0 ? 'PARTIAL' : 'UNPAID';
        return {
            id: item.id,
            name: item.name,
            description: item.description ?? null,
            scope: item.scope as string,
            amount_expected: item.amount,
            amount_paid: paidForItem,
            outstanding,
            status,
        };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCIPLINE DETAIL ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

async function resolveEnrollmentIdByMatricule(
    matricule: string,
    academicYearId?: number
): Promise<{ enrollmentId: number; academicYearId: number }> {
    const student = await resolveStudentByMatricule(matricule);
    const yearId = academicYearId ?? (await getCurrentAcademicYear())?.id;
    const enrollment = await prisma.enrollment.findFirst({
        where: {
            student_id: student.id,
            ...(yearId ? { academic_year_id: yearId } : {}),
        },
        orderBy: { created_at: 'desc' },
    });
    if (!enrollment) {
        const err: any = new Error('No enrollment found for this student in the requested academic year');
        err.statusCode = 404;
        throw err;
    }
    return { enrollmentId: enrollment.id, academicYearId: enrollment.academic_year_id };
}

export async function getChildWarningsByMatricule(matricule: string, academicYearId?: number) {
    const { enrollmentId } = await resolveEnrollmentIdByMatricule(matricule, academicYearId);
    const warnings = await prisma.studentWarning.findMany({
        where: { enrollment_id: enrollmentId },
        include: { issued_by: { select: { id: true, name: true } } },
        orderBy: { created_at: 'desc' },
    });
    const activeCount = warnings.filter(w => !w.resolved).length;
    return {
        summary: {
            total: warnings.length,
            active: activeCount,
            resolved: warnings.length - activeCount,
            highest_level: warnings.reduce((max, w) => Math.max(max, w.warning_level), 0),
        },
        items: warnings.map(w => ({
            id: w.id,
            warning_level: w.warning_level,
            reason: w.reason,
            description: w.description,
            trigger_absence_count: w.trigger_absence_count,
            issued_by: w.issued_by?.name ?? null,
            resolved: w.resolved,
            resolved_at: w.resolved_at,
            resolved_notes: w.resolved_notes,
            created_at: w.created_at,
        })),
    };
}

export async function getChildSummonsByMatricule(matricule: string, academicYearId?: number) {
    const { enrollmentId } = await resolveEnrollmentIdByMatricule(matricule, academicYearId);
    const summons = await prisma.parentSummons.findMany({
        where: { enrollment_id: enrollmentId },
        include: {
            created_by: { select: { id: true, name: true } },
            parent: { select: { id: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
    });
    const now = new Date();
    return {
        summary: {
            total: summons.length,
            pending: summons.filter(s => s.status === 'PENDING' || s.status === 'SCHEDULED').length,
            action_required: summons.some(s =>
                (s.status === 'PENDING' || s.status === 'SCHEDULED') &&
                (!s.scheduled_date || new Date(s.scheduled_date).getTime() >= now.getTime())
            ),
        },
        items: summons.map(s => ({
            id: s.id,
            reason: s.reason,
            trigger_type: s.trigger_type,
            scheduled_date: s.scheduled_date,
            status: s.status,
            attended: s.attended,
            meeting_notes: s.meeting_notes,
            parent_name: s.parent?.name ?? null,
            created_by: s.created_by?.name ?? null,
            created_at: s.created_at,
        })),
    };
}

export async function getChildDisciplinaryActionsByMatricule(matricule: string, academicYearId?: number) {
    const { enrollmentId } = await resolveEnrollmentIdByMatricule(matricule, academicYearId);
    const actions = await prisma.disciplinaryAction.findMany({
        where: { enrollment_id: enrollmentId },
        include: {
            decided_by: { select: { id: true, name: true } },
            discipline_issue: { select: { id: true, issue_type: true, description: true } },
        },
        orderBy: { created_at: 'desc' },
    });
    return {
        summary: {
            total: actions.length,
            active: actions.filter(a => a.status === 'ACTIVE').length,
            pending: actions.filter(a => a.status === 'PENDING').length,
            completed: actions.filter(a => a.status === 'COMPLETED').length,
        },
        items: actions.map(a => ({
            id: a.id,
            action_type: a.action_type,
            status: a.status,
            days: a.days,
            start_date: a.start_date,
            end_date: a.end_date,
            reason: a.reason,
            notes: a.notes,
            decided_by: a.decided_by?.name ?? null,
            linked_issue: a.discipline_issue ? {
                id: a.discipline_issue.id,
                issue_type: a.discipline_issue.issue_type,
                description: a.discipline_issue.description,
            } : null,
            created_at: a.created_at,
        })),
    };
}

export async function getChildSaturdayPunishmentsByMatricule(matricule: string, academicYearId?: number) {
    const { enrollmentId } = await resolveEnrollmentIdByMatricule(matricule, academicYearId);
    const punishments = await prisma.saturdayPunishment.findMany({
        where: { enrollment_id: enrollmentId },
        include: { assigned_by: { select: { id: true, name: true } } },
        orderBy: { created_at: 'desc' },
    });
    return {
        summary: {
            total: punishments.length,
            pending: punishments.filter(p => p.status === 'PENDING').length,
            served: punishments.filter(p => p.status === 'SERVED').length,
        },
        items: punishments.map(p => ({
            id: p.id,
            reason: p.reason,
            scheduled_date: p.scheduled_date,
            served_date: p.served_date,
            status: p.status,
            notes: p.notes,
            assigned_by: p.assigned_by?.name ?? null,
            created_at: p.created_at,
        })),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// NURSE VISIT LOG (paginated, portal-mode)
// ─────────────────────────────────────────────────────────────────────────────

export async function getChildNurseVisitsByMatricule(
    matricule: string,
    opts: { page?: number; limit?: number; academicYearId?: number } = {}
) {
    const student = await resolveStudentByMatricule(matricule);
    const page = Math.max(1, Number(opts.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(opts.limit) || 20));
    const skip = (page - 1) * limit;

    // NurseVisitLog is linked via enrollment (not student directly), so we
    // resolve the child's enrollment ids first and query by them.
    const enrollments = await prisma.enrollment.findMany({
        where: {
            student_id: student.id,
            ...(opts.academicYearId ? { academic_year_id: opts.academicYearId } : {}),
        },
        select: { id: true },
    });
    const enrollmentIds = enrollments.map(e => e.id);

    const where: Prisma.NurseVisitLogWhereInput = enrollmentIds.length > 0
        ? { enrollment_id: { in: enrollmentIds } }
        : { id: -1 }; // no enrollments → return empty

    const [total, visits] = await Promise.all([
        prisma.nurseVisitLog.count({ where }),
        prisma.nurseVisitLog.findMany({
            where,
            include: {
                logged_by: { select: { id: true, name: true } },
                period: { select: { id: true, name: true, day_of_week: true, start_time: true, end_time: true } },
            },
            orderBy: { visit_date: 'desc' },
            skip,
            take: limit,
        }),
    ]);

    return {
        student: {
            id: student.id,
            matricule: student.matricule,
            name: student.name,
            health_conditions: student.health_conditions,
            medical_notes: student.medical_notes,
        },
        meta: {
            page,
            limit,
            total,
            total_pages: Math.max(1, Math.ceil(total / limit)),
        },
        items: visits.map(v => ({
            id: v.id,
            visit_date: v.visit_date,
            reason: v.reason,
            treatment_given: v.treatment_given,
            medication_given: v.medication_given,
            sent_home: v.sent_home,
            notes: v.notes,
            period: v.period ? {
                name: v.period.name,
                day_of_week: v.period.day_of_week,
                start_time: v.period.start_time,
                end_time: v.period.end_time,
            } : null,
            logged_by: v.logged_by?.name ?? null,
        })),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMETABLE (weekly schedule)
// ─────────────────────────────────────────────────────────────────────────────

export async function getChildTimetableByMatricule(matricule: string, academicYearId?: number) {
    const student = await resolveStudentByMatricule(matricule);
    const yearId = academicYearId ?? (await getCurrentAcademicYear())?.id;
    if (!yearId) {
        const err: any = new Error('No academic year available');
        err.statusCode = 400;
        throw err;
    }

    const enrollment = await prisma.enrollment.findFirst({
        where: { student_id: student.id, academic_year_id: yearId },
        include: {
            sub_class: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
        },
        orderBy: { created_at: 'desc' },
    });

    if (!enrollment || !enrollment.sub_class_id) {
        return {
            student: { id: student.id, matricule: student.matricule, name: student.name },
            enrollment: null,
            periods: [],
            days: [],
        };
    }

    const teacherPeriods = await prisma.teacherPeriod.findMany({
        where: {
            sub_class_id: enrollment.sub_class_id,
            academic_year_id: yearId,
        },
        include: {
            subject: { select: { id: true, name: true, category: true } },
            teacher: { select: { id: true, name: true, matricule: true } },
            period: {
                select: {
                    id: true,
                    name: true,
                    day_of_week: true,
                    start_time: true,
                    end_time: true,
                    type: true,
                    sequence: true,
                },
            },
        },
    });

    const rows = teacherPeriods
        .filter(tp => !!tp.period)
        .map(tp => ({
            teacher_period_id: tp.id,
            day_of_week: tp.period!.day_of_week,
            period_name: tp.period!.name,
            period_sequence: tp.period!.sequence,
            start_time: tp.period!.start_time,
            end_time: tp.period!.end_time,
            period_type: tp.period!.type,
            subject: tp.subject ? { id: tp.subject.id, name: tp.subject.name, category: tp.subject.category } : null,
            teacher: tp.teacher ? { id: tp.teacher.id, name: tp.teacher.name, matricule: tp.teacher.matricule } : null,
        }));

    const dayOrder = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    rows.sort((a, b) => {
        const da = dayOrder.indexOf(a.day_of_week);
        const db = dayOrder.indexOf(b.day_of_week);
        if (da !== db) return da - db;
        if (a.period_sequence !== b.period_sequence) return a.period_sequence - b.period_sequence;
        return a.start_time.localeCompare(b.start_time);
    });

    const grouped: Record<string, typeof rows> = {};
    for (const r of rows) {
        (grouped[r.day_of_week] ||= []).push(r);
    }

    return {
        student: { id: student.id, matricule: student.matricule, name: student.name },
        enrollment: {
            academic_year_id: yearId,
            class_name: enrollment.sub_class!.class?.name ?? null,
            subclass_name: enrollment.sub_class!.name,
        },
        periods: rows,
        days: dayOrder
            .filter(d => grouped[d]?.length)
            .map(d => ({ day: d, periods: grouped[d] })),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-CHILD (authenticated) — GET /parents/me/children
// ─────────────────────────────────────────────────────────────────────────────

export async function getLinkedChildrenForParent(parentId: number, academicYearId?: number) {
    const yearId = academicYearId ?? (await getCurrentAcademicYear())?.id;

    const links = await prisma.parentStudent.findMany({
        where: { parent_id: parentId },
        include: {
            student: {
                include: {
                    enrollments: {
                        where: yearId ? { academic_year_id: yearId } : undefined,
                        orderBy: { created_at: 'desc' },
                        include: {
                            sub_class: { include: { class: true } },
                            school_fees: true,
                            absences: true,
                            discipline_issues: true,
                        },
                    },
                },
            },
        },
    });

    let familyTotalExpected = 0;
    let familyTotalPaid = 0;
    let familyTotalOutstanding = 0;
    let familyActiveDisciplineIssues = 0;
    let familyUnexcusedAbsences = 0;

    const children = links.map(link => {
        const s = link.student;
        const enr = s.enrollments[0];
        const fees = enr?.school_fees?.[0];
        const totalExpected = fees?.amount_expected ?? 0;
        const totalPaid = fees?.amount_paid ?? 0;
        const outstanding = Math.max(0, totalExpected - totalPaid);
        const unexcused = enr?.absences?.filter(a => !a.is_excused).length ?? 0;
        const disciplineIssues = enr?.discipline_issues?.length ?? 0;

        familyTotalExpected += totalExpected;
        familyTotalPaid += totalPaid;
        familyTotalOutstanding += outstanding;
        familyActiveDisciplineIssues += disciplineIssues;
        familyUnexcusedAbsences += unexcused;

        const now = new Date();
        const dueDate = fees?.due_date ?? null;
        const daysOverdue = dueDate && outstanding > 0
            ? Math.max(0, Math.floor((now.getTime() - new Date(dueDate).getTime()) / (24 * 60 * 60 * 1000)))
            : 0;

        return {
            student_id: s.id,
            matricule: s.matricule,
            name: s.name,
            gender: s.gender,
            date_of_birth: s.date_of_birth,
            relationship: link.relationship,
            enrollment: enr ? {
                academic_year_id: enr.academic_year_id,
                class_name: enr.sub_class?.class?.name ?? null,
                subclass_name: enr.sub_class?.name ?? null,
            } : null,
            fees: {
                total_expected: totalExpected,
                total_paid: totalPaid,
                outstanding,
                due_date: dueDate,
                days_overdue: daysOverdue,
                urgency: outstanding <= 0
                    ? 'PAID'
                    : daysOverdue > 0
                        ? 'OVERDUE'
                        : 'OK',
            },
            attendance: {
                total_absences: enr?.absences?.length ?? 0,
                unexcused_absences: unexcused,
                at_risk: unexcused >= 3,
            },
            discipline: {
                active_issues: disciplineIssues,
            },
        };
    });

    return {
        parent_id: parentId,
        academic_year_id: yearId ?? null,
        family_summary: {
            total_children: children.length,
            fees: {
                total_expected: familyTotalExpected,
                total_paid: familyTotalPaid,
                outstanding: familyTotalOutstanding,
            },
            attendance: {
                total_unexcused_absences: familyUnexcusedAbsences,
                any_child_at_risk: children.some(c => c.attendance.at_risk),
            },
            discipline: {
                total_active_issues: familyActiveDisciplineIssues,
            },
        },
        children,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-SERVICE PROFILE UPDATES (portal — matricule-gated, unauthenticated)
//
// Parents can maintain their own contact block and a small demographic slice
// of the child's record. Email is deliberately excluded from the parent-side
// patch because it is the login identifier — changing it must go through
// bursar/admin flows so the audit trail is preserved.
// ─────────────────────────────────────────────────────────────────────────────

const trimOrUndefined = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
};

const sanitizeUser = (user: User) => {
    const { password, ...safe } = user;
    return safe;
};

/**
 * Validate that a phone-like string contains at least 8 digits.
 * Local formatting characters (spaces, dashes, +, parens) are allowed but
 * ignored for the digit count.
 */
const isValidPhone = (value: string): boolean => {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 8;
};

export interface ParentContactPatch {
    phone?: string;
    whatsapp_number?: string;
    address?: string;
}

/**
 * Update the contact info (phone, whatsapp, address) of the FIRST linked
 * parent for the given child matricule. Returns the sanitized user profile
 * (password stripped). Email is intentionally NOT updatable here.
 */
export async function updateParentContactFromMatricule(
    matricule: string,
    patch: ParentContactPatch
): Promise<Omit<User, 'password'>> {
    const parentId = await resolveLinkedParentIdByMatricule(matricule);

    const data: Prisma.UserUpdateInput = {};

    if (patch.phone !== undefined) {
        const phone = trimOrUndefined(patch.phone);
        if (!phone || !isValidPhone(phone)) {
            const err: any = new Error('phone must contain at least 8 digits');
            err.statusCode = 400;
            throw err;
        }
        data.phone = phone;
    }

    if (patch.whatsapp_number !== undefined) {
        // Allow explicit clearing via empty string
        if (typeof patch.whatsapp_number === 'string' && patch.whatsapp_number.trim() === '') {
            data.whatsapp_number = null;
        } else {
            const whatsapp = trimOrUndefined(patch.whatsapp_number);
            if (!whatsapp || !isValidPhone(whatsapp)) {
                const err: any = new Error('whatsappNumber must contain at least 8 digits');
                err.statusCode = 400;
                throw err;
            }
            data.whatsapp_number = whatsapp;
        }
    }

    if (patch.address !== undefined) {
        const address = trimOrUndefined(patch.address);
        if (!address) {
            const err: any = new Error('address must not be empty');
            err.statusCode = 400;
            throw err;
        }
        data.address = address;
    }

    if (Object.keys(data).length === 0) {
        const err: any = new Error('No updatable fields provided (phone, whatsappNumber, address)');
        err.statusCode = 400;
        throw err;
    }

    const updated = await prisma.user.update({
        where: { id: parentId },
        data
    });

    return sanitizeUser(updated);
}

export interface ChildProfilePatch {
    residence?: string;
    health_conditions?: HealthCondition[];
    medical_notes?: string | null;
}

const VALID_HEALTH_CONDITIONS = new Set<string>([
    'SICKLE_CELL',
    'ASTHMATIC',
    'EPILEPTIC',
    'DIABETIC',
    'ALLERGY',
    'HYPERTENSION',
    'OTHER'
]);

/**
 * Update a small demographic slice of the child's record: residence,
 * health_conditions, medical_notes. Empty-string medical_notes clears
 * the field. Every element of health_conditions must be a valid enum value.
 */
export async function updateChildProfileFromMatricule(
    matricule: string,
    patch: ChildProfilePatch
): Promise<Student> {
    const student = await resolveStudentByMatricule(matricule);

    const data: Prisma.StudentUpdateInput = {};

    if (patch.residence !== undefined) {
        const residence = trimOrUndefined(patch.residence);
        if (!residence) {
            const err: any = new Error('residence must not be empty');
            err.statusCode = 400;
            throw err;
        }
        data.residence = residence;
    }

    if (patch.health_conditions !== undefined) {
        if (!Array.isArray(patch.health_conditions)) {
            const err: any = new Error('healthConditions must be an array');
            err.statusCode = 400;
            throw err;
        }
        const invalid = patch.health_conditions.filter(
            c => typeof c !== 'string' || !VALID_HEALTH_CONDITIONS.has(c)
        );
        if (invalid.length) {
            const err: any = new Error(
                `Invalid healthConditions: ${invalid.join(', ')}. ` +
                `Allowed: ${Array.from(VALID_HEALTH_CONDITIONS).join(', ')}`
            );
            err.statusCode = 400;
            throw err;
        }
        // Dedupe while preserving order
        const seen = new Set<HealthCondition>();
        const deduped: HealthCondition[] = [];
        for (const c of patch.health_conditions) {
            if (!seen.has(c)) { seen.add(c); deduped.push(c); }
        }
        data.health_conditions = { set: deduped };
    }

    if (patch.medical_notes !== undefined) {
        if (patch.medical_notes === null || (typeof patch.medical_notes === 'string' && patch.medical_notes.trim() === '')) {
            data.medical_notes = null;
        } else if (typeof patch.medical_notes === 'string') {
            data.medical_notes = patch.medical_notes.trim();
        } else {
            const err: any = new Error('medicalNotes must be a string or null');
            err.statusCode = 400;
            throw err;
        }
    }

    if (Object.keys(data).length === 0) {
        const err: any = new Error('No updatable fields provided (residence, healthConditions, medicalNotes)');
        err.statusCode = 400;
        throw err;
    }

    return prisma.student.update({
        where: { id: student.id },
        data
    });
}

/**
 * Aggregate parent contact block + student demographic block for the parent
 * portal's profile screen (two editable panels rendered side by side).
 */
export async function getParentAndChildProfileFromMatricule(matricule: string): Promise<{
    parent: Omit<User, 'password'>;
    student: Student;
}> {
    const student = await resolveStudentByMatricule(matricule);
    const parentId = await resolveLinkedParentIdByMatricule(matricule);
    const parent = await prisma.user.findUnique({ where: { id: parentId } });
    if (!parent) {
        const err: any = new Error('Linked parent user not found');
        err.statusCode = 404;
        throw err;
    }
    return {
        parent: sanitizeUser(parent),
        student
    };
}
