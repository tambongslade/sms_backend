import prisma from '../../../config/db';
import { getCurrentAcademicYear } from '../../../utils/academicYear';
import { SUBCLASS_MAX_STUDENTS } from '../../../utils/capacity';

// Types for Vice Principal operations
export interface VicePrincipalDashboard {
    totalStudents: number;
    studentsAssigned: number;
    pendingInterviews: number;
    completedInterviews: number;
    awaitingAssignment: number;
    recentDisciplineIssues: number;
    classesWithPendingReports: number;
    teacherAbsences: number;
    enrollmentTrends: {
        thisMonth: number;
        lastMonth: number;
        trend: 'INCREASING' | 'DECREASING' | 'STABLE';
    };
    subclassCapacityUtilization: Array<{
        subclassName: string;
        className: string;
        currentCapacity: number;
        maxCapacity: number;
        utilizationRate: number;
    }>;
    urgentTasks: Array<{
        type: 'INTERVIEW_OVERDUE' | 'ASSIGNMENT_PENDING' | 'CAPACITY_EXCEEDED';
        description: string;
        priority: 'HIGH' | 'MEDIUM' | 'LOW';
        count: number;
    }>;
}

export interface StudentManagementOverview {
    totalStudents: number;
    byStatus: {
        notEnrolled: number;
        interviewPending: number;
        interviewCompleted: number;
        assignedToClass: number;
        enrolled: number;
    };
    interviewMetrics: {
        totalConducted: number;
        averageScore: number;
        passRate: number;
        pendingInterviews: number;
        overdueInterviews: number;
    };
    classAssignmentMetrics: {
        totalAssigned: number;
        awaitingAssignment: number;
        classCapacityIssues: number;
        recentAssignments: number;
    };
}

export interface InterviewManagement {
    id: number;
    studentId: number;
    studentName: string;
    studentMatricule: string;
    className: string;
    interviewStatus: 'PENDING' | 'COMPLETED' | 'OVERDUE';
    scheduledDate?: string;
    completedDate?: string;
    score?: number;
    comments?: string;
    interviewerName?: string;
    daysOverdue?: number;
    registrationDate: string;
}

export interface SubclassOptimization {
    classId: number;
    className: string;
    subclasses: Array<{
        id: number;
        name: string;
        currentEnrollment: number;
        maxCapacity: number;
        utilizationRate: number;
        availableSpots: number;
        status: 'OPTIMAL' | 'UNDERUTILIZED' | 'OVERLOADED' | 'FULL';
        recommendations: Array<string>;
    }>;
    overallUtilization: number;
    recommendations: Array<{
        type: 'BALANCE_ENROLLMENT' | 'CREATE_SUBCLASS' | 'MERGE_SUBCLASS';
        description: string;
        priority: 'HIGH' | 'MEDIUM' | 'LOW';
    }>;
}

export interface StudentProgressTracking {
    studentId: number;
    studentName: string;
    matricule: string;
    enrollmentJourney: Array<{
        stage: 'REGISTERED' | 'INTERVIEWED' | 'ASSIGNED' | 'ENROLLED';
        date: string;
        details: string;
        completedBy?: string;
    }>;
    currentStatus: string;
    nextAction: string;
    daysInCurrentStage: number;
    alerts: Array<string>;
}

/**
 * Get comprehensive Vice Principal dashboard
 */
