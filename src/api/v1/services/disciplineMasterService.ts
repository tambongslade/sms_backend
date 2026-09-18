import prisma from '../../../config/db';
import { getCurrentAcademicYear } from '../../../utils/academicYear';

// Types for Discipline Master enhanced operations
export interface DisciplineMasterDashboard {
    totalActiveIssues: number;
    resolvedThisWeek: number;
    pendingResolution: number;
    studentsWithMultipleIssues: number;
    averageResolutionTime: number;
    attendanceRate: number;
    latenessIncidents: number;
    absenteeismCases: number;
    interventionSuccess: number;
    criticalCases: number;
    behavioralTrends: {
        thisMonth: number;
        lastMonth: number;
        trend: 'IMPROVING' | 'DECLINING' | 'STABLE';
    };
    urgentInterventions: Array<{
        studentId: number;
        studentName: string;
        issueCount: number;
        riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
        lastIncident: string;
        recommendedAction: string;
    }>;
    issuesByType: Array<{
        type: string;
        count: number;
        trend: 'INCREASING' | 'DECREASING' | 'STABLE';
        resolution_rate: number;
    }>;
}

export interface BehavioralAnalytics {
    totalStudents: number;
    studentsWithIssues: number;
    behaviorScore: number;
    riskDistribution: {
        high: number;
        medium: number;
        low: number;
        none: number;
    };
    monthlyTrends: Array<{
        month: string;
        incidents: number;
        resolved: number;
        newCases: number;
    }>;
    issueTypeAnalysis: Array<{
        issueType: string;
        frequency: number;
        averageResolutionTime: number;
        recurrenceRate: number;
        effectiveInterventions: Array<string>;
    }>;
    classroomHotspots: Array<{
        subClassName: string;
        className: string;
        incidentCount: number;
        riskScore: number;
        primaryIssues: Array<string>;
    }>;
}

export interface StudentBehaviorProfile {
    studentId: number;
    studentName: string;
    matricule: string;
    className: string;
    subClassName: string;
    riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
    behaviorScore: number;
    totalIncidents: number;
    recentIncidents: number;
    interventionsReceived: number;
    lastIncidentDate?: string;
    behaviorPattern: {
        mostCommonIssues: Array<string>;
        triggerFactors: Array<string>;
        improvementAreas: Array<string>;
        strengths: Array<string>;
    };
    interventionHistory: Array<{
        id: number;
        type: string;
        date: string;
        description: string;
        outcome: 'SUCCESSFUL' | 'PARTIALLY_SUCCESSFUL' | 'UNSUCCESSFUL' | 'ONGOING';
        followUpDate?: string;
    }>;
    recommendedActions: Array<{
        priority: 'HIGH' | 'MEDIUM' | 'LOW';
        action: string;
        timeline: string;
        responsible: string;
    }>;
}

export interface InterventionTracking {
    id: number;
    studentId: number;
    studentName: string;
    interventionType: string;
    description: string;
    startDate: string;
    expectedEndDate?: string;
    actualEndDate?: string;
    status: 'PLANNED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';
    outcome?: 'SUCCESSFUL' | 'PARTIALLY_SUCCESSFUL' | 'UNSUCCESSFUL';
    effectiveness: number;
    followUpRequired: boolean;
    nextReviewDate?: string;
    assignedTo: string;
    notes: Array<{
        date: string;
        note: string;
        recordedBy: string;
    }>;
}

export interface EarlyWarningSystem {
    criticalStudents: Array<{
        studentId: number;
        studentName: string;
        warningLevel: 'CRITICAL' | 'HIGH' | 'MODERATE';
        riskFactors: Array<string>;
        triggerEvents: Array<string>;
        recommendedActions: Array<string>;
        urgency: 'IMMEDIATE' | 'WITHIN_WEEK' | 'MONITOR';
    }>;
    riskIndicators: Array<{
        indicator: string;
        studentsAffected: number;
        severity: 'HIGH' | 'MEDIUM' | 'LOW';
        trendDirection: 'INCREASING' | 'STABLE' | 'DECREASING';
    }>;
    preventiveRecommendations: Array<{
        category: string;
        recommendation: string;
        targetStudents: number;
        priority: 'HIGH' | 'MEDIUM' | 'LOW';
        implementationTimeline: string;
    }>;
}

/**
 * Get comprehensive Discipline Master dashboard
 */
