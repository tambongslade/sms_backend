// src/api/v1/services/unifiedPaymentService.ts
import prisma, { SchoolFees, ControlSchoolFees, PaymentTransaction, ControlPaymentTransaction, PaymentMethod } from '../../../config/db';
import { normalizePaymentMethod } from '../../../utils/paymentMethod';
import * as ledger from './paymentLedgerService';
import { computeExpectedFee, ensureSchoolFeeForEnrollment } from './feeService';
import { getAcademicYearId, getStudentSubclassByStudentAndYear } from '../../../utils/academicYear';
import { shouldPayNewStudentFees } from '../../../utils/studentStatus';

export class DuplicatePaymentError extends Error {
    public readonly existingPaymentId: number;
    public readonly secondsAgo: number;
    constructor(message: string, existingPaymentId: number, secondsAgo: number) {
        super(message);
        this.name = 'DuplicatePaymentError';
        this.existingPaymentId = existingPaymentId;
        this.secondsAgo = secondsAgo;
    }
}

export const DUPLICATE_PAYMENT_WINDOW_SECONDS = 60;


/**
 * Calculate fee amount for a student based on their class
 */
async function calculateStudentFeeAmount(enrollmentId: number, academicYearId: number): Promise<number> {
    const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        include: {
            student: true,
            sub_class: {
                include: { class: true }
            }
        }
    });

    if (!enrollment) {
        throw new Error('Enrollment not found');
    }
    // Students registered to a class but not yet placed in a sub-class still owe fees.
    const classInfo = enrollment.sub_class?.class
        ?? await prisma.class.findUnique({ where: { id: enrollment.class_id } });
    if (!classInfo) {
        throw new Error('Class information not found for this enrollment');
    }

    // base_fee already includes the three term fees; computeExpectedFee is the
    // shared formula (adding term fees again here used to double-count them).
    const shouldPayNewFees = await shouldPayNewStudentFees(enrollment.student_id, academicYearId);
    return computeExpectedFee(classInfo, shouldPayNewFees);
}

/**
 * Record payment for primary fees - creates fee if it doesn't exist
 */
export async function recordPrimaryPaymentWithFee(data: {
    amount: number;
    payment_date: string;
    receipt_number?: string;
    payment_method: string;
    enrollment_id?: number;
    student_id?: number;
    academic_year_id?: number;
    recorded_by_id?: number;
    notes?: string | null;
    overpayment_policy?: 'require_confirmation' | 'allow';
    confirm_overpayment?: boolean;
}): Promise<{ payment: PaymentTransaction; fee: SchoolFees; feeCreated: boolean; ledger: Omit<ledger.InsertSchoolFeePaymentResult, 'payment'> }> {
    // Reject bad amount / future date / unknown method / malformed receipt before
    // anything is written (including the auto-created fee row).
    const validated = ledger.preValidatePayment(data);
    data.amount = validated.amount;

    // Convert student_id to enrollment_id if needed
    if (data.student_id && !data.enrollment_id) {
        const studentId = typeof data.student_id === 'string' ? parseInt(data.student_id, 10) : data.student_id;
        const yearId = data.academic_year_id || await getAcademicYearId();
        if (!yearId) {
            throw new Error("Academic year ID is required to find enrollment by student ID, but none was provided or found.");
        }
        const enrollment = await getStudentSubclassByStudentAndYear(studentId, yearId);
        if (!enrollment) {
            throw new Error(`Student with ID ${studentId} not enrolled in academic year ${yearId}`);
        }
        data.enrollment_id = enrollment.id;
    }

    if (!data.enrollment_id) {
        throw new Error('Enrollment ID is required to record a payment.');
    }

    const normalizedPaymentMethod = normalizePaymentMethod(data.payment_method);
    const academicYearId = data.academic_year_id || await getAcademicYearId();
    if (!academicYearId) {
        throw new Error("Academic year ID is required to record a payment, but none was provided or found.");
    }

    // Fee row normally exists from enrolment; create it with the shared rules if not.
    const enrollmentRow = await prisma.enrollment.findUnique({ where: { id: data.enrollment_id }, select: { academic_year_id: true } });
    if (!enrollmentRow) throw new Error(`Enrollment with ID ${data.enrollment_id} not found`);
    if (enrollmentRow.academic_year_id !== academicYearId) {
        throw new ledger.PaymentValidationError('The enrollment does not belong to the selected academic year.');
    }
    const ensured = await ensureSchoolFeeForEnrollment(data.enrollment_id);
    const fee = ensured.fee;
    const feeCreated = ensured.created;

    const primaryWindowStart = new Date(Date.now() - DUPLICATE_PAYMENT_WINDOW_SECONDS * 1000);
    const recentPrimaryDuplicate = await prisma.paymentTransaction.findFirst({
        where: {
            enrollment_id: data.enrollment_id,
            amount: data.amount,
            payment_method: normalizedPaymentMethod,
            created_at: { gte: primaryWindowStart },
        },
        orderBy: { created_at: 'desc' },
    });
    if (recentPrimaryDuplicate) {
        const secondsAgo = Math.round((Date.now() - recentPrimaryDuplicate.created_at.getTime()) / 1000);
        throw new DuplicatePaymentError(
            `Duplicate payment detected — a payment of ${data.amount} via ${normalizedPaymentMethod} for this student was recorded ${secondsAgo} second(s) ago. If this is intentional, wait ${DUPLICATE_PAYMENT_WINDOW_SECONDS} seconds and retry.`,
            recentPrimaryDuplicate.id,
            secondsAgo,
        );
    }

    const result = await ledger.insertSchoolFeePayment({
        fee_id: fee.id,
        enrollment_id: data.enrollment_id,
        academic_year_id: academicYearId,
        amount: data.amount,
        payment_date: data.payment_date,
        payment_method: normalizedPaymentMethod,
        receipt_number: data.receipt_number,
        notes: data.notes ?? null,
        recorded_by_id: data.recorded_by_id,
        overpayment_policy: data.overpayment_policy ?? 'allow',
        confirm_overpayment: data.confirm_overpayment,
    });

    const updatedFee = await prisma.schoolFees.findUniqueOrThrow({ where: { id: fee.id } });
    const { payment, ...summary } = result;
    return { payment, fee: updatedFee, feeCreated, ledger: summary };
}

