// src/api/v1/services/gceRegistrationService.ts
//
// GCE registration for the bursar: FORM 5 students register for the O Level
// (exactly 11 subjects, flat fee) and UPPER SIXTH students register for the
// A Level (3-5 subjects, fee scales with subject count and practicals).
// amount_expected is always recomputed server-side from the chosen subjects —
// never accepted from the client — so the fee can't be tampered with or drift
// from the published fee structure.

import prisma, { GceRegistration, GceRegistrationPayment, PaymentMethod } from '../../../config/db';
import { normalizePaymentMethod } from '../../../utils/paymentMethod';
import { getAcademicYearId } from '../../../utils/academicYear';

export class GceRegistrationError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

export type GceExamLevel = 'O_LEVEL' | 'A_LEVEL';

// FORM 5 (O Level): every student takes exactly this many subjects at a flat
// per-subject fee, plus fixed registration/stamps/handling/ICT-practical charges.
export const O_LEVEL_SUBJECT_COUNT = 11;
export const O_LEVEL_PER_SUBJECT_FEE = 1000;
export const O_LEVEL_REGISTRATION_FEE = 8000;
export const O_LEVEL_STAMPS_FEE = 1500;
export const O_LEVEL_HANDLING_FEE = 4000;
export const O_LEVEL_ICT_PRACTICAL_FEE = 5000;

// UPPER SIXTH (A Level): 3-5 subjects, per-subject fee, plus a practical
// surcharge for science/ICT subjects, on top of fixed registration/stamps/handling.
export const A_LEVEL_MIN_SUBJECTS = 3;
export const A_LEVEL_MAX_SUBJECTS = 5;
export const A_LEVEL_PER_SUBJECT_FEE = 2000;
export const A_LEVEL_REGISTRATION_FEE = 9000;
export const A_LEVEL_STAMPS_FEE = 1500;
export const A_LEVEL_HANDLING_FEE = 4000;
export const A_LEVEL_PRACTICAL_SURCHARGE = 5000;

// Subjects that carry an A Level practical surcharge. Matched case-insensitively
// against a substring of the subject name so "Computer Science" (this school's
// actual subject name for ICT) and "ICT" both match.
const PRACTICAL_SUBJECT_KEYWORDS = ['physics', 'chemistry', 'biology', 'ict', 'computer science'];

export function isPracticalSubjectName(name: string): boolean {
    const normalized = name.trim().toLowerCase();
    return PRACTICAL_SUBJECT_KEYWORDS.some(k => normalized.includes(k));
}

/** Which GCE level a class sits for, or null if the class doesn't register for the GCE at all. */
export function resolveExamLevel(className: string): GceExamLevel | null {
    const normalized = className.trim().toUpperCase();
    if (normalized === 'FORM 5') return 'O_LEVEL';
    if (normalized.includes('UPPER SIXTH')) return 'A_LEVEL';
    return null;
}

export interface FeeBreakdown {
    examLevel: GceExamLevel;
    subjectCount: number;
    practicalSubjectCount: number;
    perSubjectFee: number;
    practicalSurcharge: number;
    registrationFee: number;
    stampsFee: number;
    handlingFee: number;
    ictPracticalFee: number;
    amountExpected: number;
}

/**
 * Validates the subject count for the exam level and computes the total fee.
 * Throws GceRegistrationError(400) if the subject count is out of range.
 */
export function computeFee(examLevel: GceExamLevel, subjects: { id: number; name: string }[]): FeeBreakdown {
    const subjectCount = subjects.length;

    if (examLevel === 'O_LEVEL') {
        if (subjectCount !== O_LEVEL_SUBJECT_COUNT) {
            throw new GceRegistrationError(
                400,
                `FORM 5 (O Level) registration requires exactly ${O_LEVEL_SUBJECT_COUNT} subjects (got ${subjectCount}).`,
            );
        }
        const amountExpected =
            subjectCount * O_LEVEL_PER_SUBJECT_FEE + O_LEVEL_REGISTRATION_FEE + O_LEVEL_STAMPS_FEE + O_LEVEL_HANDLING_FEE + O_LEVEL_ICT_PRACTICAL_FEE;
        return {
            examLevel,
            subjectCount,
            practicalSubjectCount: 0,
            perSubjectFee: O_LEVEL_PER_SUBJECT_FEE,
            practicalSurcharge: 0,
            registrationFee: O_LEVEL_REGISTRATION_FEE,
            stampsFee: O_LEVEL_STAMPS_FEE,
            handlingFee: O_LEVEL_HANDLING_FEE,
            ictPracticalFee: O_LEVEL_ICT_PRACTICAL_FEE,
            amountExpected,
        };
    }

    // A_LEVEL
    if (subjectCount < A_LEVEL_MIN_SUBJECTS || subjectCount > A_LEVEL_MAX_SUBJECTS) {
        throw new GceRegistrationError(
            400,
            `UPPER SIXTH (A Level) registration requires between ${A_LEVEL_MIN_SUBJECTS} and ${A_LEVEL_MAX_SUBJECTS} subjects (got ${subjectCount}).`,
        );
    }
    const practicalSubjectCount = subjects.filter(s => isPracticalSubjectName(s.name)).length;
    const amountExpected =
        subjectCount * A_LEVEL_PER_SUBJECT_FEE +
        practicalSubjectCount * A_LEVEL_PRACTICAL_SURCHARGE +
        A_LEVEL_REGISTRATION_FEE +
        A_LEVEL_STAMPS_FEE +
        A_LEVEL_HANDLING_FEE;
    return {
        examLevel,
        subjectCount,
        practicalSubjectCount,
        perSubjectFee: A_LEVEL_PER_SUBJECT_FEE,
        practicalSurcharge: A_LEVEL_PRACTICAL_SURCHARGE,
        registrationFee: A_LEVEL_REGISTRATION_FEE,
        stampsFee: A_LEVEL_STAMPS_FEE,
        handlingFee: A_LEVEL_HANDLING_FEE,
        ictPracticalFee: 0,
        amountExpected,
    };
}

