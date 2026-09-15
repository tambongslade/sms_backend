// Leave request service. Any staff member requests time off; super manager
// approves or rejects. Requester can cancel while still pending.

import prisma, { LeaveStatus, LeaveType } from '../../../config/db';

const leaveInclude = {
    requester: { select: { id: true, name: true, matricule: true, email: true } },
    approver: { select: { id: true, name: true } },
};

export async function requestLeave(input: {
    requesterId: number;
    leaveType: LeaveType;
    startDate: string | Date;
    endDate: string | Date;
    reason: string;
}) {
    if (!input.reason || !input.reason.trim()) throw new Error('Reason is required');
    if (!input.leaveType) throw new Error('Leave type is required');

    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error('Invalid start or end date');
    }
    if (end < start) throw new Error('End date must be on or after start date');

    return prisma.leaveRequest.create({
        data: {
            requester_id: input.requesterId,
            leave_type: input.leaveType,
            start_date: start,
            end_date: end,
            reason: input.reason.trim(),
        },
        include: leaveInclude,
    });
}

export async function cancelLeave(leaveId: number, requesterId: number) {
    const leave = await prisma.leaveRequest.findUnique({
        where: { id: leaveId },
        select: { requester_id: true, status: true },
    });
    if (!leave) throw new Error('Leave request not found');
    if (leave.requester_id !== requesterId) throw new Error('You can only cancel your own leave requests');
    if (leave.status !== 'PENDING') throw new Error('Only pending leave requests can be cancelled');

    return prisma.leaveRequest.update({
        where: { id: leaveId },
        data: { status: 'CANCELLED', cancelled_at: new Date() },
        include: leaveInclude,
    });
}

export async function approveLeave(leaveId: number, approverId: number, note?: string) {
    const leave = await prisma.leaveRequest.findUnique({ where: { id: leaveId }, select: { status: true } });
    if (!leave) throw new Error('Leave request not found');
    if (leave.status !== 'PENDING') throw new Error('Only pending leave requests can be approved');

    return prisma.leaveRequest.update({
        where: { id: leaveId },
        data: {
            status: 'APPROVED',
            approver_id: approverId,
            approver_note: note?.trim() || null,
            decided_at: new Date(),
        },
        include: leaveInclude,
    });
}

export async function rejectLeave(leaveId: number, approverId: number, note: string) {
    const leave = await prisma.leaveRequest.findUnique({ where: { id: leaveId }, select: { status: true } });
    if (!leave) throw new Error('Leave request not found');
    if (leave.status !== 'PENDING') throw new Error('Only pending leave requests can be rejected');
    if (!note || !note.trim()) throw new Error('A rejection note is required');

    return prisma.leaveRequest.update({
        where: { id: leaveId },
        data: {
            status: 'REJECTED',
            approver_id: approverId,
            approver_note: note.trim(),
            decided_at: new Date(),
        },
        include: leaveInclude,
    });
}

export async function getLeaveById(leaveId: number) {
    return prisma.leaveRequest.findUnique({ where: { id: leaveId }, include: leaveInclude });
}

export async function listLeave(filters: {
    requesterId?: number;
    status?: LeaveStatus | LeaveStatus[];
} = {}) {
    return prisma.leaveRequest.findMany({
        where: {
            ...(filters.requesterId ? { requester_id: filters.requesterId } : {}),
            ...(filters.status
                ? Array.isArray(filters.status)
                    ? { status: { in: filters.status } }
                    : { status: filters.status }
                : {}),
        },
        include: leaveInclude,
        orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    });
}
