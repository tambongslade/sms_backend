// Super Manager Overview Routes — read-only aggregated metrics scoped
// tightly to the SUPER_MANAGER role (MANAGER and PRINCIPAL are also
// granted read access because they legitimately need the same overview).
// All modification endpoints remain on their existing routes; this router
// only exposes overview / analytics reads for dashboards and charts.

import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import * as overview from '../controllers/superManagerOverviewController';
import * as statisticsReport from '../controllers/statisticsReportController';

const router = Router();

router.use(authenticate);

const OVERVIEW_ROLES = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL'];

router.get('/snapshot',       authorize(OVERVIEW_ROLES), overview.getSnapshot);
router.get('/discipline',     authorize(OVERVIEW_ROLES), overview.getDisciplineOverview);
router.get('/attendance',     authorize(OVERVIEW_ROLES), overview.getAttendanceOverview);
router.get('/academic',       authorize(OVERVIEW_ROLES), overview.getAcademicOverview);
router.get('/financial',      authorize(OVERVIEW_ROLES), overview.getFinancialOverview);
router.get('/staff',          authorize(OVERVIEW_ROLES), overview.getStaffOverview);
router.get('/communication',  authorize(OVERVIEW_ROLES), overview.getCommunicationOverview);
router.get('/health',         authorize(OVERVIEW_ROLES), overview.getHealthOverview);
router.get('/ream-stock',     authorize(OVERVIEW_ROLES), overview.getReamStockOverview);
router.get('/salary',         authorize(OVERVIEW_ROLES), overview.getSalaryOverview);
router.get('/tasks',          authorize(OVERVIEW_ROLES), overview.getTasksOverview);
router.get('/inventory',      authorize(OVERVIEW_ROLES), overview.getInventoryOverview);
router.get('/audit',          authorize(['SUPER_MANAGER', 'MANAGER']), overview.getAuditOverview);
router.get('/enrollment',     authorize(OVERVIEW_ROLES), overview.getEnrollmentOverview);

// Statistics report — a date-ranged (weekly by default) discipline/teaching/
// work-coverage/financial snapshot with a letterhead PDF export. Vice
// Principal, Dean of Discipline and Discipline Coordinator get it too, but
// the controller scopes what they see (see statisticsReportController's
// FULL_REPORT_ROLES and TEACHING_PAY_ROLES).
const STATISTICS_ROLES = [...OVERVIEW_ROLES, 'VICE_PRINCIPAL', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR'];
router.get('/statistics-report',     authorize(STATISTICS_ROLES), statisticsReport.getStatisticsReport);
router.get('/statistics-report/pdf', authorize(STATISTICS_ROLES), statisticsReport.exportStatisticsReportPdf);

export default router;
