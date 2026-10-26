import { Request, Response } from 'express';
import * as gceRegistrationService from '../services/gceRegistrationService';
import { GceRegistrationError } from '../services/gceRegistrationService';

function handleError(err: any, res: Response) {
    if (err instanceof GceRegistrationError) {
        return res.status(err.status).json({ success: false, error: err.message });
    }
    console.error('GCE registration error:', err);
    return res.status(400).json({ success: false, error: err.message });
}

export const getRoster = async (req: Request, res: Response): Promise<any> => {
    try {
        const roster = await gceRegistrationService.listRoster({
            academic_year_id: req.query.academicYearId ? Number(req.query.academicYearId) : undefined,
            exam_level: req.query.examLevel as any,
            class_id: req.query.classId ? Number(req.query.classId) : undefined,
            sub_class_id: req.query.subClassId ? Number(req.query.subClassId) : undefined,
        });
        return res.json({ success: true, data: roster });
    } catch (err: any) {
        return handleError(err, res);
    }
};

export const getRegistration = async (req: Request, res: Response): Promise<any> => {
    try {
        const enrollmentId = parseInt(req.params.enrollmentId);
        if (isNaN(enrollmentId)) return res.status(400).json({ success: false, error: 'Invalid enrollmentId' });
        const data = await gceRegistrationService.getRegistrationForEnrollment(enrollmentId);
        return res.json({ success: true, data });
    } catch (err: any) {
        return handleError(err, res);
    }
};

export const saveSubjects = async (req: any, res: Response): Promise<any> => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const enrollmentId = parseInt(req.params.enrollmentId);
        if (isNaN(enrollmentId)) return res.status(400).json({ success: false, error: 'Invalid enrollmentId' });

        const subjectIds: number[] = req.body.subjectIds ?? req.body.subject_ids ?? [];
        const registration = await gceRegistrationService.saveRegistrationSubjects(enrollmentId, subjectIds, userId);
        return res.status(200).json({ success: true, data: registration });
    } catch (err: any) {
        return handleError(err, res);
    }
};

export const recordPayment = async (req: any, res: Response): Promise<any> => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const registrationId = parseInt(req.params.id);
        if (isNaN(registrationId)) return res.status(400).json({ success: false, error: 'Invalid registration id' });

        const result = await gceRegistrationService.recordPayment(registrationId, {
            amount: Number(req.body.amount),
            payment_date: req.body.payment_date ?? req.body.paymentDate,
            payment_method: req.body.payment_method ?? req.body.paymentMethod,
            receipt_number: req.body.receipt_number ?? req.body.receiptNumber,
            notes: req.body.notes,
            recorded_by_id: userId,
        });
        return res.status(201).json({ success: true, data: result });
    } catch (err: any) {
        return handleError(err, res);
    }
};

export const getPayments = async (req: Request, res: Response): Promise<any> => {
    try {
        const registrationId = parseInt(req.params.id);
        if (isNaN(registrationId)) return res.status(400).json({ success: false, error: 'Invalid registration id' });
        const payments = await gceRegistrationService.getPayments(registrationId);
        return res.json({ success: true, data: payments });
    } catch (err: any) {
        return handleError(err, res);
    }
};