export async function getDisciplineMasterDashboard(academicYearId?: number): Promise<DisciplineMasterDashboard> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

        // Get enrollments for current academic year
        const currentYearEnrollments = await prisma.enrollment.findMany({
            where: { academic_year_id: currentYear.id, student: { status: { not: 'WITHDRAWN' } } },
            select: { id: true }
        });
        const enrollmentIds = currentYearEnrollments.map(e => e.id);

        const [
            totalActiveIssues,
            weeklyIssues,
            studentsWithMultipleIssues,
            attendanceData,
            latenessData,
            thisMonthIssues,
            lastMonthIssues,
            urgentStudents,
            issuesByType
        ] = await Promise.all([
            // Total active issues (all issues since no status field exists)
            prisma.disciplineIssue.count({
                where: {
                    enrollment_id: { in: enrollmentIds }
                }
            }),

            // Issues from this week
            prisma.disciplineIssue.count({
                where: {
                    enrollment_id: { in: enrollmentIds },
                    created_at: { gte: oneWeekAgo }
                }
            }),

            // Students with multiple issues
            prisma.disciplineIssue.groupBy({
                by: ['enrollment_id'],
                where: {
                    enrollment_id: { in: enrollmentIds }
                },
                _count: { id: true },
                having: {
                    id: { _count: { gt: 1 } }
                }
            }),

            // Mock attendance rate (since we don't have proper attendance tracking)
            Promise.resolve(85.5),

            // Lateness incidents (MORNING_LATENESS type)
            prisma.disciplineIssue.count({
                where: {
                    enrollment_id: { in: enrollmentIds },
                    issue_type: 'MORNING_LATENESS'
                }
            }),

            // This month issues
            prisma.disciplineIssue.count({
                where: {
                    enrollment_id: { in: enrollmentIds },
                    created_at: { gte: oneMonthAgo }
                }
            }),

            // Last month issues  
            prisma.disciplineIssue.count({
                where: {
                    enrollment_id: { in: enrollmentIds },
                    created_at: {
                        gte: twoMonthsAgo,
                        lt: oneMonthAgo
                    }
                }
            }),

            // Get students with multiple recent issues for urgent interventions
            prisma.disciplineIssue.findMany({
                where: {
                    enrollment_id: { in: enrollmentIds },
                    created_at: { gte: oneWeekAgo }
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
                orderBy: { created_at: 'desc' },
                take: 10
            }),

            // Issues by type
            prisma.disciplineIssue.groupBy({
                by: ['issue_type'],
                where: {
                    enrollment_id: { in: enrollmentIds }
                },
                _count: { id: true }
            })
        ]);

        // Calculate trends
        const behavioralTrend = thisMonthIssues > lastMonthIssues ? 'DECLINING' :
            thisMonthIssues < lastMonthIssues ? 'IMPROVING' : 'STABLE';

        // Format urgent interventions
        const urgentInterventionsMap = new Map();
        urgentStudents.forEach(issue => {
            const studentId = issue.enrollment.student.id;
            if (!urgentInterventionsMap.has(studentId)) {
                urgentInterventionsMap.set(studentId, {
                    studentId,
                    studentName: issue.enrollment.student.name,
                    issueCount: 1,
                    riskLevel: 'MEDIUM' as const,
                    lastIncident: issue.created_at.toISOString(),
                    recommendedAction: 'Monitor closely and implement behavioral intervention'
                });
            } else {
                urgentInterventionsMap.get(studentId).issueCount++;
            }
        });

        const urgentInterventions = Array.from(urgentInterventionsMap.values())
            .map(item => ({
                ...item,
                riskLevel: (item.issueCount >= 3 ? 'HIGH' : item.issueCount >= 2 ? 'MEDIUM' : 'LOW') as 'HIGH' | 'MEDIUM' | 'LOW'
            }))
            .sort((a, b) => b.issueCount - a.issueCount);

        // Format issues by type
        const formattedIssuesByType = issuesByType.map(item => ({
            type: item.issue_type,
            count: item._count.id,
            trend: 'STABLE' as const, // Mock trend since we don't have historical comparison
            resolution_rate: 75 // Mock resolution rate
        }));

        return {
            totalActiveIssues,
            resolvedThisWeek: weeklyIssues, // Using weekly issues as resolved (mock)
            pendingResolution: Math.max(0, totalActiveIssues - weeklyIssues),
            studentsWithMultipleIssues: studentsWithMultipleIssues.length,
            averageResolutionTime: 5.2, // Mock average in days
            attendanceRate: attendanceData,
            latenessIncidents: latenessData,
            absenteeismCases: thisMonthIssues - latenessData, // Mock calculation
            interventionSuccess: 78, // Mock percentage
            criticalCases: urgentInterventions.filter(u => u.riskLevel === 'HIGH').length,
            behavioralTrends: {
                thisMonth: thisMonthIssues,
                lastMonth: lastMonthIssues,
                trend: behavioralTrend
            },
            urgentInterventions: urgentInterventions.slice(0, 5),
            issuesByType: formattedIssuesByType
        };
    } catch (error) {
        console.error('Error in getDisciplineMasterDashboard:', error);
        throw new Error(`Failed to get discipline master dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Get behavioral analytics
 */
export async function getBehavioralAnalytics(academicYearId?: number): Promise<BehavioralAnalytics> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        // Get enrollments for current academic year
        const currentYearEnrollments = await prisma.enrollment.findMany({
            where: { academic_year_id: currentYear.id, student: { status: { not: 'WITHDRAWN' } } },
            select: { id: true }
        });
        const enrollmentIds = currentYearEnrollments.map(e => e.id);

        const [
            totalStudents,
            studentsWithIssues,
            allIssues,
            issuesByType,
            classroomData
        ] = await Promise.all([
            // Total students in current year
            prisma.enrollment.count({
                where: { academic_year_id: currentYear.id }
            }),

            // Students with discipline issues
            prisma.disciplineIssue.findMany({
                where: {
                    enrollment_id: { in: enrollmentIds }
                },
                select: { enrollment_id: true },
                distinct: ['enrollment_id']
            }),

            // All discipline issues for analysis
            prisma.disciplineIssue.findMany({
                where: {
                    enrollment_id: { in: enrollmentIds }
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
                }
            }),

            // Issues by type for analysis
            prisma.disciplineIssue.groupBy({
                by: ['issue_type'],
                where: {
                    enrollment_id: { in: enrollmentIds }
                },
                _count: { id: true }
            }),

            // Classroom data for hotspots
            prisma.enrollment.findMany({
                where: { academic_year_id: currentYear.id, student: { status: { not: 'WITHDRAWN' } } },
                include: {
                    sub_class: {
                        include: { class: true }
                    },
                    discipline_issues: true
                }
            })
        ]);

        // Calculate behavior score (0-100, higher is better)
        const behaviorScore = totalStudents > 0 ?
            Math.round(((totalStudents - studentsWithIssues.length) / totalStudents) * 100) : 100;

        // Risk distribution (mock calculation based on issue count)
        const studentIssueCount = new Map();
        allIssues.forEach(issue => {
            const enrollmentId = issue.enrollment_id;
            studentIssueCount.set(enrollmentId, (studentIssueCount.get(enrollmentId) || 0) + 1);
        });

        const riskDistribution = {
            high: Array.from(studentIssueCount.values()).filter(count => count >= 3).length,
            medium: Array.from(studentIssueCount.values()).filter(count => count === 2).length,
            low: Array.from(studentIssueCount.values()).filter(count => count === 1).length,
            none: totalStudents - studentsWithIssues.length
        };

        // Mock monthly trends (would need proper date-based analysis)
        const monthlyTrends = [
            { month: 'January', incidents: 15, resolved: 12, newCases: 8 },
            { month: 'February', incidents: 12, resolved: 10, newCases: 6 },
            { month: 'March', incidents: 18, resolved: 15, newCases: 10 },
            { month: 'April', incidents: 14, resolved: 11, newCases: 7 }
        ];

        // Issue type analysis
        const issueTypeAnalysis = issuesByType.map(item => ({
            issueType: item.issue_type,
            frequency: item._count.id,
            averageResolutionTime: Math.random() * 10 + 2, // Mock: 2-12 days
            recurrenceRate: Math.random() * 30 + 10, // Mock: 10-40%
            effectiveInterventions: ['Counseling', 'Parent Meeting', 'Behavioral Contract']
        }));

        // Classroom hotspots
        const classroomMap = new Map();
        classroomData.forEach(enrollment => {
            if (enrollment.sub_class) {
                const key = `${enrollment.sub_class.class.name}-${enrollment.sub_class.name}`;
                if (!classroomMap.has(key)) {
                    classroomMap.set(key, {
                        subClassName: enrollment.sub_class.name,
                        className: enrollment.sub_class.class.name,
                        incidentCount: 0,
                        students: 0,
                        issues: []
                    });
                }
                const classData = classroomMap.get(key);
                classData.students++;
                classData.incidentCount += enrollment.discipline_issues.length;
                enrollment.discipline_issues.forEach(issue => {
                    classData.issues.push(issue.issue_type);
                });
            }
        });

        const classroomHotspots = Array.from(classroomMap.values())
            .map(classroom => ({
                subClassName: classroom.subClassName,
                className: classroom.className,
                incidentCount: classroom.incidentCount,
                riskScore: classroom.students > 0 ? Math.round((classroom.incidentCount / classroom.students) * 100) : 0,
                primaryIssues: [...new Set(classroom.issues)].slice(0, 3)
            }))
            .sort((a, b) => b.incidentCount - a.incidentCount)
            .slice(0, 10);

        return {
            totalStudents,
            studentsWithIssues: studentsWithIssues.length,
            behaviorScore,
            riskDistribution,
            monthlyTrends,
            issueTypeAnalysis,
            classroomHotspots: classroomHotspots.map(spot => ({
                subClassName: spot.subClassName,
                className: spot.className,
                incidentCount: spot.incidentCount,
                riskScore: spot.riskScore,
                primaryIssues: spot.primaryIssues.map(issue => String(issue))
            }))
        };
    } catch (error) {
        console.error('Error in getBehavioralAnalytics:', error);
        throw error;
    }
}

/**
 * Get student behavior profile
 */
export async function getStudentBehaviorProfile(studentId: number, academicYearId?: number): Promise<StudentBehaviorProfile> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        // Get student with enrollment and discipline issues
        const student = await prisma.student.findUnique({
            where: { id: studentId },
            include: {
                enrollments: {
                    where: { academic_year_id: currentYear.id },
                    include: {
                        sub_class: {
                            include: { class: true }
                        },
                        discipline_issues: {
                            include: {
                                assigned_by: true,
                                reviewed_by: true
                            },
                            orderBy: { created_at: 'desc' }
                        }
                    }
                }
            }
        });

        if (!student) {
            throw new Error('Student not found');
        }

        const enrollment = student.enrollments[0];
        if (!enrollment) {
            throw new Error('Student not enrolled in current academic year');
        }

        const disciplineIssues = enrollment.discipline_issues;
        const totalIncidents = disciplineIssues.length;
        const recentIncidents = disciplineIssues.filter(
            issue => new Date(issue.created_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        ).length;

        // Calculate risk level
        let riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
        if (totalIncidents === 0) riskLevel = 'NONE';
        else if (totalIncidents >= 3) riskLevel = 'HIGH';
        else if (totalIncidents >= 2) riskLevel = 'MEDIUM';
        else riskLevel = 'LOW';

        // Calculate behavior score (0-100, higher is better)
        const behaviorScore = Math.max(0, 100 - (totalIncidents * 10));

        // Most common issues
        const issueTypeCounts = new Map();
        disciplineIssues.forEach(issue => {
            issueTypeCounts.set(issue.issue_type, (issueTypeCounts.get(issue.issue_type) || 0) + 1);
        });
        const mostCommonIssues = Array.from(issueTypeCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([type]) => type);

        // Mock intervention history (would need separate table in real implementation)
        const interventionHistory = disciplineIssues.slice(0, 5).map((issue, index) => ({
            id: issue.id,
            type: 'Behavioral Counseling',
            date: issue.created_at.toISOString().split('T')[0],
            description: `Intervention for ${issue.issue_type}: ${issue.description}`,
            outcome: index % 2 === 0 ? 'SUCCESSFUL' as const : 'ONGOING' as const,
            followUpDate: index < 2 ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : undefined
        }));

        // Recommended actions based on risk level
        const recommendedActions = [];
        if (riskLevel === 'HIGH') {
            recommendedActions.push(
                { priority: 'HIGH' as const, action: 'Immediate counseling session', timeline: 'Within 24 hours', responsible: 'Guidance Counselor' },
                { priority: 'HIGH' as const, action: 'Parent conference', timeline: 'Within 3 days', responsible: 'Class Master' },
                { priority: 'MEDIUM' as const, action: 'Behavioral contract', timeline: 'Within 1 week', responsible: 'Discipline Master' }
            );
        } else if (riskLevel === 'MEDIUM') {
            recommendedActions.push(
                { priority: 'MEDIUM' as const, action: 'Counseling session', timeline: 'Within 1 week', responsible: 'Guidance Counselor' },
                { priority: 'LOW' as const, action: 'Monitor behavior', timeline: 'Ongoing', responsible: 'Class Master' }
            );
        } else if (riskLevel === 'LOW') {
            recommendedActions.push(
                { priority: 'LOW' as const, action: 'Monitor behavior', timeline: 'Ongoing', responsible: 'Class Master' }
            );
        }

        return {
            studentId: student.id,
            studentName: student.name,
            matricule: student.matricule,
            className: enrollment.sub_class?.class.name || 'N/A',
            subClassName: enrollment.sub_class?.name || 'N/A',
            riskLevel,
            behaviorScore,
            totalIncidents,
            recentIncidents,
            interventionsReceived: interventionHistory.length,
            lastIncidentDate: disciplineIssues.length > 0 ? disciplineIssues[0].created_at.toISOString().split('T')[0] : undefined,
            behaviorPattern: {
                mostCommonIssues,
                triggerFactors: ['Morning tardiness', 'Peer influence'], // Mock data
                improvementAreas: ['Punctuality', 'Class participation'], // Mock data
                strengths: ['Academic performance', 'Sports participation'] // Mock data
            },
            interventionHistory,
            recommendedActions
        };
    } catch (error) {
        console.error('Error in getStudentBehaviorProfile:', error);
        throw new Error(`Failed to get student behavior profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Get early warning system data
 */
export async function getEarlyWarningSystem(academicYearId?: number): Promise<EarlyWarningSystem> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        // Get enrollments for current academic year
        const currentYearEnrollments = await prisma.enrollment.findMany({
            where: { academic_year_id: currentYear.id, student: { status: { not: 'WITHDRAWN' } } },
            select: { id: true }
        });
        const enrollmentIds = currentYearEnrollments.map(e => e.id);

        // Get students with recent multiple issues
        const recentIssues = await prisma.disciplineIssue.findMany({
            where: {
                enrollment_id: { in: enrollmentIds },
                created_at: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
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
            }
        });

        // Group by student to identify critical cases
        const studentIssueMap = new Map();
        recentIssues.forEach(issue => {
            const studentId = issue.enrollment.student.id;
            if (!studentIssueMap.has(studentId)) {
                studentIssueMap.set(studentId, {
                    student: issue.enrollment.student,
                    enrollment: issue.enrollment,
                    issues: []
                });
            }
            studentIssueMap.get(studentId).issues.push(issue);
        });

        // Identify critical students
        const criticalStudents = Array.from(studentIssueMap.values())
            .filter(data => data.issues.length >= 2)
            .map(data => {
                const issueCount = data.issues.length;
                const warningLevel = issueCount >= 4 ? 'CRITICAL' : issueCount >= 3 ? 'HIGH' : 'MODERATE';
                const urgency = warningLevel === 'CRITICAL' ? 'IMMEDIATE' :
                    warningLevel === 'HIGH' ? 'WITHIN_WEEK' : 'MONITOR';

                return {
                    studentId: data.student.id,
                    studentName: data.student.name,
                    warningLevel: warningLevel as 'CRITICAL' | 'HIGH' | 'MODERATE',
                    riskFactors: ['Multiple recent incidents', 'Behavioral pattern', 'Academic concern'],
                    triggerEvents: data.issues.map(issue => issue.issue_type),
                    recommendedActions: [
                        'Immediate counseling intervention',
                        'Parent conference required',
                        'Behavioral support plan'
                    ],
                    urgency: urgency as 'IMMEDIATE' | 'WITHIN_WEEK' | 'MONITOR'
                };
            })
            .sort((a, b) => {
                const urgencyOrder = { 'IMMEDIATE': 3, 'WITHIN_WEEK': 2, 'MONITOR': 1 };
                return urgencyOrder[b.urgency] - urgencyOrder[a.urgency];
            });

        // Risk indicators
        const totalStudents = await prisma.enrollment.count({
            where: { academic_year_id: currentYear.id }
        });

        const behaviorSeverity: 'HIGH' | 'MEDIUM' | 'LOW' =
            studentIssueMap.size > totalStudents * 0.1 ? 'HIGH' :
                studentIssueMap.size > totalStudents * 0.05 ? 'MEDIUM' : 'LOW';

        const riskIndicators: EarlyWarningSystem['riskIndicators'] = [
            {
                indicator: 'Recent behavioral incidents',
                studentsAffected: studentIssueMap.size,
                severity: behaviorSeverity,
                trendDirection: 'STABLE'
            },
            {
                indicator: 'Chronic absenteeism',
                studentsAffected: Math.floor(totalStudents * 0.03), // Mock 3%
                severity: 'MEDIUM',
                trendDirection: 'DECREASING'
            },
            {
                indicator: 'Academic performance decline',
                studentsAffected: Math.floor(totalStudents * 0.08), // Mock 8%
                severity: 'MEDIUM',
                trendDirection: 'INCREASING'
            }
        ];

        // Preventive recommendations
        const preventiveRecommendations = [
            {
                category: 'Behavioral Support',
                recommendation: 'Implement school-wide positive behavior intervention',
                targetStudents: criticalStudents.length,
                priority: 'HIGH' as const,
                implementationTimeline: '2 weeks'
            },
            {
                category: 'Academic Support',
                recommendation: 'Enhanced tutoring program for at-risk students',
                targetStudents: Math.floor(totalStudents * 0.1),
                priority: 'MEDIUM' as const,
                implementationTimeline: '1 month'
            },
            {
                category: 'Parent Engagement',
                recommendation: 'Regular parent communication and workshops',
                targetStudents: totalStudents,
                priority: 'MEDIUM' as const,
                implementationTimeline: 'Ongoing'
            }
        ];

        return {
            criticalStudents: criticalStudents.slice(0, 20), // Limit to top 20
            riskIndicators,
            preventiveRecommendations
        };
    } catch (error) {
        console.error('Error in getEarlyWarningSystem:', error);
        throw new Error(`Failed to get early warning system data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Get discipline statistics with filters
 */
export async function getDisciplineStatistics(filters: {
    academicYearId?: number;
    startDate?: string;
    endDate?: string;
    classId?: number;
} = {}): Promise<BehavioralAnalytics & { filters: typeof filters }> {
    try {
        const analytics = await getBehavioralAnalytics(filters.academicYearId);

        return {
            ...analytics,
            filters
        };
    } catch (error) {
        console.error('Error in getDisciplineStatistics:', error);
        throw new Error(`Failed to get discipline statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Get intervention tracking (mock implementation)
 */
export async function getInterventionTracking(filters: {
    academicYearId?: number;
    status?: string;
    studentId?: number;
} = {}): Promise<{ interventions: InterventionTracking[]; meta: { total: number; filters: typeof filters } }> {
    try {
        // Mock implementation - in real scenario, this would be a separate table
        const mockInterventions: InterventionTracking[] = [
            {
                id: 1,
                studentId: 1,
                studentName: 'John Doe',
                interventionType: 'Behavioral Counseling',
                description: 'Weekly counseling sessions to address behavioral issues',
                startDate: '2024-01-15',
                expectedEndDate: '2024-02-15',
                status: 'ONGOING',
                effectiveness: 75,
                followUpRequired: true,
                nextReviewDate: '2024-01-29',
                assignedTo: 'School Counselor',
                notes: [
                    {
                        date: '2024-01-15',
                        note: 'Initial assessment completed',
                        recordedBy: 'Counselor'
                    }
                ]
            }
        ];

        return {
            interventions: mockInterventions,
            meta: {
                total: mockInterventions.length,
                filters
            }
        };
    } catch (error) {
        console.error('Error in getInterventionTracking:', error);
        throw new Error(`Failed to get intervention tracking: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Create intervention plan (mock implementation)
 */
export async function createInterventionPlan(data: {
    studentId: number;
    interventionType: string;
    description: string;
    expectedEndDate?: string;
    assignedTo: string;
}): Promise<{ success: boolean; message: string; data: any }> {
    try {
        // Mock implementation - in real scenario, this would create a record in intervention table
        const intervention = {
            id: Math.floor(Math.random() * 1000) + 1,
            studentId: data.studentId,
            interventionType: data.interventionType,
            description: data.description,
            startDate: new Date().toISOString().split('T')[0],
            expectedEndDate: data.expectedEndDate,
            status: 'PLANNED',
            assignedTo: data.assignedTo,
            createdAt: new Date().toISOString(),
            createdBy: 'Current User'
        };

        return {
            success: true,
            message: 'Intervention plan created successfully',
            data: intervention
        };
    } catch (error) {
        console.error('Error in createInterventionPlan:', error);
        throw new Error(`Failed to create intervention plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Update intervention status (mock implementation)
 */
export async function updateInterventionStatus(
    interventionId: number,
    data: {
        status: string;
        outcome?: string;
        notes?: string;
        effectiveness?: number;
    }
): Promise<{ success: boolean; message: string; data: any }> {
    try {
        // Mock implementation
        const updatedIntervention = {
            id: interventionId,
            status: data.status,
            outcome: data.outcome,
            effectiveness: data.effectiveness,
            updatedAt: new Date().toISOString(),
            updatedBy: 'Current User'
        };

        return {
            success: true,
            message: 'Intervention updated successfully',
            data: updatedIntervention
        };
    } catch (error) {
        console.error('Error in updateInterventionStatus:', error);
        throw new Error(`Failed to update intervention status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Get risk assessment
 */
export async function getRiskAssessment(filters: {
    academicYearId?: number;
    riskLevel?: string;
    classId?: number;
} = {}): Promise<{
    totalStudentsAssessed: number;
    riskLevelBreakdown: { critical: number; high: number; moderate: number };
    studentsAtRisk: any[];
    riskIndicators: any[];
    recommendations: any[];
    filters: typeof filters;
}> {
    try {
        const analytics = await getBehavioralAnalytics(filters.academicYearId);
        const earlyWarning = await getEarlyWarningSystem(filters.academicYearId);

        return {
            totalStudentsAssessed: analytics.totalStudents,
            riskLevelBreakdown: {
                critical: earlyWarning.criticalStudents.filter(s => s.warningLevel === 'CRITICAL').length,
                high: earlyWarning.criticalStudents.filter(s => s.warningLevel === 'HIGH').length,
                moderate: earlyWarning.criticalStudents.filter(s => s.warningLevel === 'MODERATE').length
            },
            studentsAtRisk: earlyWarning.criticalStudents,
            riskIndicators: earlyWarning.riskIndicators,
            recommendations: earlyWarning.preventiveRecommendations,
            filters
        };
    } catch (error) {
        console.error('Error in getRiskAssessment:', error);
        throw new Error(`Failed to get risk assessment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Generate comprehensive discipline report
 */
export async function generateDisciplineReport(filters: {
    academicYearId?: number;
    reportType?: string;
    startDate?: string;
    endDate?: string;
} = {}): Promise<{
    reportInfo: any;
    executiveSummary: any;
    detailedAnalysis: any;
    recommendations: string[];
    actionItems: any[];
}> {
    try {
        const [dashboard, analytics, earlyWarning] = await Promise.all([
            getDisciplineMasterDashboard(filters.academicYearId),
            getBehavioralAnalytics(filters.academicYearId),
            getEarlyWarningSystem(filters.academicYearId)
        ]);

        const reportInfo = {
            type: filters.reportType || 'comprehensive',
            generatedAt: new Date().toISOString(),
            generatedBy: 'System',
            academicYearId: filters.academicYearId,
            dateRange: {
                startDate: filters.startDate,
                endDate: filters.endDate
            }
        };

        const executiveSummary = {
            totalActiveIssues: dashboard.totalActiveIssues,
            studentsWithIssues: analytics.studentsWithIssues,
            behaviorScore: analytics.behaviorScore,
            criticalCases: dashboard.criticalCases,
            resolutionRate: dashboard.interventionSuccess
        };

        const detailedAnalysis = {
            dashboard,
            behavioralAnalytics: analytics,
            earlyWarning
        };

        const recommendations = [
            'Implement proactive behavioral intervention programs',
            'Enhance parent communication and engagement',
            'Provide additional training for staff on behavioral management',
            'Establish peer mentoring programs',
            'Review and update discipline policies'
        ];

        const actionItems = [
            {
                priority: 'HIGH',
                action: 'Address critical cases immediately',
                responsible: 'Discipline Master',
                deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            },
            {
                priority: 'MEDIUM',
                action: 'Implement early warning monitoring system',
                responsible: 'Vice Principal',
                deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            },
            {
                priority: 'LOW',
                action: 'Review classroom management strategies',
                responsible: 'Academic Coordinator',
                deadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            }
        ];

        return {
            reportInfo,
            executiveSummary,
            detailedAnalysis,
            recommendations,
            actionItems
        };
    } catch (error) {
        console.error('Error in generateDisciplineReport:', error);
        throw new Error(`Failed to generate discipline report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
} 