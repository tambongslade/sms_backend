// Shared write path for school-fee payments (PaymentTransaction).
//
// Every endpoint that records a school-fee payment (POST /fees/:feeId/payments,
// POST /payments/primary, PAYMENT_CLAIM approval through feeService.recordPayment,
// fee-item cascades) goes through insertSchoolFeePayment so that:
//   - amount > 0 and payment date <= today are enforced in one place (M6)
//   - receipt numbers are sequential per school/academic year (M4) and unique (M6)
//   - overpayment is detected and, for interactive entry, must be confirmed (M6)
//   - the PaymentTransaction insert and SchoolFees.amount_paid increment are atomic
import prisma, { PaymentTransaction, Prisma } from '../../../config/db';
import { normalizePaymentMethod } from '../../../utils/paymentMethod';

// ---------------------------------------------------------------- errors

export class PaymentValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PaymentValidationError';
    }
}

export class DuplicateReceiptNumberError extends Error {
    public readonly existingPaymentId: number;
    constructor(receiptNumber: string, existingPaymentId: number) {
        super(`Receipt number ${receiptNumber} is already used by another payment.`);
        this.name = 'DuplicateReceiptNumberError';
        this.existingPaymentId = existingPaymentId;
    }
}

export class OverpaymentConfirmationRequiredError extends Error {
    public readonly amountExpected: number;
    public readonly amountPaid: number;
    public readonly balance: number;
    public readonly overpayment: number;
    constructor(amountExpected: number, amountPaid: number, amount: number) {
        const balance = Math.max(amountExpected - amountPaid, 0);
        const overpayment = amountPaid + amount - amountExpected;
        super(
            `This payment of ${fmt(amount)} FCFA exceeds the remaining balance of ${fmt(balance)} FCFA ` +
            `by ${fmt(overpayment)} FCFA. Confirm to record it as an overpayment.`
        );
        this.name = 'OverpaymentConfirmationRequiredError';
        this.amountExpected = amountExpected;
        this.amountPaid = amountPaid;
        this.balance = balance;
        this.overpayment = overpayment;
    }
}

function fmt(n: number): string {
    return Math.round(n).toLocaleString('en-US');
}

// ---------------------------------------------------------------- validation

const SCHOOL_TZ = 'Africa/Douala';

/** End of "today" in the school's timezone, as an absolute instant. */
function endOfTodayInSchoolTz(): Date {
    const now = new Date();
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(now); // YYYY-MM-DD
    // Africa/Douala is UTC+1 with no DST.
    return new Date(`${ymd}T23:59:59.999+01:00`);
}

export function parsePaymentAmount(raw: unknown): number {
    const amount = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new PaymentValidationError('Payment amount must be a number greater than 0.');
    }
    return amount;
}

export function parsePaymentDate(raw: unknown): Date {
    if (raw === undefined || raw === null || raw === '') return new Date();
    const d = raw instanceof Date ? raw : new Date(String(raw));
    if (isNaN(d.getTime())) throw new PaymentValidationError('Payment date is not a valid date.');
    if (d.getTime() > endOfTodayInSchoolTz().getTime()) {
        throw new PaymentValidationError('Payment date cannot be in the future.');
    }
    if (d.getUTCFullYear() < 2000) throw new PaymentValidationError('Payment date is too far in the past.');
    return d;
}

