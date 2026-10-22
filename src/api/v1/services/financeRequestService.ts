import prisma, {
    FinanceRequest, FinanceRequestType, FinanceRequestStatus, Role, Prisma,
} from '../../../config/db';
import { RoleTier, userHasMinTier } from '../../../utils/roleHierarchy';
import * as feeService from './feeService';
import * as feeRefundService from './feeRefundService';
import * as notificationService from './notificationService';
import { getAcademicYearId } from '../../../utils/academicYear';

// ---------- Payload typing ----------
export interface FeeReductionPayload {
    enrollmentId: number;
    partnerName?: string;
}

export interface PersonnelDisbursementPayload {
    recipientUserId: number;
    purpose: string;
}

export interface BankVerificationPayload {
    studentId: number;
    claimedAmount?: number;
    estimatedPaymentPeriod: string; // e.g. "2026-03 to 2026-04"
}

// Parent (or Bursar+ on their behalf) submits proof of a payment they made.
// Bursar validates → on APPROVE we create the real PaymentTransaction.
export interface PaymentClaimPayload {
    enrollmentId?: number;        // preferred
    studentId?: number;           // fallback — resolved to current-year enrollment
    feeId?: number;               // if omitted we pick the current-year SchoolFees row
    paymentMethod: string;        // PaymentMethod enum
    paymentDate: string;          // ISO date on the receipt
    receiptNumber?: string;
}

// Bursar initiates a refund for an overpayment. SUPER_MANAGER approves.
// On APPROVE we create the real Refund (which decrements SchoolFees.amount_paid).
export interface RefundRequestPayload {
    enrollmentId: number;
    refundMethod: string;         // RefundMethod enum
    refundDate: string;
}

function validatePayload(type: FinanceRequestType, payload: any, amount: number | null | undefined) {
    if (type === 'FEE_REDUCTION') {
        if (!payload || typeof payload.enrollmentId !== 'number') {
            throw new Error('FEE_REDUCTION payload.enrollmentId is required');
        }
        if (amount === null || amount === undefined || amount <= 0) {
            throw new Error('FEE_REDUCTION amount must be > 0');
        }
    } else if (type === 'PERSONNEL_DISBURSEMENT') {
        if (!payload || typeof payload.recipientUserId !== 'number' || !payload.purpose) {
            throw new Error('PERSONNEL_DISBURSEMENT payload.recipientUserId and payload.purpose are required');
        }
        if (amount === null || amount === undefined || amount <= 0) {
            throw new Error('PERSONNEL_DISBURSEMENT amount must be > 0');
        }
    } else if (type === 'BANK_VERIFICATION') {
        if (!payload || typeof payload.studentId !== 'number' || !payload.estimatedPaymentPeriod) {
            throw new Error('BANK_VERIFICATION payload.studentId and payload.estimatedPaymentPeriod are required');
        }
        // amount may be null
    } else if (type === 'PAYMENT_CLAIM') {
        if (!payload || (typeof payload.enrollmentId !== 'number' && typeof payload.studentId !== 'number')) {
            throw new Error('PAYMENT_CLAIM payload.enrollmentId or payload.studentId is required');
        }
        if (!payload.paymentMethod || typeof payload.paymentMethod !== 'string') {
            throw new Error('PAYMENT_CLAIM payload.paymentMethod is required');
        }
        if (!payload.paymentDate || typeof payload.paymentDate !== 'string') {
            throw new Error('PAYMENT_CLAIM payload.paymentDate is required');
        }
        if (amount === null || amount === undefined || amount <= 0) {
            throw new Error('PAYMENT_CLAIM amount must be > 0');
        }
    } else if (type === 'REFUND') {
        if (!payload || typeof payload.enrollmentId !== 'number') {
            throw new Error('REFUND payload.enrollmentId is required');
        }
        if (!payload.refundMethod || typeof payload.refundMethod !== 'string') {
            throw new Error('REFUND payload.refundMethod is required');
        }
        if (!payload.refundDate || typeof payload.refundDate !== 'string') {
            throw new Error('REFUND payload.refundDate is required');
        }
        if (amount === null || amount === undefined || amount <= 0) {
            throw new Error('REFUND amount must be > 0');
        }
    }
}

