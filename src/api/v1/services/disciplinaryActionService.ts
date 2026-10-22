import prisma, { DisciplinaryAction, DisciplinaryActionType, DisciplinaryActionStatus, Prisma } from '../../../config/db';
import { DisciplinaryApprovalStatus } from '@prisma/client';
import { getAcademicYearId, getStudentSubclassByStudentAndYear } from '../../../utils/academicYear';
import { sendToRoles, sendNotification } from './notificationService';

const TYPES_REQUIRING_DAYS: DisciplinaryActionType[] = ['SUSPENSION', 'SUSPENDED_WITH_CHORES'];

// Reason is optional for these action types (e.g., quick "confiscated phone" style logs).
const REASON_OPTIONAL_TYPES: DisciplinaryActionType[] = ['WORK_DUTY', 'PUNISHMENT'];

// Any type in this set is created with approval_status = PENDING_APPROVAL and routed to a supervisor.
const REQUIRES_APPROVAL_TYPES: DisciplinaryActionType[] = [
    'SUSPENSION',
    'SUSPENDED_WITH_CHORES',
    'DISMISSAL',
    'SUSPENDED_DISMISSAL',
    'END_OF_YEAR_DISMISSAL',
    'DISCIPLINARY_COUNCIL',
];

// Dismissal-family actions always route to the PRINCIPAL for final approval.
const PRINCIPAL_APPROVAL_TYPES: DisciplinaryActionType[] = [
    'DISMISSAL',
    'SUSPENDED_DISMISSAL',
    'END_OF_YEAR_DISMISSAL',
];

export interface CreateDisciplinaryActionInput {
    student_id: number;
    academic_year_id?: number;
    discipline_issue_id?: number;
    action_type: DisciplinaryActionType;
    days?: number;
    start_date?: string | null;
    end_date?: string | null;
    reason?: string;
    notes?: string;
    decided_by_id: number;
}

function computeEndDate(start: Date | null, days: number | null | undefined): Date | null {
    if (!start || !days || days <= 0) return null;
    // Inclusive range: a 2-day suspension starting 23 Nov covers 23 and 24 Nov,
    // so end = start + (days - 1). Use UTC arithmetic because date-only inputs
    // ("2026-11-23") are parsed as UTC midnight.
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + days - 1);
    return end;
}

/**
 * Pick the first user holding the approver role for the current academic year.
 * Falls back to any global holder of the role, then null.
 */
async function pickApprover(role: 'PRINCIPAL' | 'VICE_PRINCIPAL', yearId: number): Promise<number | null> {
    const yearMatch = await prisma.userRole.findFirst({
        where: { role, academic_year_id: yearId },
        orderBy: { created_at: 'asc' },
        select: { user_id: true },
    });
    if (yearMatch) return yearMatch.user_id;
    const global = await prisma.userRole.findFirst({
        where: { role, academic_year_id: null },
        orderBy: { created_at: 'asc' },
        select: { user_id: true },
    });
    return global?.user_id ?? null;
}

