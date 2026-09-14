// src/api/v1/controllers/disciplineController.ts
import { Request, Response } from 'express';
import prisma from '../../../config/db';
import * as disciplineService from '../services/disciplineService';
import { extractPaginationAndFilters } from '../../../utils/pagination';
import { MakeupStatus, SummonsStatus, WarningReason } from '@prisma/client';

export const getAllDisciplineIssues = async (req: Request, res: Response) => {
    try {
        // Define allowed filters for discipline issues - snake_case for service
        const allowedFilters = [
            'student_id',
            'class_id',
            'sub_class_id',
            'start_date',
            'end_date',
            'issue_type',
            'description',
            'include_assigned_by',
            'include_reviewed_by',
            'include_student'
        ];

        // Extract pagination and filter parameters from the request
        const { paginationOptions, filterOptions } = extractPaginationAndFilters(req.finalQuery, allowedFilters);

        // Get academic year from finalQuery if provided
        const academic_year_id = req.finalQuery.academic_year_id ?
            parseInt(req.finalQuery.academic_year_id as string) : undefined;

        const result = await disciplineService.getAllDisciplineIssues(
            paginationOptions,
            filterOptions,
            academic_year_id
        );

        res.json({
            success: true,
            data: result
        });
    } catch (error: any) {
        console.error('Error fetching discipline issues:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const recordStudentAttendance = async (req: Request, res: Response): Promise<any> => {
    try {
        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated or missing ID'
            });
        }

        // Use the body directly - middleware handles conversion
        const attendanceData = {
            ...req.body,
            assigned_by_id: req.user.id // Set assigned_by_id from authenticated user
        };

        const attendance = await disciplineService.recordStudentAttendance(attendanceData);

        res.status(201).json({
            success: true,
            message: 'Student attendance recorded successfully',
            data: attendance
        });
    } catch (error: any) {
        console.error('Error recording student attendance:', error);

        // Determine appropriate status code based on error message
        let statusCode = 500;
        if (error.message.includes('not enrolled')) {
            statusCode = 404;
        } else if (error.message.includes('already exists')) {
            statusCode = 409;
        } else if (error.message.includes('Invalid')) {
            statusCode = 400;
        }

        res.status(statusCode).json({
            success: false,
            error: error.message
        });
    }
};

export const recordTeacherAttendance = async (req: Request, res: Response): Promise<any> => {
    try {
        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated or missing ID'
            });
        }

        // Use the body directly - middleware handles conversion
        const attendanceData = {
            ...req.body,
            assigned_by_id: req.user.id // Set assigned_by_id from authenticated user
        };

        const attendance = await disciplineService.recordTeacherAttendance(attendanceData);

        res.status(201).json({
            success: true,
            message: 'Teacher attendance recorded successfully',
            data: attendance
        });
    } catch (error: any) {
        console.error('Error recording teacher attendance:', error);

        // Determine appropriate status code based on error message
        let statusCode = 500;
        if (error.message.includes('not found')) {
            statusCode = 404;
        } else if (error.message.includes('already exists')) {
            statusCode = 409;
        } else if (error.message.includes('Invalid')) {
            statusCode = 400;
        }

        res.status(statusCode).json({
            success: false,
            error: error.message
        });
    }
};

export const recordDisciplineIssue = async (req: Request, res: Response): Promise<any> => {
    try {
        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated or missing ID'
            });
        }

        // Use the body directly - middleware handles conversion
        const issueData = {
            ...req.body,
            assigned_by_id: req.user.id, // Set assigned_by_id from authenticated user
            reviewed_by_id: req.user.id  // Same user initially reviews the issue
        };

        const issue = await disciplineService.recordDisciplineIssue(issueData);

        res.status(201).json({
            success: true,
            message: 'Discipline issue recorded successfully',
            data: issue
        });
    } catch (error: any) {
        console.error('Error recording discipline issue:', error);

        // Determine appropriate status code based on error message
        let statusCode = 500;
        if (error.message.includes('not enrolled') || error.message.includes('not found')) {
            statusCode = 404;
        } else if (error.message.includes('already exists')) {
            statusCode = 409;
        } else if (error.message.includes('Invalid')) {
            statusCode = 400;
        }

        res.status(statusCode).json({
            success: false,
            error: error.message
        });
    }
};

