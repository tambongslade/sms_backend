import express from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/auth.middleware';
import * as disciplineMasterController from '../controllers/disciplineMasterController';
import * as teacherPeriodAttendanceController from '../controllers/teacherPeriodAttendanceController';

const router = express.Router();

const DM_AND_SENIORS = ['DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR', 'PRINCIPAL', 'VICE_PRINCIPAL'];
const DM_DASHBOARD_ROLES = ['DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR'];
const STUDENT_PROFILE_ROLES = [...DM_AND_SENIORS, 'TEACHER'];
const REPORTS_ROLES = ['DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR', 'PRINCIPAL'];
const TEACHER_ATTENDANCE_ROLES = [
    'DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR',
    'PRINCIPAL', 'VICE_PRINCIPAL', 'MANAGER',
];

// Apply authentication to all routes
router.use(authenticate);

/**
 * @route GET /api/v1/discipline-master/dashboard
 * @desc Get enhanced Discipline Master / SDM / Dean dashboard with behavioral analytics
 * @access Private (DISCIPLINE_MASTER, SENIOR_DISCIPLINE_MASTER, DEAN_OF_DISCIPLINE)
 */
router.get('/dashboard',
    authorize(DM_DASHBOARD_ROLES),
    disciplineMasterController.getDMDashboard
);

/**
 * @route GET /api/v1/discipline-master/behavioral-analytics
 * @desc Get comprehensive behavioral analytics and trends
 * @access Private (DM, SDM, Dean, Principal, VP)
 */
router.get('/behavioral-analytics',
    authorize(DM_AND_SENIORS),
    disciplineMasterController.getBehavioralAnalyticsData
);

/**
 * @route GET /api/v1/discipline-master/student-profile/:studentId
 * @desc Get detailed student behavior profile and intervention history
 * @access Private (DM, SDM, Dean, Principal, VP, Teacher)
 */
router.get('/student-profile/:studentId',
    authorize(STUDENT_PROFILE_ROLES),
    disciplineMasterController.getStudentBehaviorProfileData
);

/**
 * @route GET /api/v1/discipline-master/early-warning
 * @desc Get early warning system data for at-risk students
 * @access Private (DM, SDM, Dean, Principal, VP)
 */
router.get('/early-warning',
    authorize(DM_AND_SENIORS),
    disciplineMasterController.getEarlyWarningSystemData
);

/**
 * @route GET /api/v1/discipline-master/statistics
 * @desc Get discipline statistics and trends with filtering options
 * @access Private (DM, SDM, Dean, Principal, VP)
 */
router.get('/statistics',
    authorize(DM_AND_SENIORS),
    disciplineMasterController.getDisciplineStatistics
);

/**
 * @route GET /api/v1/discipline-master/interventions
 * @desc Get intervention tracking data
 * @access Private (DM, SDM, Dean, Principal, VP)
 */
router.get('/interventions',
    authorize(DM_AND_SENIORS),
    disciplineMasterController.getInterventionTracking
);

/**
 * @route POST /api/v1/discipline-master/interventions
 * @desc Create new intervention plan for a student
 * @access Private (DM, SDM, Dean, Principal, VP)
 */
router.post('/interventions',
    authorize(DM_AND_SENIORS),
    disciplineMasterController.createIntervention
);

/**
 * @route PUT /api/v1/discipline-master/interventions/:interventionId
 * @desc Update intervention status and add notes
 * @access Private (DM, SDM, Dean, Principal, VP)
 */
router.put('/interventions/:interventionId',
    authorize(DM_AND_SENIORS),
    disciplineMasterController.updateInterventionStatus
);

/**
 * @route GET /api/v1/discipline-master/risk-assessment
 * @desc Get comprehensive risk assessment for all students
 * @access Private (DM, SDM, Dean, Principal, VP)
 */
router.get('/risk-assessment',
    authorize(DM_AND_SENIORS),
    disciplineMasterController.getRiskAssessment
);

/**
 * @route GET /api/v1/discipline-master/reports
 * @desc Generate comprehensive discipline reports
 * @access Private (DM, SDM, Dean, Principal)
 */
router.get('/reports',
    authorize(REPORTS_ROLES),
    disciplineMasterController.generateDisciplineReport
);

/**
 * Teacher-period attendance (DM marks teacher presence + evaluation checkboxes
 * — well_dressed, class_management, punctuality, assiduity — for each timetable
 * period). DMs are further gated inside the controller to their assigned
 * sub-classes via RoleAssignment; SDM / Dean / VP / Principal / Manager bypass.
 */
router.get('/teacher-attendance',
    authorize(TEACHER_ATTENDANCE_ROLES),
    teacherPeriodAttendanceController.listDay
);
router.post('/teacher-attendance',
    authorize(TEACHER_ATTENDANCE_ROLES),
    teacherPeriodAttendanceController.upsert
);
router.get('/teacher-attendance/:id',
    authorize(TEACHER_ATTENDANCE_ROLES),
    teacherPeriodAttendanceController.getById
);
router.put('/teacher-attendance/:id',
    authorize(TEACHER_ATTENDANCE_ROLES),
    teacherPeriodAttendanceController.update
);
router.delete('/teacher-attendance/:id',
    authorize(TEACHER_ATTENDANCE_ROLES),
    teacherPeriodAttendanceController.remove
);

export default router;
