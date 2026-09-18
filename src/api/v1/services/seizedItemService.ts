// src/api/v1/services/seizedItemService.ts
//
// Discipline Masters (and senior discipline roles) can record items seized
// from students and transfer custody up the chain — typically to the
// Principal. Custody only changes hands when the recipient explicitly accepts.

import prisma from '../../../config/db';
import {
    Prisma,
    Role,
    SeizedItemStatus,
    SeizedItemTransferStatus,
} from '@prisma/client';
import { emitToUser } from '../../../realtime/socket';
import { sendNotification } from './notificationService';
import { getAcademicYearId } from '../../../utils/academicYear';

// ---------- Errors ----------

function badRequest(m: string): Error { const e: any = new Error(m); e.statusCode = 400; return e; }
function notFound(m: string): Error   { const e: any = new Error(m); e.statusCode = 404; return e; }
function forbidden(m: string): Error  { const e: any = new Error(m); e.statusCode = 403; return e; }
function conflict(m: string): Error   { const e: any = new Error(m); e.statusCode = 409; return e; }

// ---------- Helpers ----------

const SEIZURE_ROLES = new Set<Role>([
    Role.DISCIPLINE_MASTER,
    Role.SENIOR_DISCIPLINE_MASTER,
    Role.DEAN_OF_DISCIPLINE,
    Role.VICE_PRINCIPAL,
    Role.PRINCIPAL,
    Role.MANAGER,
    Role.SUPER_MANAGER,
]);

async function userRoles(userId: number): Promise<Set<Role>> {
    const rows = await prisma.userRole.findMany({
        where: { user_id: userId },
        select: { role: true },
    });
    return new Set(rows.map((r) => r.role));
}

async function assertCanSeize(userId: number) {
    const roles = await userRoles(userId);
    if (![...roles].some((r) => SEIZURE_ROLES.has(r))) {
        throw forbidden('Only discipline staff can record seized items');
    }
}

async function assertRecipientEligible(userId: number) {
    // Recipient must be someone who can plausibly hold a seized item:
    // any staff role in the seizure/oversight set. This blocks parents,
    // teachers, students, etc.
    const roles = await userRoles(userId);
    if (![...roles].some((r) => SEIZURE_ROLES.has(r))) {
        throw badRequest('Recipient is not authorized to hold seized items');
    }
}

const SEIZED_ITEM_INCLUDE = {
    enrollment: {
        select: {
            id: true,
            student: { select: { id: true, matricule: true, name: true, nom: true, prenom: true } },
            sub_class: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
        },
    },
    seized_by:         { select: { id: true, name: true, matricule: true } },
    current_custodian: { select: { id: true, name: true, matricule: true } },
    released_to:       { select: { id: true, name: true, matricule: true } },
    transfers: {
        orderBy: { initiated_at: 'desc' as const },
        include: {
            from_user:   { select: { id: true, name: true } },
            to_user:     { select: { id: true, name: true } },
            resolved_by: { select: { id: true, name: true } },
        },
    },
} as const;

// ---------- Seizure lifecycle ----------

export interface CreateSeizedItemInput {
    enrollment_id: number;
    item_description: string;
    reason: string;
    photo_url?: string;
    location?: string;
}

export async function createSeizedItem(actorId: number, input: CreateSeizedItemInput) {
    await assertCanSeize(actorId);
    if (!input.item_description?.trim()) throw badRequest('item_description required');
    if (!input.reason?.trim()) throw badRequest('reason required');

    const yearId = await getAcademicYearId();
    if (!yearId) throw badRequest('No current academic year');

    const enrollment = await prisma.enrollment.findUnique({
        where: { id: input.enrollment_id },
        select: { id: true, academic_year_id: true },
    });
    if (!enrollment) throw notFound('Enrollment not found');

    const item = await prisma.seizedItem.create({
        data: {
            enrollment_id: input.enrollment_id,
            academic_year_id: enrollment.academic_year_id,
            item_description: input.item_description.trim(),
            reason: input.reason.trim(),
            photo_url: input.photo_url?.trim() || null,
            location: input.location?.trim() || null,
            seized_by_id: actorId,
            current_custodian_id: actorId,
            status: SeizedItemStatus.IN_CUSTODY,
        },
        include: SEIZED_ITEM_INCLUDE,
    });

    return item;
}