export const updateDisciplineIssue = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const updated = await disciplineService.updateDisciplineIssue(id, req.body);
        return res.json({ success: true, data: updated });
    } catch (error: any) {
        const status = error.message.includes('not found') ? 404 : 400;
        console.error('Error updating discipline issue:', error);
        return res.status(status).json({ success: false, error: error.message });
    }
};

export const getDisciplineHistory = async (req: Request, res: Response): Promise<void> => {
    try {
        const studentId = parseInt(req.params.studentId);
        if (isNaN(studentId)) {
            res.status(400).json({
                success: false,
                error: 'Invalid student ID'
            });
            return;
        }

        const history = await disciplineService.getDisciplineHistory(studentId);

        res.json({
            success: true,
            data: history
        });
    } catch (error: any) {
        console.error('Error fetching discipline history:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Record morning lateness for a single student (SDM)
 */
export const recordMorningLateness = async (req: Request, res: Response): Promise<any> => {
    try {
        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated or missing ID'
            });
        }

        const latenessData = {
            ...req.body,
            assigned_by_id: req.user.id
        };

        const lateness = await disciplineService.recordMorningLateness(latenessData);

        res.status(201).json({
            success: true,
            message: 'Morning lateness recorded successfully',
            data: lateness
        });
    } catch (error: any) {
        console.error('Error recording morning lateness:', error);

        let statusCode = 500;
        if (error.message.includes('not enrolled')) {
            statusCode = 404;
        } else if (error.message.includes('already recorded')) {
            statusCode = 409;
        } else if (error.message.includes('No academic year')) {
            statusCode = 400;
        }

        res.status(statusCode).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Record bulk morning lateness for multiple students (SDM daily use)
 */
export const recordBulkMorningLateness = async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated or missing ID'
            });
        }

        const bulkData = req.body;
        const results = await disciplineService.recordBulkMorningLateness(bulkData, req.user.id);

        res.status(201).json({
            success: true,
            message: `Processed ${results.success.length + results.errors.length} records`,
            data: {
                successful_records: results.success.length,
                failed_records: results.errors.length,
                successes: results.success,
                errors: results.errors
            }
        });
    } catch (error: any) {
        console.error('Error recording bulk morning lateness:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Get lateness statistics for SDM dashboard
 */
export const getLatenessStatistics = async (req: Request, res: Response): Promise<any> => {
    try {
        const academicYearId = req.finalQuery.academic_year_id ? parseInt(req.finalQuery.academic_year_id as string) : undefined;

        const statistics = await disciplineService.getLatenessStatistics(academicYearId);

        res.json({
            success: true,
            data: statistics
        });
    } catch (error: any) {
        console.error('Error fetching lateness statistics:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Get daily lateness report for SDM
 */
export const getDailyLatenessReport = async (req: Request, res: Response): Promise<any> => {
    try {
        const date = req.query.date as string;
        const academicYearId = req.finalQuery.academic_year_id ? parseInt(req.finalQuery.academic_year_id as string) : undefined;

        const report = await disciplineService.getDailyLatenessReport(date, academicYearId);

        res.json({
            success: true,
            data: {
                date: date || new Date().toISOString().split('T')[0],
                total_late_students: report.length,
                records: report
            }
        });
    } catch (error: any) {
        console.error('Error fetching daily lateness report:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * List pending 3-strike lateness alerts (current term).
 */
export const getLatenessAlerts = async (req: Request, res: Response): Promise<any> => {
    try {
        const academicYearId = req.finalQuery.academic_year_id ? parseInt(req.finalQuery.academic_year_id as string) : undefined;
        const alerts = await disciplineService.getLatenessAlerts(academicYearId);
        return res.json({ success: true, data: alerts });
    } catch (error: any) {
        console.error('Error fetching lateness alerts:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Roster + day's TeacherPeriods for the bulk-absence form.
 */
export const getAbsenceFormData = async (req: Request, res: Response): Promise<any> => {
    try {
        const subClassId = parseInt(req.finalQuery.sub_class_id as string);
        const date = req.finalQuery.date as string;
        if (isNaN(subClassId)) return res.status(400).json({ success: false, error: 'sub_class_id is required' });
        if (!date) return res.status(400).json({ success: false, error: 'date is required (YYYY-MM-DD)' });
        const academicYearId = req.finalQuery.academic_year_id ? parseInt(req.finalQuery.academic_year_id as string) : undefined;
        const data = await disciplineService.getAbsenceFormData(subClassId, date, academicYearId);
        return res.json({ success: true, data });
    } catch (error: any) {
        const status = error.message.includes('not found') ? 404 : 400;
        console.error('Error fetching absence form data:', error);
        return res.status(status).json({ success: false, error: error.message });
    }
};

/**
 * Bulk-mark absences for a subclass on a given date.
 */
export const bulkRecordAbsences = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const result = await disciplineService.bulkRecordAbsences({
            date: req.body.date,
            sub_class_id: req.body.sub_class_id ?? req.body.subClassId,
            academic_year_id: req.body.academic_year_id ?? req.body.academicYearId,
            absences: req.body.absences ?? [],
            assigned_by_id: req.user.id,
        });
        return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error bulk recording absences:', error);
        return res.status(400).json({ success: false, error: error.message });
    }
};

export const updateStudentAbsence = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const updated = await disciplineService.updateStudentAbsence(id, req.body);
        return res.json({ success: true, data: updated });
    } catch (error: any) {
        const status = error.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, error: error.message });
    }
};

export const deleteStudentAbsence = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        await disciplineService.deleteStudentAbsence(id);
        return res.json({ success: true });
    } catch (error: any) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

// =====================================================================
// Unified roll call
// =====================================================================

const ALLOWED_DAILY_STATUSES = new Set(['PRESENT', 'LATE', 'ABSENT']);
const ALLOWED_PERIOD_STATUSES = new Set(['PRESENT', 'ABSENT']);
const ADMIN_DAILY_ROLES = new Set(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER']);

export const getRollCall = async (req: any, res: Response): Promise<any> => {
    try {
        const q = req.finalQuery ?? req.query;
        const subClassId = parseInt((q.sub_class_id ?? q.subClassId) as string);
        const date = (q.date ?? new Date().toISOString().slice(0, 10)) as string;
        if (isNaN(subClassId)) return res.status(400).json({ success: false, error: 'subClassId is required' });
        const academicYearIdRaw = q.academic_year_id ?? q.academicYearId;
        const academicYearId = academicYearIdRaw ? parseInt(academicYearIdRaw as string) : undefined;

        const data = await disciplineService.getDailyRollCall(subClassId, date, academicYearId);
        return res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error fetching roll call:', error);
        const status = error.message?.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, error: error.message });
    }
};

export const recordRollCall = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const body = req.body ?? {};
        const subClassId = parseInt((body.sub_class_id ?? body.subClassId) as string);
        const date = body.date as string;
        const entries = Array.isArray(body.entries) ? body.entries : [];
        if (isNaN(subClassId)) return res.status(400).json({ success: false, error: 'subClassId is required' });
        if (!date) return res.status(400).json({ success: false, error: 'date is required (YYYY-MM-DD)' });
        if (entries.length === 0) return res.status(400).json({ success: false, error: 'entries must be a non-empty array' });

        const normalized: Array<{ enrollment_id: number; status: 'PRESENT' | 'LATE' | 'ABSENT' }> = [];
        for (const raw of entries) {
            const enrollmentId = parseInt((raw.enrollment_id ?? raw.enrollmentId) as string);
            const status = String(raw.status ?? '').toUpperCase();
            if (isNaN(enrollmentId)) return res.status(400).json({ success: false, error: 'Each entry needs a valid enrollmentId' });
            if (!ALLOWED_DAILY_STATUSES.has(status)) return res.status(400).json({ success: false, error: `Invalid status "${raw.status}" — must be PRESENT, LATE, or ABSENT` });
            normalized.push({ enrollment_id: enrollmentId, status: status as any });
        }

        const academicYearIdRaw = body.academic_year_id ?? body.academicYearId;
        const academicYearId = academicYearIdRaw ? parseInt(academicYearIdRaw as string) : undefined;

        const result = await disciplineService.recordDailyRollCall({
            sub_class_id: subClassId,
            date,
            entries: normalized,
            assigned_by_id: req.user.id,
            academic_year_id: academicYearId,
        });
        return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error recording roll call:', error);
        return res.status(400).json({ success: false, error: error.message });
    }
};

export const getPeriodRollCall = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid teacher period ID' });
        const data = await disciplineService.getPeriodRollCall(id);
        return res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error fetching period roll call:', error);
        const status = error.message?.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, error: error.message });
    }
};