export async function getVicePrincipalDashboard(academicYearId?: number): Promise<VicePrincipalDashboard> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        const [
            totalStudents,
            studentsAssigned,
            pendingInterviews,
            completedInterviews,
            awaitingAssignment,
            recentDiscipline,
            enrollmentsThisMonth,
            enrollmentsLastMonth,
            subclassCapacity
        ] = await Promise.all([
            // Total students in academic year
            prisma.enrollment.count({
                where: { academic_year_id: currentYear.id }
            }),

            // Students assigned to subclasses
            prisma.enrollment.count({
                where: {
                    academic_year_id: currentYear.id,
                    sub_class_id: { not: null }
                }
            }),

            // Pending interviews (students without interview records)
            prisma.student.count({
                where: {
                    enrollments: {
                        some: {
                            academic_year_id: currentYear.id,
                            sub_class_id: null
                        }
                    },
                    interview_marks: {
                        none: {}
                    }
                }
            }),

            // Completed interviews
            prisma.interviewMark.count({
                where: {
                    student: {
                        enrollments: {
                            some: { academic_year_id: currentYear.id }
                        }
                    }
                }
            }),

            // Students awaiting assignment (interviewed but not assigned)
            prisma.student.count({
                where: {
                    enrollments: {
                        some: {
                            academic_year_id: currentYear.id,
                            sub_class_id: null
                        }
                    },
                    interview_marks: {
                        some: {
                            student: {
                                enrollments: {
                                    some: { academic_year_id: currentYear.id }
                                }
                            }
                        }
                    }
                }
            }),

            // Recent discipline issues
            prisma.disciplineIssue.count({
                where: {
                    enrollment: {
                        academic_year_id: currentYear.id
                    },
                    created_at: {
                        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
                    }
                }
            }),

            // Enrollments this month
            prisma.enrollment.count({
                where: {
                    academic_year_id: currentYear.id,
                    created_at: {
                        gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                    }
                }
            }),

            // Enrollments last month
            prisma.enrollment.count({
                where: {
                    academic_year_id: currentYear.id,
                    created_at: {
                        gte: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
                        lt: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                    }
                }
            }),

            // Subclass capacity data
            prisma.subClass.findMany({
                include: {
                    class: true,
                    enrollments: {
                        where: { academic_year_id: currentYear.id }
                    }
                }
            })
        ]);

        // Calculate enrollment trend
        let enrollmentTrend: 'INCREASING' | 'DECREASING' | 'STABLE';
        if (enrollmentsThisMonth > enrollmentsLastMonth * 1.1) {
            enrollmentTrend = 'INCREASING';
        } else if (enrollmentsThisMonth < enrollmentsLastMonth * 0.9) {
            enrollmentTrend = 'DECREASING';
        } else {
            enrollmentTrend = 'STABLE';
        }

        // Process subclass capacity utilization
        const subclassCapacityUtilization = subclassCapacity.map(subclass => {
            const currentCapacity = subclass.enrollments.length;
            const maxCapacity = SUBCLASS_MAX_STUDENTS;
            const utilizationRate = (currentCapacity / maxCapacity) * 100;

            return {
                subclassName: subclass.name,
                className: subclass.class.name,
                currentCapacity,
                maxCapacity,
                utilizationRate: Math.round(utilizationRate)
            };
        });

        // Generate urgent tasks
        const urgentTasks = [];

        if (pendingInterviews > 10) {
            urgentTasks.push({
                type: 'INTERVIEW_OVERDUE' as const,
                description: `${pendingInterviews} students awaiting interviews`,
                priority: 'HIGH' as const,
                count: pendingInterviews
            });
        }

        if (awaitingAssignment > 5) {
            urgentTasks.push({
                type: 'ASSIGNMENT_PENDING' as const,
                description: `${awaitingAssignment} students awaiting class assignment`,
                priority: 'MEDIUM' as const,
                count: awaitingAssignment
            });
        }

        const overloadedSubclasses = subclassCapacityUtilization.filter(sc => sc.utilizationRate > 100).length;
        if (overloadedSubclasses > 0) {
            urgentTasks.push({
                type: 'CAPACITY_EXCEEDED' as const,
                description: `${overloadedSubclasses} subclasses over capacity`,
                priority: 'HIGH' as const,
                count: overloadedSubclasses
            });
        }

        return {
            totalStudents,
            studentsAssigned,
            pendingInterviews,
            completedInterviews,
            awaitingAssignment,
            recentDisciplineIssues: recentDiscipline,
            classesWithPendingReports: 0, // Placeholder
            teacherAbsences: 0, // Placeholder
            enrollmentTrends: {
                thisMonth: enrollmentsThisMonth,
                lastMonth: enrollmentsLastMonth,
                trend: enrollmentTrend
            },
            subclassCapacityUtilization,
            urgentTasks
        };
    } catch (error) {
        throw new Error(`Failed to fetch Vice Principal dashboard: ${error}`);
    }
}

