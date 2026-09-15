// Enhanced Dashboard Controller for Advanced Role-Specific Features
import { Request, Response } from 'express';
import prisma from '../../../config/db';
import * as enhancedDashboardService from '../services/enhancedDashboardService';
import { getCurrentAcademicYear } from '../../../utils/academicYear';

// Roles considered "administrators" for the MANAGER overview headline counts.
// Aligns with Tier 1–3 of the role hierarchy (executives + head-of-school + senior leadership).
const ADMINISTRATOR_ROLES = [
    'SUPER_MANAGER',
    'MANAGER',
    'PRINCIPAL',
    'VICE_PRINCIPAL',
    'BURSAR',
    'SECRETARY',
] as const;

// Roles counted as "teachers" — TEACHER plus HOD (who teaches in addition to leading a subject).
const TEACHER_ROLES = ['TEACHER', 'HOD'] as const;

// All roles that count as staff (everything except PARENT).
const STAFF_ROLES = [
    'SUPER_MANAGER',
    'MANAGER',
    'PRINCIPAL',
    'VICE_PRINCIPAL',
    'BURSAR',
    'SECRETARY',
    'DEAN_OF_STUDIES',
    'DEAN_OF_DISCIPLINE',
    'SENIOR_DISCIPLINE_MASTER',
    'HOD',
    'TEACHER',
    'DISCIPLINE_MASTER',
    'NURSE',
    'FEE_AUDITOR',
    'CONTROLLER',
    'GUIDANCE_COUNSELOR',
] as const;

async function countDistinctUsersWithAnyRole(roles: readonly string[]): Promise<number> {
    return prisma.user.count({
        where: {
            user_roles: { some: { role: { in: roles as any } } },
        },
    });
}

async function getStaffBreakdown() {
    const [totalStaff, teachers, administrators] = await Promise.all([
        countDistinctUsersWithAnyRole(STAFF_ROLES),
        countDistinctUsersWithAnyRole(TEACHER_ROLES),
        countDistinctUsersWithAnyRole(ADMINISTRATOR_ROLES),
    ]);
    return { totalStaff, teachers, administrators };
}

// SSIC stream hierarchy for ordering subclasses within a class:
// N → NN → MN → M → MS → S → MW → W. Unknown codes sort last, alphabetically.
const STREAM_RANK: Record<string, number> = {
    N: 1,
    NN: 1.5,
    MN: 2,
    M: 3,
    MS: 4,
    S: 5,
    MW: 5.5,
    W: 6,
};

const streamRank = (name: string | null | undefined): number => {
    const parts = (name ?? '').trim().split(/\s+/);
    const code = (parts[parts.length - 1] || '').toUpperCase();
    return STREAM_RANK[code] ?? Number.POSITIVE_INFINITY;
};

// Enrollment summary: per-class rollup with per-subclass student counts for the given
// academic year (defaults to the current year). Feeds the MANAGER overview so the
// caller can see "how many students are in each class" at a glance.
async function getEnrollmentSummary(academicYearId?: number) {
    const yearId = academicYearId ?? (await getCurrentAcademicYear())?.id;
    if (!yearId) {
        return { academicYearId: null, totalEnrolled: 0, classes: [] as any[] };
    }

    const classes = await prisma.class.findMany({
        select: {
            id: true,
            name: true,
            sub_classes: {
                select: {
                    id: true,
                    name: true,
                    _count: {
                        select: {
                            enrollments: { where: { academic_year_id: yearId } },
                        },
                    },
                },
            },
        },
        orderBy: { name: 'asc' },
    });

    let totalEnrolled = 0;
    const shaped = classes.map(cls => {
        const subClasses = [...cls.sub_classes]
            .sort((a, b) => {
                const ra = streamRank(a.name);
                const rb = streamRank(b.name);
                if (ra !== rb) return ra - rb;
                return a.name.localeCompare(b.name, undefined, { numeric: true });
            })
            .map(sc => ({
                subClassId: sc.id,
                subClassName: sc.name,
                studentCount: sc._count.enrollments,
            }));
        const classTotal = subClasses.reduce((sum, sc) => sum + sc.studentCount, 0);
        totalEnrolled += classTotal;
        return {
            classId: cls.id,
            className: cls.name,
            totalStudents: classTotal,
            subClasses,
        };
    });

    return { academicYearId: yearId, totalEnrolled, classes: shaped };
}