export const recordPeriodRollCall = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid teacher period ID' });

        const body = req.body ?? {};
        const entries = Array.isArray(body.entries) ? body.entries : [];
        if (entries.length === 0) return res.status(400).json({ success: false, error: 'entries must be a non-empty array' });

        const normalized: Array<{ enrollment_id: number; status: 'PRESENT' | 'ABSENT' }> = [];
        for (const raw of entries) {
            const enrollmentId = parseInt((raw.enrollment_id ?? raw.enrollmentId) as string);
            const status = String(raw.status ?? '').toUpperCase();
            if (isNaN(enrollmentId)) return res.status(400).json({ success: false, error: 'Each entry needs a valid enrollmentId' });
            if (!ALLOWED_PERIOD_STATUSES.has(status)) return res.status(400).json({ success: false, error: `Invalid status "${raw.status}" — must be PRESENT or ABSENT` });
            normalized.push({ enrollment_id: enrollmentId, status: status as any });
        }

        const callerRoles: string[] = req.user.roles ?? [];
        const callerIsAdmin = callerRoles.some((r) => ADMIN_DAILY_ROLES.has(r));

        const result = await disciplineService.recordPeriodRollCall({
            teacher_period_id: id,
            entries: normalized,
            assigned_by_id: req.user.id,
            caller_user_id: req.user.id,
            caller_is_admin: callerIsAdmin,
        });
        return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        if (error.message === 'FORBIDDEN_NOT_PERIOD_OWNER') {
            return res.status(403).json({ success: false, error: 'You are not the teacher assigned to this period' });
        }
        console.error('Error recording period roll call:', error);
        const status = error.message?.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, error: error.message });
    }
};