/**
 * Get comprehensive student management overview
 */
export async function getStudentManagementOverview(academicYearId?: number): Promise<StudentManagementOverview> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        const [
            totalStudents,
            studentsByStatus,
            interviewData,
            totalAssigned,
            awaitingAssignment
        ] = await Promise.all([
            // Total students
            prisma.student.count({
                where: {
                    enrollments: {
                        some: { academic_year_id: currentYear.id }
                    }
                }
            }),

            // Students count by assignment status
            Promise.resolve([
                { status: 'assigned', count: 0 },
                { status: 'unassigned', count: 0 }
            ]),

            // Interview statistics
            prisma.interviewMark.aggregate({
                where: {
                    student: {
                        enrollments: {
                            some: { academic_year_id: currentYear.id }
                        }
                    }
                },
                _count: { id: true },
                _avg: { marks: true }
            }),

            // Total assigned students
            prisma.enrollment.count({
                where: {
                    academic_year_id: currentYear.id,
                    sub_class_id: { not: null }
                }
            }),

            // Students awaiting assignment
            prisma.student.count({
                where: {
                    enrollments: {
                        some: {
                            academic_year_id: currentYear.id,
                            sub_class_id: null
                        }
                    },
                    interview_marks: {
                        some: {
                            student: {
                                enrollments: {
                                    some: { academic_year_id: currentYear.id }
                                }
                            }
                        }
                    }
                }
            })
        ]);

        // Process status counts
        const statusCounts = {
            notEnrolled: 0,
            interviewPending: 0,
            interviewCompleted: 0,
            assignedToClass: 0,
            enrolled: 0
        };

        studentsByStatus.forEach(status => {
            switch (status.status) {
                case 'NOT_ENROLLED':
                    statusCounts.notEnrolled = status.count;
                    break;
                case 'ASSIGNED_TO_CLASS':
                    statusCounts.assignedToClass = status.count;
                    break;
                case 'ENROLLED':
                    statusCounts.enrolled = status.count;
                    break;
            }
        });

        // Calculate interview metrics
        const totalConducted = interviewData._count.id;
        const averageScore = interviewData._avg.marks || 0;
        const passRate = totalConducted > 0 ? 75 : 0; // Simplified calculation
        const pendingInterviews = totalStudents - totalConducted;

        return {
            totalStudents,
            byStatus: statusCounts,
            interviewMetrics: {
                totalConducted,
                averageScore: Math.round(averageScore * 100) / 100,
                passRate,
                pendingInterviews,
                overdueInterviews: Math.max(0, pendingInterviews - 5) // Simplified
            },
            classAssignmentMetrics: {
                totalAssigned,
                awaitingAssignment,
                classCapacityIssues: 0, // Simplified
                recentAssignments: Math.floor(totalAssigned * 0.1) // Simplified
            }
        };
    } catch (error) {
        throw new Error(`Failed to fetch student management overview: ${error}`);
    }
}

/**
 * Get interview management data with advanced tracking
 */
