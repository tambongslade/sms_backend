/**
 * Student absences for the Deans of Discipline, limited to each dean's sector
 * (the sub-classes assigned to them under "Assign classes to deans",
 * RoleAssignment role DEAN_OF_DISCIPLINE). Super Manager / Manager see every class.
 *
 *   GET  /dean-absences/sub-classes                       the caller's sector
 *   GET  /dean-absences/students?subClassId=&search=      students of the sector with absence counts
 *   GET  /dean-absences/student/:studentId                that student's absences this year
 *   POST /dean-absences/justify                           { absenceIds: number[], reason } -> justified
 *
 * Justifying reuses disciplineService.excuseAbsence, so warnings / summons that no longer
 * stand are withdrawn exactly as when a parent justifies.
 */
import { Router, Request, Response } from 'express';
import prisma from '../../../config/db';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { getCurrentAcademicYear } from '../../../utils/academicYear';
import { getDeanSubClassIds } from '../services/teacherPeriodAttendanceService';
import * as disciplineService from '../services/disciplineService';

const router = Router();
// The Discipline Coordinator oversees every sector.
const ROLES = ['DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR'];
const SEE_ALL = ['SUPER_MANAGER', 'MANAGER', 'DISCIPLINE_COORDINATOR'];

const fail = (res: Response, e: unknown, status = 500) =>
    res.status(status).json({ success: false, error: (e as Error)?.message || String(e) });
const field = (e: any, camel: string) => e?.[camel] ?? e?.[camel.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)];

const SLOT_LABEL: Record<string, string> = { SLOT_2: 'Morning roll call', SLOT_5: 'Midday roll call', SLOT_8: 'Afternoon roll call' };

/** Sub-class ids the caller may work on this year; null = every class. */
async function sectorOf(req: Request, yearId: number): Promise<number[] | null> {
    const user: any = (req as any).user;
    const roles: string[] = user?.role || [];
    if (roles.some(r => SEE_ALL.includes(r))) return null;
    return getDeanSubClassIds(user.id, yearId);
}

async function yearId(): Promise<number | null> {
    return (await getCurrentAcademicYear())?.id ?? null;
}

router.get('/sub-classes', authenticate, authorize(ROLES), async (req: Request, res: Response) => {
    try {
        const y = await yearId();
        if (!y) return res.json({ success: true, data: [] });
        const sector = await sectorOf(req, y);
        const subs = await prisma.subClass.findMany({
            where: sector ? { id: { in: sector } } : {},
            select: { id: true, name: true, class: { select: { id: true, name: true } } },
        });
        const data = subs
            .map(s => ({ id: s.id, name: s.name, classId: s.class.id, className: s.class.name }))
            .sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true }) || a.name.localeCompare(b.name, undefined, { numeric: true }));
        res.json({ success: true, data });
    } catch (e) {
        fail(res, e);
    }
});

router.get('/students', authenticate, authorize(ROLES), async (req: Request, res: Response) => {
    try {
        const y = await yearId();
        if (!y) return res.json({ success: true, data: [] });
        const sector = await sectorOf(req, y);
        const subClassId = Number(req.query.subClassId);
        if (Number.isInteger(subClassId) && subClassId > 0 && sector && !sector.includes(subClassId)) {
            return fail(res, new Error('This class is not in your sector'), 403);
        }
        const search = String(req.query.search || '').trim();
        const onlyWithAbsences = !(Number.isInteger(subClassId) && subClassId > 0) && search.length < 2;
        const enrollments = await prisma.enrollment.findMany({
            where: {
                academic_year_id: y,
                sub_class_id: Number.isInteger(subClassId) && subClassId > 0 ? subClassId : sector ? { in: sector } : { not: null },
                ...(search.length >= 2
                    ? { student: { OR: [{ name: { contains: search, mode: 'insensitive' } }, { matricule: { contains: search, mode: 'insensitive' } }] } }
                    : {}),
                // Landing list: only students who have absences waiting to be justified.
                ...(onlyWithAbsences ? { absences: { some: { is_excused: false } } } : {}),
            },
            select: {
                id: true,
                student: { select: { id: true, name: true, matricule: true } },
                sub_class: { select: { id: true, name: true, class: { select: { name: true } } } },
                absences: { select: { is_excused: true } },
            },
            take: 500,
        });
        const data = enrollments
            .map(e => ({
                studentId: e.student.id,
                name: e.student.name,
                matricule: e.student.matricule,
                subClassId: e.sub_class?.id ?? null,
                subClassName: e.sub_class?.name ?? '',
                className: e.sub_class?.class?.name ?? '',
                total: e.absences.length,
                unjustified: e.absences.filter(a => !a.is_excused).length,
            }))
            .sort((a, b) => (onlyWithAbsences ? b.unjustified - a.unjustified : 0) || a.name.localeCompare(b.name));
        res.json({ success: true, data });
    } catch (e) {
        fail(res, e);
    }
});

