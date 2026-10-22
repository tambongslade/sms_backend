import { Request, Response } from 'express';
import * as svc from '../services/brokenPropertyService';

export const createBrokenProperty = async (req: any, res: Response): Promise<any> => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const rawCost = req.body.estimated_cost;
        // Cost is now optional. Omit / null / '' -> no charge recorded.
        let estimated_cost: number | null = null;
        if (rawCost !== undefined && rawCost !== null && rawCost !== '') {
            const parsed = Number(rawCost);
            if (Number.isNaN(parsed)) {
                return res.status(400).json({ success: false, error: 'estimated_cost must be a number' });
            }
            estimated_cost = parsed;
        }
        const created = await svc.createBrokenProperty({
            student_id: Number(req.body.student_id),
            academic_year_id: req.body.academic_year_id ? Number(req.body.academic_year_id) : undefined,
            item_name: req.body.item_name,
            description: req.body.description,
            estimated_cost,
            photo_url: req.body.photo_url,
            action_taken: req.body.action_taken,
            reported_by_id: req.user.id,
        });
        return res.status(201).json({ success: true, data: created });
    } catch (err: any) {
        console.error('Error creating broken property:', err);
        const status = err.message.includes('not enrolled') ? 404 : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const listBrokenProperty = async (req: Request, res: Response): Promise<any> => {
    try {
        const result = await svc.listBrokenProperty({
            student_id: req.finalQuery.student_id ? Number(req.finalQuery.student_id) : undefined,
            enrollment_id: req.finalQuery.enrollment_id ? Number(req.finalQuery.enrollment_id) : undefined,
            from: req.query.from as string | undefined,
            to: req.query.to as string | undefined,
            academic_year_id: req.finalQuery.academic_year_id ? Number(req.finalQuery.academic_year_id) : undefined,
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
        });
        return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err: any) {
        console.error('Error listing broken property:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const getBrokenPropertyById = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const item = await svc.getBrokenPropertyById(id);
        if (!item) return res.status(404).json({ success: false, error: 'BrokenProperty not found' });
        return res.json({ success: true, data: item });
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const updateBrokenProperty = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        let estimated_cost: number | null | undefined = undefined;
        if (req.body.estimated_cost !== undefined) {
            const rawCost = req.body.estimated_cost;
            if (rawCost === null || rawCost === '') {
                estimated_cost = null;
            } else {
                const parsed = Number(rawCost);
                if (Number.isNaN(parsed)) {
                    return res.status(400).json({ success: false, error: 'estimated_cost must be a number' });
                }
                estimated_cost = parsed;
            }
        }
        const updated = await svc.updateBrokenProperty(id, {
            item_name: req.body.item_name,
            description: req.body.description,
            estimated_cost,
            photo_url: req.body.photo_url,
            action_taken: req.body.action_taken,
        });
        return res.json({ success: true, data: updated });
    } catch (err: any) {
        const status = err.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const deleteBrokenProperty = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        await svc.deleteBrokenProperty(id);
        return res.json({ success: true });
    } catch (err: any) {
        const status = err.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, error: err.message });
    }
};
