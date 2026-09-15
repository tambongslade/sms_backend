import { Router } from 'express';
import authRoutes from './authRoutes';
import academicYearRoutes from './academicYearRoutes';
import userRoutes from './userRoutes';
import classRoutes from './classRoutes';
import studentRoutes from './studentRoutes';
import feeRoutes from './feeRoutes';
import feeItemRoutes from './feeItemRoutes';
import financeRequestRoutes from './financeRequestRoutes';
import expenditureRoutes from './expenditureRoutes';
import controlFeeRoutes from './controlFeeRoutes';
import feeComparisonRoutes from './feeComparisonRoutes';
import unifiedPaymentRoutes from './unifiedPaymentRoutes';
import subjectRoutes from './subjectRoutes';
import disciplineRoutes from './disciplineRoutes';
import examRoutes, { marksRouter, reportCardsRouter } from './examRoutes';
import communicationRoutes from './communicationRoutes';
import mobileRoutes from './mobileRoutes';
import fileRoutes from './fileRoutes';
import periodRoutes from './periodRoutes';
import timetableRoutes from './timetableRoutes';
import teacherRoutes from './teacherRoutes';
import enrollmentRoutes from './enrollmentRoutes';
import enhancedDashboardRoutes from './enhancedDashboardRoutes';
import notificationRoutes from './notificationRoutes';
import parentRoutes from './parentRoutes';
import auditTrailRoutes from './auditTrailRoutes';
import teacherAttendanceAnalyticsRoutes from './teacherAttendanceAnalyticsRoutes';
import classProfileAnalyticsRoutes from './classProfileAnalyticsRoutes';
import quizRoutes from './quizRoutes';
import bursarRoutes from './bursarRoutes';
import hodRoutes from './hodRoutes';
import systemRoutes from './systemRoutes';
import principalRoutes from './principalRoutes';
import vicePrincipalRoutes from './vicePrincipalRoutes';
import disciplineMasterRoutes from './disciplineMasterRoutes';
import disciplinaryActionRoutes from './disciplinaryActionRoutes';
import reportRequestRoutes from './reportRequestRoutes';
import messagingRoutes from './messagingRoutes';
import chatRoutes from './chatRoutes';
import inventoryRoutes from './inventoryRoutes';
import rollCallRoutes from './rollCallRoutes';
import seizedItemRoutes from './seizedItemRoutes';
import managerRoutes from './managerRoutes';
import subjectSchemeRoutes from './subjectSchemeRoutes';
import logbookRoutes from './logbookRoutes';
import nurseRoutes from './nurseRoutes';
import salaryRoutes from './salaryRoutes';
import reamStockRoutes from './reamStockRoutes';
import taskRoutes from './taskRoutes';
import superManagerOverviewRoutes from './superManagerOverviewRoutes';
import aiRoutes from './aiRoutes';
import staffLoanRoutes from './staffLoanRoutes';
import leaveRequestRoutes from './leaveRequestRoutes';
import express from 'express';
import path from 'path';
import * as disciplineController from '../controllers/disciplineController';
import { authenticate, authorize } from '../middleware/auth.middleware';
import studentAverageRoutes from './studentAverageRoutes';

const router = Router();

// Import attendance routes
import attendanceRoutes from './attendanceRoutes';

// Mount routes with the appropriate base paths
router.use('/ai', aiRoutes);
router.use('/auth', authRoutes);
router.use('/academic-years', academicYearRoutes);
router.use('/users', userRoutes);
router.use('/classes', classRoutes);
router.use('/students', studentRoutes);
router.use('/fees', feeRoutes);
router.use('/fee-items', feeItemRoutes);
router.use('/finance-requests', financeRequestRoutes);
router.use('/expenditures', expenditureRoutes);
router.use('/control-fees', controlFeeRoutes);
router.use('/fee-comparison', feeComparisonRoutes);
router.use('/payments', unifiedPaymentRoutes);
router.use('/subjects', subjectRoutes);
router.use('/periods', periodRoutes);
router.use('/timetables', timetableRoutes);

