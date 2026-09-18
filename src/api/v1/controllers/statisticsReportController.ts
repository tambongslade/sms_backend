import { Request, Response } from 'express';
import * as statisticsReportService from '../services/statisticsReportService';

function parseParams(req: Request) {
    const q = req.finalQuery as any;
    const from = q.from as string | undefined;
    const to = q.to as string | undefined;
    if (!from || !to) {
        const e: any = new Error('from and to query params are required (YYYY-MM-DD)');
        e.statusCode = 400;
        throw e;
    }
    return {
        academicYearId: q.academic_year_id ? parseInt(q.academic_year_id) : undefined,
        from,
        to,
    };
}

/**
 * GET /statistics-report
 * On-screen JSON payload for the Super Manager Statistics page.
 */
export const getStatisticsReport = async (req: Request, res: Response): Promise<void> => {
    try {
        const params = parseParams(req);
        const data = await statisticsReportService.getStatisticsReport(params);
        res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error building statistics report:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
};

/**
 * GET /statistics-report/pdf
 * Letterhead PDF export of the same report.
 */
export const exportStatisticsReportPdf = async (req: Request, res: Response): Promise<void> => {
    try {
        const params = parseParams(req);
        const { buffer, filename } = await statisticsReportService.generateStatisticsReportPdf(params);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error: any) {
        console.error('Error exporting statistics report PDF:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
};