export async function createDisciplinaryAction(input: CreateDisciplinaryActionInput): Promise<DisciplinaryAction> {
    if (!input.action_type) throw new Error('action_type is required');

    const reasonRequired = !REASON_OPTIONAL_TYPES.includes(input.action_type);
    if (reasonRequired && !input.reason?.trim()) {
        throw new Error('reason is required for this action type');
    }

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

    // Approval routing
    const needsApproval = REQUIRES_APPROVAL_TYPES.includes(input.action_type);
    const approverRole = PRINCIPAL_APPROVAL_TYPES.includes(input.action_type) ? 'PRINCIPAL' : 'VICE_PRINCIPAL';
    const approverId = needsApproval ? await pickApprover(approverRole, yearId) : null;
    const approvalStatus: DisciplinaryApprovalStatus = needsApproval ? 'PENDING_APPROVAL' : 'NOT_REQUIRED';
    // A pending-approval action stays PENDING (workflow status) and inactive until approved.
    const workflowStatus: DisciplinaryActionStatus = 'PENDING';

    const created = await prisma.disciplinaryAction.create({
        data: {
            enrollment_id: enrollment.id,
            discipline_issue_id: input.discipline_issue_id ?? null,
            action_type: input.action_type,
            status: workflowStatus,
            days: input.days ?? null,
            start_date: startDate,
            end_date: endDate,
            reason: input.reason?.trim() || null,
            notes: input.notes?.trim() || null,
            decided_by_id: input.decided_by_id,
            approval_status: approvalStatus,
            approver_id: approverId,
        },
    });

    // Fire-and-forget notification to the approver (or the whole approver-role pool if we couldn't pick one).
    if (needsApproval) {
        const student = await prisma.student.findUnique({
            where: { id: input.student_id },
            select: { name: true },
        });
        const studentName = student?.name ?? `student ${input.student_id}`;
        const title = `Approval needed: ${input.action_type.replace(/_/g, ' ')}`;
        const message = `A ${input.action_type.replace(/_/g, ' ').toLowerCase()} for ${studentName} awaits your approval.`;
        // `?approve=1` is the frontend contract to auto-open the approve/decline modal
        // when the notification is clicked (rather than just landing on the record page).
        const actionUrl = `/dashboard/disciplinary-actions/${created.id}?approve=1`;
        if (approverId) {
            sendNotification({
                user_id: approverId,
                sender_id: input.decided_by_id,
                title,
                message,
                category: 'APPROVAL_NEEDED',
                priority: PRINCIPAL_APPROVAL_TYPES.includes(input.action_type) ? 'URGENT' : 'HIGH',
                entity_type: 'DisciplinaryAction',
                entity_id: created.id,
                action_url: actionUrl,
            }).catch((err) => console.error('[approval-notify] send failed:', err));
        } else {
            sendToRoles([approverRole], {
                sender_id: input.decided_by_id,
                title,
                message,
                category: 'APPROVAL_NEEDED',
                priority: PRINCIPAL_APPROVAL_TYPES.includes(input.action_type) ? 'URGENT' : 'HIGH',
                entity_type: 'DisciplinaryAction',
                entity_id: created.id,
                action_url: actionUrl,
            }, { academic_year_id: yearId }).catch((err) => console.error('[approval-notify] fan-out failed:', err));
        }
    }

    return created;
}

export interface ListDisciplinaryActionOptions {
    student_id?: number;
    enrollment_id?: number;
    discipline_issue_id?: number;
    action_type?: DisciplinaryActionType;
    status?: DisciplinaryActionStatus;
    approval_status?: DisciplinaryApprovalStatus;
    approver_id?: number;
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
        ...(opts.approval_status && { approval_status: opts.approval_status }),
        ...(opts.approver_id && { approver_id: opts.approver_id }),
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
                approver: { select: { id: true, name: true, matricule: true } },
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
            approver: { select: { id: true, name: true, matricule: true } },
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
            ...(data.reason !== undefined && { reason: data.reason?.trim() || null }),
            ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
        },
    });
}

export async function deleteDisciplinaryAction(id: number): Promise<void> {
    const existing = await prisma.disciplinaryAction.findUnique({ where: { id } });
    if (!existing) throw new Error(`DisciplinaryAction ${id} not found`);
    await prisma.disciplinaryAction.delete({ where: { id } });
}

export interface ApprovalDecisionInput {
    approver_id: number;
    approval_notes?: string;
    // Optional supervisor overrides (allowed at approval time, per requirements)
    days?: number | null;
    start_date?: string | null;
    end_date?: string | null;
    reason?: string;
}

