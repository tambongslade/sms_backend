// src/api/v1/controllers/controlFeeController.ts
import { Request, Response } from 'express';
import * as controlFeeService from '../services/controlFeeService';
import { PaginationOptions, FilterOptions } from '../../../utils/pagination';

export const getAllControlFees = async (req: Request, res: Response) => {
    try {
        const academic_year_id = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        const paginationOptions: PaginationOptions = {
            page: req.query.page ? parseInt(req.query.page as string) : undefined,
            limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        };

        const filterOptions: FilterOptions = {
            search: req.query.search as string,
            className: req.query.className as string,
            subclassName: req.query.subclassName as string,
            classId: req.query.classId as string,
            subClassId: req.query.subClassId as string,
            studentIdentifier: req.query.studentIdentifier as string,
            paymentStatus: req.query.paymentStatus as string
        };

        const fees = await controlFeeService.getAllControlFees(paginationOptions, filterOptions, academic_year_id);
        res.json({ success: true, data: fees });
    } catch (error: any) {
        console.error('Error fetching control fees:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getControlFeeById = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        const fee = await controlFeeService.getControlFeeById(id);
        if (!fee) {
            return res.status(404).json({ success: false, error: 'Control fee record not found' });
        }
        res.json({ success: true, data: fee });
    } catch (error: any) {
        console.error('Error fetching control fee:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getStudentControlFees = async (req: Request, res: Response) => {
    try {
        const studentId = parseInt(req.params.studentId);
        const academic_year_id = req.finalQuery.academic_year_id ?
            parseInt(req.finalQuery.academic_year_id as string) : undefined;
        const fees = await controlFeeService.getStudentControlFees(studentId, academic_year_id);
        res.json({ success: true, data: fees });
    } catch (error: any) {
        console.error('Error fetching student control fees:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getSubclassControlFeesSummary = async (req: Request, res: Response) => {
    try {
        const sub_classId = parseInt(req.params.sub_classId ?? req.params.id);
        const academic_year_id = req.finalQuery.academic_year_id ?
            parseInt(req.finalQuery.academic_year_id as string) : undefined;
        const summary = await controlFeeService.getSubclassControlFeesSummary(sub_classId, academic_year_id);
        res.json({ success: true, data: summary });
    } catch (error: any) {
        console.error('Error fetching subclass control fee summary:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Simplified payment recording: the Controller only enters what was collected.
// No expected-amount, no due-date, no separate "create fee" step.
export const recordControlPayment = async (req: Request, res: Response): Promise<any> => {
    try {
        const paymentData = {
            ...req.body,
            recorded_by_id: (req as any).user?.id
        };
        const payment = await controlFeeService.recordSimpleControlPayment(paymentData);
        res.status(201).json({ success: true, data: payment });
    } catch (error: any) {
        console.error('Error recording control payment:', error);
        const msg = error.message || 'Failed to record control payment';

        if (msg.includes('not enrolled') || msg.includes('Either enrollmentId')) {
            return res.status(400).json({ success: false, error: msg });
        }
        if (msg.includes('Amount must be greater')) {
            return res.status(400).json({ success: false, error: msg });
        }
        if (msg.includes('Invalid payment method')) {
            return res.status(400).json({ success: false, error: msg });
        }
        if (msg.includes('Academic year ID is required')) {
            return res.status(400).json({ success: false, error: msg });
        }
        res.status(500).json({ success: false, error: msg });
    }
};

export const getControlFeePayments = async (req: Request, res: Response): Promise<any> => {
    try {
        const controlFeeId = parseInt(req.params.controlFeeId);
        const payments = await controlFeeService.getControlFeePayments(controlFeeId);
        if (!payments) {
            return res.status(404).json({ success: false, error: 'Control fee record not found' });
        }
        res.json({ success: true, data: payments });
    } catch (error: any) {
        console.error('Error fetching control fee payments:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const exportControlFeeReports = async (req: Request, res: Response) => {
    try {
        const academic_year_id = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;
        const sub_class_id = req.query.subClassId ?
            parseInt(req.query.subClassId as string) : undefined;
        const class_id = req.query.classId ?
            parseInt(req.query.classId as string) : undefined;
        const student_identifier = req.query.studentIdentifier as string;
        const payment_status = req.query.paymentStatus as string;
        const format = (req.query.format as string || 'csv').toLowerCase();

        if (!['csv', 'pdf', 'docx', 'xlsx', 'excel'].includes(format)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid format requested. Supported formats are: csv, pdf, docx, xlsx, excel.'
            });
        }

        const normalizedFormat = format === 'excel' ? 'xlsx' : format;

        const { buffer, contentType, filename } = await controlFeeService.exportControlFeeReports(
            academic_year_id,
            sub_class_id,
            class_id,
            student_identifier,
            payment_status,
            normalizedFormat as 'csv' | 'pdf' | 'docx' | 'xlsx'
        );

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error: any) {
        console.error('Error exporting control fee reports:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error during control fee report export.'
        });
    }
};

// PUT /control-fees/payments/:id - correct a payment within 10 minutes of recording it (only by whoever recorded it).
export const updateControlPayment = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: 'Invalid payment id' });
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Not signed in' });
        const { amount, payment_date, payment_method, receipt_number } = req.body || {};
        const payment = await controlFeeService.updateControlPayment(id, userId, { amount, payment_date, payment_method, receipt_number });
        res.json({ success: true, data: payment });
    } catch (error: any) {
        if (error instanceof controlFeeService.ControlPaymentEditError) {
            return res.status(error.status).json({ success: false, error: error.message });
        }
        if (String(error?.message || '').includes('Invalid payment method')) {
            return res.status(400).json({ success: false, error: error.message });
        }
        console.error('Error updating control payment:', error);
        res.status(500).json({ success: false, error: error?.message || 'Failed to update payment' });
    }
};
