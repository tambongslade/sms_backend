import { Request, Response } from 'express';
import * as hodService from '../services/hodService';
import * as hodDepartmentStatus from '../services/hodDepartmentStatusService';

/**
 * Get HOD dashboard overview
 * GET /api/v1/hod/dashboard
 */
export const getHODDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
        const hodId = req.user?.id;
        const { academicYearId } = req.query;

        if (!hodId) {
            res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
            return;
        }

        const dashboard = await hodService.getHODDashboard(
            hodId,
            academicYearId ? parseInt(academicYearId as string) : undefined
        );

        res.status(200).json({
            success: true,
            data: dashboard
        });
    } catch (error: any) {
        console.error('Error getting HOD dashboard:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve HOD dashboard'
        });
    }
};

/**
 * Get department overview for HOD
 * GET /api/v1/hod/department-overview
 */
export const getDepartmentOverview = async (req: Request, res: Response): Promise<void> => {
    try {
        const hodId = req.user?.id;
        const { academicYearId } = req.query;

        if (!hodId) {
            res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
            return;
        }

        const overview = await hodService.getDepartmentOverview(
            hodId,
            academicYearId ? parseInt(academicYearId as string) : undefined
        );

        res.status(200).json({
            success: true,
            data: overview
        });
    } catch (error: any) {
        console.error('Error getting department overview:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve department overview'
        });
    }
};

/**
 * Get teachers in HOD's department
 * GET /api/v1/hod/teachers-in-department
 */
export const getTeachersInDepartment = async (req: Request, res: Response): Promise<void> => {
    try {
        const hodId = req.user?.id;
        const { academicYearId, search, page, limit, sortBy, sortOrder } = req.query;

        if (!hodId) {
            res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
            return;
        }

        const paginationOptions = {
            page: page ? parseInt(page as string) : 1,
            limit: limit ? parseInt(limit as string) : 10,
            sortBy: sortBy as string || 'name',
            sortOrder: (sortOrder as 'asc' | 'desc') || 'asc',
            search: search as string
        };

        const result = await hodService.getTeachersInDepartment(
            hodId,
            academicYearId ? parseInt(academicYearId as string) : undefined,
            paginationOptions
        );

        res.status(200).json({
            success: true,
            data: result.data,
            meta: result.meta
        });
    } catch (error: any) {
        console.error('Error getting teachers in department:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve teachers in department'
        });
    }
};

/**
 * Get subject performance analytics for HOD's subjects
 * GET /api/v1/hod/subject-performance
 */
export const getSubjectPerformance = async (req: Request, res: Response): Promise<void> => {
    try {
        const hodId = req.user?.id;
        const { subjectId, academicYearId } = req.query;

        if (!hodId) {
            res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
            return;
        }

        const performance = await hodService.getSubjectPerformance(
            hodId,
            subjectId ? parseInt(subjectId as string) : undefined,
            academicYearId ? parseInt(academicYearId as string) : undefined
        );

        res.status(200).json({
            success: true,
            data: performance
        });
    } catch (error: any) {
        console.error('Error getting subject performance:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve subject performance'
        });
    }
};

/**
 * Assign teacher to HOD's subject
 * POST /api/v1/hod/assign-teacher-subject
 */
export const assignTeacherToSubject = async (req: Request, res: Response): Promise<void> => {
    try {
        const hodId = req.user?.id;
        const { subjectId, teacherId } = req.body;

        if (!hodId) {
            res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
            return;
        }

        // Validate required fields
        if (!subjectId || !teacherId) {
            res.status(400).json({
                success: false,
                error: 'subjectId and teacherId are required'
            });
            return;
        }

        const result = await hodService.assignTeacherToSubject(
            hodId,
            parseInt(subjectId),
            parseInt(teacherId)
        );

        res.status(201).json({
            success: true,
            message: result.message,
            data: result.assignment
        });
    } catch (error: any) {
        console.error('Error assigning teacher to subject:', error);

        if (error.message.includes('not found') || error.message.includes('not managed')) {
            res.status(404).json({
                success: false,
                error: error.message
            });
        } else if (error.message.includes('already assigned')) {
            res.status(409).json({
                success: false,
                error: error.message
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to assign teacher to subject'
            });
        }
    }
};

