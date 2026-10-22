// src/api/v1/controllers/feeComparisonController.ts
import { Request, Response } from 'express';
import * as feeComparisonService from '../services/feeComparisonService';

export const getFeeDiscrepancies = async (req: Request, res: Response) => {
    try {
        const academic_year_id = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;
        const sub_class_id = req.query.subClassId ?
            parseInt(req.query.subClassId as string) : undefined;
        const class_id = req.query.classId ?
            parseInt(req.query.classId as string) : undefined;
        const student_id = req.query.studentId ?
            parseInt(req.query.studentId as string) : undefined;

        const discrepancies = await feeComparisonService.getFeeDiscrepancies(
            academic_year_id,
            sub_class_id,
            class_id,
            student_id
        );

        res.json({
            success: true,
            data: discrepancies,
            meta: {
                total: discrepancies.length,
                academicYearId: academic_year_id
            }
        });
    } catch (error: any) {
        console.error('Error fetching fee discrepancies:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getComparisonSummary = async (req: Request, res: Response) => {
    try {
        const academic_year_id = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        const summary = await feeComparisonService.getComparisonSummary(academic_year_id);

        res.json({
            success: true,
            data: summary
        });
    } catch (error: any) {
        console.error('Error fetching comparison summary:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getStudentFeeComparison = async (req: Request, res: Response) => {
    try {
        const student_id = parseInt(req.params.studentId);
        const academic_year_id = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        if (isNaN(student_id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid student ID format'
            });
        }

        const comparison = await feeComparisonService.getStudentFeeComparison(student_id, academic_year_id);

        res.json({
            success: true,
            data: comparison
        });
    } catch (error: any) {
        console.error('Error fetching student fee comparison:', error);

        if (error.message.includes('not enrolled')) {
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

export const getEnrolledStudentsFeeStatus = async (req: Request, res: Response): Promise<any> => {
    try {
        const academic_year_id = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;

        const status = req.query.status as string | undefined;
        const allowed = ['MATCHED', 'NOT_PAID', 'PAYMENT_MISMATCH', 'MISSING_PRIMARY', 'MISSING_CONTROL', 'NO_RECORDS'];
        if (status && !allowed.includes(status)) {
            return res.status(400).json({
                success: false,
                error: `Invalid status. Allowed: ${allowed.join(', ')}`
            });
        }

        const studentStatus = req.query.studentStatus as string | undefined;
        const allowedStudentStatus = ['NEW', 'OLD', 'REPEATER'];
        if (studentStatus && !allowedStudentStatus.includes(studentStatus)) {
            return res.status(400).json({
                success: false,
                error: `Invalid studentStatus. Allowed: ${allowedStudentStatus.join(', ')}`
            });
        }

        const result = await feeComparisonService.getEnrolledStudentsFeeStatus(academic_year_id, {
            page: req.query.page ? parseInt(req.query.page as string) : undefined,
            limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
            classId: req.query.classId ? parseInt(req.query.classId as string) : undefined,
            subClassId: req.query.subClassId ? parseInt(req.query.subClassId as string) : undefined,
            search: req.query.search as string | undefined,
            status: status as any,
            studentStatus: studentStatus as any,
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error fetching enrolled students fee status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const exportDiscrepancyReports = async (req: Request, res: Response) => {
    try {
        const academic_year_id = req.query.academicYearId ?
            parseInt(req.query.academicYearId as string) : undefined;
        const format = (req.query.format as string || 'csv').toLowerCase();

        // Validate format
        if (!['csv', 'xlsx', 'excel'].includes(format)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid format requested. Supported formats are: csv, xlsx, excel.'
            });
        }

        // Map 'excel' to 'xlsx' for proper file generation
        const normalizedFormat = format === 'excel' ? 'xlsx' : format;

        const { buffer, contentType, filename } = await feeComparisonService.exportDiscrepancyReports(
            academic_year_id,
            normalizedFormat as 'csv' | 'xlsx'
        );

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);

    } catch (error: any) {
        console.error('Error exporting discrepancy reports:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error during discrepancy report export.'
        });
    }
};