/**
 * GET /api/v1/dashboard/super-manager/enhanced
 * Enhanced Super Manager Dashboard with comprehensive analytics
 */
export const getEnhancedSuperManagerDashboard = async (req: Request, res: Response) => {
    try {
        const academicYearId = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        const dashboardData = await enhancedDashboardService.getEnhancedSuperManagerDashboard(academicYearId);

        res.json({
            success: true,
            data: dashboardData
        });
    } catch (error) {
        console.error('Error fetching enhanced Super Manager dashboard:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch enhanced dashboard data'
        });
    }
};

/**
 * GET /api/v1/dashboard/manager/enhanced
 * Enhanced Manager Dashboard. Uses the same service as Super Manager but omits
 * fee-collection statistics (MANAGER is not scoped to finance) and adds a
 * headcount breakdown for the overview: total staff, teachers, administrators.
 */
export const getEnhancedManagerDashboard = async (req: Request, res: Response) => {
    try {
        const academicYearId = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        const [dashboardData, staffBreakdown, enrollmentSummary] = await Promise.all([
            enhancedDashboardService.getEnhancedSuperManagerDashboard(academicYearId),
            getStaffBreakdown(),
            getEnrollmentSummary(academicYearId),
        ]);

        const data: any = dashboardData;
        delete data.schoolFees;
        if (data.schoolOverview) {
            delete data.schoolOverview.finance;
        }
        data.staffBreakdown = staffBreakdown;
        data.enrollmentSummary = enrollmentSummary;

        res.json({
            success: true,
            data
        });
    } catch (error) {
        console.error('Error fetching enhanced Manager dashboard:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch enhanced dashboard data'
        });
    }
};

/**
 * GET /api/v1/dashboard/bursar/enhanced
 * Enhanced Bursar Dashboard with student registration and payment analytics
 */
export const getEnhancedBursarDashboard = async (req: Request, res: Response) => {
    try {
        const academicYearId = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        const dashboardData = await enhancedDashboardService.getEnhancedBursarDashboard(academicYearId);

        res.json({
            success: true,
            data: dashboardData
        });
    } catch (error) {
        console.error('Error fetching enhanced Bursar dashboard:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch enhanced Bursar dashboard data'
        });
    }
};

/**
 * GET /api/v1/dashboard/vp/enhanced
 * Enhanced VP Dashboard with interview management and student assignment
 */
export const getEnhancedVPDashboard = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.userId;
        const academicYearId = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        const dashboardData = await enhancedDashboardService.getEnhancedVPDashboard(userId, academicYearId);

        res.json({
            success: true,
            data: dashboardData
        });
    } catch (error) {
        console.error('Error fetching enhanced VP dashboard:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch enhanced VP dashboard data'
        });
    }
};

/**
 * GET /api/v1/dashboard/teacher-analytics
 * Teacher Analytics for Super Manager and Managers
 */
export const getTeacherAnalytics = async (req: Request, res: Response) => {
    try {
        const academicYearId = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        // This would be part of the enhanced dashboard, extracting teacher analytics specifically
        const dashboardData = await enhancedDashboardService.getEnhancedSuperManagerDashboard(academicYearId);

        res.json({
            success: true,
            data: {
                teacherAnalytics: dashboardData.teacherAnalytics,
                lastUpdated: dashboardData.lastUpdated
            }
        });
    } catch (error) {
        console.error('Error fetching teacher analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch teacher analytics data'
        });
    }
};

/**
 * GET /api/v1/dashboard/class-profiles
 * Class Profiles for Super Manager oversight
 */