async function resolveEnrollmentContext(enrollmentId: number) {
    const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        include: {
            student: { select: { id: true, name: true, matricule: true } },
            class: { select: { id: true, name: true } },
            sub_class: { select: { id: true, name: true } },
        },
    });
    if (!enrollment) throw new GceRegistrationError(404, `Enrollment ${enrollmentId} not found`);

    const examLevel = resolveExamLevel(enrollment.class.name);
    if (!examLevel) {
        throw new GceRegistrationError(
            400,
            `${enrollment.class.name} does not register for the GCE (only FORM 5 and UPPER SIXTH do).`,
        );
    }
    return { enrollment, examLevel };
}

const registrationInclude = {
    subjects: { include: { subject: { select: { id: true, name: true, category: true } } } },
    payments: {
        orderBy: { payment_date: 'desc' as const },
        include: { recorded_by: { select: { id: true, name: true, matricule: true } } },
    },
} as const;

/**
 * Current registration state for an enrollment: the saved registration (if any),
 * plus the exam level / subject-count limits so the frontend can render the
 * right picker even before anything has been saved.
 */
export async function getRegistrationForEnrollment(enrollmentId: number) {
    const { enrollment, examLevel } = await resolveEnrollmentContext(enrollmentId);

    const registration = await prisma.gceRegistration.findFirst({
        where: { enrollment_id: enrollmentId },
        include: registrationInclude,
    });

    return {
        enrollment: {
            id: enrollment.id,
            student: enrollment.student,
            class: enrollment.class,
            sub_class: enrollment.sub_class,
        },
        exam_level: examLevel,
        min_subjects: examLevel === 'O_LEVEL' ? O_LEVEL_SUBJECT_COUNT : A_LEVEL_MIN_SUBJECTS,
        max_subjects: examLevel === 'O_LEVEL' ? O_LEVEL_SUBJECT_COUNT : A_LEVEL_MAX_SUBJECTS,
        registration,
        is_locked: !!registration && registration.amount_paid > 0,
    };
}

/**
 * Saves (creates or replaces) the subject list for an enrollment's GCE
 * registration and recomputes the fee. Blocked once any payment has been
 * recorded — the subject count/practicals the fee was charged on must not
 * move under a payment that's already been collected.
 */
export async function saveRegistrationSubjects(
    enrollmentId: number,
    subjectIds: number[],
    createdById: number,
): Promise<GceRegistration> {
    const { enrollment, examLevel } = await resolveEnrollmentContext(enrollmentId);

    const uniqueSubjectIds = [...new Set(subjectIds.map(Number))];
    if (uniqueSubjectIds.some(id => !Number.isInteger(id))) {
        throw new GceRegistrationError(400, 'subjectIds must be an array of integers');
    }

    if (!enrollment.sub_class) {
        throw new GceRegistrationError(400, 'This student has no subclass assigned yet.');
    }

    // Subjects must actually be taught in the student's subclass — a GCE
    // registration can't charge for a subject the school doesn't offer them.
    const offeredSubjects = await prisma.subClassSubject.findMany({
        where: { sub_class_id: enrollment.sub_class.id, subject_id: { in: uniqueSubjectIds } },
        include: { subject: { select: { id: true, name: true } } },
    });
    const offeredById = new Map(offeredSubjects.map(s => [s.subject_id, s.subject]));
    const notOffered = uniqueSubjectIds.filter(id => !offeredById.has(id));
    if (notOffered.length) {
        throw new GceRegistrationError(
            400,
            `Subject(s) [${notOffered.join(', ')}] are not taught in ${enrollment.sub_class.name}.`,
        );
    }

    const subjects = uniqueSubjectIds.map(id => offeredById.get(id)!);
    const breakdown = computeFee(examLevel, subjects);

    const academic_year_id = enrollment.academic_year_id ?? (await getAcademicYearId())!;

    const existing = await prisma.gceRegistration.findFirst({ where: { enrollment_id: enrollmentId } });
    if (existing && existing.amount_paid > 0) {
        throw new GceRegistrationError(
            409,
            'Subjects are locked: a payment has already been recorded against this registration.',
        );
    }

    const registrationId = await prisma.$transaction(async (tx) => {
        const registration = existing
            ? await tx.gceRegistration.update({
                where: { id: existing.id },
                data: { exam_level: examLevel, amount_expected: breakdown.amountExpected },
            })
            : await tx.gceRegistration.create({
                data: {
                    enrollment_id: enrollmentId,
                    academic_year_id,
                    exam_level: examLevel,
                    amount_expected: breakdown.amountExpected,
                    created_by_id: createdById,
                },
            });

        await tx.gceRegistrationSubject.deleteMany({ where: { gce_registration_id: registration.id } });
        await tx.gceRegistrationSubject.createMany({
            data: subjects.map(s => ({
                gce_registration_id: registration.id,
                subject_id: s.id,
                is_practical: examLevel === 'A_LEVEL' && isPracticalSubjectName(s.name),
            })),
        });

        return registration.id;
    });

    return (await prisma.gceRegistration.findUnique({
        where: { id: registrationId },
        include: registrationInclude,
    }))!;
}