export async function updateSeizedItem(
    actorId: number,
    itemId: number,
    input: Partial<Pick<CreateSeizedItemInput, 'item_description' | 'reason' | 'photo_url' | 'location'>>,
) {
    const item = await prisma.seizedItem.findUnique({ where: { id: itemId } });
    if (!item) throw notFound('Seized item not found');
    if (item.status !== SeizedItemStatus.IN_CUSTODY) throw conflict('Item is no longer in custody');
    if (item.current_custodian_id !== actorId) {
        throw forbidden('Only the current custodian can edit this record');
    }

    return prisma.seizedItem.update({
        where: { id: itemId },
        data: {
            ...(input.item_description !== undefined ? { item_description: input.item_description.trim() } : {}),
            ...(input.reason !== undefined ? { reason: input.reason.trim() } : {}),
            ...(input.photo_url !== undefined ? { photo_url: input.photo_url?.trim() || null } : {}),
            ...(input.location !== undefined ? { location: input.location?.trim() || null } : {}),
        },
        include: SEIZED_ITEM_INCLUDE,
    });
}

export async function deleteSeizedItem(actorId: number, itemId: number) {
    const item = await prisma.seizedItem.findUnique({
        where: { id: itemId },
        include: { transfers: { select: { id: true } } },
    });
    if (!item) throw notFound('Seized item not found');
    if (item.seized_by_id !== actorId) {
        throw forbidden('Only the original recorder can delete this seizure');
    }
    if (item.transfers.length > 0) {
        throw conflict('Cannot delete a seizure that already has transfers');
    }
    if (item.status !== SeizedItemStatus.IN_CUSTODY) {
        throw conflict('Item is no longer in custody');
    }
    // Only allow deletion within 24h of recording (typo/mistake window).
    const ageMs = Date.now() - item.seized_at.getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
        throw conflict('Deletion window (24h) has passed');
    }
    await prisma.seizedItem.delete({ where: { id: itemId } });
}

// ---------- Read ----------

export interface ListSeizedItemsFilters {
    enrollment_id?: number;
    student_id?: number;
    status?: SeizedItemStatus;
    custodian_id?: number;
    seized_by_id?: number;
    only_mine_as_custodian?: boolean;
    actor_id?: number;
    limit?: number;
}

export async function listSeizedItems(filters: ListSeizedItemsFilters) {
    const yearId = await getAcademicYearId();
    const limit = Math.min(filters.limit && filters.limit > 0 ? filters.limit : 50, 500);
    const where: Prisma.SeizedItemWhereInput = {
        ...(yearId ? { academic_year_id: yearId } : {}),
        ...(filters.enrollment_id ? { enrollment_id: filters.enrollment_id } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.custodian_id ? { current_custodian_id: filters.custodian_id } : {}),
        ...(filters.seized_by_id ? { seized_by_id: filters.seized_by_id } : {}),
        ...(filters.only_mine_as_custodian && filters.actor_id
            ? { current_custodian_id: filters.actor_id }
            : {}),
        ...(filters.student_id
            ? { enrollment: { student_id: filters.student_id } }
            // Roster-style browsing (no specific student target) must exclude
            // withdrawn students -- see the same pattern in
            // disciplineService.ts's listStudentWarnings/listParentSummons.
            : { enrollment: { student: { status: { not: 'WITHDRAWN' } } } }),
    };
    return prisma.seizedItem.findMany({
        where,
        include: SEIZED_ITEM_INCLUDE,
        orderBy: { seized_at: 'desc' },
        take: limit,
    });
}

export async function getSeizedItem(itemId: number) {
    const item = await prisma.seizedItem.findUnique({
        where: { id: itemId },
        include: SEIZED_ITEM_INCLUDE,
    });
    if (!item) throw notFound('Seized item not found');
    return item;
}