// Mount teacher routes at /teachers
router.use('/teachers', teacherRoutes);

// Mount discipline routes at /discipline
router.use('/discipline', disciplineRoutes);

// Mount attendance routes at /attendance
router.use('/attendance', attendanceRoutes);

// Mount enrollment workflow routes at /enrollment
router.use('/enrollment', enrollmentRoutes);

// Mount bursar routes at /bursar
router.use('/bursar', bursarRoutes);

// Mount HOD routes at /hod
router.use('/hod', hodRoutes);

// Mount system administration routes at /system
router.use('/system', systemRoutes);

// Mount principal routes at /principal
router.use('/principal', principalRoutes);

// Mount vice principal routes at /vice-principal
router.use('/vice-principal', vicePrincipalRoutes);

// Mount discipline master routes at /discipline-master
router.use('/discipline-master', disciplineMasterRoutes);

// Structured disciplinary actions (Dean of Discipline)
router.use('/disciplinary-actions', disciplinaryActionRoutes);

// Report requests (Dean of Discipline → SDM/DM)
router.use('/report-requests', reportRequestRoutes);

// Mount messaging routes at /messaging
router.use('/messaging', messagingRoutes);

// Mount Slack-style chat (channels + DMs + threads + WebSockets) at /chat
router.use('/chat', chatRoutes);

// Personnel inventory (manager grants stock; peer-to-peer transfers with accept flow)
router.use('/inventory', inventoryRoutes);

// Teacher per-period roll call oversight (SDM / Dean of Discipline / VP / Principal / Manager)
router.use('/roll-calls', rollCallRoutes);

// Items seized from students by the discipline chain (with transfer-accept flow)
router.use('/seized-items', seizedItemRoutes);

// Mount manager routes at /manager
router.use('/manager', managerRoutes);

// Enhanced dashboard routes at /dashboard
router.use('/dashboard', enhancedDashboardRoutes);

// Exams endpoints are mounted at /exams
router.use('/exams', examRoutes);

// Marks endpoints are mounted at /marks
router.use('/marks', marksRouter);

// Report cards endpoints are mounted at /report-cards
router.use('/report-cards', reportCardsRouter);

// Quiz endpoints are mounted at /quiz
router.use('/quiz', quizRoutes);

// Communication endpoints (announcements & notifications)
router.use('/communications', communicationRoutes);

// Notification endpoints
router.use('/notifications', notificationRoutes);

// Parent portal endpoints
router.use('/parents', parentRoutes);

// Audit trail endpoints
router.use('/audit', auditTrailRoutes);

// Teacher attendance analytics endpoints
router.use('/teacher-attendance', teacherAttendanceAnalyticsRoutes);

// Class profile analytics endpoints
router.use('/class-analytics', classProfileAnalyticsRoutes);

// Mobile endpoints (prefixed with /mobile)
router.use('/mobile', mobileRoutes);

// File upload endpoints
router.use('/uploads', fileRoutes);

// Serve uploaded files statically
router.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Register routes
router.use('/student-averages', studentAverageRoutes);

// Subject scheme of work (Module → Chapter → Lesson) — owned by VP / Dean of Studies
router.use('/subject-schemes', subjectSchemeRoutes);

// Teacher logbook (records of lessons taught against the scheme)
router.use('/logbook', logbookRoutes);

// Nurse: student health profiles + infirmary visit logs
router.use('/nurse', nurseRoutes);

// Salary management: profiles, allowances, pay periods, withholdings, bursar cash summary
router.use('/salary', salaryRoutes);

// Ream (paper) stock ledger: receipts + issuances with reason
router.use('/reams', reamStockRoutes);

// Tasks (assign + track): senior delegates, assignee updates progress
router.use('/tasks', taskRoutes);

// Staff loans + leave — single-step super-manager approval
router.use('/loans', staffLoanRoutes);
router.use('/leave', leaveRequestRoutes);

// Super Manager read-only overview / metrics endpoints for dashboards & charts
router.use('/super-manager/overview', superManagerOverviewRoutes);

export default router;
