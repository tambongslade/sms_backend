// Staff loan service: request / cancel / modify (requester), approve / reject
// (super manager picks the repayment method), and repayment recording.

import prisma, { LoanRepaymentMethod, LoanStatus } from '../../../config/db';

const ACTIVE_STATUSES: LoanStatus[] = ['PENDING', 'APPROVED'];

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

function computeMonthlyInstallment(amount: number, durationMonths: number): number {
    if (durationMonths <= 0) throw new Error('Duration must be at least 1 month');
    return roundMoney(amount / durationMonths);
}

const loanInclude = {
    borrower: { select: { id: true, name: true, matricule: true, email: true } },
    approver: { select: { id: true, name: true } },
    repayments: {
        include: {
            recorded_by: { select: { id: true, name: true } },
        },
        orderBy: { paid_on: 'asc' as const },
    },
};

async function ensureNoActiveLoan(borrowerId: number) {
    const existing = await prisma.staffLoan.findFirst({
        where: { borrower_id: borrowerId, status: { in: ACTIVE_STATUSES } },
        select: { id: true, status: true },
    });
    if (existing) {
        throw new Error(
            `You already have a ${existing.status.toLowerCase()} loan (#${existing.id}). Close it before requesting another.`,
        );
    }
}

export async function requestLoan(input: {
    borrowerId: number;
    amount: number;
    durationMonths: number;
    reason?: string;
}) {
    if (!input.amount || input.amount <= 0) throw new Error('Amount must be positive');
    if (!Number.isInteger(input.durationMonths) || input.durationMonths <= 0) {
        throw new Error('Duration must be a positive whole number of months');
    }
    await ensureNoActiveLoan(input.borrowerId);

    return prisma.staffLoan.create({
        data: {
            borrower_id: input.borrowerId,
            amount: roundMoney(input.amount),
            duration_months: input.durationMonths,
            monthly_installment: computeMonthlyInstallment(input.amount, input.durationMonths),
            reason: input.reason?.trim() || null,
        },
        include: loanInclude,
    });
}

export async function modifyLoan(
    loanId: number,
    requesterId: number,
    changes: { amount?: number; durationMonths?: number; reason?: string | null },
) {
    const loan = await prisma.staffLoan.findUnique({ where: { id: loanId }, select: { id: true, borrower_id: true, status: true } });
    if (!loan) throw new Error('Loan not found');
    if (loan.borrower_id !== requesterId) throw new Error('You can only modify your own loan requests');
    if (loan.status !== 'PENDING') throw new Error('Only pending loans can be modified');

    const nextAmount = changes.amount != null ? roundMoney(changes.amount) : undefined;
    const nextDuration = changes.durationMonths != null ? changes.durationMonths : undefined;

    if (nextAmount != null && nextAmount <= 0) throw new Error('Amount must be positive');
    if (nextDuration != null && (!Number.isInteger(nextDuration) || nextDuration <= 0)) {
        throw new Error('Duration must be a positive whole number of months');
    }

    // Fetch current values to compute the new monthly installment consistently.
    const current = await prisma.staffLoan.findUnique({
        where: { id: loanId },
        select: { amount: true, duration_months: true },
    });
    if (!current) throw new Error('Loan not found');

    const finalAmount = nextAmount ?? current.amount;
    const finalDuration = nextDuration ?? current.duration_months;

    return prisma.staffLoan.update({
        where: { id: loanId },
        data: {
            amount: finalAmount,
            duration_months: finalDuration,
            monthly_installment: computeMonthlyInstallment(finalAmount, finalDuration),
            ...(changes.reason !== undefined ? { reason: changes.reason?.trim() || null } : {}),
        },
        include: loanInclude,
    });
}

export async function cancelLoan(loanId: number, requesterId: number) {
    const loan = await prisma.staffLoan.findUnique({ where: { id: loanId }, select: { borrower_id: true, status: true } });
    if (!loan) throw new Error('Loan not found');
    if (loan.borrower_id !== requesterId) throw new Error('You can only cancel your own loan requests');
    if (loan.status !== 'PENDING') throw new Error('Only pending loans can be cancelled');

    return prisma.staffLoan.update({
        where: { id: loanId },
        data: { status: 'CANCELLED', cancelled_at: new Date() },
        include: loanInclude,
    });
}

