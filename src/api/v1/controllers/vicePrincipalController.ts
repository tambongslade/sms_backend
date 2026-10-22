import { Request, Response } from 'express';
import {
    getVicePrincipalDashboard,
    getStudentManagementOverview,
    getInterviewManagement,
    getSubclassOptimization,
    getStudentProgressTracking,
    bulkScheduleInterviews,
    getEnrollmentAnalytics
} from '../services/vicePrincipalService';

/**
 * Get Vice Principal dashboard with comprehensive student management overview
 */
export async function getVPDashboard(req: Request, res: Response): Promise<void> {
    try {
        const academicYearId = req.query.academicYearId ? 
            parseInt(req.query.academicYearId as string) : undefined;

        const dashboard = await getVicePrincipalDashboard(academicYearId);

        res.status(200).json({
            success: true,
            data: dashboard
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch Vice Principal dashboard'
        });
    }
}

/**
 * Get detailed student management overview with analytics
 */
export async function getStudentManagement(req: Request, res: Response): Promise<void> {
    try {
        const academicYearId = req.query.academicYearId ? 
            parseInt(req.query.academicYearId as string) : undefined;

        const overview = await getStudentManagementOverview(academicYearId);

        res.status(200).json({
            success: true,
            data: overview
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch student management overview'
        });
    }
}

/**
 * Get interview management data with tracking and scheduling
 */
export async function getInterviewData(req: Request, res: Response): Promise<void> {
    try {
        const academicYearId = req.query.academicYearId ? 
            parseInt(req.query.academicYearId as string) : undefined;
        const status = req.query.status as string | undefined;
        const rawAssignment = String(req.query.assignment ?? 'UNASSIGNED').toUpperCase();
        if (!['UNASSIGNED', 'ASSIGNED', 'ALL'].includes(rawAssignment)) {
            res.status(400).json({ success: false, error: 'assignment must be UNASSIGNED, ASSIGNED or ALL' });
            return;
        }
        const assignment = rawAssignment as 'UNASSIGNED' | 'ASSIGNED' | 'ALL';

        const interviewData = await getInterviewManagement(academicYearId, status, assignment);

        res.status(200).json({
            success: true,
            data: interviewData,
            count: interviewData.length
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch interview management data'
        });
    }
}

/**
 * Get subclass optimization recommendations and capacity analysis
 */
export async function getSubclassOptimizationData(req: Request, res: Response): Promise<void> {
    try {
        const academicYearId = req.query.academicYearId ? 
            parseInt(req.query.academicYearId as string) : undefined;

        const optimization = await getSubclassOptimization(academicYearId);

        res.status(200).json({
            success: true,
            data: optimization
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch subclass optimization data'
        });
    }
}

/**
 * Get detailed student progress tracking for enrollment journey
 */
export async function getStudentProgress(req: Request, res: Response): Promise<void> {
    try {
        const studentId = parseInt(req.params.studentId);
        const academicYearId = req.query.academicYearId ? 
            parseInt(req.query.academicYearId as string) : undefined;

        if (!studentId || isNaN(studentId)) {
            res.status(400).json({
                success: false,
                error: 'Valid student ID is required'
            });
            return;
        }

        const progress = await getStudentProgressTracking(studentId, academicYearId);

        res.status(200).json({
            success: true,
            data: progress
        });
    } catch (error: any) {
        if (error.message.includes('not found')) {
            res.status(404).json({
                success: false,
                error: error.message
            });
        } else {
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to fetch student progress tracking'
            });
        }
    }
}

/**
 * Bulk schedule interviews for multiple students
 */
export async function scheduleBulkInterviews(req: Request, res: Response): Promise<void> {
    try {
        const { studentIds, scheduledDate } = req.body;
        const academicYearId = req.body.academicYearId;

        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            res.status(400).json({
                success: false,
                error: 'Student IDs array is required and cannot be empty'
            });
            return;
        }

        if (!scheduledDate) {
            res.status(400).json({
                success: false,
                error: 'Scheduled date is required'
            });
            return;
        }

        // Validate that all studentIds are numbers
        const validStudentIds = studentIds.filter(id => !isNaN(parseInt(id))).map(id => parseInt(id));
        if (validStudentIds.length !== studentIds.length) {
            res.status(400).json({
                success: false,
                error: 'All student IDs must be valid numbers'
            });
            return;
        }

        const result = await bulkScheduleInterviews(validStudentIds, scheduledDate, academicYearId);

        res.status(201).json({
            success: true,
            message: `Successfully scheduled ${result.scheduled} interviews`,
            data: result
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to schedule bulk interviews'
        });
    }
}

/**
 * Get enrollment analytics and trends
 */