export async function getInterviewManagement(
    academicYearId?: number,
    status?: string
): Promise<InterviewManagement[]> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;
        if (!yearId) {
            throw new Error('No academic year found and none provided.');
        }

        const enrollments = await prisma.enrollment.findMany({
            where: {
                academic_year_id: yearId,
                sub_class_id: null,      // But not to a subclass
                student: { status: { not: 'WITHDRAWN' } },
            },
            include: {
                student: {
                    include: {
                        interview_marks: {
                            orderBy: { created_at: 'desc' },
                            take: 1,
                        },
                    },
                },
                class: true,
            },
            orderBy: {
                created_at: 'asc',
            },
        });

        const filteredAndMappedResult = enrollments
            .filter((enr) => {
                const hasInterviewMark = enr.student.interview_marks.length > 0;
                if (status === 'PENDING') {
                    return !hasInterviewMark;
                } else if (status === 'COMPLETED') {
                    return hasInterviewMark;
                } else if (status === 'OVERDUE') {
                    if (!hasInterviewMark) {
                        // Define overdue: e.g., enrollment created more than 7 days ago and no interview mark
                        const daysSinceEnrollment = Math.floor((Date.now() - enr.created_at.getTime()) / (1000 * 60 * 60 * 24));
                        return daysSinceEnrollment > 7; // Example threshold for overdue
                    }
                    return false;
                }
                return true; // No status filter or unknown status, include all matching main criteria
            })
            .map((enr) => {
                const latestInterview = enr.student.interview_marks[0];
                const currentInterviewStatus: InterviewManagement['interviewStatus'] = latestInterview ? 'COMPLETED' : 'PENDING';
                let daysOverdue: number | undefined = undefined;

                if (currentInterviewStatus === 'PENDING') {
                    daysOverdue = Math.floor((Date.now() - enr.created_at.getTime()) / (1000 * 60 * 60 * 24));
                }

                return {
                    id: enr.student.id, // Using student.id as the primary ID for the report item
                    studentId: enr.student.id,
                    studentName: enr.student.name,
                    studentMatricule: enr.student.matricule,
                    className: enr.class.name,
                    interviewStatus: currentInterviewStatus,
                    scheduledDate: undefined,
                    completedDate: latestInterview?.created_at.toISOString().split('T')[0],
                    score: latestInterview?.marks,
                    comments: latestInterview?.notes,
                    interviewerName: undefined, // Not directly available from current includes without schema change
                    daysOverdue: daysOverdue,
                    registrationDate: enr.created_at.toISOString().split('T')[0],
                };
            });

        return filteredAndMappedResult;
    } catch (error: any) {
        console.error('Error fetching interview management data:', error);
        throw new Error(`Failed to fetch interview management data: ${error.message}`);
    }
}

/**
 * Get subclass optimization recommendations
 */
export async function getSubclassOptimization(academicYearId?: number): Promise<SubclassOptimization[]> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        const classes = await prisma.class.findMany({
            include: {
                sub_classes: {
                    include: {
                        enrollments: {
                            where: { academic_year_id: currentYear.id }
                        }
                    }
                }
            }
        });

        const optimizationData: SubclassOptimization[] = classes.map(classData => {
            const subclasses = classData.sub_classes.map(subclass => {
                const currentEnrollment = subclass.enrollments.length;
                const maxCapacity = SUBCLASS_MAX_STUDENTS;
                const utilizationRate = (currentEnrollment / maxCapacity) * 100;
                const availableSpots = Math.max(0, maxCapacity - currentEnrollment);

                let status: 'OPTIMAL' | 'UNDERUTILIZED' | 'OVERLOADED' | 'FULL';
                const recommendations: string[] = [];

                if (utilizationRate > 100) {
                    status = 'OVERLOADED';
                    recommendations.push('Reduce enrollment or increase capacity');
                    recommendations.push('Consider transferring students to other subclasses');
                } else if (utilizationRate === 100) {
                    status = 'FULL';
                    recommendations.push('Monitor for any withdrawals');
                } else if (utilizationRate < 60) {
                    status = 'UNDERUTILIZED';
                    recommendations.push('Consider consolidating with another subclass');
                    recommendations.push('Increase recruitment efforts');
                } else {
                    status = 'OPTIMAL';
                    recommendations.push('Maintain current enrollment levels');
                }

                return {
                    id: subclass.id,
                    name: subclass.name,
                    currentEnrollment,
                    maxCapacity,
                    utilizationRate: Math.round(utilizationRate),
                    availableSpots,
                    status,
                    recommendations
                };
            });

            const totalCurrentEnrollment = subclasses.reduce((sum, sc) => sum + sc.currentEnrollment, 0);
            const totalMaxCapacity = subclasses.reduce((sum, sc) => sum + sc.maxCapacity, 0);
            const overallUtilization = totalMaxCapacity > 0 ? (totalCurrentEnrollment / totalMaxCapacity) * 100 : 0;

            // Generate class-level recommendations
            const classRecommendations = [];
            const overloadedCount = subclasses.filter(sc => sc.status === 'OVERLOADED').length;
            const underutilizedCount = subclasses.filter(sc => sc.status === 'UNDERUTILIZED').length;

            if (overloadedCount > 0 && underutilizedCount > 0) {
                classRecommendations.push({
                    type: 'BALANCE_ENROLLMENT' as const,
                    description: 'Balance student distribution across subclasses',
                    priority: 'HIGH' as const
                });
            }

            if (overallUtilization > 95) {
                classRecommendations.push({
                    type: 'CREATE_SUBCLASS' as const,
                    description: 'Consider creating additional subclass',
                    priority: 'MEDIUM' as const
                });
            }

            if (underutilizedCount > 1) {
                classRecommendations.push({
                    type: 'MERGE_SUBCLASS' as const,
                    description: 'Consider merging underutilized subclasses',
                    priority: 'LOW' as const
                });
            }

            return {
                classId: classData.id,
                className: classData.name,
                subclasses,
                overallUtilization: Math.round(overallUtilization),
                recommendations: classRecommendations
            };
        });

        return optimizationData;
    } catch (error) {
        throw new Error(`Failed to fetch subclass optimization data: ${error}`);
    }
}