export function normalizeReceiptNumber(raw: unknown): string | null {
    if (raw === undefined || raw === null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    if (s.length > 64) throw new PaymentValidationError('Receipt number is too long (max 64 characters).');
    return s;
}

// ---------------------------------------------------------------- receipt numbers

// Format: <PREFIX>-<academic-year start year>-<6-digit sequence>, e.g. REC-2026-000123.
// RECEIPT_PREFIX lets an offline/local sync node use its own series so the VPS
// and the school server never mint the same number.
const RECEIPT_LOCK_KEY = 7_220_301; // arbitrary, stable advisory-lock key

function receiptPrefix(): string {
    return (process.env.RECEIPT_PREFIX || 'REC').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'REC';
}

async function receiptSeriesFor(tx: Prisma.TransactionClient, academicYearId: number): Promise<string> {
    const year = await tx.academicYear.findUnique({ where: { id: academicYearId }, select: { start_date: true } });
    const y = year?.start_date ? new Date(year.start_date).getUTCFullYear() : new Date().getUTCFullYear();
    return `${receiptPrefix()}-${y}-`;
}

/**
 * Next sequential receipt number. MUST be called inside a transaction: it takes a
 * transaction-scoped advisory lock so concurrent cashiers cannot get the same number.
 */
export async function nextReceiptNumber(tx: Prisma.TransactionClient, academicYearId: number): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RECEIPT_LOCK_KEY})`;
    const series = await receiptSeriesFor(tx, academicYearId);
    const pattern = `^${series}([0-9]+)$`; // series is [A-Z0-9-] only
    const rows = await tx.$queryRaw<{ max: number | null }[]>`
        SELECT MAX(CAST(substring(receipt_number from ${pattern}) AS INTEGER)) AS max
        FROM "PaymentTransaction"
        WHERE receipt_number ~ ${pattern}`;
    const next = (Number(rows?.[0]?.max) || 0) + 1;
    return `${series}${String(next).padStart(6, '0')}`;
}

export async function assertReceiptNumberAvailable(
    tx: Prisma.TransactionClient,
    receiptNumber: string,
    excludePaymentId?: number,
): Promise<void> {
    const clash = await tx.paymentTransaction.findFirst({
        where: {
            receipt_number: { equals: receiptNumber, mode: 'insensitive' },
            ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}),
        },
        select: { id: true },
    });
    if (clash) throw new DuplicateReceiptNumberError(receiptNumber, clash.id);
}

// ---------------------------------------------------------------- insert

export interface InsertSchoolFeePaymentInput {
    fee_id: number;
    enrollment_id: number;
    academic_year_id: number;
    amount: unknown;
    payment_date?: unknown;
    payment_method: string;
    receipt_number?: unknown;
    notes?: string | null;
    recorded_by_id?: number;
    /**
     * 'require_confirmation' (interactive desk entry): throws
     * OverpaymentConfirmationRequiredError unless confirm_overpayment is true.
     * 'allow' (approved claims, cascades): records it and reports the overpayment.
     */
    overpayment_policy?: 'require_confirmation' | 'allow';
    confirm_overpayment?: boolean;
}

export interface InsertSchoolFeePaymentResult {
    payment: PaymentTransaction;
    amount_expected: number;
    amount_paid: number;   // after this payment
    balance: number;       // max(expected - paid, 0)
    overpayment: number;   // max(paid - expected, 0)
    receipt_generated: boolean;
}

/** Validates the payload without touching the DB (used before fee auto-creation). */
export function preValidatePayment(input: { amount: unknown; payment_date?: unknown; payment_method: string; receipt_number?: unknown }) {
    return {
        amount: parsePaymentAmount(input.amount),
        payment_date: parsePaymentDate(input.payment_date),
        payment_method: normalizePaymentMethod(input.payment_method),
        receipt_number: normalizeReceiptNumber(input.receipt_number),
    };
}

export async function insertSchoolFeePayment(
    input: InsertSchoolFeePaymentInput,
    client?: Prisma.TransactionClient,
): Promise<InsertSchoolFeePaymentResult> {
    const v = preValidatePayment(input as any);

    const run = async (tx: Prisma.TransactionClient): Promise<InsertSchoolFeePaymentResult> => {
        const fee = await tx.schoolFees.findUnique({ where: { id: input.fee_id } });
        if (!fee) throw new PaymentValidationError(`Fee record ${input.fee_id} not found.`);

        if ((input.overpayment_policy ?? 'allow') === 'require_confirmation' && !input.confirm_overpayment) {
            if (fee.amount_paid + v.amount > fee.amount_expected + 0.0001) {
                throw new OverpaymentConfirmationRequiredError(fee.amount_expected, fee.amount_paid, v.amount);
            }
        }

        let receiptNumber = v.receipt_number;
        let generated = false;
        if (receiptNumber) {
            await assertReceiptNumberAvailable(tx, receiptNumber);
        } else {
            receiptNumber = await nextReceiptNumber(tx, input.academic_year_id);
            generated = true;
        }

        const data: any = {
            fee_id: input.fee_id,
            enrollment_id: input.enrollment_id,
            academic_year_id: input.academic_year_id,
            amount: v.amount,
            payment_date: v.payment_date,
            receipt_number: receiptNumber,
            payment_method: v.payment_method,
            notes: input.notes ?? null,
        };
        if (input.recorded_by_id !== undefined) data.recorded_by_id = input.recorded_by_id;

        const payment = await tx.paymentTransaction.create({ data });
        const updatedFee = await tx.schoolFees.update({
            where: { id: input.fee_id },
            data: { amount_paid: { increment: v.amount } },
        });

        return {
            payment,
            amount_expected: updatedFee.amount_expected,
            amount_paid: updatedFee.amount_paid,
            balance: Math.max(updatedFee.amount_expected - updatedFee.amount_paid, 0),
            overpayment: Math.max(updatedFee.amount_paid - updatedFee.amount_expected, 0),
            receipt_generated: generated,
        };
    };

    return client ? run(client) : prisma.$transaction(run);
}

// ---------------------------------------------------------------- HTTP mapping

/** Maps payment-ledger errors to { status, body } for controllers; null if not ours. */
export function paymentErrorToHttp(error: any): { status: number; body: Record<string, any> } | null {
    if (error instanceof OverpaymentConfirmationRequiredError) {
        return {
            status: 409,
            body: {
                success: false,
                error: error.message,
                code: 'OVERPAYMENT_CONFIRMATION_REQUIRED',
                amountExpected: error.amountExpected,
                amountPaid: error.amountPaid,
                balance: error.balance,
                overpayment: error.overpayment,
            },
        };
    }
    if (error instanceof DuplicateReceiptNumberError) {
        return {
            status: 409,
            body: { success: false, error: error.message, code: 'DUPLICATE_RECEIPT', existingPaymentId: error.existingPaymentId },
        };
    }
    if (error instanceof PaymentValidationError || error?.name === 'InvalidPaymentMethodError') {
        return { status: 400, body: { success: false, error: error.message } };
    }
    return null;
}