/** The student's enrollment this year, if it is in the caller's sector. */
async function sectorEnrollment(req: Request, studentId: number) {
    const y = await yearId();
    if (!y) return { error: 'No current academic year is set', status: 400 as const };
    const enrollment = await prisma.enrollment.findFirst({
        where: { student_id: studentId, academic_year_id: y },
        select: {
            id: true,
            sub_class_id: true,
            student: { select: { id: true, name: true, matricule: true } },
            sub_class: { select: { name: true, class: { select: { name: true } } } },
        },
    });
    if (!enrollment) return { error: 'Student not enrolled this year', status: 404 as const };
    const sector = await sectorOf(req, y);
    if (sector && (!enrollment.sub_class_id || !sector.includes(enrollment.sub_class_id))) {
        return { error: 'This student is not in your sector', status: 403 as const };
    }
    return { enrollment };
}

router.get('/student/:studentId', authenticate, authorize(ROLES), async (req: Request, res: Response) => {
    try {
        const studentId = Number(req.params.studentId);
        if (!Number.isInteger(studentId) || studentId <= 0) return fail(res, new Error('Invalid student'), 400);
        const r = await sectorEnrollment(req, studentId);
        if (!('enrollment' in r) || !r.enrollment) return fail(res, new Error(r.error), r.status);
        const absences = await prisma.studentAbsence.findMany({
            where: { enrollment_id: r.enrollment.id },
            include: {
                assigned_by: { select: { name: true } },
                excused_by: { select: { name: true } },
                teacher_period: { select: { subject: { select: { name: true } }, period: { select: { name: true, start_time: true, end_time: true } } } },
                dm_roll_call_entries: { take: 1, select: { dm_roll_call: { select: { date: true, slot: true } } } },
                teacher_roll_call_entries: { take: 1, select: { teacher_roll_call: { select: { date: true } } } },
            },
        });
        const rows = absences.map(a => {
            const dm = a.dm_roll_call_entries[0]?.dm_roll_call;
            const tr = a.teacher_roll_call_entries[0]?.teacher_roll_call;
            const date = (dm?.date ?? tr?.date ?? a.created_at).toISOString().slice(0, 10);
            const p = a.teacher_period?.period;
            return {
                id: a.id,
                date,
                type: a.absence_type,
                when: dm ? SLOT_LABEL[dm.slot] ?? dm.slot : p ? `${p.name} (${p.start_time}-${p.end_time})` : '',
                subject: a.teacher_period?.subject?.name ?? null,
                recordedBy: a.assigned_by?.name ?? null,
                justified: a.is_excused,
                justifiedAt: a.excused_at ? a.excused_at.toISOString() : null,
                justifiedBy: a.excused_by?.name ?? null,
                reason: a.excuse_reason,
            };
        }).sort((x, y) => y.date.localeCompare(x.date) || y.id - x.id);
        res.json({
            success: true,
            data: {
                student: {
                    id: r.enrollment.student.id,
                    name: r.enrollment.student.name,
                    matricule: r.enrollment.student.matricule,
                    className: r.enrollment.sub_class?.class?.name ?? '',
                    subClassName: r.enrollment.sub_class?.name ?? '',
                },
                total: rows.length,
                unjustified: rows.filter(x => !x.justified).length,
                absences: rows,
            },
        });
    } catch (e) {
        fail(res, e);
    }
});

router.post('/justify', authenticate, authorize(ROLES), async (req: Request, res: Response) => {
    try {
        const raw = field(req.body, 'absenceIds');
        const ids: number[] = Array.isArray(raw) ? Array.from(new Set<number>(raw.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))) : [];
        const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
        if (!ids.length) return fail(res, new Error('Choose at least one absence'), 400);
        if (!reason) return fail(res, new Error('Give the reason for the justification'), 400);
        const y = await yearId();
        if (!y) return fail(res, new Error('No current academic year is set'), 400);
        const sector = await sectorOf(req, y);
        const absences = await prisma.studentAbsence.findMany({
            where: { id: { in: ids } },
            select: { id: true, is_excused: true, enrollment: { select: { sub_class_id: true } } },
        });
        if (absences.length !== ids.length) return fail(res, new Error('Absence not found'), 404);
        if (sector && absences.some(a => !a.enrollment.sub_class_id || !sector.includes(a.enrollment.sub_class_id))) {
            return fail(res, new Error('This student is not in your sector'), 403);
        }
        const userId = (req as any).user.id;
        let justified = 0, alreadyJustified = 0, withdrawnWarnings = 0, cancelledSummons = 0;
        for (const a of absences) {
            if (a.is_excused) { alreadyJustified += 1; continue; }
            const r = await disciplineService.excuseAbsence(a.id, { excused_by_parent_id: userId, excuse_reason: reason, actor_user_id: userId });
            justified += 1;
            withdrawnWarnings += r.reverted_warnings;
            cancelledSummons += r.cancelled_summons;
        }
        res.json({ success: true, data: { justified, alreadyJustified, withdrawnWarnings, cancelledSummons } });
    } catch (e: any) {
        if (e?.message === 'ABSENCE_ALREADY_EXCUSED') return fail(res, new Error('Absence already justified'), 409);
        fail(res, e);
    }
});

export default router;
