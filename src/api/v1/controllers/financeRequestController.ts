import { Request, Response } from 'express';
import * as svc from '../services/financeRequestService';
import { FinanceRequestType, FinanceRequestStatus, Role } from '../../../config/db';
import { convertToCamelCase } from '../../../utils/caseConversion';

export const createFinanceRequest = async (req: any, res: Response): Promise<any> => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

        // The global convertCamelToSnakeCase middleware recursively snake_cases nested keys,
        // but `payload` is an opaque JSON column whose inner keys the service (and stored
        // records) expect in camelCase (recipientUserId, enrollmentId, paymentDate, ...).
        // Re-camelCase the payload keys here so the service sees what the client sent.
        const payload = convertToCamelCase(req.body.payload ?? {});

        const created = await svc.createFinanceRequest({
            type: req.body.type as FinanceRequestType,
            amount: req.body.amount !== undefined ? Number(req.body.amount) : null,
            reason: req.body.reason,
            notes: req.body.notes,
            payload,
            requested_by_id: userId,
            requested_by_roles: (req.user?.role ?? []) as Role[],
        });

        return res.status(201).json({ success: true, data: created });
    } catch (err: any) {
        console.error('Error creating finance request:', err);
        const status = err.code === 'FORBIDDEN' ? 403 : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const listFinanceRequests = async (req: any, res: Response): Promise<any> => {
    try {
        const result = await svc.listFinanceRequests({
            type: req.query.type as FinanceRequestType | undefined,
            status: req.query.status as FinanceRequestStatus | undefined,
            requested_by_id: req.query.requestedById ? Number(req.query.requestedById) : undefined,
            recipient_user_id: req.query.recipientUserId ? Number(req.query.recipientUserId) : undefined,
            student_id: req.query.studentId ? Number(req.query.studentId) : undefined,
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
            viewer_user_id: req.user?.id,
            viewer_roles: req.user?.role as Role[] | undefined,
        });
        return res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('Error listing finance requests:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const getFinanceRequestById = async (req: any, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        // Non-oversight viewers only get requests in their own scope (else 404).
        const found = await svc.getFinanceRequestById(id, {
            user_id: req.user?.id,
            roles: (req.user?.role ?? []) as Role[],
        });
        if (!found) return res.status(404).json({ success: false, error: 'Finance request not found' });
        return res.json({ success: true, data: found });
    } catch (err: any) {
        console.error('Error fetching finance request:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

const runTransition = async (
    req: any,
    res: Response,
    fn: typeof svc.approveFinanceRequest
) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const userId = req.user?.id;
        const roles = (req.user?.role ?? []) as Role[];
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const updated = await fn(id, userId, roles, req.body?.notes);
        return res.json({ success: true, data: updated });
    } catch (err: any) {
        const status = err.code === 'FORBIDDEN' ? 403 : 400;
        console.error('Error transitioning finance request:', err);
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const approveFinanceRequest = (req: any, res: Response) => runTransition(req, res, svc.approveFinanceRequest);
export const rejectFinanceRequest = (req: any, res: Response) => runTransition(req, res, svc.rejectFinanceRequest);
export const completeFinanceRequest = (req: any, res: Response) => runTransition(req, res, svc.completeFinanceRequest);