// Roles that run the finance office and may raise any request type for anyone.
// Explicit list (not a tier check): SENIOR_LEADERSHIP also contains VP / SECRETARY /
// DISCIPLINE_COORDINATOR, who must not raise refunds or fee reductions.
const FINANCE_CREATOR_ROLES: Role[] = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'BURSAR'] as Role[];

// Roles that see every finance request (oversight). Everyone else only sees
// requests they raised, money addressed to them, or (parents) their children's.
const OVERSIGHT_VIEW_ROLES: Role[] = [
    'SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY', 'FEE_AUDITOR',
] as Role[];

const isFinanceCreator = (roles: Role[]) => roles.some((r) => FINANCE_CREATOR_ROLES.includes(r));
const isOversightViewer = (roles: Role[]) => roles.some((r) => OVERSIGHT_VIEW_ROLES.includes(r));
const isStaff = (roles: Role[]) => roles.some((r) => r !== ('PARENT' as Role));

export class FinanceRequestForbiddenError extends Error {
    code = 'FORBIDDEN';
}

// Per-type creator restrictions (route authorize() is intentionally permissive:
// any authenticated user reaches here). Messages are user-facing — no role lists.
function assertCreatorRole(type: FinanceRequestType, roles: Role[], requesterId: number, payload: any) {
    const financeCreator = isFinanceCreator(roles);
    const isParent = roles.includes('PARENT' as Role);

    if (type === 'PAYMENT_CLAIM') {
        if (!isParent && !financeCreator) {
            throw new FinanceRequestForbiddenError('Only parents or the Bursar can submit a payment claim.');
        }
    } else if (type === 'PERSONNEL_DISBURSEMENT') {
        if (financeCreator) return;
        // Any staff member may ask the Bursar for money for themselves.
        if (!isStaff(roles)) {
            throw new FinanceRequestForbiddenError('You are not allowed to request money.');
        }
        if (payload?.recipientUserId !== requesterId) {
            throw new FinanceRequestForbiddenError('You can only request money for yourself.');
        }
    } else if (type === 'REFUND' || type === 'FEE_REDUCTION' || type === 'BANK_VERIFICATION') {
        if (!financeCreator) {
            throw new FinanceRequestForbiddenError('Only the Bursar or school leadership can create this type of request.');
        }
    }
}

async function assertParentOwnsEnrollment(parentUserId: number, enrollmentId: number) {
    const enr = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, select: { student_id: true } });
    if (!enr) throw new Error(`Enrollment ${enrollmentId} not found`);
    const link = await prisma.parentStudent.findFirst({
        where: { parent_id: parentUserId, student_id: enr.student_id },
        select: { id: true },
    });
    if (!link) throw new Error('You are not linked to this student');
}

// ---------- Create ----------
export interface CreateFinanceRequestInput {
    type: FinanceRequestType;
    amount?: number | null;
    reason: string;
    notes?: string;
    payload: Record<string, any>;
    requested_by_id: number;
    requested_by_roles?: Role[];
}