/**
 * Record payment for control fees - creates fee if it doesn't exist
 */
export async function recordControlPaymentWithFee(data: {
    amount: number;
    payment_date: string;
    receipt_number?: string;
    payment_method: string;
    enrollment_id?: number;
    student_id?: number;
    academic_year_id?: number;
    recorded_by_id?: number;
}): Promise<{ payment: ControlPaymentTransaction; fee: ControlSchoolFees; feeCreated: boolean }> {

    // Convert student_id to enrollment_id if needed
    if (data.student_id && !data.enrollment_id) {
        const studentId = typeof data.student_id === 'string' ? parseInt(data.student_id, 10) : data.student_id;
        const yearId = data.academic_year_id || await getAcademicYearId();
        if (!yearId) {
            throw new Error("Academic year ID is required to find enrollment by student ID, but none was provided or found.");
        }
        const enrollment = await getStudentSubclassByStudentAndYear(studentId, yearId);
        if (!enrollment) {
            throw new Error(`Student with ID ${studentId} not enrolled in academic year ${yearId}`);
        }
        data.enrollment_id = enrollment.id;
    }

    if (!data.enrollment_id) {
        throw new Error('Enrollment ID is required to record a control payment.');
    }

    const normalizedPaymentMethod = normalizePaymentMethod(data.payment_method);
    const academicYearId = data.academic_year_id || await getAcademicYearId();
    if (!academicYearId) {
        throw new Error("Academic year ID is required to record a control payment, but none was provided or found.");
    }

    // Check if control fee already exists
    let fee = await prisma.controlSchoolFees.findFirst({
        where: {
            enrollment_id: data.enrollment_id,
            academic_year_id: academicYearId
        }
    });

    let feeCreated = false;

    // Create control fee if it doesn't exist
    if (!fee) {
        const expectedAmount = await calculateStudentFeeAmount(data.enrollment_id, academicYearId);

        // Get academic year for due date
        const academicYear = await prisma.academicYear.findUnique({
            where: { id: academicYearId }
        });

        fee = await prisma.controlSchoolFees.create({
            data: {
                enrollment_id: data.enrollment_id,
                academic_year_id: academicYearId,
                amount_expected: expectedAmount,
                amount_paid: 0,
                due_date: academicYear?.end_date || new Date(new Date().getFullYear(), 11, 31)
            }
        });
        feeCreated = true;
    }

    const controlWindowStart = new Date(Date.now() - DUPLICATE_PAYMENT_WINDOW_SECONDS * 1000);
    const recentControlDuplicate = await prisma.controlPaymentTransaction.findFirst({
        where: {
            enrollment_id: data.enrollment_id,
            amount: data.amount,
            payment_method: normalizedPaymentMethod,
            created_at: { gte: controlWindowStart },
        },
        orderBy: { created_at: 'desc' },
    });
    if (recentControlDuplicate) {
        const secondsAgo = Math.round((Date.now() - recentControlDuplicate.created_at.getTime()) / 1000);
        throw new DuplicatePaymentError(
            `Duplicate control payment detected — a payment of ${data.amount} via ${normalizedPaymentMethod} for this student was recorded ${secondsAgo} second(s) ago. If this is intentional, wait ${DUPLICATE_PAYMENT_WINDOW_SECONDS} seconds and retry.`,
            recentControlDuplicate.id,
            secondsAgo,
        );
    }

    // Create control payment transaction
    const createData: any = {
        control_fee_id: fee.id,
        enrollment_id: data.enrollment_id,
        academic_year_id: academicYearId,
        amount: data.amount,
        payment_date: new Date(data.payment_date),
        receipt_number: data.receipt_number,
        payment_method: normalizedPaymentMethod,
    };

    if (data.recorded_by_id !== undefined) {
        createData.recorded_by_id = data.recorded_by_id;
    }

    const payment = await prisma.controlPaymentTransaction.create({
        data: createData,
    });

    // Update the amount_paid in the ControlSchoolFees record
    const updatedFee = await prisma.controlSchoolFees.update({
        where: { id: fee.id },
        data: {
            amount_paid: {
                increment: data.amount
            }
        }
    });

    return { payment, fee: updatedFee, feeCreated };
}