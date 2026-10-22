import { Request, Response } from 'express';
import { extractPaginationAndFilters } from '../../../utils/pagination';
import * as teacherService from '../services/teacherService';
import * as timetableService from '../services/timetableService';

interface AuthenticatedRequest extends Request {
    user?: {
        id: number;
        userId: number;
    };
    teacherSubClassIds?: number[];
    teacherSubjectIds?: number[];
}

/**
 * GET /teachers/me/subjects
 * Get subjects assigned to the authenticated teacher
 */
export const getMySubjects = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }

        const academicYearId = req.query.academicYearId ? parseInt(req.query.academicYearId as string) : undefined;
        const subjects = await teacherService.getTeacherSubjects(teacherId, academicYearId);

        res.json({
            success: true,
            data: subjects
        });
    } catch (error: any) {
        console.error('Error fetching teacher subjects:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * GET /teachers/me/students
 * Get students from subclasses where the teacher has assignments
 */
export const getMyStudents = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }

        // Extract pagination and filters
        const allowedFilters = ['subClassId', 'subjectId', 'academicYearId', 'sub_class_id', 'subject_id', 'academic_year_id', 'search', 'q'];
        const { paginationOptions, filterOptions } = extractPaginationAndFilters(req.query, allowedFilters);

        // Normalize filter keys (handle both camelCase and snake_case)
        const filters = {
            subClassId: filterOptions.subClassId || filterOptions.sub_class_id,
            subjectId: filterOptions.subjectId || filterOptions.subject_id,
            academicYearId: filterOptions.academicYearId || filterOptions.academic_year_id
        };

        // Parse numeric filters
        const parsedFilters = {
            subClassId: filters.subClassId ? parseInt(filters.subClassId as string) : undefined,
            subjectId: filters.subjectId ? parseInt(filters.subjectId as string) : undefined,
            academicYearId: filters.academicYearId ? parseInt(filters.academicYearId as string) : undefined,
            search: ((filterOptions.search || filterOptions.q) as string | undefined) || undefined
        };

        const result = await teacherService.getTeacherStudents(teacherId, parsedFilters, paginationOptions);

        res.json({
            success: true,
            data: result.data,
            meta: result.meta
        });
    } catch (error: any) {
        console.error('Error fetching teacher students:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * GET /teachers/me/subclasses
 * Get subclasses where the teacher has assignments
 */
export const getMySubClasses = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }

        const academicYearId = req.query.academicYearId ? parseInt(req.query.academicYearId as string) : undefined;
        const subClasses = await teacherService.getTeacherSubClasses(teacherId, academicYearId);

        res.json({
            success: true,
            data: subClasses
        });
    } catch (error: any) {
        console.error('Error fetching teacher subclasses:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * GET /teachers/me/dashboard
 * Get teacher dashboard summary
 */
export const getMyDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }

        const academicYearId = req.query.academicYearId ? parseInt(req.query.academicYearId as string) : undefined;
        const dashboard = await teacherService.getTeacherDashboard(teacherId, academicYearId);

        res.json({
            success: true,
            data: dashboard
        });
    } catch (error: any) {
        console.error('Error fetching teacher dashboard:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * GET /teachers/me/access-check
 * Check if teacher has access to specific subject/subclass
 */
export const checkMyAccess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }

        const subjectId = req.query.subjectId ? parseInt(req.query.subjectId as string) : undefined;
        const subClassId = req.query.subClassId ? parseInt(req.query.subClassId as string) : undefined;
        const academicYearId = req.query.academicYearId ? parseInt(req.query.academicYearId as string) : undefined;

        const hasAccess = await teacherService.hasTeacherAccess(teacherId, subjectId, subClassId, academicYearId);

        res.json({
            success: true,
            data: {
                hasAccess,
                subjectId,
                subClassId,
                academicYearId
            }
        });
    } catch (error: any) {
        console.error('Error checking teacher access:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * GET /teachers/me/subject-ids
 * Get list of subject IDs the teacher has access to
 */
export const getMySubjectIds = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }

        const academicYearId = req.query.academicYearId ? parseInt(req.query.academicYearId as string) : undefined;
        const subjectIds = await teacherService.getTeacherSubjectIds(teacherId, academicYearId);

        res.json({
            success: true,
            data: subjectIds
        });
    } catch (error: any) {
        console.error('Error fetching teacher subject IDs:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * GET /teachers/me/subclass-ids
 * Get list of subclass IDs the teacher has access to
 */
export const getMySubClassIds = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }

        const academicYearId = req.query.academicYearId ? parseInt(req.query.academicYearId as string) : undefined;
        const subClassIds = await teacherService.getTeacherSubClassIds(teacherId, academicYearId);

        res.json({
            success: true,
            data: subClassIds
        });
    } catch (error: any) {
        console.error('Error fetching teacher subclass IDs:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// =============================
// TEACHER ATTENDANCE MANAGEMENT
// =============================

/**
 * GET /teachers/me/attendance
 * Get my own attendance records
 */
export const getMyAttendance = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }

        // Extract pagination and filters
        const allowedFilters = ['startDate', 'endDate', 'academicYearId', 'start_date', 'end_date', 'academic_year_id'];
        const { paginationOptions, filterOptions } = extractPaginationAndFilters(req.query, allowedFilters);

        // Normalize filter keys
        const filters = {
            startDate: filterOptions.startDate || filterOptions.start_date,
            endDate: filterOptions.endDate || filterOptions.end_date,
            academicYearId: filterOptions.academicYearId || filterOptions.academic_year_id
        };

        // Parse filters
        const parsedFilters = {
            startDate: filters.startDate as string,
            endDate: filters.endDate as string,
            academicYearId: filters.academicYearId ? parseInt(filters.academicYearId as string) : undefined
        };

        const result = await teacherService.getMyAttendance(teacherId, parsedFilters, paginationOptions);

        res.json({
            success: true,
            data: result.data,
            meta: result.meta
        });
    } catch (error: any) {
        console.error('Error fetching teacher attendance:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * POST /teachers/attendance/record
 * Record student attendance for my classes
 */
export const recordStudentAttendance = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }

        const {
            studentId,
            subClassId,
            subjectId,
            status,
            reason,
            periodId,
            date,
            academicYearId
        } = req.body;

        // Validate required fields
        if (!studentId || !subClassId || !subjectId || !status) {
            res.status(400).json({
                success: false,
                error: 'studentId, subClassId, subjectId, and status are required'
            });
            return;
        }

        const attendanceRecord = await teacherService.recordStudentAttendance(teacherId, {
            studentId: parseInt(studentId),
            subClassId: parseInt(subClassId),
            subjectId: parseInt(subjectId),
            status,
            reason,
            periodId: periodId ? parseInt(periodId) : undefined,
            date,
            academicYearId: academicYearId ? parseInt(academicYearId) : undefined
        });

        res.status(201).json({
            success: true,
            message: 'Student attendance recorded successfully',
            data: attendanceRecord
        });
    } catch (error: any) {
        console.error('Error recording student attendance:', error);

        let statusCode = 500;
        if (error.message.includes('not have access')) {
            statusCode = 403;
        } else if (error.message.includes('not enrolled') || error.message.includes('not found')) {
            statusCode = 404;
        } else if (error.message.includes('already exists')) {
            statusCode = 409;
        } else if (error.message.includes('required')) {
            statusCode = 400;
        }

        res.status(statusCode).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * GET /teachers/attendance/statistics
 * Get attendance statistics for my classes
 */
export const getAttendanceStatistics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }

        // Extract filters
        const filters = {
            subClassId: req.query.subClassId ? parseInt(req.query.subClassId as string) : undefined,
            subjectId: req.query.subjectId ? parseInt(req.query.subjectId as string) : undefined,
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
            academicYearId: req.query.academicYearId ? parseInt(req.query.academicYearId as string) : undefined
        };

        const statistics = await teacherService.getAttendanceStatistics(teacherId, filters);

        res.json({
            success: true,
            data: statistics
        });
    } catch (error: any) {
        console.error('Error fetching attendance statistics:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * GET /attendance/subclass/:id
 * Get attendance records for a specific subclass (that I teach)
 */
export const getSubClassAttendance = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }

        const subClassId = parseInt(req.params.id);
        if (isNaN(subClassId)) {
            res.status(400).json({
                success: false,
                error: 'Invalid subclass ID'
            });
            return;
        }

        // Extract pagination and filters
        const allowedFilters = ['date', 'subjectId', 'academicYearId', 'subject_id', 'academic_year_id'];
        const { paginationOptions, filterOptions } = extractPaginationAndFilters(req.query, allowedFilters);

        // Normalize filter keys
        const filters = {
            date: filterOptions.date as string,
            subjectId: filterOptions.subjectId || filterOptions.subject_id,
            academicYearId: filterOptions.academicYearId || filterOptions.academic_year_id
        };

        // Parse filters
        const parsedFilters = {
            date: filters.date,
            subjectId: filters.subjectId ? parseInt(filters.subjectId as string) : undefined,
            academicYearId: filters.academicYearId ? parseInt(filters.academicYearId as string) : undefined
        };

        const result = await teacherService.getSubClassAttendance(teacherId, subClassId, parsedFilters, paginationOptions);

        res.json({
            success: true,
            data: result.data,
            meta: result.meta
        });
    } catch (error: any) {
        console.error('Error fetching subclass attendance:', error);

        let statusCode = 500;
        if (error.message.includes('not have access')) {
            statusCode = 403;
        }

        res.status(statusCode).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * GET /teachers/me/timetable/current-next
 * Get current and next subjects from timetable based on request time
 */
export const getMyCurrentAndNextSubjects = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }

        const academicYearId = req.query.academicYearId ? parseInt(req.query.academicYearId as string) : undefined;
        const result = await teacherService.getTeacherCurrentAndNextSubjects(teacherId, academicYearId);

        res.json({
            success: true,
            data: result
        });
    } catch (error: any) {
        console.error('Error fetching teacher current and next subjects:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getMyTimetable = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }
        const academicYearId = req.query.academicYearId ? parseInt(req.query.academicYearId as string) : undefined;
        const timetable = await teacherService.getTeacherTimetable(teacherId, academicYearId);
        res.json({ success: true, data: timetable });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /teachers/me/timetable/export/pdf
 * Download the authenticated teacher's weekly timetable as a PDF.
 */
export const exportMyTimetablePdf = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const teacherId = req.user?.id;
        if (!teacherId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }

        const academicYearId = req.query.academicYearId ? parseInt(req.query.academicYearId as string) : undefined;
        const { buffer, filename } = await timetableService.exportTeacherTimetablePdf(teacherId, academicYearId);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error: any) {
        console.error('Error exporting teacher timetable PDF:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

 