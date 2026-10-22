import { Request, Response } from 'express';
import * as svc from '../services/reportRequestService';
import { ReportRequestStatus } from '../../../config/db';

export const createReportRequest = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const created = await svc.createReportRequest({
            requested_by_id: req.user.id,
            requested_from_id: Number(req.body.requested_from_id),
            subject: req.body.subject,
            description: req.body.description,
            due_date: req.body.due_date,
        });
        return res.status(201).json({ success: true, data: created });
    } catch (err: any) {
        console.error('Error creating report request:', err);
        const status = err.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const listReportRequests = async (req: any, res: Response): Promise<any> => {
    try {
        const result = await svc.listReportRequests({
            requested_by_id: req.finalQuery.requested_by_id ? Number(req.finalQuery.requested_by_id) : undefined,
            requested_from_id: req.finalQuery.requested_from_id ? Number(req.finalQuery.requested_from_id) : undefined,
            status: req.finalQuery.status as ReportRequestStatus | undefined,
            overdue_only: req.finalQuery.overdue_only === 'true' || req.finalQuery.overdue_only === true,
            from: req.query.from as string | undefined,
            to: req.query.to as string | undefined,
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
        });
        return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err: any) {
        console.error('Error listing report requests:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

/** Convenience: requests sent by the current user (Dean view of "my requests"). */
export const listMyReportRequests = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const result = await svc.listReportRequests({
            requested_by_id: req.user.id,
            status: req.finalQuery.status as ReportRequestStatus | undefined,
            overdue_only: req.finalQuery.overdue_only === 'true' || req.finalQuery.overdue_only === true,
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
        });
        return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

/** Convenience: requests assigned to the current user (SDM/DM inbox). */
export const listAssignedReportRequests = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const result = await svc.listReportRequests({
            requested_from_id: req.user.id,
            status: req.finalQuery.status as ReportRequestStatus | undefined,
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
        });
        return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const getReportRequestById = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const item = await svc.getReportRequestById(id);
        if (!item) return res.status(404).json({ success: false, error: 'ReportRequest not found' });
        return res.json({ success: true, data: item });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const updateReportRequest = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const updated = await svc.updateReportRequest(id, req.user.id, {
            subject: req.body.subject,
            description: req.body.description,
            due_date: req.body.due_date,
        });
        return res.json({ success: true, data: updated });
    } catch (err: any) {
        const status = err.message.includes('not found') ? 404
            : err.message.includes('Only the original') ? 403
            : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const submitReportRequest = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const updated = await svc.submitReportRequest(id, {
            submitter_id: req.user.id,
            submission_notes: req.body.submission_notes,
            submission_file_url: req.body.submission_file_url,
        });
        return res.json({ success: true, data: updated });
    } catch (err: any) {
        const status = err.message.includes('not found') ? 404
            : err.message.includes('Only the assigned') ? 403
            : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const reviewReportRequest = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const updated = await svc.reviewReportRequest(id, {
            reviewer_id: req.user.id,
            reviewed_notes: req.body.reviewed_notes,
        });
        return res.json({ success: true, data: updated });
    } catch (err: any) {
        const status = err.message.includes('not found') ? 404
            : err.message.includes('Only the original') ? 403
            : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const cancelReportRequest = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const updated = await svc.cancelReportRequest(id, req.user.id);
        return res.json({ success: true, data: updated });
    } catch (err: any) {
        const status = err.message.includes('not found') ? 404
            : err.message.includes('Only the original') ? 403
            : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

/**
 * GET /report-requests/recipients[?roles=SENIOR_DISCIPLINE_MASTER,DISCIPLINE_MASTER]
 * People the caller may request a report from (default: SDM + DM for the
 * current academic year, filtered to those the caller outranks).
 */
const RECIPIENT_ROLE_WHITELIST = new Set([
    'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY', 'DEAN_OF_STUDIES', 'DEAN_OF_DISCIPLINE',
    'DISCIPLINE_COORDINATOR', 'SENIOR_DISCIPLINE_MASTER', 'HOD', 'TEACHER', 'DISCIPLINE_MASTER',
    'NURSE', 'FEE_AUDITOR', 'CONTROLLER', 'GUIDANCE_COUNSELOR',
]);
export const listReportRecipients = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const raw = (req.finalQuery?.roles ?? req.query.roles) as string | string[] | undefined;
        let roles: any[] | undefined;
        if (raw) {
            roles = (Array.isArray(raw) ? raw : String(raw).split(','))
                .map(r => String(r).trim().toUpperCase())
                .filter(Boolean);
            const bad = roles.filter(r => !RECIPIENT_ROLE_WHITELIST.has(r));
            if (bad.length) return res.status(400).json({ success: false, error: `Invalid recipient role(s): ${bad.join(', ')}` });
        }
        const data = await svc.listReportRecipients(req.user.id, roles);
        return res.json({ success: true, data });
    } catch (err: any) {
        console.error('Error listing report recipients:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};
