import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import * as leaveService from '../services/leaveRequestService';

function respondError(res: Response, err: any, defaultStatus = 400) {
    const message = err?.message || 'Unknown error';
    if (/not found/i.test(message)) return res.status(404).json({ success: false, error: message });
    if (/only|required|invalid/i.test(message)) return res.status(400).json({ success: false, error: message });
    console.error('Leave error:', err);
    return res.status(defaultStatus).json({ success: false, error: message });
}

// POST /leave
export const createLeave = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const { leave_type, start_date, end_date, reason } = req.body;
        const leave = await leaveService.requestLeave({
            requesterId: userId,
            leaveType: leave_type,
            startDate: start_date,
            endDate: end_date,
            reason,
        });
        return res.status(201).json({ success: true, data: leave });
    } catch (err) {
        return respondError(res, err);
    }
};

// POST /leave/:id/cancel
export const cancelLeave = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const id = parseInt(req.params.id, 10);
        const leave = await leaveService.cancelLeave(id, userId);
        return res.json({ success: true, data: leave });
    } catch (err) {
        return respondError(res, err);
    }
};

// POST /leave/:id/approve — SUPER_MANAGER only
export const approveLeave = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const id = parseInt(req.params.id, 10);
        const leave = await leaveService.approveLeave(id, userId, req.body?.note);
        return res.json({ success: true, data: leave });
    } catch (err) {
        return respondError(res, err);
    }
};

// POST /leave/:id/reject — SUPER_MANAGER only
export const rejectLeave = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const id = parseInt(req.params.id, 10);
        const leave = await leaveService.rejectLeave(id, userId, req.body?.note);
        return res.json({ success: true, data: leave });
    } catch (err) {
        return respondError(res, err);
    }
};

// GET /leave/mine
export const listMyLeave = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const leave = await leaveService.listLeave({ requesterId: userId });
        return res.json({ success: true, data: leave });
    } catch (err) {
        return respondError(res, err, 500);
    }
};

// GET /leave — SUPER_MANAGER
export const listLeave = async (req: Request, res: Response) => {
    try {
        const statusParam = req.query.status as string | undefined;
        const leave = await leaveService.listLeave({
            status: statusParam ? (statusParam.split(',') as any) : undefined,
        });
        return res.json({ success: true, data: leave });
    } catch (err) {
        return respondError(res, err, 500);
    }
};

// GET /leave/:id
export const getLeave = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        const roles: string[] = (req as any).user?.role ?? [];
        const id = parseInt(req.params.id, 10);
        const leave = await leaveService.getLeaveById(id);
        if (!leave) return res.status(404).json({ success: false, error: 'Leave request not found' });

        const isPrivileged = roles.some(r => ['SUPER_MANAGER', 'MANAGER'].includes(r));
        if (!isPrivileged && leave.requester_id !== userId) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        return res.json({ success: true, data: leave });
    } catch (err) {
        return respondError(res, err, 500);
    }
};
