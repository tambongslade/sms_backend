import prisma, { FeeItem, FeeItemPayment, FeeItemScope, PaymentMethod, Prisma } from '../../../config/db';
import { normalizePaymentMethod } from '../../../utils/paymentMethod';
import { insertSchoolFeePayment } from './paymentLedgerService';
import { getAcademicYearId } from '../../../utils/academicYear';

export interface CreateFeeItemInput {
    name: string;
    description?: string;
    amount: number;
    academic_year_id?: number;
    scope: FeeItemScope;
    class_id?: number | null;
    sub_class_id?: number | null;
    student_id?: number | null;
    requires_school_fees_paid?: boolean;
    is_active?: boolean;
    created_by_id: number;
}

export async function createFeeItem(data: CreateFeeItemInput): Promise<FeeItem> {
    const academic_year_id = data.academic_year_id ?? await getAcademicYearId();
    if (!academic_year_id) throw new Error('Academic year is required');

    // Scope validation
    if (data.scope === 'CLASS' && !data.class_id) {
        throw new Error('class_id is required when scope = CLASS');
    }
    if (data.scope === 'SUBCLASS' && !data.sub_class_id) {
        throw new Error('sub_class_id is required when scope = SUBCLASS');
    }
    if (data.scope === 'STUDENT' && !data.student_id) {
        throw new Error('student_id is required when scope = STUDENT');
    }
    if (data.scope === 'ALL' && (data.class_id || data.sub_class_id || data.student_id)) {
        throw new Error('class_id, sub_class_id, and student_id must be null when scope = ALL');
    }

    if (data.amount <= 0) throw new Error('amount must be greater than 0');

    return prisma.feeItem.create({
        data: {
            name: data.name,
            description: data.description ?? null,
            amount: data.amount,
            academic_year_id,
            scope: data.scope,
            class_id: data.scope === 'CLASS' ? data.class_id! : null,
            sub_class_id: data.scope === 'SUBCLASS' ? data.sub_class_id! : null,
            student_id: data.scope === 'STUDENT' ? data.student_id! : null,
            requires_school_fees_paid: data.requires_school_fees_paid ?? false,
            is_active: data.is_active ?? true,
            created_by_id: data.created_by_id,
        },
    });
}

export async function updateFeeItem(id: number, data: Partial<CreateFeeItemInput>): Promise<FeeItem> {
    const existing = await prisma.feeItem.findUnique({ where: { id } });
    if (!existing) throw new Error(`FeeItem ${id} not found`);

    const merged = { ...existing, ...data };
    if (merged.scope === 'CLASS' && !merged.class_id) throw new Error('class_id required for scope CLASS');
    if (merged.scope === 'SUBCLASS' && !merged.sub_class_id) throw new Error('sub_class_id required for scope SUBCLASS');

    const updateData: Prisma.FeeItemUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.amount !== undefined) {
        if (data.amount <= 0) throw new Error('amount must be greater than 0');
        updateData.amount = data.amount;
    }
    if (data.scope !== undefined) updateData.scope = data.scope;
    if (data.class_id !== undefined) updateData.class = data.class_id ? { connect: { id: data.class_id } } : { disconnect: true };
    if (data.sub_class_id !== undefined) updateData.sub_class = data.sub_class_id ? { connect: { id: data.sub_class_id } } : { disconnect: true };
    if (data.requires_school_fees_paid !== undefined) updateData.requires_school_fees_paid = data.requires_school_fees_paid;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    return prisma.feeItem.update({ where: { id }, data: updateData });
}

export async function deleteFeeItem(id: number): Promise<void> {
    const paymentCount = await prisma.feeItemPayment.count({ where: { fee_item_id: id } });
    if (paymentCount > 0) {
        throw new Error(`Cannot delete FeeItem ${id}: ${paymentCount} payment(s) already recorded. Deactivate instead (is_active = false).`);
    }
    await prisma.feeItem.delete({ where: { id } });
}