export async function getEnrollmentAnalyticsData(req: Request, res: Response): Promise<void> {
    try {
        const academicYearId = req.query.academicYearId ? 
            parseInt(req.query.academicYearId as string) : undefined;

        const analytics = await getEnrollmentAnalytics(academicYearId);

        res.status(200).json({
            success: true,
            data: analytics
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch enrollment analytics'
        });
    }
}

/**
 * Get students requiring immediate attention (pending interviews, overdue assignments)
 */
export async function getStudentsRequiringAttention(req: Request, res: Response): Promise<void> {
    try {
        const academicYearId = req.query.academicYearId ? 
            parseInt(req.query.academicYearId as string) : undefined;

        // Get students with various urgent statuses
        const [pendingInterviews, overdueInterviews, awaitingAssignment] = await Promise.all([
            getInterviewManagement(academicYearId, 'PENDING'),
            getInterviewManagement(academicYearId, 'OVERDUE'),
            getInterviewManagement(academicYearId, 'COMPLETED') // Filter further in processing
        ]);

        // Filter awaiting assignment (interviewed but not assigned)
        const awaitingAssignmentFiltered = awaitingAssignment.filter(interview => 
            interview.interviewStatus === 'COMPLETED' && interview.score !== undefined
        );

        const studentsRequiringAttention = {
            pendingInterviews: {
                count: pendingInterviews.length,
                students: pendingInterviews.slice(0, 10) // Limit to 10 for dashboard
            },
            overdueInterviews: {
                count: overdueInterviews.length,
                students: overdueInterviews.slice(0, 10)
            },
            awaitingAssignment: {
                count: awaitingAssignmentFiltered.length,
                students: awaitingAssignmentFiltered.slice(0, 10)
            },
            totalRequiringAttention: pendingInterviews.length + overdueInterviews.length + awaitingAssignmentFiltered.length
        };

        res.status(200).json({
            success: true,
            data: studentsRequiringAttention
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch students requiring attention'
        });
    }
}

/**
 * Get detailed class capacity analysis
 */
export async function getClassCapacityAnalysis(req: Request, res: Response): Promise<void> {
    try {
        const academicYearId = req.query.academicYearId ? 
            parseInt(req.query.academicYearId as string) : undefined;

        const optimization = await getSubclassOptimization(academicYearId);

        // Process data for capacity analysis view
        const capacityAnalysis = optimization.map(classData => ({
            classId: classData.classId,
            className: classData.className,
            totalSubclasses: classData.subclasses.length,
            totalCurrentEnrollment: classData.subclasses.reduce((sum, sc) => sum + sc.currentEnrollment, 0),
            totalMaxCapacity: classData.subclasses.reduce((sum, sc) => sum + sc.maxCapacity, 0),
            overallUtilization: classData.overallUtilization,
            availableSpots: classData.subclasses.reduce((sum, sc) => sum + sc.availableSpots, 0),
            issuesCount: classData.subclasses.filter(sc => 
                sc.status === 'OVERLOADED' || sc.status === 'UNDERUTILIZED'
            ).length,
            recommendations: classData.recommendations,
            subclassDetails: classData.subclasses.map(sc => ({
                id: sc.id,
                name: sc.name,
                utilizationRate: sc.utilizationRate,
                status: sc.status,
                currentEnrollment: sc.currentEnrollment,
                maxCapacity: sc.maxCapacity,
                availableSpots: sc.availableSpots
            }))
        }));

        res.status(200).json({
            success: true,
            data: capacityAnalysis
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch class capacity analysis'
        });
    }
}

/**
 * Get quick statistics for Vice Principal overview
 */
export async function getQuickStats(req: Request, res: Response): Promise<void> {
    try {
        const academicYearId = req.query.academicYearId ? 
            parseInt(req.query.academicYearId as string) : undefined;

        const [dashboard, studentManagement] = await Promise.all([
            getVicePrincipalDashboard(academicYearId),
            getStudentManagementOverview(academicYearId)
        ]);

        const quickStats = {
            totalStudents: dashboard.totalStudents,
            studentsAssigned: dashboard.studentsAssigned,
            pendingInterviews: dashboard.pendingInterviews,
            awaitingAssignment: dashboard.awaitingAssignment,
            completionRate: dashboard.totalStudents > 0 ? 
                Math.round((dashboard.studentsAssigned / dashboard.totalStudents) * 100) : 0,
            interviewCompletionRate: studentManagement.totalStudents > 0 ?
                Math.round((studentManagement.interviewMetrics.totalConducted / studentManagement.totalStudents) * 100) : 0,
            urgentTasksCount: dashboard.urgentTasks.length,
            enrollmentTrend: dashboard.enrollmentTrends.trend,
            averageInterviewScore: studentManagement.interviewMetrics.averageScore
        };

        res.status(200).json({
            success: true,
            data: quickStats
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch quick statistics'
        });
    }
} 