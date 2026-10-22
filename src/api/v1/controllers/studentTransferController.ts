// src/api/v1/controllers/studentTransferController.ts
// U13 transfer-out endpoints. See services/studentTransferService.ts.
import { Request, Response } from 'express';
import * as transferService from '../services/studentTransferService';

function sendError(res: Response, error: any): any {
    switch (error?.message) {
        case 'STUDENT_NOT_FOUND':
            return res.status(404).json({ success: false, error: 'Student not found' });
        case 'TRANSFER_NOT_FOUND':
            return res.status(404).json({ success: false, error: 'No transfer-out record found for this student' });
        case 'REASON_REQUIRED':
            return res.status(400).json({ success: false, error: 'reason is required' });
        case 'INVALID_TRANSFER_DATE':
            return res.status(400).json({ success: false, error: 'transferDate must be a valid date (YYYY-MM-DD)' });
        case 'ALREADY_TRANSFERRED':
            return res.status(409).json({ success: false, error: 'Student has already been transferred out' });
        case 'STUDENT_WITHDRAWN':
            return res.status(409).json({ success: false, error: 'Student has been withdrawn and cannot be transferred out' });
        case 'DUPLICATE_TRANSFER':
            return res.status(409).json({ success: false, error: 'A transfer-out record already exists for this student on that date' });
        case 'TRANSFER_TABLE_MISSING':
            return res.status(503).json({ success: false, error: 'Transfer-out is not available yet: database migration 20261020400000_add_student_transfer has not been applied' });
        default:
            console.error('Student transfer error:', error);
            return res.status(500).json({ success: false, error: error?.message || 'Internal server error' });
    }
}

const parseId = (v: any) => {
    const n = parseInt(String(v), 10);
    return isNaN(n) ? undefined : n;
};

// POST /students/:id/transfer-out
export const transferOut = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Invalid student ID format' });
        const body = req.body || {};
        const academicYearId = body.academic_year_id !== undefined && body.academic_year_id !== null && body.academic_year_id !== ''
            ? parseId(body.academic_year_id)
            : undefined;
        if (body.academic_year_id && academicYearId === undefined) {
            return res.status(400).json({ success: false, error: 'Invalid academic year ID format' });
        }
        const transfer = await transferService.transferOutStudent(id, {
            transfer_date: body.transfer_date,
            reason: body.reason,
            destination_school: body.destination_school,
            remarks: body.remarks,
            academic_year_id: academicYearId,
        }, (req as any).user?.id);
        return res.status(201).json({ success: true, message: 'Student transferred out', data: transfer });
    } catch (error: any) {
        return sendError(res, error);
    }
};

// GET /students/:id/transfer-out
export const getStudentTransfers = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Invalid student ID format' });
        const data = await transferService.getStudentTransfers(id);
        return res.json({ success: true, data });
    } catch (error: any) {
        return sendError(res, error);
    }
};

// GET /students/transfers
export const listTransfers = async (req: Request, res: Response): Promise<any> => {
    try {
        const q: any = (req as any).finalQuery || req.query;
        const result = await transferService.listTransfers({
            academic_year_id: parseId(q.academic_year_id),
            page: parseId(q.page),
            limit: parseId(q.limit),
        });
        return res.json({ success: true, ...result });
    } catch (error: any) {
        return sendError(res, error);
    }
};

// GET /students/:id/leaving-certificate[?transferId=]
export const downloadLeavingCertificate = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Invalid student ID format' });
        const q: any = (req as any).finalQuery || req.query;
        const { buffer, filename } = await transferService.buildLeavingCertificatePdf(id, parseId(q.transfer_id));
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buffer);
    } catch (error: any) {
        return sendError(res, error);
    }
};