export const getClassProfiles = async (req: Request, res: Response) => {
    try {
        const academicYearId = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        const dashboardData = await enhancedDashboardService.getEnhancedSuperManagerDashboard(academicYearId);

        res.json({
            success: true,
            data: {
                classProfiles: dashboardData.systemStatistics.classUtilization,
                averageUtilization: dashboardData.systemStatistics.averageClassUtilization,
                lastUpdated: dashboardData.lastUpdated
            }
        });
    } catch (error) {
        console.error('Error fetching class profiles:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch class profiles data'
        });
    }
};

/**
 * GET /api/v1/dashboard/reports-analytics
 * Reports Analytics for deadline management and tracking
 */
export const getReportsAnalytics = async (req: Request, res: Response) => {
    try {
        const academicYearId = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        const dashboardData = await enhancedDashboardService.getEnhancedSuperManagerDashboard(academicYearId);

        res.json({
            success: true,
            data: {
                reportAnalytics: dashboardData.reportAnalytics,
                lastUpdated: dashboardData.lastUpdated
            }
        });
    } catch (error) {
        console.error('Error fetching reports analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch reports analytics data'
        });
    }
};

/**
 * GET /api/v1/dashboard/audit-trail
 * System Audit Trail for tracking modifications
 */
export const getAuditTrail = async (req: Request, res: Response) => {
    try {
        const dashboardData = await enhancedDashboardService.getEnhancedSuperManagerDashboard();

        res.json({
            success: true,
            data: {
                auditTrail: dashboardData.auditTrail,
                lastUpdated: dashboardData.lastUpdated
            }
        });
    } catch (error) {
        console.error('Error fetching audit trail:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch audit trail data'
        });
    }
};

/**
 * GET /api/v1/dashboard/financial-overview
 * Financial Overview for Super Manager and Bursar
 */
export const getFinancialOverview = async (req: Request, res: Response) => {
    try {
        // MANAGER (as a pure MANAGER, not also SUPER_MANAGER) is intentionally
        // excluded from finance data. The auth middleware treats MANAGER as a
        // tier-1 executive peer of SUPER_MANAGER, so we block explicitly here.
        const callerRoles: string[] = (req as any).user?.role ?? [];
        if (callerRoles.includes('MANAGER') && !callerRoles.includes('SUPER_MANAGER') && !callerRoles.includes('BURSAR')) {
            return res.status(403).json({
                success: false,
                error: 'Forbidden: financial overview is not available to the MANAGER role',
            });
        }

        const academicYearId = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        const [superManagerData, bursarData] = await Promise.all([
            enhancedDashboardService.getEnhancedSuperManagerDashboard(academicYearId),
            enhancedDashboardService.getEnhancedBursarDashboard(academicYearId)
        ]);

        res.json({
            success: true,
            data: {
                schoolOverview: superManagerData.schoolOverview.finance,
                detailedFinancials: bursarData.financialOverview,
                paymentAnalytics: bursarData.paymentAnalytics,
                lastUpdated: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching financial overview:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch financial overview data'
        });
    }
};

/**
 * GET /api/v1/dashboard/student-registration
 * Student Registration Analytics for Bursar
 */
export const getStudentRegistrationAnalytics = async (req: Request, res: Response) => {
    try {
        const academicYearId = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        const dashboardData = await enhancedDashboardService.getEnhancedBursarDashboard(academicYearId);

        res.json({
            success: true,
            data: {
                studentRegistration: dashboardData.studentRegistration,
                parentManagement: dashboardData.parentManagement,
                lastUpdated: dashboardData.lastUpdated
            }
        });
    } catch (error) {
        console.error('Error fetching student registration analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch student registration analytics'
        });
    }
};

/**
 * GET /api/v1/dashboard/interview-management
 * Interview Management for VP
 */
export const getInterviewManagement = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.userId;
        const academicYearId = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        const dashboardData = await enhancedDashboardService.getEnhancedVPDashboard(userId, academicYearId);

        res.json({
            success: true,
            data: {
                studentManagement: dashboardData.studentManagement,
                interviewStats: dashboardData.interviewStats,
                lastUpdated: dashboardData.lastUpdated
            }
        });
    } catch (error) {
        console.error('Error fetching interview management data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch interview management data'
        });
    }
}; 