// src/api/v1/controllers/logbookController.ts
import { Request, Response } from 'express';
import * as logbookService from '../services/logbookService';
import prisma from '../../../config/db';

function statusFromError(err: any): number {
    if (err?.code === 'CONFLICT' || err?.code === 'P2002') return 409;
    if (err?.code === 'NOT_FOUND' || err?.code === 'P2025') return 404;
    if (err?.code === 'VALIDATION') return 400;
    if (typeof err?.message === 'string' && /not found/i.test(err.message)) return 404;
    return 500;
}

function fail(res: Response, err: any) {
    const code = statusFromError(err);
    if (code === 500) console.error('Logbook error:', err);
    res.status(code).json({ success: false, error: err.message ?? 'Server error' });
}

function userRoles(req: Request): string[] {
    return (req.user?.role as unknown as string[]) ?? [];
}

const REVIEWERS = ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_STUDIES', 'HOD'];
const PRIVILEGED_WRITERS = ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_STUDIES'];

function hasAny(roles: string[], allowed: string[]): boolean {
    return roles.some((r) => allowed.includes(r));
}

export const createEntry = async (req: Request, res: Response) => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const roles = userRoles(req);
        let taught_by_id = req.user.id;

        // A privileged writer (VP/Dean/Principal) may file an entry on behalf of
        // the timetabled teacher. Default behaviour: the logged-in user must be the teacher.
        if (req.body.taught_by_id && req.body.taught_by_id !== req.user.id) {
            if (!hasAny(roles, PRIVILEGED_WRITERS)) {
                return res
                    .status(403)
                    .json({ success: false, error: 'Only VP/Dean/Principal may log on behalf of a teacher.' });
            }
            taught_by_id = Number(req.body.taught_by_id);
        } else {
            // Verify req.user.id is actually the teacher of this period (unless privileged).
            const tp = await prisma.teacherPeriod.findUnique({
                where: { id: Number(req.body.teacher_period_id) },
                select: { teacher_id: true },
            });
            if (!tp) return res.status(404).json({ success: false, error: 'Teacher period not found' });
            if (tp.teacher_id !== req.user.id && !hasAny(roles, PRIVILEGED_WRITERS)) {
                return res.status(403).json({
                    success: false,
                    error: 'You are not the assigned teacher for this period.',
                });
            }
        }

        const entry = await logbookService.createEntry(req.body, taught_by_id);
        res.status(201).json({ success: true, data: entry });
    } catch (err: any) {
        fail(res, err);
    }
};

export const updateEntry = async (req: Request, res: Response) => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const id = Number(req.params.id);

        const existing = await prisma.logbookEntry.findUnique({
            where: { id },
            select: { taught_by_id: true },
        });
        if (!existing) return res.status(404).json({ success: false, error: 'Logbook entry not found' });

        const roles = userRoles(req);
        if (existing.taught_by_id !== req.user.id && !hasAny(roles, PRIVILEGED_WRITERS)) {
            return res
                .status(403)
                .json({ success: false, error: 'Only the author or a VP/Dean/Principal may edit this entry.' });
        }

        const entry = await logbookService.updateEntry(id, req.body);
        res.json({ success: true, data: entry });
    } catch (err: any) {
        fail(res, err);
    }
};

export const deleteEntry = async (req: Request, res: Response) => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const id = Number(req.params.id);

        const existing = await prisma.logbookEntry.findUnique({
            where: { id },
            select: { taught_by_id: true },
        });
        if (!existing) return res.status(404).json({ success: false, error: 'Logbook entry not found' });

        const roles = userRoles(req);
        if (existing.taught_by_id !== req.user.id && !hasAny(roles, PRIVILEGED_WRITERS)) {
            return res
                .status(403)
                .json({ success: false, error: 'Only the author or a VP/Dean/Principal may delete this entry.' });
        }
        await logbookService.deleteEntry(id);
        res.json({ success: true, message: 'Logbook entry deleted' });
    } catch (err: any) {
        fail(res, err);
    }
};

export const getEntryById = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const entry = await logbookService.getEntryById(id);
        if (!entry) return res.status(404).json({ success: false, error: 'Logbook entry not found' });
        res.json({ success: true, data: entry });
    } catch (err: any) {
        fail(res, err);
    }
};