export async function approveLoan(
    loanId: number,
    approverId: number,
    input: { repaymentMethod: LoanRepaymentMethod; note?: string },
) {
    const loan = await prisma.staffLoan.findUnique({ where: { id: loanId }, select: { status: true } });
    if (!loan) throw new Error('Loan not found');
    if (loan.status !== 'PENDING') throw new Error('Only pending loans can be approved');
    if (!input.repaymentMethod) throw new Error('Repayment method is required');

    return prisma.staffLoan.update({
        where: { id: loanId },
        data: {
            status: 'APPROVED',
            repayment_method: input.repaymentMethod,
            approver_id: approverId,
            approver_note: input.note?.trim() || null,
            approved_at: new Date(),
        },
        include: loanInclude,
    });
}

export async function rejectLoan(loanId: number, approverId: number, note: string) {
    const loan = await prisma.staffLoan.findUnique({ where: { id: loanId }, select: { status: true } });
    if (!loan) throw new Error('Loan not found');
    if (loan.status !== 'PENDING') throw new Error('Only pending loans can be rejected');
    if (!note || !note.trim()) throw new Error('A rejection note is required');

    return prisma.staffLoan.update({
        where: { id: loanId },
        data: {
            status: 'REJECTED',
            approver_id: approverId,
            approver_note: note.trim(),
            approved_at: new Date(),
        },
        include: loanInclude,
    });
}

export async function recordRepayment(
    loanId: number,
    recorderId: number,
    input: { amount: number; paidOn?: string | Date; method?: LoanRepaymentMethod; notes?: string },
) {
    if (!input.amount || input.amount <= 0) throw new Error('Amount must be positive');

    const loan = await prisma.staffLoan.findUnique({
        where: { id: loanId },
        include: { repayments: { select: { amount: true } } },
    });
    if (!loan) throw new Error('Loan not found');
    if (loan.status !== 'APPROVED') throw new Error('Only approved loans can receive repayments');

    const method = input.method ?? loan.repayment_method ?? 'CASH';
    const paidOn = input.paidOn ? new Date(input.paidOn) : new Date();
    if (Number.isNaN(paidOn.getTime())) throw new Error('Invalid paid_on date');

    const alreadyPaid = loan.repayments.reduce((sum, r) => sum + r.amount, 0);
    const outstanding = roundMoney(loan.amount - alreadyPaid);
    const amount = roundMoney(input.amount);
    if (amount - outstanding > 0.01) {
        throw new Error(`Amount ${amount} exceeds outstanding balance ${outstanding}`);
    }

    return prisma.$transaction(async (tx) => {
        const repayment = await tx.staffLoanRepayment.create({
            data: {
                loan_id: loanId,
                amount,
                paid_on: paidOn,
                method,
                notes: input.notes?.trim() || null,
                recorded_by_id: recorderId,
            },
            include: { recorded_by: { select: { id: true, name: true } } },
        });

        const newBalance = roundMoney(outstanding - amount);
        if (newBalance <= 0.009) {
            await tx.staffLoan.update({
                where: { id: loanId },
                data: { status: 'PAID_OFF', paid_off_at: new Date() },
            });
        }

        const refreshed = await tx.staffLoan.findUnique({
            where: { id: loanId },
            include: loanInclude,
        });
        return { repayment, loan: refreshed };
    });
}

export async function getLoanById(loanId: number) {
    return prisma.staffLoan.findUnique({ where: { id: loanId }, include: loanInclude });
}

export async function listLoans(filters: {
    borrowerId?: number;
    status?: LoanStatus | LoanStatus[];
} = {}) {
    return prisma.staffLoan.findMany({
        where: {
            ...(filters.borrowerId ? { borrower_id: filters.borrowerId } : {}),
            ...(filters.status
                ? Array.isArray(filters.status)
                    ? { status: { in: filters.status } }
                    : { status: filters.status }
                : {}),
        },
        include: loanInclude,
        orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    });
}
