import { Request, Response } from 'express';
import * as statisticsReportService from '../services/statisticsReportService';

// Roles that see the full report (Teaching/Work Coverage/Financial included).
// Anyone else authorized for this route (currently Dean of Discipline and
// Discipline Coordinator) gets discipline-only -- see
// statisticsReportRoutes' authorize() list for who can reach this at all.
const FULL_REPORT_ROLES = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL'];

function parseParams(req: Request) {
    const q = req.finalQuery as any;
    const from = q.from as string | undefined;
    const to = q.to as string | undefined;
    if (!from || !to) {
        const e: any = new Error('from and to query params are required (YYYY-MM-DD)');
        e.statusCode = 400;
        throw e;
    }
    const callerRoles = req.user?.role ?? [];
    const disciplineOnly = !callerRoles.some((r) => FULL_REPORT_ROLES.includes(r));
    return {
        academicYearId: q.academic_year_id ? parseInt(q.academic_year_id) : undefined,
        from,
        to,
        disciplineOnly,
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