// ---------- Transfers ----------

export interface InitiateTransferInput {
    to_user_id: number;
    note?: string;
}

export async function initiateTransfer(actorId: number, itemId: number, input: InitiateTransferInput) {
    if (!input.to_user_id) throw badRequest('to_user_id required');
    if (input.to_user_id === actorId) throw badRequest('Cannot transfer to yourself');

    const item = await prisma.seizedItem.findUnique({
        where: { id: itemId },
        include: {
            transfers: { where: { status: SeizedItemTransferStatus.PENDING }, select: { id: true } },
        },
    });
    if (!item) throw notFound('Seized item not found');
    if (item.status !== SeizedItemStatus.IN_CUSTODY) throw conflict('Item is no longer in custody');
    if (item.current_custodian_id !== actorId) {
        throw forbidden('Only the current custodian can transfer this item');
    }
    if (item.transfers.length > 0) {
        throw conflict('A transfer is already pending for this item');
    }
    await assertRecipientEligible(input.to_user_id);

    const target = await prisma.user.findUnique({
        where: { id: input.to_user_id },
        select: { id: true, name: true },
    });
    if (!target) throw notFound('Recipient user not found');

    const transfer = await prisma.seizedItemTransfer.create({
        data: {
            seized_item_id: itemId,
            from_user_id: actorId,
            to_user_id: input.to_user_id,
            note: input.note?.trim() || null,
        },
    });

    const fresh = await prisma.seizedItem.findUnique({
        where: { id: itemId },
        include: SEIZED_ITEM_INCLUDE,
    });

    // Realtime + push to recipient
    emitToUser(input.to_user_id, 'discipline.seized_item.transfer.received', fresh);
    emitToUser(actorId, 'discipline.seized_item.transfer.sent', fresh);

    const summary = fresh?.item_description ?? 'seized item';
    const student = fresh?.enrollment.student.name ?? 'a student';
    sendNotification({
        user_id: input.to_user_id,
        message: `Discipline: ${item.current_custodian_id ? 'Custodian' : 'Sender'} wants to transfer custody of ${summary} (from ${student}) — please accept or reject`,
    }).catch(() => {});

    return { item: fresh, transfer };
}

async function loadPendingTransfer(itemId: number, transferId: number) {
    const t = await prisma.seizedItemTransfer.findUnique({ where: { id: transferId } });
    if (!t || t.seized_item_id !== itemId) throw notFound('Transfer not found');
    if (t.status !== SeizedItemTransferStatus.PENDING) {
        throw conflict(`Transfer is already ${t.status.toLowerCase()}`);
    }
    return t;
}

export async function acceptTransfer(actorId: number, itemId: number, transferId: number) {
    const t = await loadPendingTransfer(itemId, transferId);
    if (t.to_user_id !== actorId) throw forbidden('Only the recipient can accept');

    const item = await prisma.$transaction(async (tx) => {
        await tx.seizedItemTransfer.update({
            where: { id: t.id },
            data: {
                status: SeizedItemTransferStatus.ACCEPTED,
                resolved_at: new Date(),
                resolved_by_id: actorId,
            },
        });
        return tx.seizedItem.update({
            where: { id: itemId },
            data: { current_custodian_id: actorId },
            include: SEIZED_ITEM_INCLUDE,
        });
    });

    emitToUser(t.from_user_id, 'discipline.seized_item.transfer.resolved', item);
    emitToUser(actorId, 'discipline.seized_item.transfer.resolved', item);
    sendNotification({
        user_id: t.from_user_id,
        message: `Discipline: ${item.current_custodian?.name} accepted custody of "${item.item_description}"`,
    }).catch(() => {});
    return item;
}