export async function approveDisciplinaryAction(id: number, input: ApprovalDecisionInput): Promise<DisciplinaryAction> {
    const existing = await prisma.disciplinaryAction.findUnique({
        where: { id },
        include: {
            enrollment: { include: { student: { select: { name: true } } } },
        },
    });
    if (!existing) throw new Error(`DisciplinaryAction ${id} not found`);
    if (existing.approval_status !== 'PENDING_APPROVAL') {
        throw new Error(`DisciplinaryAction ${id} is not pending approval`);
    }

    const nextDays = input.days !== undefined ? input.days : existing.days;
    const nextStart = input.start_date !== undefined
        ? (input.start_date ? new Date(input.start_date) : null)
        : existing.start_date;
    let nextEnd: Date | null | undefined;
    if (input.end_date !== undefined) {
        nextEnd = input.end_date ? new Date(input.end_date) : null;
    } else if (input.days !== undefined || input.start_date !== undefined) {
        nextEnd = computeEndDate(nextStart, nextDays);
    }

    const updated = await prisma.disciplinaryAction.update({
        where: { id },
        data: {
            approval_status: 'APPROVED',
            approver_id: input.approver_id,
            approved_at: new Date(),
            approval_notes: input.approval_notes?.trim() || null,
            status: 'ACTIVE',
            ...(input.days !== undefined && { days: input.days }),
            ...(input.start_date !== undefined && { start_date: input.start_date ? new Date(input.start_date) : null }),
            ...(nextEnd !== undefined && { end_date: nextEnd }),
            ...(input.reason !== undefined && { reason: input.reason?.trim() || null }),
        },
    });

    // Notify the person who requested the action
    if (existing.decided_by_id) {
        const studentName = existing.enrollment?.student?.name ?? `student`;
        sendNotification({
            user_id: existing.decided_by_id,
            sender_id: input.approver_id,
            title: 'Action approved',
            message: `Your ${existing.action_type.replace(/_/g, ' ').toLowerCase()} for ${studentName} was approved.`,
            category: 'APPROVAL_APPROVED',
            priority: 'NORMAL',
            entity_type: 'DisciplinaryAction',
            entity_id: id,
            action_url: `/dashboard/disciplinary-actions/${id}?approve=1`,
        }).catch((err) => console.error('[approval-notify] approve notify failed:', err));
    }

    return updated;
}

export async function declineDisciplinaryAction(id: number, input: ApprovalDecisionInput): Promise<DisciplinaryAction> {
    const existing = await prisma.disciplinaryAction.findUnique({
        where: { id },
        include: {
            enrollment: { include: { student: { select: { name: true } } } },
        },
    });
    if (!existing) throw new Error(`DisciplinaryAction ${id} not found`);
    if (existing.approval_status !== 'PENDING_APPROVAL') {
        throw new Error(`DisciplinaryAction ${id} is not pending approval`);
    }

    const updated = await prisma.disciplinaryAction.update({
        where: { id },
        data: {
            approval_status: 'DECLINED',
            approver_id: input.approver_id,
            approved_at: new Date(),
            approval_notes: input.approval_notes?.trim() || null,
            status: 'CANCELLED',
        },
    });

    if (existing.decided_by_id) {
        const studentName = existing.enrollment?.student?.name ?? `student`;
        sendNotification({
            user_id: existing.decided_by_id,
            sender_id: input.approver_id,
            title: 'Action declined',
            message: `Your ${existing.action_type.replace(/_/g, ' ').toLowerCase()} for ${studentName} was declined.`,
            category: 'APPROVAL_REJECTED',
            priority: 'HIGH',
            entity_type: 'DisciplinaryAction',
            entity_id: id,
            action_url: `/dashboard/disciplinary-actions/${id}?approve=1`,
        }).catch((err) => console.error('[approval-notify] decline notify failed:', err));
    }

    return updated;
}

/** All actions currently in PENDING_APPROVAL, regardless of approver. */
export async function listPendingApprovals(opts: { academic_year_id?: number; page?: number; limit?: number } = {}) {
    return listDisciplinaryActions({
        approval_status: 'PENDING_APPROVAL',
        academic_year_id: opts.academic_year_id,
        page: opts.page,
        limit: opts.limit,
    });
}

/** Pending approvals routed to a specific approver (used by "my inbox"). */
export async function listMyPendingApprovals(approverId: number, opts: { academic_year_id?: number; page?: number; limit?: number } = {}) {
    return listDisciplinaryActions({
        approval_status: 'PENDING_APPROVAL',
        approver_id: approverId,
        academic_year_id: opts.academic_year_id,
        page: opts.page,
        limit: opts.limit,
    });
}
