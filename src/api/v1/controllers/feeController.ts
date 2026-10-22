// src/api/v1/controllers/feeController.ts
import { Request, Response } from 'express';
import prisma from '../../../config/db';
import * as feeService from '../services/feeService';
import * as feeRefundService from '../services/feeRefundService';
import * as paymentLedger from '../services/paymentLedgerService';
import * as receiptService from '../services/receiptService';
import * as feeOutstandingService from '../services/feeOutstandingService';
import { getAcademicYearId } from '../../../utils/academicYear';
import { listPaymentMethods } from '../../../utils/paymentMethod';
import * as financialReportService from '../services/financialReportService';
import { PaginationOptions, FilterOptions } from '../../../utils/pagination';

export const getAllFees = async (req: Request, res: Response) => {
    try {
        const academic_year_id = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;
        const class_id = req.query.classId ?
            parseInt(req.query.classId as string) : undefined;
        const student_identifier = req.query.studentIdentifier as string;
        const report_type = req.query.reportType as string || 'detailed'; // Default to detailed (existing behavior)

        // Validate report type
        if (!['summary', 'detailed', 'analytics'].includes(report_type)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid report type. Supported types are: summary, detailed, analytics.'
            });
        }

        let data: any;

        // Route to appropriate service based on report type
        if (report_type === 'summary') {
            // Class Fee Summary Report
            data = await financialReportService.getClassFeeSummaryData(
                academic_year_id,
                class_id
            );
        } else if (report_type === 'analytics') {
            // Payment Method Analytics Report
            data = await financialReportService.getPaymentMethodAnalyticsData(
                academic_year_id,
                class_id
            );
        } else {
            // Check if legacy parameters are being used
            const hasLegacyParams = req.query.page || req.query.limit || req.query.search ||
                                  req.query.className || req.query.subclassName || req.query.dueDate ||
                                  req.query.dueBeforeDate || req.query.dueAfterDate || req.query.subClassId ||
                                  req.query.paymentStatus;

            if (hasLegacyParams) {
                // Use legacy getAllFees with pagination and filtering
                const paginationOptions: PaginationOptions = {
                    page: req.query.page ? parseInt(req.query.page as string) : undefined,
                    limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
                };

                const filterOptions: FilterOptions = {
                    search: req.query.search as string,
                    className: req.query.className as string,
                    subclassName: req.query.subclassName as string,
                    dueDate: req.query.dueDate as string,
                    dueBeforeDate: req.query.dueBeforeDate as string,
                    dueAfterDate: req.query.dueAfterDate as string,
                    classId: req.query.classId as string,
                    subClassId: req.query.subClassId as string,
                    studentIdentifier: req.query.studentIdentifier as string,
                    paymentStatus: req.query.paymentStatus as string,
                    includeWithdrawn: req.query.includeWithdrawn as string
                };

                data = await feeService.getAllFees(paginationOptions, filterOptions, academic_year_id);
            } else {
                // Use new detailed fees data (simplified, structured response)
                data = await financialReportService.getStudentDetailedFeesData(
                    academic_year_id,
                    class_id,
                    student_identifier
                );
            }
        }

        res.json({
            success: true,
            data: data,
            reportType: report_type
        });
    } catch (error: any) {
        console.error('Error fetching fees:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getFeeById = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        const fee = await feeService.getFeeById(id);

        if (!fee) {
            return res.status(404).json({
                success: false,
                error: 'Fee not found'
            });
        }

        res.json({
            success: true,
            data: fee
        });
    } catch (error: any) {
        console.error('Error fetching fee:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const createFee = async (req: Request, res: Response) => {
    try {
        // Use the body directly - middleware handles the conversion to snake_case
        const feeData = req.body;
        const newFee = await feeService.createFee(feeData);

        res.status(201).json({
            success: true,
            data: newFee
        });
    } catch (error: any) {
        console.error('Error creating fee:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const updateFee = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        const feeData = req.body;

        const updatedFee = await feeService.updateFee(id, feeData);

        res.json({
            success: true,
            data: updatedFee
        });
    } catch (error: any) {
        console.error('Error updating fee:', error);

        // Check if it's a "not found" error
        if (error.message.includes('not found')) {
            return res.status(404).json({
                success: false,
                error: error.message
            });
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const deleteFee = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);

        await feeService.deleteFee(id);

        res.json({
            success: true,
            message: 'Fee deleted successfully'
        });
    } catch (error: any) {
        console.error('Error deleting fee:', error);

        // Check for specific error types
        if (error.message.includes('Cannot delete fee with existing payment records')) {
            return res.status(400).json({
                success: false,
                error: error.message
            });
        }

        if (error.message.includes('Record to delete does not exist')) {
            return res.status(404).json({
                success: false,
                error: 'Fee not found'
            });
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getStudentFees = async (req: Request, res: Response) => {
    try {
        const studentId = parseInt(req.params.studentId);

        const academic_year_id = req.finalQuery.academic_year_id ?
            parseInt(req.finalQuery.academic_year_id as string) : undefined;

        const fees = await feeService.getStudentFees(studentId, academic_year_id);

        res.json({
            success: true,
            data: fees
        });
    } catch (error: any) {
        console.error('Error fetching student fees:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getSubclassFeesSummary = async (req: Request, res: Response) => {
    try {
        const sub_classId = parseInt(req.params.sub_classId ?? req.params.id);

        const academic_year_id = req.finalQuery.academic_year_id ?
            parseInt(req.finalQuery.academic_year_id as string) : undefined;

        const summary = await feeService.getSubclassFeesSummary(sub_classId, academic_year_id);

        res.json({
            success: true,
            data: summary
        });
    } catch (error: any) {
        console.error('Error fetching sub_class fees summary:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getStudentFeesStatus = async (req: Request, res: Response): Promise<any> => {
    try {
        const studentId = parseInt(req.params.studentId);
        if (isNaN(studentId)) return res.status(400).json({ success: false, error: 'Invalid studentId' });

        const academicYearId = req.query.academicYearId ? parseInt(req.query.academicYearId as string)
            : req.finalQuery.academic_year_id ? parseInt(req.finalQuery.academic_year_id as string) : undefined;

        const status = await feeService.checkStudentSchoolFeesPaid(studentId, academicYearId);
        return res.json({ success: true, data: status });
    } catch (error: any) {
        console.error('Error fetching student fee status:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

export const getSubclassUnpaidStudents = async (req: Request, res: Response): Promise<any> => {
    try {
        const subClassId = parseInt(req.params.subClassId ?? req.params.id);
        if (isNaN(subClassId)) return res.status(400).json({ success: false, error: 'Invalid subClassId' });

        const academicYearId = req.query.academicYearId ? parseInt(req.query.academicYearId as string)
            : req.finalQuery.academic_year_id ? parseInt(req.finalQuery.academic_year_id as string) : undefined;

        const result = await feeService.getSubclassFeesStatus(subClassId, academicYearId);
        return res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error fetching subclass fee status:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

export const recordPayment = async (req: Request, res: Response): Promise<any> => {
    try {
        const feeId = parseInt(req.params.feeId);
        if (isNaN(feeId)) {
            return res.status(400).json({ success: false, error: 'Invalid feeId' });
        }
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        // Body arrives snake_cased by the case-conversion middleware.
        const { confirm_overpayment, ...body } = req.body || {};
        const payment = await feeService.recordPayment({
            ...body,
            fee_id: feeId,
            recorded_by_id: userId,
            overpayment_policy: 'require_confirmation',
            confirm_overpayment: confirm_overpayment === true || confirm_overpayment === 'true',
        });

        res.status(201).json({
            success: true,
            data: payment
        });
    } catch (error: any) {
        console.error('Error recording payment:', error);

        const mapped = paymentLedger.paymentErrorToHttp(error);
        if (mapped) return res.status(mapped.status).json(mapped.body);

        if (error instanceof feeService.DuplicatePaymentError) {
            return res.status(409).json({
                success: false,
                error: error.message,
                code: 'DUPLICATE_PAYMENT',
                existingPaymentId: error.existingPaymentId,
                secondsAgo: error.secondsAgo,
            });
        }
        if (error.message?.includes('not found') || error.message?.includes('not enrolled')) {
            return res.status(404).json({ success: false, error: error.message });
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * PUT /fees/payments/:paymentId  and  PUT /fees/:feeId/payments/:paymentId
 * Body (camelCase): { amount?, paymentDate?, paymentMethod?, receiptNumber?, notes?, reason? }
 */
export const updatePayment = async (req: Request, res: Response): Promise<any> => {
    try {
        const paymentId = parseInt(req.params.paymentId);
        if (isNaN(paymentId)) {
            return res.status(400).json({ success: false, error: 'Invalid paymentId' });
        }
        const feeId = req.params.feeId !== undefined ? parseInt(req.params.feeId) : undefined;
        if (req.params.feeId !== undefined && isNaN(feeId as number)) {
            return res.status(400).json({ success: false, error: 'Invalid feeId' });
        }

        const userRoles = ((req as any).user?.role || []) as string[];
        const { reason, ...body } = req.body || {};
        const updated = await feeService.updatePayment(paymentId, body, userRoles, {
            userId: (req as any).user?.id,
            feeId,
            reason: typeof reason === 'string' ? reason : null,
        });

        return res.json({ success: true, data: updated });
    } catch (error: any) {
        console.error('Error updating payment:', error);

        const mapped = paymentLedger.paymentErrorToHttp(error);
        if (mapped) return res.status(mapped.status).json(mapped.body);

        if (error instanceof feeService.PaymentEditWindowClosedError) {
            return res.status(403).json({ success: false, error: error.message });
        }
        if (error.message?.includes('not found')) {
            return res.status(404).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
};

/** GET /fees/payments/:paymentId/receipt  -> receipt data (JSON) */
export const getPaymentReceipt = async (req: Request, res: Response): Promise<any> => {
    try {
        const paymentId = parseInt(req.params.paymentId);
        if (isNaN(paymentId)) {
            return res.status(400).json({ success: false, error: 'Invalid paymentId' });
        }
        const data = await receiptService.getReceiptData(paymentId);
        if (!data) return res.status(404).json({ success: false, error: 'Payment not found' });
        return res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error fetching receipt:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/** GET /fees/payments/:paymentId/receipt/pdf?reprint=true  -> application/pdf */
export const getPaymentReceiptPdf = async (req: Request, res: Response): Promise<any> => {
    try {
        const paymentId = parseInt(req.params.paymentId);
        if (isNaN(paymentId)) {
            return res.status(400).json({ success: false, error: 'Invalid paymentId' });
        }
        const user = (req as any).user;
        const result = await receiptService.generateReceiptPdf(paymentId, {
            reprint: req.query.reprint === 'true' || req.query.reprint === '1',
            printedBy: user?.id
                ? (await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } }))?.name ?? null
                : null,
        });
        if (!result) return res.status(404).json({ success: false, error: 'Payment not found' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${result.filename}"`);
        return res.send(result.buffer);
    } catch (error: any) {
        console.error('Error generating receipt PDF:', error);
        return res.status(500).json({ success: false, error: 'Failed to generate receipt PDF' });
    }
};

/** GET /fees/outstanding-summary?academicYearId=&classId=&subClassId= — shared outstanding totals + reconciliation */
export const getOutstandingSummary = async (req: Request, res: Response): Promise<any> => {
    try {
        const yearId = await getAcademicYearId(req.query.academicYearId ? parseInt(req.query.academicYearId as string) : undefined);
        if (!yearId) return res.status(400).json({ success: false, error: 'No academic year found and none provided' });
        const classId = req.query.classId ? parseInt(req.query.classId as string) : undefined;
        const subClassId = req.query.subClassId ? parseInt(req.query.subClassId as string) : undefined;
        const data = await feeOutstandingService.getOutstandingSummary(yearId, {
            classId: classId && !isNaN(classId) ? classId : undefined,
            subClassId: subClassId && !isNaN(subClassId) ? subClassId : undefined,
        });
        return res.json({ success: true, data: { academicYearId: yearId, ...data } });
    } catch (error: any) {
        console.error('Error computing outstanding summary:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/** GET /fees/payment-methods -> [{ value, label }] for dropdowns */
export const getPaymentMethods = async (_req: Request, res: Response): Promise<any> => {
    return res.json({ success: true, data: listPaymentMethods() });
};

export const getFeePayments = async (req: Request, res: Response): Promise<any> => {
    try {
        const feeId = parseInt(req.params.feeId);
        const payments = await feeService.getFeePayments(feeId);

        if (!payments) {
            return res.status(404).json({
                success: false,
                error: 'Fee not found'
            });
        }

        // Response will be automatically converted to camelCase by middleware
        res.json({
            success: true,
            data: payments
        });
    } catch (error: any) {
        console.error('Error fetching fee payments:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const exportFeeReports = async (req: Request, res: Response) => {
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
        const report_type = req.query.reportType as string || 'detailed'; // Default to detailed (existing behavior)

        // Validate format
        if (!['csv', 'pdf', 'docx', 'xlsx', 'excel'].includes(format)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid format requested. Supported formats are: csv, pdf, docx, xlsx, excel.'
            });
        }

        // Validate report type
        if (!['summary', 'detailed', 'analytics'].includes(report_type)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid report type. Supported types are: summary, detailed, analytics.'
            });
        }

        // Map 'excel' to 'xlsx' for proper file generation
        const normalizedFormat = format === 'excel' ? 'xlsx' : format;

        let buffer: Buffer, contentType: string, filename: string;

        // Route to appropriate service based on report type
        if (report_type === 'summary') {
            // Class Fee Summary Report
            const result = await financialReportService.generateClassFeeSummaryReport(
                academic_year_id,
                class_id,
                normalizedFormat as 'csv' | 'xlsx' | 'pdf' | 'docx'
            );
            buffer = result.buffer;
            contentType = result.contentType;
            filename = result.filename;
        } else if (report_type === 'analytics') {
            // Payment Method Analytics Report
            const result = await financialReportService.generatePaymentMethodAnalyticsReport(
                academic_year_id,
                class_id,
                normalizedFormat as 'csv' | 'xlsx' | 'pdf' | 'docx'
            );
            buffer = result.buffer;
            contentType = result.contentType;
            filename = result.filename;
        } else {
            // Detailed Student Fee Report (default and existing behavior)
            const result = await financialReportService.generateStudentDetailedFeesReport(
                academic_year_id,
                class_id,
                student_identifier,
                normalizedFormat as 'csv' | 'xlsx' | 'pdf' | 'docx'
            );
            buffer = result.buffer;
            contentType = result.contentType;
            filename = result.filename;
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);

    } catch (error: any) {
        console.error('Error exporting fee reports:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error during fee report export.'
        });
    }
};

export const listOverpaid = async (req: Request, res: Response): Promise<any> => {
    try {
        const result = await feeRefundService.listOverpaid({
            academic_year_id: req.query.academicYearId ? Number(req.query.academicYearId) : undefined,
            class_id: req.query.classId ? Number(req.query.classId) : undefined,
            sub_class_id: req.query.subClassId ? Number(req.query.subClassId) : undefined,
            min_overpayment: req.query.minOverpayment ? Number(req.query.minOverpayment) : undefined,
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
        });
        return res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('Error listing overpaid students:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const exportOverpaid = async (req: Request, res: Response): Promise<any> => {
    try {
        const { buffer, filename } = await feeRefundService.exportOverpaidExcel({
            academic_year_id: req.query.academicYearId ? Number(req.query.academicYearId) : undefined,
            class_id: req.query.classId ? Number(req.query.classId) : undefined,
            sub_class_id: req.query.subClassId ? Number(req.query.subClassId) : undefined,
            min_overpayment: req.query.minOverpayment ? Number(req.query.minOverpayment) : undefined,
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buffer);
    } catch (err: any) {
        console.error('Error exporting overpaid students:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const recordRefund = async (req: any, res: Response): Promise<any> => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const result = await feeRefundService.recordRefund({
            enrollment_id: Number(req.body.enrollmentId ?? req.body.enrollment_id),
            amount: Number(req.body.amount),
            refund_date: req.body.refundDate ?? req.body.refund_date,
            refund_method: req.body.refundMethod ?? req.body.refund_method,
            reason: req.body.reason,
            notes: req.body.notes,
            recorded_by_id: userId,
        });
        return res.status(201).json({ success: true, data: result });
    } catch (err: any) {
        console.error('Error recording refund:', err);
        return res.status(400).json({ success: false, error: err.message });
    }
};

export const listRefunds = async (req: Request, res: Response): Promise<any> => {
    try {
        const result = await feeRefundService.listRefunds({
            student_id: req.query.studentId ? Number(req.query.studentId) : undefined,
            enrollment_id: req.query.enrollmentId ? Number(req.query.enrollmentId) : undefined,
            academic_year_id: req.query.academicYearId ? Number(req.query.academicYearId) : undefined,
            from: req.query.from as string | undefined,
            to: req.query.to as string | undefined,
            page: req.query.page ? Number(req.query.page) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
        });
        return res.json({ success: true, ...result });
    } catch (err: any) {
        console.error('Error listing refunds:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const getRefundById = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
        const refund = await feeRefundService.getRefundById(id);
        if (!refund) return res.status(404).json({ success: false, error: 'Refund not found' });
        return res.json({ success: true, data: refund });
    } catch (err: any) {
        console.error('Error fetching refund:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};
