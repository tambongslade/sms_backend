import { Request, Response } from 'express';
import * as statisticsReportService from '../services/statisticsReportService';

// Roles that see Work Coverage/Financial (besides Discipline + Teaching,
// which everyone authorized for this route gets -- see STATISTICS_ROLES in
// superManagerOverviewRoutes.ts for who can reach this at all).
const FULL_REPORT_ROLES = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL'];

// Only Super Manager sees Teaching's pay-adjacent columns (Hour Rate,
// Socials, Total) -- everyone else in FULL_REPORT_ROLES, plus Dean of
// Discipline/Discipline Coordinator, still sees the Teaching table itself
// (Expected/Taught/Not-Taught Periods), just without those three.
const TEACHING_PAY_ROLES = ['SUPER_MANAGER'];

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
    const canSeeTeachingPay = callerRoles.some((r) => TEACHING_PAY_ROLES.includes(r));
    return {
        academicYearId: q.academic_year_id ? parseInt(q.academic_year_id) : undefined,
        from,
        to,
        disciplineOnly,
        canSeeTeachingPay,
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

/**
 * GET /statistics-report/sub-class/:id?from=&to=
 * One sub-class's students with their discipline figures for the range.
 */
export const getSubClassStudentStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const { academicYearId, from, to } = parseParams(req);
        const subClassId = Number(req.params.id);
        if (!Number.isInteger(subClassId) || subClassId <= 0) {
            res.status(400).json({ success: false, error: 'Invalid sub-class' });
            return;
        }
        const data = await statisticsReportService.getSubClassStudentStats({ subClassId, academicYearId, from, to });
        res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error building sub-class statistics:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
};

/**
 * GET /statistics-report/student/:id/absences?from=&to=[&type=MORNING_LATENESS]
 * One student's absence records in the range, with when and by whom each was recorded.
 */
export const getStudentAbsenceRecords = async (req: Request, res: Response): Promise<void> => {
    try {
        const { academicYearId, from, to } = parseParams(req);
        const studentId = Number(req.params.id);
        if (!Number.isInteger(studentId) || studentId <= 0) {
            res.status(400).json({ success: false, error: 'Invalid student' });
            return;
        }
        const t = String((req.finalQuery as any)?.type || '');
        const type = t === 'MORNING_LATENESS' ? 'MORNING_LATENESS' : 'CLASS_ABSENCE';
        const data = await statisticsReportService.getStudentAbsenceRecords({ studentId, academicYearId, from, to, type });
        res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error loading student absence records:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
};
