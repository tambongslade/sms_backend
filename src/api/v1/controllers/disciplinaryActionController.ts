import { Request, Response } from 'express';
import * as svc from '../services/disciplinaryActionService';
import { DisciplinaryActionType, DisciplinaryActionStatus } from '../../../config/db';

export const createDisciplinaryAction = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const created = await svc.createDisciplinaryAction({
            student_id: Number(req.body.student_id),
            academic_year_id: req.body.academic_year_id ? Number(req.body.academic_year_id) : undefined,
            discipline_issue_id: req.body.discipline_issue_id ? Number(req.body.discipline_issue_id) : undefined,
            action_type: req.body.action_type as DisciplinaryActionType,
            days: req.body.days !== undefined ? Number(req.body.days) : undefined,
            start_date: req.body.start_date,
            end_date: req.body.end_date,
            reason: req.body.reason,
            notes: req.body.notes,
            decided_by_id: req.user.id,
        });
        return res.status(201).json({ success: true, data: created });
    } catch (err: any) {
        console.error('Error creating disciplinary action:', err);
        const status = err.message.includes('not enrolled') || err.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const listDisciplinaryActions = async (req: Request, res: Response): Promise<any> => {
    try {
        const result = await svc.listDisciplinaryActions({
            student_id: req.finalQuery.student_id ? Number(req.finalQuery.student_id) : undefined,
            enrollment_id: req.finalQuery.enrollment_id ? Number(req.finalQuery.enrollment_id) : undefined,
            discipline_issue_id: req.finalQuery.discipline_issue_id ? Number(req.finalQuery.discipline_issue_id) : undefined,
            action_type: req.finalQuery.action_type as DisciplinaryActionType | undefined,
            status: req.finalQuery.status as DisciplinaryActionStatus | undefined,
            from: req.query.from as string | undefined,
            to: req.query.to as string | undefined,
            academic_year_id: req.finalQuery.academic_year_id ? Number(req.finalQuery.academic_year_id) : undefined,
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
        });
        return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err: any) {
        console.error('Error listing disciplinary actions:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const getDisciplinaryActionById = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const item = await svc.getDisciplinaryActionById(id);
        if (!item) return res.status(404).json({ success: false, error: 'DisciplinaryAction not found' });
        return res.json({ success: true, data: item });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const updateDisciplinaryAction = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const updated = await svc.updateDisciplinaryAction(id, {
            status: req.body.status as DisciplinaryActionStatus | undefined,
            days: req.body.days !== undefined ? Number(req.body.days) : undefined,
            start_date: req.body.start_date,
            end_date: req.body.end_date,
            reason: req.body.reason,
            notes: req.body.notes,
        });
        return res.json({ success: true, data: updated });
    } catch (err: any) {
        const status = err.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const deleteDisciplinaryAction = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        await svc.deleteDisciplinaryAction(id);
        return res.json({ success: true });
    } catch (err: any) {
        const status = err.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const listPendingApprovals = async (req: Request, res: Response): Promise<any> => {
    try {
        const result = await svc.listPendingApprovals({
            academic_year_id: req.finalQuery.academic_year_id ? Number(req.finalQuery.academic_year_id) : undefined,
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
        });
        return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err: any) {
        console.error('Error listing pending approvals:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const listMyPendingApprovals = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const result = await svc.listMyPendingApprovals(req.user.id, {
            academic_year_id: req.finalQuery.academic_year_id ? Number(req.finalQuery.academic_year_id) : undefined,
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
        });
        return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err: any) {
        console.error('Error listing my pending approvals:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const approveDisciplinaryAction = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const updated = await svc.approveDisciplinaryAction(id, {
            approver_id: req.user.id,
            approval_notes: req.body.approval_notes,
        });
        return res.json({ success: true, data: updated });
    } catch (err: any) {
        const status = err.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const declineDisciplinaryAction = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const updated = await svc.declineDisciplinaryAction(id, {
            approver_id: req.user.id,
            approval_notes: req.body.approval_notes,
        });
        return res.json({ success: true, data: updated });
    } catch (err: any) {
        const status = err.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};