export async function rejectTransfer(actorId: number, itemId: number, transferId: number) {
    const t = await loadPendingTransfer(itemId, transferId);
    if (t.to_user_id !== actorId) throw forbidden('Only the recipient can reject');

    await prisma.seizedItemTransfer.update({
        where: { id: t.id },
        data: {
            status: SeizedItemTransferStatus.REJECTED,
            resolved_at: new Date(),
            resolved_by_id: actorId,
        },
    });
    const item = await prisma.seizedItem.findUnique({
        where: { id: itemId },
        include: SEIZED_ITEM_INCLUDE,
    });
    emitToUser(t.from_user_id, 'discipline.seized_item.transfer.resolved', item);
    emitToUser(actorId, 'discipline.seized_item.transfer.resolved', item);
    sendNotification({
        user_id: t.from_user_id,
        message: `Discipline: transfer of "${item?.item_description}" was rejected`,
    }).catch(() => {});
    return item;
}

export async function cancelTransfer(actorId: number, itemId: number, transferId: number) {
    const t = await loadPendingTransfer(itemId, transferId);
    if (t.from_user_id !== actorId) throw forbidden('Only the sender can cancel');

    await prisma.seizedItemTransfer.update({
        where: { id: t.id },
        data: {
            status: SeizedItemTransferStatus.CANCELLED,
            resolved_at: new Date(),
            resolved_by_id: actorId,
        },
    });
    const item = await prisma.seizedItem.findUnique({
        where: { id: itemId },
        include: SEIZED_ITEM_INCLUDE,
    });
    emitToUser(t.from_user_id, 'discipline.seized_item.transfer.resolved', item);
    emitToUser(t.to_user_id, 'discipline.seized_item.transfer.resolved', item);
    return item;
}

// ---------- Terminal actions ----------

export async function releaseSeizedItem(
    actorId: number,
    itemId: number,
    input: { released_to_id?: number; notes?: string },
) {
    const item = await prisma.seizedItem.findUnique({
        where: { id: itemId },
        include: { transfers: { where: { status: SeizedItemTransferStatus.PENDING }, select: { id: true } } },
    });
    if (!item) throw notFound('Seized item not found');
    if (item.status !== SeizedItemStatus.IN_CUSTODY) throw conflict('Item is no longer in custody');
    if (item.current_custodian_id !== actorId) {
        throw forbidden('Only the current custodian can release this item');
    }
    if (item.transfers.length > 0) {
        throw conflict('Cannot release while a transfer is pending');
    }

    let releasedToId: number | null = null;
    if (input.released_to_id) {
        const u = await prisma.user.findUnique({
            where: { id: input.released_to_id },
            select: { id: true },
        });
        if (!u) throw badRequest('released_to user not found');
        releasedToId = input.released_to_id;
    }

    return prisma.seizedItem.update({
        where: { id: itemId },
        data: {
            status: SeizedItemStatus.RELEASED,
            released_to_id: releasedToId,
            released_at: new Date(),
            released_notes: input.notes?.trim() || null,
            current_custodian_id: null,
        },
        include: SEIZED_ITEM_INCLUDE,
    });
}

export async function destroySeizedItem(actorId: number, itemId: number, notes?: string) {
    // Only PRINCIPAL / SUPER_MANAGER can destroy.
    const roles = await userRoles(actorId);
    if (!roles.has(Role.PRINCIPAL) && !roles.has(Role.SUPER_MANAGER)) {
        throw forbidden('Only the Principal or Super Manager can destroy a seized item');
    }
    const item = await prisma.seizedItem.findUnique({
        where: { id: itemId },
        include: { transfers: { where: { status: SeizedItemTransferStatus.PENDING }, select: { id: true } } },
    });
    if (!item) throw notFound('Seized item not found');
    if (item.status !== SeizedItemStatus.IN_CUSTODY) throw conflict('Item is no longer in custody');
    if (item.current_custodian_id !== actorId) {
        throw forbidden('Only the current custodian can destroy this item');
    }
    if (item.transfers.length > 0) {
        throw conflict('Cannot destroy while a transfer is pending');
    }

    return prisma.seizedItem.update({
        where: { id: itemId },
        data: {
            status: SeizedItemStatus.DESTROYED,
            destroyed_at: new Date(),
            destroyed_notes: notes?.trim() || null,
            current_custodian_id: null,
        },
        include: SEIZED_ITEM_INCLUDE,
    });
}