// =====================================================================
// Absence excuse / makeup / warnings / summons
// =====================================================================

async function ensureParentCanExcuse(actorUserId: number, actorRoles: string[], absenceId: number): Promise<boolean> {
    const ADMIN_BYPASS = new Set(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER', 'DEAN_OF_DISCIPLINE']);
    if (actorRoles.some((r) => ADMIN_BYPASS.has(r))) return true;
    if (!actorRoles.includes('PARENT')) return false;
    const absence = await prisma.studentAbsence.findUnique({
        where: { id: absenceId },
        select: { enrollment: { select: { student_id: true } } },
    });
    if (!absence) return false;
    const link = await prisma.parentStudent.findFirst({
        where: { parent_id: actorUserId, student_id: absence.enrollment.student_id },
        select: { id: true },
    });
    return !!link;
}

// POST /discipline/absences/:id/excuse - Mark an absence as parent-justified
export const excuseAbsence = async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid absence ID' });

        const actorRoles: string[] = ((req.user as any).roles ?? (req.user.role as any)) || [];
        const allowed = await ensureParentCanExcuse(req.user.id, actorRoles, id);
        if (!allowed) {
            return res.status(403).json({ success: false, error: 'You are not authorized to excuse this absence' });
        }

        const excusedByParentId = req.body.excused_by_parent_id ?? req.user.id;
        const excuseReason = req.body.excuse_reason;

        const result = await disciplineService.excuseAbsence(id, {
            excused_by_parent_id: excusedByParentId,
            excuse_reason: excuseReason,
            actor_user_id: req.user.id,
        });
        return res.json({ success: true, data: result });
    } catch (error: any) {
        if (error.message === 'ABSENCE_NOT_FOUND') return res.status(404).json({ success: false, error: 'Absence not found' });
        if (error.message === 'ABSENCE_ALREADY_EXCUSED') return res.status(409).json({ success: false, error: 'Absence already excused' });
        console.error('Error excusing absence:', error);
        return res.status(400).json({ success: false, error: error.message });
    }
};