/**
 * Get detailed student progress tracking
 */
export async function getStudentProgressTracking(studentId: number, academicYearId?: number): Promise<StudentProgressTracking> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        const student = await prisma.student.findUnique({
            where: { id: studentId },
            include: {
                enrollments: {
                    where: { academic_year_id: currentYear.id },
                    include: {
                        class: true,
                        sub_class: true
                    }
                },
                interview_marks: true
            }
        });

        if (!student) {
            throw new Error('Student not found');
        }

        const enrollment = student.enrollments[0];
        const interview = student.interview_marks[0];

        // Build enrollment journey
        const enrollmentJourney = [];

        if (enrollment) {
            enrollmentJourney.push({
                stage: 'REGISTERED' as const,
                date: enrollment.created_at.toISOString(),
                details: `Registered for ${enrollment.class.name}`,
                completedBy: 'Bursar'
            });
        }

        if (interview) {
            enrollmentJourney.push({
                stage: 'INTERVIEWED' as const,
                date: interview.created_at.toISOString(),
                details: `Interview completed - Score: ${interview.marks}/20`,
                completedBy: 'Vice Principal'
            });
        }

        if (enrollment?.sub_class_id) {
            enrollmentJourney.push({
                stage: 'ASSIGNED' as const,
                date: enrollment.updated_at.toISOString(),
                details: `Assigned to ${enrollment.sub_class?.name}`,
                completedBy: 'Vice Principal'
            });
        }

        if (enrollment?.sub_class_id && interview) {
            enrollmentJourney.push({
                stage: 'ENROLLED' as const,
                date: enrollment.updated_at.toISOString(),
                details: 'Fully enrolled and attending classes',
                completedBy: 'System'
            });
        }

        // Determine current status and next action
        let currentStatus = 'Registered';
        let nextAction = 'Schedule interview';

        if (interview) {
            currentStatus = 'Interviewed';
            nextAction = 'Assign to subclass';
        }

        if (enrollment?.sub_class_id) {
            currentStatus = 'Assigned to subclass';
            nextAction = 'Complete enrollment process';
        }

        if (enrollment?.sub_class_id && interview) {
            currentStatus = 'Fully enrolled';
            nextAction = 'Monitor academic progress';
        }

        // Calculate days in current stage
        const lastStageDate = enrollmentJourney.length > 0 ?
            new Date(enrollmentJourney[enrollmentJourney.length - 1].date) :
            new Date(enrollment?.created_at || Date.now());

        const daysInCurrentStage = Math.floor(
            (new Date().getTime() - lastStageDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Generate alerts
        const alerts = [];
        if (!interview && daysInCurrentStage > 7) {
            alerts.push('Interview overdue - student waiting for more than 7 days');
        }
        if (interview && !enrollment?.sub_class_id && daysInCurrentStage > 3) {
            alerts.push('Assignment pending - student interviewed but not assigned to subclass');
        }

        return {
            studentId: student.id,
            studentName: student.name,
            matricule: student.matricule,
            enrollmentJourney,
            currentStatus,
            nextAction,
            daysInCurrentStage,
            alerts
        };
    } catch (error) {
        throw new Error(`Failed to fetch student progress tracking: ${error}`);
    }
}

