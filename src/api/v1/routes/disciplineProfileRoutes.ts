/**
 * Student Discipline Profiles (discipline staff and management).
 *
 *   GET /discipline-profiles/recent                 students with the most recent disciplinary actions
 *   GET /discipline-profiles/sub-class/:id          students of one sub-class with their discipline counts
 *   GET /discipline-profiles/student/:id/fees       outstanding fees for the current installment
 *
 * All take ?academicYearId= (default: the current year).
 */
import { Router, Request, Response } from 'express';
import prisma from '../../../config/db';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { getCurrentAcademicYear } from '../../../utils/academicYear';
import { ACTIVE_FEE_ROW_WHERE } from '../services/feeOutstandingService';
import { currentInstallment, installmentCount, splitInstallments } from '../../../utils/installments';

const router = Router();

// Same audience as the disciplinary actions list.
const VIEWERS = [
    'SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR',
    'DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER', 'CONTROLLER',
];
const guard = [authenticate, authorize(VIEWERS)];

const yearIdFrom = async (req: Request): Promise<number | null> => {
    const q = Number(req.query.academicYearId);
    if (Number.isInteger(q) && q > 0) return q;
    return (await getCurrentAcademicYear())?.id ?? null;
};

const fail = (res: Response, error: unknown) =>
    res.status(500).json({ success: false, error: (error as Error)?.message || 'Something went wrong' });

const studentRow = (e: any) => ({
    id: e.student.id,
    name: e.student.name,
    matricule: e.student.matricule,
    photo: e.photo || null,
    className: e.sub_class?.class?.name || e.class?.name || null,
    subClassId: e.sub_class?.id ?? null,
    subClassName: e.sub_class?.name || null,
});

const enrollmentSelect = {
    id: true,
    photo: true,
    student: { select: { id: true, name: true, matricule: true } },
    class: { select: { name: true } },
    sub_class: { select: { id: true, name: true, class: { select: { name: true } } } },
} as const;