export interface RecordGceRegistrationPaymentInput {
    amount: number;
    payment_date: string;
    payment_method: string;
    receipt_number?: string;
    notes?: string;
    recorded_by_id: number;
}

export async function recordPayment(
    registrationId: number,
    input: RecordGceRegistrationPaymentInput,
): Promise<{ payment: GceRegistrationPayment; registration: GceRegistration }> {
    if (!input.amount || input.amount <= 0) throw new GceRegistrationError(400, 'amount must be greater than 0');
    const method = normalizePaymentMethod(input.payment_method);

    const registration = await prisma.gceRegistration.findUnique({ where: { id: registrationId } });
    if (!registration) throw new GceRegistrationError(404, `GCE registration ${registrationId} not found`);

    const [payment, updated] = await prisma.$transaction([
        prisma.gceRegistrationPayment.create({
            data: {
                gce_registration_id: registrationId,
                amount: input.amount,
                payment_date: new Date(input.payment_date),
                payment_method: method,
                receipt_number: input.receipt_number ?? null,
                notes: input.notes ?? null,
                recorded_by_id: input.recorded_by_id,
            },
        }),
        prisma.gceRegistration.update({
            where: { id: registrationId },
            data: { amount_paid: { increment: input.amount } },
        }),
    ]);

    return { payment, registration: updated };
}

export async function getPayments(registrationId: number): Promise<GceRegistrationPayment[]> {
    return prisma.gceRegistrationPayment.findMany({
        where: { gce_registration_id: registrationId },
        include: { recorded_by: { select: { id: true, name: true, matricule: true } } },
        orderBy: { payment_date: 'desc' },
    });
}

export interface RosterFilter {
    academic_year_id?: number;
    exam_level?: GceExamLevel;
    class_id?: number;
    sub_class_id?: number;
}

/**
 * Every FORM 5 / UPPER SIXTH enrollment for the year, with its GCE
 * registration progress (if any) — the bursar's main worklist.
 */
export async function listRoster(filter: RosterFilter) {
    const academic_year_id = await getAcademicYearId(filter.academic_year_id);
    if (!academic_year_id) return [];

    const classes = await prisma.class.findMany({
        where: {
            OR: [{ name: 'FORM 5' }, { name: { contains: 'UPPER SIXTH' } }],
            ...(filter.class_id && { id: filter.class_id }),
        },
        select: { id: true, name: true },
    });
    const examLevelByClassId = new Map(classes.map(c => [c.id, resolveExamLevel(c.name)!]));
    const eligibleClassIds = classes
        .filter(c => !filter.exam_level || examLevelByClassId.get(c.id) === filter.exam_level)
        .map(c => c.id);
    if (!eligibleClassIds.length) return [];

    const enrollments = await prisma.enrollment.findMany({
        where: {
            academic_year_id,
            class_id: { in: eligibleClassIds },
            ...(filter.sub_class_id && { sub_class_id: filter.sub_class_id }),
            student: { status: { not: 'WITHDRAWN' } },
        },
        include: {
            student: { select: { id: true, name: true, matricule: true } },
            class: { select: { id: true, name: true } },
            sub_class: { select: { id: true, name: true } },
        },
        orderBy: { student: { name: 'asc' } },
    });

    const registrations = await prisma.gceRegistration.findMany({
        where: { enrollment_id: { in: enrollments.map(e => e.id) } },
        include: { subjects: true },
    });
    const registrationByEnrollment = new Map(registrations.map(r => [r.enrollment_id, r]));

    return enrollments.map(enrollment => {
        const registration = registrationByEnrollment.get(enrollment.id) ?? null;
        return {
            enrollment_id: enrollment.id,
            student: enrollment.student,
            class: enrollment.class,
            sub_class: enrollment.sub_class,
            exam_level: examLevelByClassId.get(enrollment.class_id)!,
            registration_id: registration?.id ?? null,
            subject_count: registration?.subjects.length ?? 0,
            amount_expected: registration?.amount_expected ?? 0,
            amount_paid: registration?.amount_paid ?? 0,
            balance: (registration?.amount_expected ?? 0) - (registration?.amount_paid ?? 0),
            is_locked: !!registration && registration.amount_paid > 0,
        };
    });
}