// POST /discipline/absences/:id/makeup - Record student makeup for the absence
export const markAbsenceMakeup = async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid absence ID' });

        const status = String(req.body.status || '').toUpperCase();
        if (!Object.values(MakeupStatus).includes(status as MakeupStatus)) {
            return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${Object.values(MakeupStatus).join(', ')}` });
        }

        const result = await disciplineService.markAbsenceMakeup(id, {
            status: status as MakeupStatus,
            makeup_notes: req.body.makeup_notes,
            actor_user_id: req.user.id,
        });
        return res.json({ success: true, data: result });
    } catch (error: any) {
        if (error.message === 'ABSENCE_NOT_FOUND') return res.status(404).json({ success: false, error: 'Absence not found' });
        console.error('Error marking makeup:', error);
        return res.status(400).json({ success: false, error: error.message });
    }
};

// GET /discipline/warnings
export const listWarnings = async (req: Request, res: Response): Promise<any> => {
    try {
        const q = req.finalQuery as any;
        const data = await disciplineService.listStudentWarnings({
            enrollment_id: q.enrollment_id ? parseInt(q.enrollment_id) : undefined,
            student_id: q.student_id ? parseInt(q.student_id) : undefined,
            sub_class_id: q.sub_class_id ? parseInt(q.sub_class_id) : undefined,
            resolved: q.resolved === undefined ? undefined : q.resolved === 'true',
            academic_year_id: q.academic_year_id ? parseInt(q.academic_year_id) : undefined,
        });
        return res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error listing warnings:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

// POST /discipline/warnings - Manually issue a warning
export const createWarning = async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });
        const reason = String(req.body.reason || '').toUpperCase();
        if (!Object.values(WarningReason).includes(reason as WarningReason)) {
            return res.status(400).json({ success: false, error: `Invalid reason. Must be one of: ${Object.values(WarningReason).join(', ')}` });
        }
        const data = await disciplineService.createStudentWarning({
            enrollment_id: parseInt(req.body.enrollment_id),
            warning_level: req.body.warning_level ? parseInt(req.body.warning_level) : undefined,
            reason: reason as WarningReason,
            description: req.body.description,
            issued_by_id: req.user.id,
        });
        return res.status(201).json({ success: true, data });
    } catch (error: any) {
        if (error.message === 'ENROLLMENT_NOT_FOUND') return res.status(404).json({ success: false, error: 'Enrollment not found' });
        return res.status(400).json({ success: false, error: error.message });
    }
};

// PATCH /discipline/warnings/:id/resolve
export const resolveWarning = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid warning ID' });
        const data = await disciplineService.resolveStudentWarning(id, { resolved_notes: req.body.resolved_notes });
        return res.json({ success: true, data });
    } catch (error: any) {
        if (error.message === 'WARNING_NOT_FOUND') return res.status(404).json({ success: false, error: 'Warning not found' });
        return res.status(400).json({ success: false, error: error.message });
    }
};

// GET /discipline/summons
export const listSummons = async (req: Request, res: Response): Promise<any> => {
    try {
        const q = req.finalQuery as any;
        const statusRaw = q.status ? String(q.status).toUpperCase() : undefined;
        if (statusRaw && !Object.values(SummonsStatus).includes(statusRaw as SummonsStatus)) {
            return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${Object.values(SummonsStatus).join(', ')}` });
        }
        const data = await disciplineService.listParentSummons({
            enrollment_id: q.enrollment_id ? parseInt(q.enrollment_id) : undefined,
            student_id: q.student_id ? parseInt(q.student_id) : undefined,
            sub_class_id: q.sub_class_id ? parseInt(q.sub_class_id) : undefined,
            status: statusRaw as SummonsStatus | undefined,
            academic_year_id: q.academic_year_id ? parseInt(q.academic_year_id) : undefined,
        });
        return res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error listing summons:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