export async function listFeeItems(filter: {
    academic_year_id?: number;
    scope?: FeeItemScope;
    class_id?: number;
    sub_class_id?: number;
    student_id?: number;
    is_active?: boolean;
}): Promise<FeeItem[]> {
    return prisma.feeItem.findMany({
        where: {
            ...(filter.academic_year_id && { academic_year_id: filter.academic_year_id }),
            ...(filter.scope && { scope: filter.scope }),
            ...(filter.class_id && { class_id: filter.class_id }),
            ...(filter.sub_class_id && { sub_class_id: filter.sub_class_id }),
            ...(filter.student_id && { student_id: filter.student_id }),
            ...(filter.is_active !== undefined && { is_active: filter.is_active }),
        },
        include: { class: true, sub_class: true, academic_year: true },
        orderBy: [{ academic_year_id: 'desc' }, { name: 'asc' }],
    });
}

// Given an enrollment, list every FeeItem that applies to it (scope match + active + same year),
// plus paid-so-far and remaining balance.
export async function getFeeItemsForEnrollment(enrollmentId: number): Promise<Array<FeeItem & { amount_paid: number; balance: number }>> {
    const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        select: { id: true, academic_year_id: true, class_id: true, sub_class_id: true },
    });
    if (!enrollment) throw new Error(`Enrollment ${enrollmentId} not found`);

    const fullEnrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        select: { student_id: true },
    });

    const items = await prisma.feeItem.findMany({
        where: {
            academic_year_id: enrollment.academic_year_id,
            is_active: true,
            OR: [
                { scope: 'ALL' },
                { scope: 'CLASS', class_id: enrollment.class_id },
                ...(enrollment.sub_class_id ? [{ scope: 'SUBCLASS' as const, sub_class_id: enrollment.sub_class_id }] : []),
                ...(fullEnrollment?.student_id ? [{ scope: 'STUDENT' as const, student_id: fullEnrollment.student_id }] : []),
            ],
        },
        include: { class: true, sub_class: true },
        orderBy: { name: 'asc' },
    });

    const payments = await prisma.feeItemPayment.groupBy({
        by: ['fee_item_id'],
        where: {
            enrollment_id: enrollmentId,
            fee_item_id: { in: items.map(i => i.id) },
            cascaded_to_school_fees: false,
        },
        _sum: { amount: true },
    });
    const paidByItem = new Map(payments.map(p => [p.fee_item_id, p._sum.amount ?? 0]));

    return items.map(item => {
        const paid = paidByItem.get(item.id) ?? 0;
        return { ...item, amount_paid: paid, balance: item.amount - paid };
    });
}


export interface RecordFeeItemPaymentInput {
    fee_item_id: number;
    enrollment_id: number;
    amount: number;
    payment_date: string;
    payment_method: string;
    receipt_number?: string;
    notes?: string;
    recorded_by_id: number;
}

export interface RecordFeeItemPaymentResult {
    fee_item_payment: FeeItemPayment;
    cascaded_to_school_fees: boolean;
    school_fees_payment_id: number | null;
    message: string;
}

/**
 * Records a payment against a FeeItem with the strict-cascade rule:
 * if the FeeItem.requires_school_fees_paid is true AND the student still owes anything
 * on SchoolFees, the entire incoming amount is redirected to SchoolFees. The FeeItem
 * records a ledger row with cascaded_to_school_fees = true and amount = 0 effectively
 * counted toward the item (so balance does not move).
 */
