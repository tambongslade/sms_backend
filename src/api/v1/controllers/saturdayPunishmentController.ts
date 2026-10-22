import { Request, Response } from 'express';
import * as svc from '../services/saturdayPunishmentService';
import { PunishmentStatus } from '../../../config/db';

export const createSaturdayPunishment = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const created = await svc.createSaturdayPunishment({
            student_id: Number(req.body.student_id),
            academic_year_id: req.body.academic_year_id ? Number(req.body.academic_year_id) : undefined,
            reason: req.body.reason,
            reason_category: req.body.reason_category,
            scheduled_date: req.body.scheduled_date ?? null,
            notes: req.body.notes,
            assigned_by_id: req.user.id,
        });
        return res.status(201).json({ success: true, data: created });
    } catch (err: any) {
        console.error('Error creating Saturday punishment:', err);
        const status = err.message.includes('not enrolled') ? 404 : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const listSaturdayPunishments = async (req: Request, res: Response): Promise<any> => {
    try {
        const result = await svc.listSaturdayPunishments({
            student_id: req.finalQuery.student_id ? Number(req.finalQuery.student_id) : undefined,
            enrollment_id: req.finalQuery.enrollment_id ? Number(req.finalQuery.enrollment_id) : undefined,
            status: req.query.status as PunishmentStatus | undefined,
            from: req.query.from as string | undefined,
            to: req.query.to as string | undefined,
            academic_year_id: req.finalQuery.academic_year_id ? Number(req.finalQuery.academic_year_id) : undefined,
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
        });
        return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err: any) {
        console.error('Error listing Saturday punishments:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const getSaturdayPunishmentById = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const item = await svc.getSaturdayPunishmentById(id);
        if (!item) return res.status(404).json({ success: false, error: 'SaturdayPunishment not found' });
        return res.json({ success: true, data: item });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const updateSaturdayPunishment = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const updated = await svc.updateSaturdayPunishment(id, {
            reason: req.body.reason,
            reason_category: req.body.reason_category,
            scheduled_date: req.body.scheduled_date,
            served_date: req.body.served_date,
            status: req.body.status as PunishmentStatus | undefined,
            notes: req.body.notes,
        });
        return res.json({ success: true, data: updated });
    } catch (err: any) {
        const status = err.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const deleteSaturdayPunishment = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        await svc.deleteSaturdayPunishment(id);
        return res.json({ success: true });
    } catch (err: any) {
        return res.status(400).json({ success: false, error: err.message });
    }
};
