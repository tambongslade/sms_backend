import prisma, { SaturdayPunishment, PunishmentStatus, Prisma } from '../../../config/db';
import { getAcademicYearId, getStudentSubclassByStudentAndYear } from '../../../utils/academicYear';

export interface CreateSaturdayPunishmentInput {
    student_id: number;
    academic_year_id?: number;
    reason: string;
    scheduled_date?: string | null;
    notes?: string;
    assigned_by_id: number;
}

export async function createSaturdayPunishment(input: CreateSaturdayPunishmentInput): Promise<SaturdayPunishment> {
    if (!input.reason?.trim()) throw new Error('reason is required');

    const yearId = input.academic_year_id ?? await getAcademicYearId();
    if (!yearId) throw new Error('No academic year found');

    const enrollment = await getStudentSubclassByStudentAndYear(input.student_id, yearId);
    if (!enrollment) {
        throw new Error(`Student ${input.student_id} is not enrolled in academic year ${yearId}`);
    }

    return prisma.saturdayPunishment.create({
        data: {
            enrollment_id: enrollment.id,
            reason: input.reason.trim(),
            scheduled_date: input.scheduled_date ? new Date(input.scheduled_date) : null,
            notes: input.notes?.trim() || null,
            status: 'PENDING',
            assigned_by_id: input.assigned_by_id,
        },
    });
}

export interface ListSaturdayPunishmentOptions {
    student_id?: number;
    enrollment_id?: number;
    status?: PunishmentStatus;
    from?: string;
    to?: string;
    academic_year_id?: number;
    page?: number;
    limit?: number;
}

export async function listSaturdayPunishments(opts: ListSaturdayPunishmentOptions) {
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;
    const yearId = opts.academic_year_id ?? await getAcademicYearId();

    const where: Prisma.SaturdayPunishmentWhereInput = {
        ...(opts.status && { status: opts.status }),
        ...(opts.enrollment_id && { enrollment_id: opts.enrollment_id }),
        ...((opts.from || opts.to) && {
            scheduled_date: {
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
        prisma.saturdayPunishment.count({ where }),
        prisma.saturdayPunishment.findMany({
            where,
            include: {
                enrollment: {
                    include: {
                        student: { select: { id: true, name: true, matricule: true } },
                        sub_class: { select: { id: true, name: true, class: { select: { name: true } } } },
                    },
                },
                assigned_by: { select: { id: true, name: true, matricule: true } },
            },
            orderBy: [{ status: 'asc' }, { scheduled_date: 'asc' }, { created_at: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return { data: items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getSaturdayPunishmentById(id: number) {
    return prisma.saturdayPunishment.findUnique({
        where: { id },
        include: {
            enrollment: { include: { student: true, sub_class: { include: { class: true } } } },
            assigned_by: { select: { id: true, name: true, matricule: true } },
        },
    });
}

export interface UpdateSaturdayPunishmentInput {
    reason?: string;
    scheduled_date?: string | null;
    served_date?: string | null;
    status?: PunishmentStatus;
    notes?: string | null;
}

export async function updateSaturdayPunishment(id: number, data: UpdateSaturdayPunishmentInput): Promise<SaturdayPunishment> {
    const existing = await prisma.saturdayPunishment.findUnique({ where: { id } });
    if (!existing) throw new Error(`SaturdayPunishment ${id} not found`);

    // If moving into SERVED, default served_date to now unless caller provided one
    const servedDate = data.served_date !== undefined
        ? (data.served_date ? new Date(data.served_date) : null)
        : (data.status === 'SERVED' && !existing.served_date ? new Date() : undefined);

    return prisma.saturdayPunishment.update({
        where: { id },
        data: {
            ...(data.reason !== undefined && { reason: data.reason.trim() }),
            ...(data.scheduled_date !== undefined && { scheduled_date: data.scheduled_date ? new Date(data.scheduled_date) : null }),
            ...(servedDate !== undefined && { served_date: servedDate }),
            ...(data.status !== undefined && { status: data.status }),
            ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
        },
    });
}

export async function deleteSaturdayPunishment(id: number): Promise<void> {
    await prisma.saturdayPunishment.delete({ where: { id } });
}
