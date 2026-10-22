import prisma, { ReportRequest, ReportRequestStatus, Prisma } from '../../../config/db';
import { Role } from '@prisma/client';
import { highestRole, outranks } from '../../../utils/roleHierarchy';
import { getCurrentAcademicYear } from '../../../utils/academicYear';

export interface CreateReportRequestInput {
    requested_by_id: number;
    requested_from_id: number;
    subject: string;
    description: string;
    due_date: string;
}

export async function createReportRequest(input: CreateReportRequestInput): Promise<ReportRequest> {
    if (!input.subject?.trim()) throw new Error('subject is required');
    if (!input.description?.trim()) throw new Error('description is required');
    if (!input.due_date) throw new Error('due_date is required');

    const dueDate = new Date(input.due_date);
    if (isNaN(dueDate.getTime())) throw new Error('due_date is invalid');

    if (input.requested_by_id === input.requested_from_id) {
        throw new Error('Cannot request a report from yourself');
    }

    const [requester, recipient] = await Promise.all([
        prisma.user.findUnique({
            where: { id: input.requested_by_id },
            include: { user_roles: { select: { role: true } } },
        }),
        prisma.user.findUnique({
            where: { id: input.requested_from_id },
            include: { user_roles: { select: { role: true } } },
        }),
    ]);

    if (!requester) throw new Error(`Requester user ${input.requested_by_id} not found`);
    if (!recipient) throw new Error(`Recipient user ${input.requested_from_id} not found`);

    const requesterTop = highestRole([...new Set(requester.user_roles.map(r => r.role as Role))]);
    const recipientTop = highestRole([...new Set(recipient.user_roles.map(r => r.role as Role))]);

    if (!requesterTop || !recipientTop) {
        throw new Error('Requester and recipient must both have at least one role');
    }
    if (recipientTop === 'PARENT') {
        throw new Error('Cannot request a report from a parent');
    }
    if (!outranks(requesterTop, recipientTop)) {
        throw new Error(`Requester (${requesterTop}) must outrank recipient (${recipientTop})`);
    }

    return prisma.reportRequest.create({
        data: {
            requested_by_id: input.requested_by_id,
            requested_from_id: input.requested_from_id,
            subject: input.subject.trim(),
            description: input.description.trim(),
            due_date: dueDate,
            status: 'PENDING',
        },
    });
}

export interface ListReportRequestOptions {
    requested_by_id?: number;
    requested_from_id?: number;
    status?: ReportRequestStatus;
    overdue_only?: boolean;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}

const REPORT_REQUEST_INCLUDE = {
    requested_by: { select: { id: true, name: true, matricule: true } },
    requested_from: { select: { id: true, name: true, matricule: true } },
} as const;

function withOverdueFlag<T extends { status: ReportRequestStatus; due_date: Date }>(item: T) {
    const isOverdue = item.status === 'PENDING' && item.due_date < new Date();
    return { ...item, is_overdue: isOverdue };
}

