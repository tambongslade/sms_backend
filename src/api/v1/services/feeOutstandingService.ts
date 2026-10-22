// One definition of "outstanding school fees" for every screen (M8).
//
// Before this module, Overview, Fee Defaulters, Fee Statistics and Reports each
// summed SchoolFees on their own, with different populations (withdrawn students
// in or out, unplaced students in or out) and different overpayment handling
// (some netted overpayments against other students' debts). Every caller now uses
// these rules:
//
//   population   : SchoolFees rows of the academic year whose student is not WITHDRAWN
//   class        : sub_class.class when placed, else enrollment.class (registered, not yet placed)
//   paid         : SchoolFees.amount_paid (running total maintained by the payment ledger)
//   balance      : max(expected - paid, 0)            -> summed into "outstanding"
//   overpayment  : max(paid - expected, 0)            -> never offsets someone else's debt
//   reconciliation (always holds):  expected - collected + overpayments = outstanding
import prisma, { Prisma } from '../../../config/db';
import { listPaymentMethods } from '../../../utils/paymentMethod';

export const ACTIVE_FEE_ROW_WHERE: Prisma.SchoolFeesWhereInput = {
    enrollment: { student: { status: { not: 'WITHDRAWN' } } },
};

export interface FeeBalanceRow {
    fee_id: number;
    enrollment_id: number;
    student_id: number;
    student_name: string;
    matricule: string;
    class_id: number | null;
    class_name: string;
    sub_class_id: number | null;
    sub_class_name: string | null;
    amount_expected: number;
    amount_paid: number;
    balance: number;
    overpayment: number;
    due_date: Date;
}

export interface OutstandingTotals {
    student_count: number;
    students_owing: number;
    students_paid_in_full: number;
    students_overpaid: number;
    students_not_paid_anything: number;
    total_expected: number;
    total_collected: number;
    total_outstanding: number;
    total_overpayments: number;
    /** Human-readable proof line shown under the totals on every screen. */
    reconciliation: {
        expected: number;
        collected: number;
        overpayments: number;
        outstanding: number;
        formula: string;
    };
}

export interface BalanceFilter {
    classId?: number;
    subClassId?: number;
}

function filterWhere(yearId: number, f: BalanceFilter = {}): Prisma.SchoolFeesWhereInput {
    const and: Prisma.SchoolFeesWhereInput[] = [{ academic_year_id: yearId }, ACTIVE_FEE_ROW_WHERE];
    if (f.subClassId) and.push({ enrollment: { sub_class_id: f.subClassId } });
    if (f.classId) {
        and.push({
            OR: [
                { enrollment: { sub_class: { class_id: f.classId } } },
                { enrollment: { sub_class_id: null, class_id: f.classId } },
            ],
        });
    }
    return { AND: and };
}

export async function getFeeBalances(yearId: number, f: BalanceFilter = {}): Promise<FeeBalanceRow[]> {
    const rows = await prisma.schoolFees.findMany({
        where: filterWhere(yearId, f),
        select: {
            id: true,
            enrollment_id: true,
            amount_expected: true,
            amount_paid: true,
            due_date: true,
            enrollment: {
                select: {
                    student: { select: { id: true, name: true, matricule: true } },
                    class: { select: { id: true, name: true } },
                    sub_class: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
                },
            },
        },
    });
    return rows.map(r => {
        const expected = r.amount_expected || 0;
        const paid = r.amount_paid || 0;
        const cls = r.enrollment.sub_class?.class ?? r.enrollment.class;
        return {
            fee_id: r.id,
            enrollment_id: r.enrollment_id,
            student_id: r.enrollment.student.id,
            student_name: r.enrollment.student.name,
            matricule: r.enrollment.student.matricule,
            class_id: cls?.id ?? null,
            class_name: cls?.name ?? 'Unassigned',
            sub_class_id: r.enrollment.sub_class?.id ?? null,
            sub_class_name: r.enrollment.sub_class?.name ?? null,
            amount_expected: expected,
            amount_paid: paid,
            balance: Math.max(expected - paid, 0),
            overpayment: Math.max(paid - expected, 0),
            due_date: r.due_date,
        };
    });
}

export function summarizeBalances(rows: Pick<FeeBalanceRow, 'amount_expected' | 'amount_paid' | 'balance' | 'overpayment'>[]): OutstandingTotals {
    let expected = 0, collected = 0, outstanding = 0, overpayments = 0;
    let owing = 0, paidInFull = 0, overpaid = 0, nothing = 0;
    for (const r of rows) {
        expected += r.amount_expected;
        collected += r.amount_paid;
        outstanding += r.balance;
        overpayments += r.overpayment;
        if (r.balance > 0) owing++; else paidInFull++;
        if (r.overpayment > 0) overpaid++;
        if (r.amount_paid <= 0 && r.amount_expected > 0) nothing++;
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
    return {
        student_count: rows.length,
        students_owing: owing,
        students_paid_in_full: paidInFull,
        students_overpaid: overpaid,
        students_not_paid_anything: nothing,
        total_expected: round(expected),
        total_collected: round(collected),
        total_outstanding: round(outstanding),
        total_overpayments: round(overpayments),
        reconciliation: {
            expected: round(expected),
            collected: round(collected),
            overpayments: round(overpayments),
            outstanding: round(outstanding),
            formula: `${fmt(expected)} expected − ${fmt(collected)} collected + ${fmt(overpayments)} overpayments = ${fmt(outstanding)} outstanding`,
        },
    };
}

export async function getOutstandingSummary(yearId: number, f: BalanceFilter = {}): Promise<OutstandingTotals & {
    enrollments_without_fee_record: number;
}> {
    const [rows, missing] = await Promise.all([
        getFeeBalances(yearId, f),
        prisma.enrollment.count({
            where: {
                academic_year_id: yearId,
                student: { status: { not: 'WITHDRAWN' } },
                school_fees: { none: { academic_year_id: yearId } },
                ...(f.subClassId ? { sub_class_id: f.subClassId } : {}),
                ...(f.classId ? { OR: [{ sub_class: { class_id: f.classId } }, { sub_class_id: null, class_id: f.classId }] } : {}),
            },
        }),
    ]);
    return { ...summarizeBalances(rows), enrollments_without_fee_record: missing };
}

/**
 * Transactions per payment method for the academic year, every method listed
 * (zeros included) with its display label. Same population as the payment-method
 * analytics report: all PaymentTransaction rows of the year.
 */
export async function getPaymentMethodTotals(yearId: number, range?: { from?: Date; to?: Date }) {
    const where: Prisma.PaymentTransactionWhereInput = {
        academic_year_id: yearId,
        ...(range?.from || range?.to ? { payment_date: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } } : {}),
    };
    const grouped = await prisma.paymentTransaction.groupBy({
        by: ['payment_method'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
    });
    const byMethod = new Map(grouped.map(g => [g.payment_method as string, g]));
    return listPaymentMethods().map(({ value, label }) => {
        const g = byMethod.get(value);
        return {
            method: value,
            label,
            count: g?._count._all ?? 0,
            totalAmount: g?._sum.amount ?? 0,
        };
    });
}
