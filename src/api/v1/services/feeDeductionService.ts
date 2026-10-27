import prisma, { FeeDeduction, Prisma } from '../../../config/db';
import * as studentService from './studentService';

export interface ApplyFeeDeductionInput {
    school_fees_id: number;
    amount: number;
    is_personnel_child: boolean;
    personnel_id?: number;
    reason?: string;
    created_by_id: number;
    /** Set once the caller has seen and dismissed the "already applied" warning. */
    confirm_duplicate?: boolean;
}

export class DuplicateDeductionError extends Error {
    statusCode = 409;
    code = 'DEDUCTION_ALREADY_APPLIED';
    existing: FeeDeduction[];
    constructor(existing: FeeDeduction[]) {
        super('A fee reduction has already been applied to this student for this fee record.');
        this.existing = existing;
    }
}

const DEDUCTION_INCLUDE = {
    enrollment: {
        include: {
            student: { select: { id: true, name: true, matricule: true } },
            class: { select: { id: true, name: true } },
            sub_class: { select: { id: true, name: true } },
            academic_year: { select: { id: true, name: true } },
        },
    },
    personnel: { select: { id: true, name: true, matricule: true } },
    created_by: { select: { id: true, name: true } },
} satisfies Prisma.FeeDeductionInclude;

export async function applyFeeDeduction(input: ApplyFeeDeductionInput): Promise<FeeDeduction> {
    if (!input.amount || input.amount <= 0) {
        throw new Error('amount must be greater than 0');
    }
    if (input.is_personnel_child) {
        if (!input.personnel_id) {
            throw new Error('personnel_id is required when is_personnel_child is true');
        }
    } else if (!input.reason || !input.reason.trim()) {
        throw new Error('reason is required when the student is not a child of a personnel');
    }

    const fee = await prisma.schoolFees.findUnique({ where: { id: input.school_fees_id } });
    if (!fee) throw new Error(`Fee with ID ${input.school_fees_id} not found`);

    if (input.amount > fee.amount_expected) {
        throw new Error(`Deduction amount (${input.amount}) exceeds the amount expected (${fee.amount_expected})`);
    }

    if (!input.confirm_duplicate) {
        const existing = await prisma.feeDeduction.findMany({
            where: { school_fees_id: input.school_fees_id },
            include: DEDUCTION_INCLUDE,
            orderBy: { created_at: 'desc' },
        });
        if (existing.length > 0) {
            throw new DuplicateDeductionError(existing);
        }
    }

    const deduction = await prisma.$transaction(async (tx) => {
        const amountExpectedAfter = Math.round((fee.amount_expected - input.amount) * 100) / 100;

        const updated = await tx.schoolFees.update({
            where: { id: fee.id },
            data: { amount_expected: amountExpectedAfter },
        });

        return tx.feeDeduction.create({
            data: {
                enrollment_id: fee.enrollment_id,
                school_fees_id: fee.id,
                amount: input.amount,
                amount_expected_before: fee.amount_expected,
                amount_expected_after: updated.amount_expected,
                is_personnel_child: input.is_personnel_child,
                personnel_id: input.is_personnel_child ? input.personnel_id : null,
                reason: input.is_personnel_child ? null : input.reason!.trim(),
                created_by_id: input.created_by_id,
            },
            include: DEDUCTION_INCLUDE,
        });
    });

    if (input.is_personnel_child && input.personnel_id) {
        try {
            await studentService.linkParent(deduction.enrollment.student.id, {
                parent_id: input.personnel_id,
                relationship: 'GUARDIAN',
            });
        } catch (error: any) {
            // Already linked from an earlier deduction (or set up some other way) — not an error here.
            if (!String(error.message).includes('already linked')) throw error;
        }
    }

    return deduction;
}

export interface ListFeeDeductionsOptions {
    student_id?: number;
    enrollment_id?: number;
    academic_year_id?: number;
    page?: number;
    limit?: number;
}

export async function listFeeDeductions(opts: ListFeeDeductionsOptions) {
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 25;

    const where: Prisma.FeeDeductionWhereInput = {
        ...(opts.enrollment_id ? { enrollment_id: opts.enrollment_id } : {}),
        ...(opts.student_id ? { enrollment: { student_id: opts.student_id } } : {}),
        ...(opts.academic_year_id ? { enrollment: { academic_year_id: opts.academic_year_id } } : {}),
    };

    const [total, deductions] = await Promise.all([
        prisma.feeDeduction.count({ where }),
        prisma.feeDeduction.findMany({
            where,
            include: DEDUCTION_INCLUDE,
            orderBy: { created_at: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return {
        data: deductions,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

export async function deleteFeeDeduction(id: number): Promise<void> {
    const deduction = await prisma.feeDeduction.findUnique({ where: { id } });
    if (!deduction) throw new Error(`Fee deduction ${id} not found`);

    await prisma.$transaction(async (tx) => {
        await tx.schoolFees.update({
            where: { id: deduction.school_fees_id },
            data: { amount_expected: { increment: deduction.amount } },
        });
        await tx.feeDeduction.delete({ where: { id } });
    });
}