export async function createFinanceRequest(input: CreateFinanceRequestInput) {
    if (!input.reason || !input.reason.trim()) throw new Error('reason is required');
    validatePayload(input.type, input.payload, input.amount ?? null);
    if (input.requested_by_roles) {
        assertCreatorRole(input.type, input.requested_by_roles, input.requested_by_id, input.payload);
    }

    if (input.type === 'FEE_REDUCTION') {
        const enr = await prisma.enrollment.findUnique({ where: { id: input.payload.enrollmentId } });
        if (!enr) throw new Error(`Enrollment ${input.payload.enrollmentId} not found`);
    } else if (input.type === 'PERSONNEL_DISBURSEMENT') {
        const u = await prisma.user.findUnique({ where: { id: input.payload.recipientUserId } });
        if (!u) throw new Error(`Recipient user ${input.payload.recipientUserId} not found`);
    } else if (input.type === 'BANK_VERIFICATION') {
        const s = await prisma.student.findUnique({ where: { id: input.payload.studentId } });
        if (!s) throw new Error(`Student ${input.payload.studentId} not found`);
    } else if (input.type === 'PAYMENT_CLAIM') {
        // Resolve enrollment (from studentId if needed) and validate parent linkage.
        let enrollmentId: number | undefined = input.payload.enrollmentId;
        if (!enrollmentId && input.payload.studentId) {
            const yearId = await getAcademicYearId();
            if (!yearId) throw new Error('No current academic year — cannot resolve enrollment from studentId');
            const enr = await prisma.enrollment.findFirst({
                where: { student_id: input.payload.studentId, academic_year_id: yearId },
                select: { id: true },
            });
            if (!enr) throw new Error(`Student ${input.payload.studentId} has no enrollment for the current academic year`);
            enrollmentId = enr.id;
            input.payload.enrollmentId = enrollmentId;
        }
        if (!enrollmentId) throw new Error('Could not resolve enrollment for PAYMENT_CLAIM');
        const enr = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
        if (!enr) throw new Error(`Enrollment ${enrollmentId} not found`);

        const isParent = (input.requested_by_roles ?? []).includes('PARENT' as Role);
        if (isParent && !isFinanceCreator(input.requested_by_roles ?? [])) {
            await assertParentOwnsEnrollment(input.requested_by_id, enrollmentId);
        }
    } else if (input.type === 'REFUND') {
        const enr = await prisma.enrollment.findUnique({
            where: { id: input.payload.enrollmentId },
            include: { school_fees: { include: { refunds: { select: { amount: true } } } } },
        });
        if (!enr) throw new Error(`Enrollment ${input.payload.enrollmentId} not found`);
        const fees = enr.school_fees[0];
        if (!fees) throw new Error(`Enrollment ${input.payload.enrollmentId} has no SchoolFees record`);
        const totalRefunded = fees.refunds.reduce((s, r) => s + r.amount, 0);
        const currentOverpayment = fees.amount_paid - fees.amount_expected - totalRefunded;
        if (currentOverpayment <= 0) throw new Error('Enrollment has no current overpayment to refund');
        if ((input.amount ?? 0) > currentOverpayment) {
            throw new Error(`Refund amount (${input.amount}) exceeds current overpayment (${currentOverpayment})`);
        }
    }

    const created = await prisma.financeRequest.create({
        data: {
            type: input.type,
            status: 'PENDING',
            amount: input.amount ?? null,
            reason: input.reason.trim(),
            notes: input.notes?.trim() || null,
            payload: input.payload as Prisma.InputJsonValue,
            requested_by_id: input.requested_by_id,
        },
    });

    // Fire notifications (best-effort — never block the create).
    notifyOnCreate(created).catch((e) => console.error('finance-request notify-on-create failed', e));

    return (await getFinanceRequestById(created.id)) ?? created;
}

// ---------- Listing ----------
export interface ListFinanceRequestsOptions {
    type?: FinanceRequestType;
    status?: FinanceRequestStatus;
    requested_by_id?: number;
    recipient_user_id?: number;       // PERSONNEL_DISBURSEMENT — payload.recipientUserId match
    student_id?: number;              // BANK_VERIFICATION payload.studentId match (or FEE_REDUCTION via enrollment)
    page?: number;
    limit?: number;
    viewer_user_id?: number;          // for "show requests addressed to me"
    viewer_roles?: Role[];
}