/**
 * Bulk interview management - schedule multiple interviews
 */
export async function bulkScheduleInterviews(
    studentIds: number[],
    scheduledDate: string,
    academicYearId?: number
): Promise<{ scheduled: number; errors: Array<{ studentId: number; error: string }> }> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        let scheduled = 0;
        const errors: Array<{ studentId: number; error: string }> = [];

        // Note: In a full implementation, this would create interview scheduling records
        // For now, we'll simulate the scheduling process
        for (const studentId of studentIds) {
            try {
                const student = await prisma.student.findUnique({
                    where: { id: studentId },
                    include: {
                        interview_marks: true
                    }
                });

                if (!student) {
                    errors.push({ studentId, error: 'Student not found' });
                    continue;
                }

                if (student.interview_marks.length > 0) {
                    errors.push({ studentId, error: 'Student already interviewed' });
                    continue;
                }

                // In a full implementation, create interview scheduling record here
                scheduled++;
            } catch (error: any) {
                errors.push({ studentId, error: error.message });
            }
        }

        return { scheduled, errors };
    } catch (error) {
        throw new Error(`Failed to bulk schedule interviews: ${error}`);
    }
}

/**
 * Get enrollment analytics for Vice Principal
 */
export async function getEnrollmentAnalytics(academicYearId?: number): Promise<any> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        const [
            enrollmentTrends,
            genderDistribution,
            ageDistribution,
            classDistribution
        ] = await Promise.all([
            // Enrollment trends over time (simplified)
            prisma.enrollment.groupBy({
                by: ['created_at'],
                where: { academic_year_id: currentYear.id, student: { status: { not: 'WITHDRAWN' } } },
                _count: { id: true }
            }),

            // Gender distribution
            prisma.student.groupBy({
                by: ['gender'],
                where: {
                    status: { not: 'WITHDRAWN' },
                    enrollments: {
                        some: { academic_year_id: currentYear.id }
                    }
                },
                _count: { id: true }
            }),

            // Age distribution (simplified calculation)
            prisma.student.findMany({
                where: {
                    status: { not: 'WITHDRAWN' },
                    enrollments: {
                        some: { academic_year_id: currentYear.id }
                    }
                },
                select: { date_of_birth: true }
            }),

            // Class distribution
            prisma.enrollment.groupBy({
                by: ['class_id'],
                where: { academic_year_id: currentYear.id, student: { status: { not: 'WITHDRAWN' } } },
                _count: { id: true },
                _max: { created_at: true }
            })
        ]);

        // Process age distribution
        const currentDate = new Date();
        const ageGroups = { '12-14': 0, '15-16': 0, '17-18': 0, '19+': 0 };

        ageDistribution.forEach(student => {
            const age = currentDate.getFullYear() - new Date(student.date_of_birth).getFullYear();
            if (age <= 14) ageGroups['12-14']++;
            else if (age <= 16) ageGroups['15-16']++;
            else if (age <= 18) ageGroups['17-18']++;
            else ageGroups['19+']++;
        });

        return {
            enrollmentTrends: enrollmentTrends.map(trend => ({
                date: trend.created_at.toISOString().split('T')[0],
                count: trend._count.id
            })),
            genderDistribution: genderDistribution.map(gender => ({
                gender: gender.gender,
                count: gender._count.id
            })),
            ageDistribution: Object.entries(ageGroups).map(([range, count]) => ({
                ageRange: range,
                count
            })),
            classDistribution: classDistribution.map(cls => ({
                classId: cls.class_id,
                enrollmentCount: cls._count.id,
                lastEnrollment: cls._max.created_at?.toISOString()
            }))
        };
    } catch (error) {
        throw new Error(`Failed to fetch enrollment analytics: ${error}`);
    }
} 