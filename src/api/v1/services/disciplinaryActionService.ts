import prisma, { DisciplinaryAction, DisciplinaryActionType, DisciplinaryActionStatus, Prisma } from '../../../config/db';
import { getAcademicYearId, getStudentSubclassByStudentAndYear } from '../../../utils/academicYear';

const TYPES_REQUIRING_DAYS: DisciplinaryActionType[] = ['SUSPENSION', 'SUSPENDED_WITH_CHORES'];

export interface CreateDisciplinaryActionInput {
    student_id: number;
    academic_year_id?: number;
    discipline_issue_id?: number;
    action_type: DisciplinaryActionType;
    days?: number;
    start_date?: string | null;
    end_date?: string | null;
    reason: string;
    notes?: string;
    decided_by_id: number;
}

function computeEndDate(start: Date | null, days: number | null | undefined): Date | null {
    if (!start || !days || days <= 0) return null;
    const end = new Date(start);
    end.setDate(end.getDate() + days);
    return end;
}

export async function createDisciplinaryAction(input: CreateDisciplinaryActionInput): Promise<DisciplinaryAction> {
    if (!input.reason?.trim()) throw new Error('reason is required');
    if (!input.action_type) throw new Error('action_type is required');
    if (TYPES_REQUIRING_DAYS.includes(input.action_type)) {
        if (!input.days || input.days <= 0) {
            throw new Error(`days is required and must be > 0 for ${input.action_type}`);
        }
    }

    const yearId = input.academic_year_id ?? await getAcademicYearId();
    if (!yearId) throw new Error('No academic year found');

    const enrollment = await getStudentSubclassByStudentAndYear(input.student_id, yearId);
    if (!enrollment) {
        throw new Error(`Student ${input.student_id} is not enrolled in academic year ${yearId}`);
    }

    if (input.discipline_issue_id) {
        const issue = await prisma.disciplineIssue.findUnique({ where: { id: input.discipline_issue_id } });
        if (!issue) throw new Error(`DisciplineIssue ${input.discipline_issue_id} not found`);
        if (issue.enrollment_id !== enrollment.id) {
            throw new Error(`DisciplineIssue ${input.discipline_issue_id} does not belong to this student`);
        }
    }

    const startDate = input.start_date ? new Date(input.start_date) : null;
    const endDate = input.end_date
        ? new Date(input.end_date)
        : computeEndDate(startDate, input.days);

    return prisma.disciplinaryAction.create({
        data: {
            enrollment_id: enrollment.id,
            discipline_issue_id: input.discipline_issue_id ?? null,
            action_type: input.action_type,
            status: 'PENDING',
            days: input.days ?? null,
            start_date: startDate,
            end_date: endDate,
            reason: input.reason.trim(),
            notes: input.notes?.trim() || null,
            decided_by_id: input.decided_by_id,
        },
    });
}

export interface ListDisciplinaryActionOptions {
    student_id?: number;
    enrollment_id?: number;
    discipline_issue_id?: number;
    action_type?: DisciplinaryActionType;
    status?: DisciplinaryActionStatus;
    from?: string;
    to?: string;
    academic_year_id?: number;
    page?: number;
    limit?: number;
}