export async function recordFeeItemPayment(input: RecordFeeItemPaymentInput): Promise<RecordFeeItemPaymentResult> {
    if (input.amount <= 0) throw new Error('amount must be greater than 0');
    const method = normalizePaymentMethod(input.payment_method);

    const feeItem = await prisma.feeItem.findUnique({ where: { id: input.fee_item_id } });
    if (!feeItem) throw new Error(`FeeItem ${input.fee_item_id} not found`);
    if (!feeItem.is_active) throw new Error(`FeeItem ${input.fee_item_id} is inactive`);

    const enrollment = await prisma.enrollment.findUnique({
        where: { id: input.enrollment_id },
        select: { id: true, academic_year_id: true, class_id: true, sub_class_id: true, student_id: true },
    });
    if (!enrollment) throw new Error(`Enrollment ${input.enrollment_id} not found`);
    if (enrollment.academic_year_id !== feeItem.academic_year_id) {
        throw new Error('FeeItem and Enrollment belong to different academic years');
    }

    // Scope check
    const scopeMatches =
        feeItem.scope === 'ALL' ||
        (feeItem.scope === 'CLASS' && feeItem.class_id === enrollment.class_id) ||
        (feeItem.scope === 'SUBCLASS' && feeItem.sub_class_id === enrollment.sub_class_id) ||
        (feeItem.scope === 'STUDENT' && feeItem.student_id === enrollment.student_id);
    if (!scopeMatches) {
        throw new Error(`FeeItem ${feeItem.id} does not apply to this enrollment (scope mismatch)`);
    }

    return prisma.$transaction(async (tx) => {
        let cascaded = false;
        let schoolFeesPaymentId: number | null = null;
        let message = 'Payment recorded against fee item';

        if (feeItem.requires_school_fees_paid) {
            // Look up the student's SchoolFees row for this year
            const schoolFees = await tx.schoolFees.findFirst({
                where: { enrollment_id: enrollment.id, academic_year_id: enrollment.academic_year_id },
            });

            if (!schoolFees) {
                throw new Error(`No SchoolFees record found for enrollment ${enrollment.id}; cannot evaluate cascade rule`);
            }

            const outstanding = schoolFees.amount_expected - schoolFees.amount_paid;
            if (outstanding > 0) {
                // STRICT CASCADE: the entire incoming amount goes to school fees, item gets 0.
                cascaded = true;
                // Shared ledger path: validation, sequential receipt number, atomic amount_paid update.
                const sfResult = await insertSchoolFeePayment({
                    fee_id: schoolFees.id,
                    enrollment_id: enrollment.id,
                    academic_year_id: enrollment.academic_year_id,
                    amount: input.amount,
                    payment_date: input.payment_date,
                    payment_method: method,
                    receipt_number: input.receipt_number ?? null,
                    recorded_by_id: input.recorded_by_id,
                    notes: `Cascaded from FeeItem #${feeItem.id} (${feeItem.name}): school fees were unpaid (${outstanding} outstanding). ${input.notes ?? ''}`.trim(),
                    overpayment_policy: 'allow',
                }, tx);
                schoolFeesPaymentId = sfResult.payment.id;

                message = `Payment of ${input.amount} was redirected to school fees (outstanding: ${outstanding}). FeeItem balance unchanged.`;
            }
        }

        // Always create a FeeItemPayment ledger row, even when cascaded — so the bursar
        // can see the attempted payment and that it was redirected.
        const feeItemPayment = await tx.feeItemPayment.create({
            data: {
                fee_item_id: feeItem.id,
                enrollment_id: enrollment.id,
                amount: input.amount,
                payment_date: new Date(input.payment_date),
                payment_method: method,
                receipt_number: input.receipt_number ?? null,
                notes: input.notes ?? null,
                recorded_by_id: input.recorded_by_id,
                cascaded_to_school_fees: cascaded,
                school_fees_payment_id: schoolFeesPaymentId,
            },
        });

        return {
            fee_item_payment: feeItemPayment,
            cascaded_to_school_fees: cascaded,
            school_fees_payment_id: schoolFeesPaymentId,
            message,
        };
    });
}

export async function getFeeItemPayments(feeItemId: number, enrollmentId?: number): Promise<FeeItemPayment[]> {
    return prisma.feeItemPayment.findMany({
        where: {
            fee_item_id: feeItemId,
            ...(enrollmentId && { enrollment_id: enrollmentId }),
        },
        include: {
            enrollment: { include: { student: true } },
            recorded_by: { select: { id: true, name: true, matricule: true } },
        },
        orderBy: { payment_date: 'desc' },
    });
}
