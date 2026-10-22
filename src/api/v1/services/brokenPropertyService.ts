import prisma, { BrokenProperty, Prisma } from '../../../config/db';
import { getAcademicYearId, getStudentSubclassByStudentAndYear } from '../../../utils/academicYear';

export interface CreateBrokenPropertyInput {
    student_id: number;
    academic_year_id?: number;
    item_name: string;
    description: string;
    estimated_cost?: number | null;
    photo_url?: string | null;
    action_taken?: string;
    reported_by_id: number;
}

/**
 * Log a broken-property incident on a student. Atomically creates a
 * STUDENT-scoped FeeItem so the bursar sees the charge on the student's
 * outstanding fees. If estimated_cost is null/undefined the FeeItem is skipped —
 * the incident is recorded without an outstanding charge.
 */
export async function createBrokenProperty(input: CreateBrokenPropertyInput): Promise<BrokenProperty> {
    if (!input.item_name?.trim()) throw new Error('item_name is required');
    if (!input.description?.trim()) throw new Error('description is required');
    if (input.estimated_cost !== undefined && input.estimated_cost !== null && input.estimated_cost < 0) {
        throw new Error('estimated_cost cannot be negative');
    }

    const yearId = input.academic_year_id ?? await getAcademicYearId();
    if (!yearId) throw new Error('No academic year found');

    const enrollment = await getStudentSubclassByStudentAndYear(input.student_id, yearId);
    if (!enrollment) {
        throw new Error(`Student ${input.student_id} is not enrolled in academic year ${yearId}`);
    }

    const hasCost = input.estimated_cost !== undefined && input.estimated_cost !== null && input.estimated_cost > 0;

    return prisma.$transaction(async (tx) => {
        let feeItemId: number | null = null;
        if (hasCost) {
            const feeItem = await tx.feeItem.create({
                data: {
                    name: `Broken property: ${input.item_name.trim()}`,
                    description: input.description.trim(),
                    amount: input.estimated_cost as number,
                    academic_year_id: yearId,
                    scope: 'STUDENT',
                    student_id: input.student_id,
                    requires_school_fees_paid: false,
                    is_active: true,
                    created_by_id: input.reported_by_id,
                },
            });
            feeItemId = feeItem.id;
        }

        return tx.brokenProperty.create({
            data: {
                enrollment_id: enrollment.id,
                item_name: input.item_name.trim(),
                description: input.description.trim(),
                estimated_cost: hasCost ? (input.estimated_cost as number) : null,
                photo_url: input.photo_url?.trim() || null,
                action_taken: input.action_taken?.trim() || null,
                fee_item_id: feeItemId,
                reported_by_id: input.reported_by_id,
            },
        });
    });
}

export interface ListBrokenPropertyOptions {
    student_id?: number;
    enrollment_id?: number;
    from?: string;
    to?: string;
    academic_year_id?: number;
    page?: number;
    limit?: number;
}

export async function listBrokenProperty(opts: ListBrokenPropertyOptions) {
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;
    const yearId = opts.academic_year_id ?? await getAcademicYearId();

    const where: Prisma.BrokenPropertyWhereInput = {
        ...(opts.enrollment_id && { enrollment_id: opts.enrollment_id }),
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
        ...(!opts.student_id && !opts.enrollment_id && yearId && {
            enrollment: { academic_year_id: yearId },
        }),
    };

    const [total, items] = await Promise.all([
        prisma.brokenProperty.count({ where }),
        prisma.brokenProperty.findMany({
            where,
            include: {
                enrollment: {
                    include: {
                        student: { select: { id: true, name: true, matricule: true } },
                        sub_class: { select: { id: true, name: true, class: { select: { name: true } } } },
                    },
                },
                fee_item: true,
                reported_by: { select: { id: true, name: true, matricule: true } },
            },
            orderBy: { created_at: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return { data: items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getBrokenPropertyById(id: number) {
    return prisma.brokenProperty.findUnique({
        where: { id },
        include: {
            enrollment: { include: { student: true, sub_class: { include: { class: true } } } },
            fee_item: { include: { payments: true } },
            reported_by: { select: { id: true, name: true, matricule: true } },
        },
    });
}

export interface UpdateBrokenPropertyInput {
    item_name?: string;
    description?: string;
    estimated_cost?: number | null;
    photo_url?: string | null;
    action_taken?: string | null;
}

export async function updateBrokenProperty(id: number, data: UpdateBrokenPropertyInput): Promise<BrokenProperty> {
    const existing = await prisma.brokenProperty.findUnique({ where: { id } });
    if (!existing) throw new Error(`BrokenProperty ${id} not found`);
    if (data.estimated_cost !== undefined && data.estimated_cost !== null && data.estimated_cost < 0) {
        throw new Error('estimated_cost cannot be negative');
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.brokenProperty.update({
            where: { id },
            data: {
                ...(data.item_name !== undefined && { item_name: data.item_name.trim() }),
                ...(data.description !== undefined && { description: data.description.trim() }),
                ...(data.estimated_cost !== undefined && { estimated_cost: data.estimated_cost }),
                ...(data.photo_url !== undefined && { photo_url: data.photo_url?.trim() || null }),
                ...(data.action_taken !== undefined && { action_taken: data.action_taken?.trim() || null }),
            },
        });

        // Sync the linked FeeItem (name + amount + description). If cost is cleared to null on a record
        // that had a fee item, deactivate the fee item (leaving history intact).
        if (existing.fee_item_id && (data.item_name !== undefined || data.description !== undefined || data.estimated_cost !== undefined)) {
            const wantsInactive = data.estimated_cost !== undefined && (data.estimated_cost === null || data.estimated_cost === 0);
            await tx.feeItem.update({
                where: { id: existing.fee_item_id },
                data: {
                    ...(data.item_name !== undefined && { name: `Broken property: ${data.item_name.trim()}` }),
                    ...(data.description !== undefined && { description: data.description.trim() }),
                    ...(data.estimated_cost !== undefined && data.estimated_cost !== null && { amount: data.estimated_cost }),
                    ...(wantsInactive && { is_active: false }),
                },
            });
        }

        return updated;
    });
}

/**
 * Delete a broken-property record. Refuses if the linked FeeItem already
 * has payments recorded; the DM should deactivate the FeeItem instead.
 */
export async function deleteBrokenProperty(id: number): Promise<void> {
    const existing = await prisma.brokenProperty.findUnique({ where: { id } });
    if (!existing) throw new Error(`BrokenProperty ${id} not found`);

    if (existing.fee_item_id) {
        const paymentCount = await prisma.feeItemPayment.count({ where: { fee_item_id: existing.fee_item_id } });
        if (paymentCount > 0) {
            throw new Error(`Cannot delete BrokenProperty ${id}: linked fee item has ${paymentCount} payment(s) recorded`);
        }
    }

    await prisma.$transaction(async (tx) => {
        await tx.brokenProperty.delete({ where: { id } });
        if (existing.fee_item_id) {
            await tx.feeItem.delete({ where: { id: existing.fee_item_id } });
        }
    });
}