// GET /recent?limit=50 - students whose disciplinary actions are the most recent, newest first
router.get('/recent', ...guard, async (req: Request, res: Response) => {
    try {
        const yearId = await yearIdFrom(req);
        if (!yearId) return res.status(400).json({ success: false, error: 'No academic year' });
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

        const actions = await prisma.disciplinaryAction.findMany({
            where: { enrollment: { academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' } } } },
            orderBy: { created_at: 'desc' },
            take: limit * 5,
            select: {
                id: true,
                action_type: true,
                status: true,
                days: true,
                start_date: true,
                end_date: true,
                reason: true,
                created_at: true,
                enrollment: { select: enrollmentSelect },
            },
        });

        const byStudent = new Map<number, any>();
        for (const a of actions) {
            const sid = a.enrollment.student.id;
            const row = byStudent.get(sid);
            if (row) {
                row.actionCount++;
                continue;
            }
            if (byStudent.size >= limit) continue;
            byStudent.set(sid, {
                ...studentRow(a.enrollment),
                actionCount: 1,
                latestAction: {
                    id: a.id,
                    actionType: a.action_type,
                    status: a.status,
                    days: a.days,
                    startDate: a.start_date,
                    endDate: a.end_date,
                    reason: a.reason,
                    createdAt: a.created_at,
                },
            });
        }
        res.json({ success: true, data: [...byStudent.values()] });
    } catch (error) {
        fail(res, error);
    }
});

// GET /sub-class/:id - the sub-class's students with their discipline counts for the year
router.get('/sub-class/:id', ...guard, async (req: Request, res: Response) => {
    try {
        const subClassId = Number(req.params.id);
        if (!Number.isInteger(subClassId) || subClassId <= 0) return res.status(400).json({ success: false, error: 'Invalid sub-class' });
        const yearId = await yearIdFrom(req);
        if (!yearId) return res.status(400).json({ success: false, error: 'No academic year' });

        const enrollments = await prisma.enrollment.findMany({
            where: { academic_year_id: yearId, sub_class_id: subClassId, student: { status: { not: 'WITHDRAWN' } } },
            select: {
                ...enrollmentSelect,
                _count: {
                    select: {
                        discipline_issues: true,
                        disciplinary_actions: { where: { status: { not: 'CANCELLED' } } },
                        student_warnings: { where: { resolved: false } },
                        parent_summons: { where: { status: { in: ['PENDING', 'SCHEDULED'] } } },
                    },
                },
                disciplinary_actions: { orderBy: { created_at: 'desc' }, take: 1, select: { created_at: true } },
            },
            orderBy: { student: { name: 'asc' } },
        });

        res.json({
            success: true,
            data: enrollments.map((e) => ({
                ...studentRow(e),
                issues: e._count.discipline_issues,
                actions: e._count.disciplinary_actions,
                openWarnings: e._count.student_warnings,
                pendingSummons: e._count.parent_summons,
                lastActionAt: e.disciplinary_actions[0]?.created_at ?? null,
            })),
        });
    } catch (error) {
        fail(res, error);
    }
});

// GET /student/:id/fees - what is still owed on the installment that applies today
router.get('/student/:id/fees', ...guard, async (req: Request, res: Response) => {
    try {
        const studentId = Number(req.params.id);
        if (!Number.isInteger(studentId) || studentId <= 0) return res.status(400).json({ success: false, error: 'Invalid student' });
        const yearId = await yearIdFrom(req);
        if (!yearId) return res.status(400).json({ success: false, error: 'No academic year' });

        const enrollment = await prisma.enrollment.findFirst({
            where: { student_id: studentId, academic_year_id: yearId },
            select: {
                id: true,
                class: {
                    select: {
                        name: true, first_term_fee: true, second_term_fee: true, third_term_fee: true,
                        new_student_fee: true, old_student_fee: true, miscellaneous_fee: true,
                    },
                },
                sub_class: { select: { class: { select: { name: true } } } },
            },
        });
        if (!enrollment) return res.json({ success: true, data: null });

        const [rows, terms] = await Promise.all([
            prisma.schoolFees.findMany({
                where: { AND: [{ enrollment_id: enrollment.id, academic_year_id: yearId }, ACTIVE_FEE_ROW_WHERE] },
                select: { amount_expected: true, amount_paid: true, is_new_student: true },
            }),
            prisma.term.findMany({
                where: { academic_year_id: yearId, is_holiday: false },
                orderBy: [{ start_date: 'asc' }, { id: 'asc' }],
                select: { fee_deadline: true },
            }),
        ]);
        if (rows.length === 0) return res.json({ success: true, data: null });

        const totalExpected = rows.reduce((s, r) => s + (r.amount_expected || 0), 0);
        const totalPaid = rows.reduce((s, r) => s + (r.amount_paid || 0), 0);
        const c = enrollment.class;
        const className = enrollment.sub_class?.class?.name || c?.name || '';
        const count = installmentCount(className);
        const split = splitInstallments(
            {
                registration: (rows[0].is_new_student ? c?.new_student_fee || 0 : c?.old_student_fee || 0) + (c?.miscellaneous_fee || 0),
                first: c?.first_term_fee || 0,
                second: c?.second_term_fee || 0,
                third: c?.third_term_fee || 0,
            },
            totalExpected,
            totalPaid,
            count,
        );
        const current = currentInstallment(terms.map((t) => t.fee_deadline), count);

        res.json({
            success: true,
            data: {
                installmentsCount: count,
                totalExpected,
                totalPaid,
                totalOutstanding: Math.max(totalExpected - totalPaid, 0),
                current: current && {
                    number: current.number,
                    dueDate: current.dueDate,
                    passed: current.passed,
                    dueByThen: split[current.key].cumulativeExpected,
                    outstanding: split[current.key].cumulativeOutstanding,
                },
                next: current?.next && {
                    number: current.next.number,
                    dueDate: current.next.dueDate,
                    dueByThen: split[current.next.key].cumulativeExpected,
                    outstanding: split[current.next.key].cumulativeOutstanding,
                },
            },
        });
    } catch (error) {
        fail(res, error);
    }
});

export default router;