// Reviewers who see the whole school. An HOD who holds none of these is
// scoped to their department (subjects where Subject.hod_id = them).
const SCHOOL_WIDE_REVIEWERS = ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_STUDIES'];

/**
 * Department scope for the caller, or undefined for "no restriction".
 * - HOD without a school-wide reviewer role: always their department.
 * - Anyone passing ?department=mine (the HOD menu's page does): their
 *   department, so a principal who is also HOD can review as HOD.
 */
async function departmentSubjectIds(req: Request, q: any): Promise<number[] | undefined> {
    const roles = userRoles(req);
    const wantsDept = String(q.department ?? '').toLowerCase() === 'mine';
    const forced = roles.includes('HOD') && !hasAny(roles, SCHOOL_WIDE_REVIEWERS);
    if (!wantsDept && !forced) return undefined;
    if (!req.user?.id) return [];
    const subjects = await prisma.subject.findMany({ where: { hod_id: req.user.id }, select: { id: true } });
    return subjects.map((s) => s.id);
}

export const listEntries = async (req: Request, res: Response) => {
    try {
        const q = (req as any).finalQuery ?? req.query;
        const roles = userRoles(req);

        // Non-reviewers can only see their own entries.
        let teacher_id = q.teacher_id ? Number(q.teacher_id) : undefined;
        if (!hasAny(roles, REVIEWERS)) {
            teacher_id = req.user?.id;
        }
        const subject_ids = hasAny(roles, REVIEWERS) ? await departmentSubjectIds(req, q) : undefined;

        const data = await logbookService.listEntries({
            teacher_id,
            subject_ids,
            sub_class_id: q.sub_class_id ? Number(q.sub_class_id) : undefined,
            class_id: q.class_id ? Number(q.class_id) : undefined,
            subject_id: q.subject_id ? Number(q.subject_id) : undefined,
            teacher_period_id: q.teacher_period_id ? Number(q.teacher_period_id) : undefined,
            lesson_id: q.lesson_id ? Number(q.lesson_id) : undefined,
            academic_year_id: q.academic_year_id ? Number(q.academic_year_id) : undefined,
            from: q.from,
            to: q.to,
            status: q.status,
            reviewed: q.reviewed !== undefined ? q.reviewed === 'true' || q.reviewed === true : undefined,
        });
        res.json({ success: true, data });
    } catch (err: any) {
        fail(res, err);
    }
};

/**
 * GET /logbook/filter-options[?department=mine&academicYearId=]
 * Teachers / classes / sub-classes / subjects for the Logbook Review filters,
 * department-scoped for HODs (same rule as GET /logbook).
 */
export const getReviewFilterOptions = async (req: Request, res: Response) => {
    try {
        const q = (req as any).finalQuery ?? req.query;
        const subject_ids = await departmentSubjectIds(req, q);
        const data = await logbookService.getReviewFilterOptions({
            academic_year_id: q.academic_year_id ? Number(q.academic_year_id) : undefined,
            subject_ids,
        });
        res.json({ success: true, data: { ...data, department_scoped: subject_ids !== undefined } });
    } catch (err: any) {
        fail(res, err);
    }
};

export const reviewEntry = async (req: Request, res: Response) => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const id = Number(req.params.id);
        // An HOD (without a school-wide reviewer role) may only review their own department.
        const deptSubjects = await departmentSubjectIds(req, {});
        if (deptSubjects) {
            const target = await prisma.logbookEntry.findUnique({
                where: { id },
                select: { teacher_period: { select: { subject_id: true } } },
            });
            if (!target) return res.status(404).json({ success: false, error: 'Logbook entry not found' });
            if (!deptSubjects.includes(target.teacher_period.subject_id)) {
                return res.status(403).json({ success: false, error: 'This entry is outside your department' });
            }
        }
        const entry = await logbookService.reviewEntry(id, req.user.id, req.body?.reviewer_notes);
        res.json({ success: true, data: entry });
    } catch (err: any) {
        fail(res, err);
    }
};

export const getSchemeCoverage = async (req: Request, res: Response) => {
    try {
        const subject_scheme_id = Number(req.params.schemeId);
        const data = await logbookService.getSchemeCoverage(subject_scheme_id);
        if (!data) return res.status(404).json({ success: false, error: 'Scheme not found' });
        res.json({ success: true, data });
    } catch (err: any) {
        fail(res, err);
    }
};
