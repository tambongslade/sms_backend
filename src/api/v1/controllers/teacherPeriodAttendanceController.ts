// src/api/v1/controllers/teacherPeriodAttendanceController.ts
//
// DM-facing endpoints for marking teacher presence + evaluation checkboxes
// during each timetable period.

import { Request, Response } from 'express';
import { TeacherPeriodAttendanceStatus } from '@prisma/client';
import * as svc from '../services/teacherPeriodAttendanceService';

const VALID_STATUSES = new Set<string>(Object.values(TeacherPeriodAttendanceStatus));

function toBool(v: any): boolean | undefined {
    if (v === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
        const s = v.toLowerCase();
        if (s === 'true' || s === '1' || s === 'yes') return true;
        if (s === 'false' || s === '0' || s === 'no') return false;
    }
    if (typeof v === 'number') return v !== 0;
    return Boolean(v);
}

function parseDate(input: any): Date | null {
    if (!input) return null;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
}

async function getRestriction(req: Request, academicYearId?: number): Promise<number[] | null> {
    const user = req.user!;
    const roles: string[] = (user.role as any) || [];
    return svc.getDmSubClassRestriction(user.id, roles, academicYearId);
}

// GET /discipline-master/teacher-attendance?date=YYYY-MM-DD[&subClassId=][&academicYearId=]
export const listDay = async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });

        const q = (req.finalQuery ?? req.query) as any;
        const date = parseDate(q.date);
        if (!date) return res.status(400).json({ success: false, error: 'Valid date is required (YYYY-MM-DD)' });

        const subClassId = q.sub_class_id ? parseInt(q.sub_class_id, 10) : undefined;
        const academicYearId = q.academic_year_id ? parseInt(q.academic_year_id, 10) : undefined;

        const restriction = await getRestriction(req, academicYearId);

        const data = await svc.listDayAttendance({
            date,
            academic_year_id: academicYearId,
            sub_class_id: Number.isFinite(subClassId as number) ? (subClassId as number) : undefined,
            restrict_to_sub_class_ids: restriction ?? undefined,
        });

        return res.json({ success: true, data });
    } catch (err: any) {
        console.error('Error listing teacher-period attendance day:', err);
        const status = /Access denied/i.test(err.message) ? 403 : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

// GET /discipline-master/teacher-attendance/:id
export const getById = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const record = await svc.getById(id);
        if (!record) return res.status(404).json({ success: false, error: 'TeacherPeriodAttendance not found' });
        return res.json({ success: true, data: record });
    } catch (err: any) {
        console.error('Error fetching teacher-period attendance:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

// POST /discipline-master/teacher-attendance
// Body: { date, entries: [{ teacherPeriodId, status, wellDressed, classManagement, punctuality, assiduity, reason?, notes? }], academicYearId? }
export const upsert = async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });

        const date = parseDate(req.body.date);
        if (!date) return res.status(400).json({ success: false, error: 'Valid date is required' });

        const rawEntries: any[] = Array.isArray(req.body.entries) ? req.body.entries : [];
        if (rawEntries.length === 0) {
            return res.status(400).json({ success: false, error: 'entries must be a non-empty array' });
        }

        const entries: svc.AttendanceEntryInput[] = [];
        for (const raw of rawEntries) {
            const tpId = parseInt(raw.teacher_period_id ?? raw.teacherPeriodId, 10);
            if (Number.isNaN(tpId)) {
                return res.status(400).json({ success: false, error: 'Each entry requires a valid teacher_period_id' });
            }
            const st = String(raw.status || '').toUpperCase();
            if (!VALID_STATUSES.has(st)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid status "${raw.status}". Must be one of: ${Array.from(VALID_STATUSES).join(', ')}`,
                });
            }
            entries.push({
                teacher_period_id: tpId,
                status: st as TeacherPeriodAttendanceStatus,
                well_dressed: toBool(raw.well_dressed ?? raw.wellDressed),
                class_management: toBool(raw.class_management ?? raw.classManagement),
                punctuality: toBool(raw.punctuality),
                assiduity: toBool(raw.assiduity),
                reason: raw.reason,
                notes: raw.notes,
            });
        }

        const academicYearId = req.body.academic_year_id ? parseInt(req.body.academic_year_id, 10) : undefined;
        const restriction = await getRestriction(req, academicYearId);

        const data = await svc.upsertAttendance({
            date,
            entries,
            recorded_by_id: req.user.id,
            academic_year_id: academicYearId,
            restrict_to_sub_class_ids: restriction ?? undefined,
        });

        return res.status(200).json({ success: true, data });
    } catch (err: any) {
        console.error('Error recording teacher-period attendance:', err);
        const status = /Access denied/i.test(err.message)
            ? 403
            : /not found/i.test(err.message)
                ? 404
                : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

// PUT /discipline-master/teacher-attendance/:id
export const update = async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

        const body = req.body;
        let statusVal: TeacherPeriodAttendanceStatus | undefined;
        if (body.status !== undefined) {
            const st = String(body.status).toUpperCase();
            if (!VALID_STATUSES.has(st)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid status. Must be one of: ${Array.from(VALID_STATUSES).join(', ')}`,
                });
            }
            statusVal = st as TeacherPeriodAttendanceStatus;
        }

        const restriction = await getRestriction(req);

        const data = await svc.updateAttendance(
            id,
            {
                status: statusVal,
                well_dressed: toBool(body.well_dressed ?? body.wellDressed),
                class_management: toBool(body.class_management ?? body.classManagement),
                punctuality: toBool(body.punctuality),
                assiduity: toBool(body.assiduity),
                reason: body.reason === undefined ? undefined : body.reason,
                notes: body.notes === undefined ? undefined : body.notes,
            },
            { restrict_to_sub_class_ids: restriction ?? undefined }
        );

        return res.json({ success: true, data });
    } catch (err: any) {
        console.error('Error updating teacher-period attendance:', err);
        const status = /Access denied/i.test(err.message)
            ? 403
            : /not found/i.test(err.message)
                ? 404
                : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

// DELETE /discipline-master/teacher-attendance/:id
export const remove = async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

        const restriction = await getRestriction(req);
        await svc.deleteAttendance(id, { restrict_to_sub_class_ids: restriction ?? undefined });
        return res.json({ success: true });
    } catch (err: any) {
        console.error('Error deleting teacher-period attendance:', err);
        const status = /Access denied/i.test(err.message)
            ? 403
            : /not found/i.test(err.message)
                ? 404
                : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

// GET /discipline-master/teacher-attendance/overview?weekStart=YYYY-MM-DD[&academicYearId=]
// Read-only weekly grid (teachers x days) built from what the DMs have recorded.
export const weekOverview = async (req: Request, res: Response): Promise<any> => {
    try {
        if (!req.user) return res.status(401).json({ success: false, error: 'Unauthenticated' });

        const q = (req.finalQuery ?? req.query) as any;
        const weekStart = parseDate(q.week_start ?? q.weekStart) ?? new Date();
        const academicYearId = q.academic_year_id ? parseInt(q.academic_year_id, 10) : undefined;

        const data = await svc.getWeekOverview({
            week_start: weekStart,
            academic_year_id: Number.isFinite(academicYearId as number) ? (academicYearId as number) : undefined,
        });
        return res.json({ success: true, data });
    } catch (err: any) {
        console.error('Error building teacher-attendance week overview:', err);
        return res.status(400).json({ success: false, error: err.message });
    }
};