export async function listFinanceRequests(opts: ListFinanceRequestsOptions) {
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;

    const where: Prisma.FinanceRequestWhereInput = {
        ...(opts.type && { type: opts.type }),
        ...(opts.status && { status: opts.status }),
        ...(opts.requested_by_id && { requested_by_id: opts.requested_by_id }),
    };

    // recipient_user_id filter for PERSONNEL_DISBURSEMENT (JSON match on payload.recipientUserId)
    if (opts.recipient_user_id) {
        where.AND = [
            ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
            { type: 'PERSONNEL_DISBURSEMENT' },
            { payload: { path: ['recipientUserId'], equals: opts.recipient_user_id } as any },
        ];
    }

    if (opts.student_id) {
        where.AND = [
            ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
            { payload: { path: ['studentId'], equals: opts.student_id } as any },
        ];
    }

    // Non-oversight viewers (teachers, HODs, parents, ...) only ever see their own.
    if (opts.viewer_user_id && !isOversightViewer(opts.viewer_roles ?? [])) {
        const scope = await viewerScopeWhere(opts.viewer_user_id, opts.viewer_roles ?? []);
        where.AND = [
            ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
            scope,
        ];
    }

    const [total, requests] = await Promise.all([
        prisma.financeRequest.count({ where }),
        prisma.financeRequest.findMany({
            where,
            include: PEOPLE_INCLUDE,
            orderBy: { created_at: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return {
        data: await enrichFinanceRequests(requests),
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

/**
 * Fetch one request. When `viewer` is given and is not an oversight role, the
 * request is only returned if it falls inside that viewer's scope (else null → 404).
 */
export async function getFinanceRequestById(id: number, viewer?: { user_id: number; roles: Role[] }) {
    let where: Prisma.FinanceRequestWhereInput = { id };
    if (viewer && !isOversightViewer(viewer.roles)) {
        where = { AND: [{ id }, await viewerScopeWhere(viewer.user_id, viewer.roles)] };
    }
    const found = await prisma.financeRequest.findFirst({ where, include: PEOPLE_INCLUDE });
    if (!found) return null;
    const [enriched] = await enrichFinanceRequests([found]);
    return enriched;
}

// ---------- Display enrichment ----------
const PERSON_SELECT = { id: true, name: true, matricule: true } as const;
const PEOPLE_INCLUDE = {
    requested_by: { select: PERSON_SELECT },
    acted_by: { select: PERSON_SELECT },
} satisfies Prisma.FinanceRequestInclude;

/**
 * Requests a non-oversight viewer may see: ones they raised, money addressed to
 * them, and — for parents — anything about a child they are linked to.
 */
async function viewerScopeWhere(userId: number, roles: Role[]): Promise<Prisma.FinanceRequestWhereInput> {
    const or: Prisma.FinanceRequestWhereInput[] = [
        { requested_by_id: userId },
        { payload: { path: ['recipientUserId'], equals: userId } as any },
    ];
    if (roles.includes('PARENT' as Role)) {
        const links = await prisma.parentStudent.findMany({ where: { parent_id: userId }, select: { student_id: true } });
        const studentIds = links.map((l) => l.student_id);
        if (studentIds.length) {
            const enrollments = await prisma.enrollment.findMany({
                where: { student_id: { in: studentIds } },
                select: { id: true },
            });
            for (const sid of studentIds) or.push({ payload: { path: ['studentId'], equals: sid } as any });
            for (const e of enrollments) or.push({ payload: { path: ['enrollmentId'], equals: e.id } as any });
        }
    }
    return { OR: or };
}

/**
 * Attach human-readable context so clients never have to show raw ids:
 * - student:    { id, name, matricule }               (from payload.enrollmentId or payload.studentId)
 * - enrollment: { id, class_name, sub_class_name, academic_year_name }
 * - recipient:  { id, name, matricule }               (PERSONNEL_DISBURSEMENT payload.recipientUserId)
 * Missing references resolve to null. Batched: 3 queries max per call.
 */
async function enrichFinanceRequests<T extends FinanceRequest>(requests: T[]) {
    const num = (v: any) => (typeof v === 'number' ? v : undefined);
    const enrollmentIds = new Set<number>();
    const studentIds = new Set<number>();
    const recipientIds = new Set<number>();
    for (const r of requests) {
        const p = (r.payload ?? {}) as any;
        const eid = num(p.enrollmentId);
        const sid = num(p.studentId);
        const rid = num(p.recipientUserId);
        if (eid) enrollmentIds.add(eid);
        else if (sid) studentIds.add(sid);
        if (rid) recipientIds.add(rid);
    }

    const enrollmentSelect = {
        id: true,
        student_id: true,
        academic_year_id: true,
        student: { select: { id: true, name: true, matricule: true } },
        class: { select: { name: true } },
        sub_class: { select: { name: true } },
        academic_year: { select: { name: true } },
    } as const;

    const [enrollments, studentEnrollments, recipients] = await Promise.all([
        enrollmentIds.size
            ? prisma.enrollment.findMany({ where: { id: { in: [...enrollmentIds] } }, select: enrollmentSelect })
            : Promise.resolve([]),
        // Student-only payloads (e.g. BANK_VERIFICATION): use the student's latest enrollment for the class label.
        studentIds.size
            ? prisma.enrollment.findMany({
                where: { student_id: { in: [...studentIds] } },
                select: enrollmentSelect,
                orderBy: [{ academic_year: { start_date: 'desc' } }, { id: 'desc' }],
            })
            : Promise.resolve([]),
        recipientIds.size
            ? prisma.user.findMany({ where: { id: { in: [...recipientIds] } }, select: PERSON_SELECT })
            : Promise.resolve([]),
    ]);

    // Students with no enrollment at all still need a name.
    const studentsWithoutEnrollment = [...studentIds].filter((sid) => !studentEnrollments.some((e) => e.student_id === sid));
    const bareStudents = studentsWithoutEnrollment.length
        ? await prisma.student.findMany({ where: { id: { in: studentsWithoutEnrollment } }, select: { id: true, name: true, matricule: true } })
        : [];

    type Enr = (typeof enrollments)[number];
    const toEnrollmentRef = (e: Enr) => ({
        id: e.id,
        class_name: e.class?.name ?? null,
        sub_class_name: e.sub_class?.name ?? null,
        academic_year_name: e.academic_year?.name ?? null,
    });
    const byEnrollment = new Map(enrollments.map((e) => [e.id, e]));
    const latestByStudent = new Map<number, Enr>();
    for (const e of studentEnrollments) if (!latestByStudent.has(e.student_id)) latestByStudent.set(e.student_id, e);
    const bareById = new Map(bareStudents.map((s) => [s.id, s]));
    const recipientById = new Map(recipients.map((u) => [u.id, u]));

    return requests.map((r) => {
        const p = (r.payload ?? {}) as any;
        const eid = num(p.enrollmentId);
        const sid = num(p.studentId);
        const rid = num(p.recipientUserId);
        const enr = eid ? byEnrollment.get(eid) : sid ? latestByStudent.get(sid) : undefined;
        const student = enr?.student ?? (sid ? bareById.get(sid) : undefined) ?? null;
        return {
            ...r,
            student,
            enrollment: enr ? toEnrollmentRef(enr) : null,
            recipient: rid ? recipientById.get(rid) ?? null : null,
        };
    });
}

// ---------- Authorization helpers for transitions ----------
function isPrincipalPlus(roles: Role[]): boolean {
    return userHasMinTier(roles, RoleTier.HEAD_OF_SCHOOL);
}

function isBursarPlus(roles: Role[]): boolean {
    return userHasMinTier(roles, RoleTier.SENIOR_LEADERSHIP);
}

function isSuperManager(roles: Role[]): boolean {
    return roles.includes('SUPER_MANAGER' as Role);
}

function canActOnRequest(
    req: FinanceRequest,
    action: 'APPROVE' | 'REJECT' | 'COMPLETE',
    actorUserId: number,
    actorRoles: Role[]
): { allowed: boolean; reason?: string } {
    if (req.status !== 'PENDING') {
        return { allowed: false, reason: `Request is already ${req.status}` };
    }

    const principalPlus = isPrincipalPlus(actorRoles);

    if (req.type === 'FEE_REDUCTION') {
        if (action !== 'APPROVE' && action !== 'REJECT') {
            return { allowed: false, reason: 'FEE_REDUCTION only supports APPROVE or REJECT' };
        }
        if (!principalPlus) return { allowed: false, reason: 'Only Principal+ can act on FEE_REDUCTION' };
        return { allowed: true };
    }

    if (req.type === 'PERSONNEL_DISBURSEMENT') {
        if (action !== 'COMPLETE' && action !== 'REJECT') {
            return { allowed: false, reason: 'PERSONNEL_DISBURSEMENT only supports COMPLETE or REJECT' };
        }
        const recipientId = (req.payload as any)?.recipientUserId;
        const isRecipient = typeof recipientId === 'number' && recipientId === actorUserId;
        if (!isRecipient && !principalPlus) {
            return { allowed: false, reason: 'Only the recipient or Principal+ can act on this request' };
        }
        return { allowed: true };
    }

    if (req.type === 'BANK_VERIFICATION') {
        if (action !== 'COMPLETE' && action !== 'REJECT') {
            return { allowed: false, reason: 'BANK_VERIFICATION only supports COMPLETE or REJECT' };
        }
        // Finance oversight roles (Secretary, Fee Auditor, Bursar, VP, Principal+) clear bank slips.
        // The reject/complete routes have no authorize(), so this check is the gate.
        if (!isOversightViewer(actorRoles)) {
            return { allowed: false, reason: 'You are not allowed to verify bank deposits' };
        }
        return { allowed: true };
    }

    if (req.type === 'PAYMENT_CLAIM') {
        if (action !== 'APPROVE' && action !== 'REJECT') {
            return { allowed: false, reason: 'PAYMENT_CLAIM only supports APPROVE or REJECT' };
        }
        if (!isBursarPlus(actorRoles)) {
            return { allowed: false, reason: 'Only Bursar+ can validate a PAYMENT_CLAIM' };
        }
        return { allowed: true };
    }

    if (req.type === 'REFUND') {
        if (action !== 'APPROVE' && action !== 'REJECT') {
            return { allowed: false, reason: 'REFUND only supports APPROVE or REJECT' };
        }
        if (!isSuperManager(actorRoles)) {
            return { allowed: false, reason: 'Only SUPER_MANAGER can approve or reject a REFUND request' };
        }
        return { allowed: true };
    }

    return { allowed: false, reason: 'Unknown request type' };
}

// ---------- Side effects on approve ----------
// PAYMENT_CLAIM approve → create a real PaymentTransaction.
async function performApprovedPaymentClaim(req: FinanceRequest, actorUserId: number) {
    const payload = req.payload as any;
    const feeId: number | undefined = payload.feeId;
    let resolvedFeeId = feeId;

    if (!resolvedFeeId) {
        // Pick the current-year SchoolFees row for the enrollment.
        const enr = await prisma.enrollment.findUnique({
            where: { id: payload.enrollmentId },
            include: { school_fees: { select: { id: true }, orderBy: { id: 'desc' }, take: 1 } },
        });
        if (!enr) throw new Error(`Enrollment ${payload.enrollmentId} not found`);
        const fee = enr.school_fees[0];
        if (!fee) throw new Error(`Enrollment ${payload.enrollmentId} has no SchoolFees record`);
        resolvedFeeId = fee.id;
    }

    await feeService.recordPayment({
        amount: req.amount ?? 0,
        payment_date: payload.paymentDate,
        receipt_number: payload.receiptNumber,
        payment_method: payload.paymentMethod,
        enrollment_id: payload.enrollmentId,
        fee_id: resolvedFeeId!,
        recorded_by_id: actorUserId,
    });
}

// REFUND approve → create a real Refund (decrements SchoolFees.amount_paid).
async function performApprovedRefund(req: FinanceRequest, actorUserId: number) {
    const payload = req.payload as any;
    await feeRefundService.recordRefund({
        enrollment_id: payload.enrollmentId,
        amount: req.amount ?? 0,
        refund_date: payload.refundDate,
        refund_method: payload.refundMethod,
        reason: req.reason,
        notes: req.notes ?? undefined,
        recorded_by_id: actorUserId,
    });
}

// ---------- Transitions ----------
async function transition(
    id: number,
    action: 'APPROVE' | 'REJECT' | 'COMPLETE',
    actorUserId: number,
    actorRoles: Role[],
    notes?: string
): Promise<FinanceRequest> {
    const req = await prisma.financeRequest.findUnique({ where: { id } });
    if (!req) throw new Error(`FinanceRequest ${id} not found`);

    const check = canActOnRequest(req, action, actorUserId, actorRoles);
    if (!check.allowed) {
        const err: any = new Error(check.reason || 'Forbidden');
        err.code = 'FORBIDDEN';
        throw err;
    }

    // Side effects on APPROVE — do them BEFORE flipping status so a failure aborts the transition.
    if (action === 'APPROVE') {
        if (req.type === 'PAYMENT_CLAIM') {
            await performApprovedPaymentClaim(req, actorUserId);
        } else if (req.type === 'REFUND') {
            await performApprovedRefund(req, actorUserId);
        }
    }

    const newStatus: FinanceRequestStatus =
        action === 'APPROVE' ? 'APPROVED' :
        action === 'REJECT' ? 'REJECTED' :
        'COMPLETED';

    const updated = await prisma.financeRequest.update({
        where: { id },
        data: {
            status: newStatus,
            acted_by_id: actorUserId,
            acted_at: new Date(),
            acted_notes: notes?.trim() || null,
        },
    });

    // Fan out notifications.
    notifyOnTransition(updated, action, actorUserId).catch((e) =>
        console.error('finance-request notify-on-transition failed', e)
    );

    // Return the same shape as list/detail (requester/actor names, student, class)
    // so clients can swap the row in place without losing display fields.
    return (await getFinanceRequestById(id)) ?? updated;
}

export const approveFinanceRequest = (id: number, actorUserId: number, actorRoles: Role[], notes?: string) =>
    transition(id, 'APPROVE', actorUserId, actorRoles, notes);

export const rejectFinanceRequest = (id: number, actorUserId: number, actorRoles: Role[], notes?: string) =>
    transition(id, 'REJECT', actorUserId, actorRoles, notes);

export const completeFinanceRequest = (id: number, actorUserId: number, actorRoles: Role[], notes?: string) =>
    transition(id, 'COMPLETE', actorUserId, actorRoles, notes);

// ---------- Notifications ----------
async function studentLabelForEnrollment(enrollmentId?: number): Promise<string> {
    if (!enrollmentId) return '';
    const enr = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        include: { student: { select: { name: true, matricule: true } } },
    });
    if (!enr?.student) return '';
    return `${enr.student.name} (${enr.student.matricule})`;
}

async function parentUserIdsForEnrollment(enrollmentId?: number): Promise<number[]> {
    if (!enrollmentId) return [];
    const enr = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, select: { student_id: true } });
    if (!enr) return [];
    const links = await prisma.parentStudent.findMany({
        where: { student_id: enr.student_id },
        select: { parent_id: true },
    });
    return Array.from(new Set(links.map(l => l.parent_id)));
}

async function notifyOnCreate(req: FinanceRequest) {
    const payload = req.payload as any;
    const actionUrl = `/finance-requests/${req.id}`;

    if (req.type === 'PAYMENT_CLAIM') {
        const label = await studentLabelForEnrollment(payload.enrollmentId);
        const amount = req.amount ?? 0;
        await notificationService.sendToRoles(
            ['BURSAR', 'PRINCIPAL', 'SUPER_MANAGER', 'MANAGER'],
            {
                title: 'Payment claim awaiting validation',
                message: `New payment claim of ${amount} for ${label}. Please verify and approve.`,
                sender_id: req.requested_by_id,
                category: 'APPROVAL_NEEDED',
                priority: 'HIGH',
                entity_type: 'FinanceRequest',
                entity_id: req.id,
                action_url: actionUrl,
            }
        );
        return;
    }

    if (req.type === 'REFUND') {
        const label = await studentLabelForEnrollment(payload.enrollmentId);
        const amount = req.amount ?? 0;
        await notificationService.notifySuperManagers({
            title: 'Refund request awaiting approval',
            message: `Bursar requests refund of ${amount} for ${label}. Reason: ${req.reason}`,
            sender_id: req.requested_by_id,
            priority: 'HIGH',
            entity_type: 'FinanceRequest',
            entity_id: req.id,
            action_url: actionUrl,
        });
        return;
    }

    // Existing types keep their pre-existing (silent) behavior; add fanouts opportunistically.
    if (req.type === 'FEE_REDUCTION') {
        await notificationService.sendToRoles(['PRINCIPAL', 'SUPER_MANAGER'], {
            title: 'Fee-reduction request',
            message: `Bursar requests fee reduction of ${req.amount}. Reason: ${req.reason}`,
            sender_id: req.requested_by_id,
            category: 'APPROVAL_NEEDED',
            priority: 'HIGH',
            entity_type: 'FinanceRequest',
            entity_id: req.id,
            action_url: actionUrl,
        });
    } else if (req.type === 'PERSONNEL_DISBURSEMENT') {
        const recipientId = payload?.recipientUserId;
        if (typeof recipientId === 'number') {
            await notificationService.sendNotification({
                user_id: recipientId,
                title: 'Disbursement awaiting your confirmation',
                message: `A disbursement of ${req.amount} for "${payload?.purpose}" has been recorded. Confirm receipt.`,
                sender_id: req.requested_by_id,
                category: 'APPROVAL_NEEDED',
                priority: 'HIGH',
                entity_type: 'FinanceRequest',
                entity_id: req.id,
                action_url: actionUrl,
            });
        }
    } else if (req.type === 'BANK_VERIFICATION') {
        await notificationService.sendToRoles(['SECRETARY', 'FEE_AUDITOR', 'BURSAR', 'PRINCIPAL'], {
            title: 'Bank verification requested',
            message: `Verify bank slip for student ${payload?.studentId} (${payload?.estimatedPaymentPeriod}).`,
            sender_id: req.requested_by_id,
            category: 'APPROVAL_NEEDED',
            priority: 'HIGH',
            entity_type: 'FinanceRequest',
            entity_id: req.id,
            action_url: actionUrl,
        });
    }
}

async function notifyOnTransition(req: FinanceRequest, action: 'APPROVE' | 'REJECT' | 'COMPLETE', actorId: number) {
    const payload = req.payload as any;
    const actionUrl = `/finance-requests/${req.id}`;
    const label = await studentLabelForEnrollment(payload?.enrollmentId);

    const category =
        action === 'APPROVE' ? 'APPROVAL_APPROVED' :
        action === 'REJECT' ? 'APPROVAL_REJECTED' :
        'FEE_UPDATE';

    // Always notify the requester. Approve/reject outcomes are high-priority so
    // the requester sees them immediately as a popup; COMPLETE is informational.
    const verb = action === 'APPROVE' ? 'approved' : action === 'REJECT' ? 'rejected' : 'completed';
    const humanType = req.type.replace(/_/g, ' ').toLowerCase();
    const requesterPriority = action === 'COMPLETE' ? 'NORMAL' : 'HIGH';
    await notificationService.sendNotification({
        user_id: req.requested_by_id,
        sender_id: actorId,
        title: `Your ${humanType} request was ${verb}`,
        message: req.acted_notes || `${humanType} request ${verb}.`,
        category: category as any,
        priority: requesterPriority,
        entity_type: 'FinanceRequest',
        entity_id: req.id,
        action_url: actionUrl,
    });

    // On PAYMENT_CLAIM approve: also notify all linked parents of the student
    // that the payment was recorded (unless the requester is the parent themself).
    if (req.type === 'PAYMENT_CLAIM' && action === 'APPROVE') {
        const parentIds = await parentUserIdsForEnrollment(payload?.enrollmentId);
        const recipients = parentIds.filter(pid => pid !== req.requested_by_id);
        if (recipients.length) {
            await notificationService.sendBulkNotifications({
                title: 'Payment recorded',
                message: `Payment of ${req.amount} for ${label} has been validated by the bursar.`,
                recipient_ids: recipients,
                sender_id: actorId,
                category: 'FEE_UPDATE',
                entity_type: 'FinanceRequest',
                entity_id: req.id,
                action_url: actionUrl,
            });
        }
    }

    // On REFUND approve: notify all linked parents that a refund was issued.
    if (req.type === 'REFUND' && action === 'APPROVE') {
        const parentIds = await parentUserIdsForEnrollment(payload?.enrollmentId);
        if (parentIds.length) {
            await notificationService.sendBulkNotifications({
                title: 'Refund issued',
                message: `A refund of ${req.amount} has been issued for ${label}.`,
                recipient_ids: parentIds,
                sender_id: actorId,
                category: 'FEE_UPDATE',
                entity_type: 'FinanceRequest',
                entity_id: req.id,
                action_url: actionUrl,
            });
        }
    }
}