/**
 * Get department analytics for HOD
 * GET /api/v1/hod/department-analytics
 */
export const getDepartmentAnalytics = async (req: Request, res: Response): Promise<void> => {
    try {
        const hodId = req.user?.id;
        const { academicYearId } = req.query;

        if (!hodId) {
            res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
            return;
        }

        const analytics = await hodService.getDepartmentAnalytics(
            hodId,
            academicYearId ? parseInt(academicYearId as string) : undefined
        );

        res.status(200).json({
            success: true,
            data: analytics
        });
    } catch (error: any) {
        console.error('Error getting department analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve department analytics'
        });
    }
};

/**
 * Get teacher performance details in HOD's department
 * GET /api/v1/hod/teacher-performance/:teacherId
 */
export const getTeacherPerformance = async (req: Request, res: Response): Promise<void> => {
    try {
        const hodId = req.user?.id;
        const { teacherId } = req.params;
        const { academicYearId } = req.query;

        if (!hodId) {
            res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
            return;
        }

        if (!teacherId) {
            res.status(400).json({
                success: false,
                error: 'teacherId parameter is required'
            });
            return;
        }

        const performance = await hodService.getTeacherPerformance(
            hodId,
            parseInt(teacherId),
            academicYearId ? parseInt(academicYearId as string) : undefined
        );

        res.status(200).json({
            success: true,
            data: performance
        });
    } catch (error: any) {
        console.error('Error getting teacher performance:', error);

        if (error.message.includes('not found')) {
            res.status(404).json({
                success: false,
                error: error.message
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve teacher performance'
            });
        }
    }
};

/**
 * Get HOD's subjects list
 * GET /api/v1/hod/my-subjects
 */
export const getMySubjects = async (req: Request, res: Response): Promise<void> => {
    try {
        const hodId = req.user?.id;

        if (!hodId) {
            res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
            return;
        }

        const subjects = await hodService.getHODSubjects(hodId);

        const formattedSubjects = subjects.map(subject => ({
            id: subject.id,
            name: subject.name,
            category: subject.category,
            totalTeachers: subject.subject_teachers.length,
            totalClasses: subject.sub_class_subjects.length,
            totalStudents: subject.sub_class_subjects.reduce((total: number, scs: any) =>
                total + scs.sub_class.enrollments.length, 0)
        }));

        res.status(200).json({
            success: true,
            data: formattedSubjects
        });
    } catch (error: any) {
        console.error('Error getting HOD subjects:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve HOD subjects'
        });
    }
}; 
/**
 * Department status for the HOD's Period Tracking / Curriculum / Performance
 * pages: teacher load + logbook activity, scheme-of-work coverage and
 * marks-entry status, scoped to the subjects the HOD heads.
 * GET /api/v1/hod/department-status[?academicYearId=&hodId=]
 * (hodId is honoured for SUPER_MANAGER / PRINCIPAL viewing a given HOD.)
 */
export const getDepartmentStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const q: any = (req as any).finalQuery ?? req.query;
        const callerRoles: string[] = (req.user?.role as unknown as string[]) ?? [];
        let hodId = req.user?.id;
        if (q.hod_id && callerRoles.some((r) => ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_STUDIES'].includes(r))) {
            const n = parseInt(q.hod_id as string);
            if (!isNaN(n)) hodId = n;
        }
        if (!hodId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }
        const academicYearId = q.academic_year_id ? parseInt(q.academic_year_id as string) : undefined;
        const data = await hodDepartmentStatus.getDepartmentStatus(hodId, academicYearId);
        res.status(200).json({ success: true, data });
    } catch (error: any) {
        console.error('Error getting HOD department status:', error);
        res.status(500).json({ success: false, error: 'Failed to retrieve department status' });
    }
};