export async function listReportRequests(opts: ListReportRequestOptions) {
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;

    const where: Prisma.ReportRequestWhereInput = {
        ...(opts.requested_by_id && { requested_by_id: opts.requested_by_id }),
        ...(opts.requested_from_id && { requested_from_id: opts.requested_from_id }),
        ...(opts.status && { status: opts.status }),
        ...(opts.overdue_only && { status: 'PENDING', due_date: { lt: new Date() } }),
        ...((opts.from || opts.to) && {
            created_at: {
                ...(opts.from && { gte: new Date(opts.from) }),
                ...(opts.to && { lte: new Date(opts.to) }),
            },
        }),
    };

    const [total, items] = await Promise.all([
        prisma.reportRequest.count({ where }),
        prisma.reportRequest.findMany({
            where,
            include: REPORT_REQUEST_INCLUDE,
            orderBy: [{ status: 'asc' }, { due_date: 'asc' }],
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return {
        data: items.map(withOverdueFlag),
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

export async function getReportRequestById(id: number) {
    const item = await prisma.reportRequest.findUnique({
        where: { id },
        include: REPORT_REQUEST_INCLUDE,
    });
    return item ? withOverdueFlag(item) : null;
}

export interface UpdateReportRequestInput {
    subject?: string;
    description?: string;
    due_date?: string;
}

/**
 * Edit a pending request. Only the original requester can edit, and only while
 * the request is still PENDING.
 */
export async function updateReportRequest(id: number, requester_id: number, data: UpdateReportRequestInput): Promise<ReportRequest> {
    const existing = await prisma.reportRequest.findUnique({ where: { id } });
    if (!existing) throw new Error(`ReportRequest ${id} not found`);
    if (existing.requested_by_id !== requester_id) {
        throw new Error('Only the original requester can edit this request');
    }
    if (existing.status !== 'PENDING') {
        throw new Error(`Cannot edit a request that is ${existing.status}`);
    }

    return prisma.reportRequest.update({
        where: { id },
        data: {
            ...(data.subject !== undefined && { subject: data.subject.trim() }),
            ...(data.description !== undefined && { description: data.description.trim() }),
            ...(data.due_date !== undefined && { due_date: new Date(data.due_date) }),
        },
    });
}

export interface SubmitReportRequestInput {
    submitter_id: number;
    submission_notes?: string;
    submission_file_url?: string;
}

export async function submitReportRequest(id: number, input: SubmitReportRequestInput): Promise<ReportRequest> {
    const existing = await prisma.reportRequest.findUnique({ where: { id } });
    if (!existing) throw new Error(`ReportRequest ${id} not found`);
    if (existing.requested_from_id !== input.submitter_id) {
        throw new Error('Only the assigned recipient can submit this report');
    }
    if (existing.status !== 'PENDING') {
        throw new Error(`Cannot submit a request that is ${existing.status}`);
    }

    return prisma.reportRequest.update({
        where: { id },
        data: {
            status: 'SUBMITTED',
            submitted_at: new Date(),
            submission_notes: input.submission_notes?.trim() || null,
            submission_file_url: input.submission_file_url?.trim() || null,
        },
    });
}

export interface ReviewReportRequestInput {
    reviewer_id: number;
    reviewed_notes?: string;
}

export async function reviewReportRequest(id: number, input: ReviewReportRequestInput): Promise<ReportRequest> {
    const existing = await prisma.reportRequest.findUnique({ where: { id } });
    if (!existing) throw new Error(`ReportRequest ${id} not found`);
    if (existing.requested_by_id !== input.reviewer_id) {
        throw new Error('Only the original requester can review this submission');
    }
    if (existing.status !== 'SUBMITTED') {
        throw new Error(`Cannot review a request that is ${existing.status}`);
    }

    return prisma.reportRequest.update({
        where: { id },
        data: {
            status: 'REVIEWED',
            reviewed_at: new Date(),
            reviewed_notes: input.reviewed_notes?.trim() || null,
        },
    });
}

export async function cancelReportRequest(id: number, requester_id: number): Promise<ReportRequest> {
    const existing = await prisma.reportRequest.findUnique({ where: { id } });
    if (!existing) throw new Error(`ReportRequest ${id} not found`);
    if (existing.requested_by_id !== requester_id) {
        throw new Error('Only the original requester can cancel this request');
    }
    if (existing.status === 'REVIEWED') {
        throw new Error('Cannot cancel a request that is already REVIEWED');
    }

    return prisma.reportRequest.update({
        where: { id },
        data: { status: 'CANCELLED' },
    });
}

// ---------------------------------------------------------------------------
// Recipient lookup for the "Request from" picker.
//
// The Request Report form used to build this list client-side from
// GET /users?role=..., which 403s for some requester roles (e.g. MANAGER)
// and, being swallowed, left the picker on "Loading…" forever. This returns
// exactly the people createReportRequest() would accept: holders of the
// requested role(s) in the current academic year (or globally), excluding
// the caller and anyone the caller does not outrank.
// ---------------------------------------------------------------------------
export const DEFAULT_RECIPIENT_ROLES: Role[] = ['SENIOR_DISCIPLINE_MASTER', 'DISCIPLINE_MASTER'] as Role[];

export async function listReportRecipients(requesterId: number, roles: Role[] = DEFAULT_RECIPIENT_ROLES) {
    const year = await getCurrentAcademicYear();

    const requester = await prisma.user.findUnique({
        where: { id: requesterId },
        select: { user_roles: { select: { role: true } } },
    });
    const requesterTop = highestRole([...new Set((requester?.user_roles ?? []).map(r => r.role as Role))]);

    const users = await prisma.user.findMany({
        where: {
            id: { not: requesterId },
            status: 'ACTIVE',
            user_roles: {
                some: {
                    role: { in: roles },
                    OR: [{ academic_year_id: null }, ...(year ? [{ academic_year_id: year.id }] : [])],
                },
            },
        },
        select: {
            id: true,
            name: true,
            matricule: true,
            user_roles: { select: { role: true, academic_year_id: true } },
        },
        orderBy: { name: 'asc' },
    });

    return users
        .map(u => {
            const all = [...new Set(u.user_roles.map(r => r.role as Role))];
            const top = highestRole(all);
            // The role shown in the picker: the most senior of the requested
            // roles this user holds for the current year (or globally).
            const held = u.user_roles
                .filter(r => roles.includes(r.role as Role) && (r.academic_year_id === null || !year || r.academic_year_id === year.id))
                .map(r => r.role as Role);
            const role = highestRole([...new Set(held)]);
            return { id: u.id, name: u.name, matricule: u.matricule, role, top };
        })
        .filter(u => u.role && u.top && (!requesterTop || outranks(requesterTop, u.top)))
        .map(({ top, ...rest }) => rest);
}