// POST /discipline/summons - Manually create a summons
export const createSummons = async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });
        const data = await disciplineService.createParentSummons({
            enrollment_id: parseInt(req.body.enrollment_id),
            parent_id: req.body.parent_id ? parseInt(req.body.parent_id) : undefined,
            reason: req.body.reason,
            scheduled_date: req.body.scheduled_date,
            created_by_id: req.user.id,
        });
        return res.status(201).json({ success: true, data });
    } catch (error: any) {
        if (error.message === 'ENROLLMENT_NOT_FOUND') return res.status(404).json({ success: false, error: 'Enrollment not found' });
        return res.status(400).json({ success: false, error: error.message });
    }
};

// PUT /discipline/summons/:id - Update a summons (schedule, notes, status)
export const updateSummons = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid summons ID' });
        const statusRaw = req.body.status ? String(req.body.status).toUpperCase() : undefined;
        if (statusRaw && !Object.values(SummonsStatus).includes(statusRaw as SummonsStatus)) {
            return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${Object.values(SummonsStatus).join(', ')}` });
        }
        const data = await disciplineService.updateParentSummons(id, {
            status: statusRaw as SummonsStatus | undefined,
            scheduled_date: req.body.scheduled_date,
            meeting_notes: req.body.meeting_notes,
            attended: req.body.attended,
            parent_id: req.body.parent_id,
        });
        return res.json({ success: true, data });
    } catch (error: any) {
        if (error.message === 'SUMMONS_NOT_FOUND') return res.status(404).json({ success: false, error: 'Summons not found' });
        return res.status(400).json({ success: false, error: error.message });
    }
};

/**
 * Daily overview for the Dean of Discipline dashboard. Returns
 *   - lateTodayCount        (StudentAbsence rows of type MORNING_LATENESS created today)
 *   - dailyAbsencesCount    (StudentAbsence rows of type CLASS_ABSENCE created today)
 *   - disciplinaryActionsTodayCount
 *   - personsOfInterest[]   (top N enrollments with >= threshold absences this academic year)
 *
 * Query params:
 *   - academic_year_id (optional, defaults to current)
 *   - date (YYYY-MM-DD, optional, defaults to today)
 *   - poi_threshold (integer, default 5)
 *   - poi_limit     (integer, default 10)
 */
export const getDailyOverview = async (req: any, res: Response): Promise<any> => {
    try {
        const overview = await disciplineService.getDailyOverview({
            academic_year_id: req.finalQuery.academic_year_id ? Number(req.finalQuery.academic_year_id) : undefined,
            date: req.query.date as string | undefined,
            from: req.query.from as string | undefined,
            to: req.query.to as string | undefined,
            poi_threshold: req.query.poi_threshold ? Number(req.query.poi_threshold) : undefined,
            poi_limit: req.query.poi_limit ? Number(req.query.poi_limit) : undefined,
        });
        return res.json({ success: true, data: overview });
    } catch (err: any) {
        console.error('Error getting daily overview:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};