export async function listDisciplinaryActions(opts: ListDisciplinaryActionOptions) {
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;
    const yearId = opts.academic_year_id ?? await getAcademicYearId();

    const where: Prisma.DisciplinaryActionWhereInput = {
        ...(opts.action_type && { action_type: opts.action_type }),
        ...(opts.status && { status: opts.status }),
        ...(opts.enrollment_id && { enrollment_id: opts.enrollment_id }),
        ...(opts.discipline_issue_id && { discipline_issue_id: opts.discipline_issue_id }),
        ...((opts.from || opts.to) && {
            created_at: {
                ...(opts.from && { gte: new Date(opts.from) }),
                ...(opts.to && { lte: new Date(opts.to) }),
            },
        }),
        ...(opts.student_id && {
            enrollment: {
                student_id: opts.student_id,
                ...(yearId && { academic_year_id: yearId }),
            },
        }),
        // Roster-style browsing (no specific student/enrollment target) must
        // exclude withdrawn students -- see the same pattern in
        // disciplineService.ts's listStudentWarnings/listParentSummons.
        ...(!opts.student_id && !opts.enrollment_id && yearId && {
            enrollment: { academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' } } },
        }),
    };

    const [total, items] = await Promise.all([
        prisma.disciplinaryAction.count({ where }),
        prisma.disciplinaryAction.findMany({
            where,
            include: {
                enrollment: {
                    include: {
                        student: { select: { id: true, name: true, matricule: true } },
                        sub_class: { select: { id: true, name: true, class: { select: { name: true } } } },
                    },
                },
                discipline_issue: { select: { id: true, issue_type: true, description: true, created_at: true } },
                decided_by: { select: { id: true, name: true, matricule: true } },
            },
            orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return { data: items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getDisciplinaryActionById(id: number) {
    return prisma.disciplinaryAction.findUnique({
        where: { id },
        include: {
            enrollment: { include: { student: true, sub_class: { include: { class: true } } } },
            discipline_issue: true,
            decided_by: { select: { id: true, name: true, matricule: true } },
        },
    });
}

export interface UpdateDisciplinaryActionInput {
    status?: DisciplinaryActionStatus;
    days?: number | null;
    start_date?: string | null;
    end_date?: string | null;
    reason?: string;
    notes?: string | null;
}

export async function updateDisciplinaryAction(id: number, data: UpdateDisciplinaryActionInput): Promise<DisciplinaryAction> {
    const existing = await prisma.disciplinaryAction.findUnique({ where: { id } });
    if (!existing) throw new Error(`DisciplinaryAction ${id} not found`);

    const nextDays = data.days !== undefined ? data.days : existing.days;
    const nextStart = data.start_date !== undefined
        ? (data.start_date ? new Date(data.start_date) : null)
        : existing.start_date;

    // Recompute end_date if days or start_date changed and caller didn't pass an explicit end_date
    let nextEnd: Date | null | undefined;
    if (data.end_date !== undefined) {
        nextEnd = data.end_date ? new Date(data.end_date) : null;
    } else if (data.days !== undefined || data.start_date !== undefined) {
        nextEnd = computeEndDate(nextStart, nextDays);
    }

    return prisma.disciplinaryAction.update({
        where: { id },
        data: {
            ...(data.status !== undefined && { status: data.status }),
            ...(data.days !== undefined && { days: data.days }),
            ...(data.start_date !== undefined && { start_date: data.start_date ? new Date(data.start_date) : null }),
            ...(nextEnd !== undefined && { end_date: nextEnd }),
            ...(data.reason !== undefined && { reason: data.reason.trim() }),
            ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
        },
    });
}

export async function deleteDisciplinaryAction(id: number): Promise<void> {
    const existing = await prisma.disciplinaryAction.findUnique({ where: { id } });
    if (!existing) throw new Error(`DisciplinaryAction ${id} not found`);
    await prisma.disciplinaryAction.delete({ where: { id } });
}

// --- Approval workflow -----------------------------------------------------
// Note: nothing currently moves an action into PENDING_APPROVAL -- it stays at
// the schema default (NOT_REQUIRED) unless something sets it explicitly, and
// createDisciplinaryAction doesn't. So these list/decide endpoints are correct
// against whatever approval_status ends up in the data, but return nothing
// until a caller (or a future change to createDisciplinaryAction) actually
// requests approval for an action.

export interface ListPendingApprovalOptions {
    academic_year_id?: number;
    page?: number;
    limit?: number;
}

export async function listPendingApprovals(opts: ListPendingApprovalOptions) {
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;
    const yearId = opts.academic_year_id ?? await getAcademicYearId();

    const where: Prisma.DisciplinaryActionWhereInput = {
        approval_status: 'PENDING_APPROVAL',
        ...(yearId && { enrollment: { academic_year_id: yearId } }),
    };

    const [total, items] = await Promise.all([
        prisma.disciplinaryAction.count({ where }),
        prisma.disciplinaryAction.findMany({
            where,
            include: {
                enrollment: {
                    include: {
                        student: { select: { id: true, name: true, matricule: true } },
                        sub_class: { select: { id: true, name: true, class: { select: { name: true } } } },
                    },
                },
                discipline_issue: { select: { id: true, issue_type: true, description: true, created_at: true } },
                decided_by: { select: { id: true, name: true, matricule: true } },
            },
            orderBy: [{ created_at: 'asc' }],
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return { data: items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// Same as listPendingApprovals, narrowed to actions this specific caller was
// designated to decide (approver_id set ahead of time). Whatever assigns
// approver_id is also not wired up yet -- see the note above.
export async function listMyPendingApprovals(approverId: number, opts: ListPendingApprovalOptions) {
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;
    const yearId = opts.academic_year_id ?? await getAcademicYearId();

    const where: Prisma.DisciplinaryActionWhereInput = {
        approval_status: 'PENDING_APPROVAL',
        approver_id: approverId,
        ...(yearId && { enrollment: { academic_year_id: yearId } }),
    };

    const [total, items] = await Promise.all([
        prisma.disciplinaryAction.count({ where }),
        prisma.disciplinaryAction.findMany({
            where,
            include: {
                enrollment: {
                    include: {
                        student: { select: { id: true, name: true, matricule: true } },
                        sub_class: { select: { id: true, name: true, class: { select: { name: true } } } },
                    },
                },
                discipline_issue: { select: { id: true, issue_type: true, description: true, created_at: true } },
                decided_by: { select: { id: true, name: true, matricule: true } },
            },
            orderBy: [{ created_at: 'asc' }],
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return { data: items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export interface DecideApprovalInput {
    approver_id: number;
    approval_notes?: string;
}

async function transitionApproval(
    id: number,
    nextStatus: 'APPROVED' | 'DECLINED',
    input: DecideApprovalInput,
): Promise<DisciplinaryAction> {
    const existing = await prisma.disciplinaryAction.findUnique({ where: { id } });
    if (!existing) throw new Error(`DisciplinaryAction ${id} not found`);
    if (existing.approval_status !== 'PENDING_APPROVAL') {
        throw new Error(`DisciplinaryAction ${id} is not pending approval (current: ${existing.approval_status})`);
    }
    return prisma.disciplinaryAction.update({
        where: { id },
        data: {
            approval_status: nextStatus,
            approver_id: input.approver_id,
            approved_at: new Date(),
            approval_notes: input.approval_notes?.trim() || null,
        },
    });
}

export async function approveDisciplinaryAction(id: number, input: DecideApprovalInput): Promise<DisciplinaryAction> {
    return transitionApproval(id, 'APPROVED', input);
}

export async function declineDisciplinaryAction(id: number, input: DecideApprovalInput): Promise<DisciplinaryAction> {
    return transitionApproval(id, 'DECLINED', input);
}
