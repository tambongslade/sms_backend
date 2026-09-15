// Swagger documentation can be found in src/config/swagger/docs/disciplineDocs.ts
import { Router } from 'express';
import * as disciplineController from '../controllers/disciplineController';
import * as brokenPropertyController from '../controllers/brokenPropertyController';
import * as saturdayPunishmentController from '../controllers/saturdayPunishmentController';
import * as dmRollCallController from '../controllers/dmRollCallController';
import { authenticate, authorize } from '../middleware/auth.middleware';
import {
    validateDMSubClassAccess,
    validateDMAccessForEnrollment,
    resolveEnrollmentIdFromAbsenceParam,
} from '../middleware/disciplineAuth.middleware';

const router = Router();

const DM_AND_ADMIN = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR', 'DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER'];
const DM_VIEW_ROLES = [...DM_AND_ADMIN, 'TEACHER'];
const ADMIN_DELETE = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL'];
const EXCUSE_ROLES = [...DM_AND_ADMIN, 'PARENT'];

// === DISCIPLINE ISSUES (general) ===

router.get('/', authenticate, disciplineController.getAllDisciplineIssues);
router.post('/', authenticate, authorize(DM_VIEW_ROLES), disciplineController.recordDisciplineIssue);

// === SDM LATENESS TRACKING ===

router.post('/lateness', authenticate, authorize(DM_AND_ADMIN), disciplineController.recordMorningLateness);
router.post('/lateness/bulk', authenticate, authorize(DM_AND_ADMIN), disciplineController.recordBulkMorningLateness);
router.get('/lateness/statistics', authenticate, authorize(DM_AND_ADMIN), disciplineController.getLatenessStatistics);
router.get('/lateness/daily-report', authenticate, authorize(DM_AND_ADMIN), disciplineController.getDailyLatenessReport);
router.get('/lateness/alerts', authenticate, authorize(DM_AND_ADMIN), disciplineController.getLatenessAlerts);

// === BULK ABSENCES (DM daily roll call) ===

router.get('/absences/form-data', authenticate, authorize(DM_AND_ADMIN), disciplineController.getAbsenceFormData);
router.post('/absences/bulk', authenticate, authorize(DM_AND_ADMIN), validateDMSubClassAccess, disciplineController.bulkRecordAbsences);
router.put('/absences/:id', authenticate, authorize(DM_AND_ADMIN), disciplineController.updateStudentAbsence);
router.delete('/absences/:id', authenticate, authorize(DM_AND_ADMIN), disciplineController.deleteStudentAbsence);

// Excuse / makeup
router.post('/absences/:id/excuse', authenticate, authorize(EXCUSE_ROLES), disciplineController.excuseAbsence);
router.post('/absences/:id/makeup',
    authenticate,
    authorize([...DM_AND_ADMIN, 'TEACHER']),
    disciplineController.markAbsenceMakeup
);

// === STUDENT WARNINGS ===

router.get('/warnings', authenticate, authorize(DM_AND_ADMIN), disciplineController.listWarnings);
router.post('/warnings', authenticate, authorize(DM_AND_ADMIN), disciplineController.createWarning);
router.patch('/warnings/:id/resolve', authenticate, authorize(DM_AND_ADMIN), disciplineController.resolveWarning);

// === PARENT SUMMONS ===

router.get('/summons', authenticate, authorize(DM_AND_ADMIN), disciplineController.listSummons);
router.post('/summons', authenticate, authorize(DM_AND_ADMIN), disciplineController.createSummons);
router.put('/summons/:id', authenticate, authorize(DM_AND_ADMIN), disciplineController.updateSummons);

// === DM ROLL CALL (3 fixed daily slots) ===

// List sub-classes the caller may record roll calls for. DMs get their
// assigned ones, admins get all. No validateDMSubClassAccess — this endpoint
// IS how the caller learns which sub-classes are accessible.
router.get('/dm-roll-call/my-subclasses',
    authenticate,
    authorize(DM_AND_ADMIN),
    dmRollCallController.listMySubClasses
);

router.get('/dm-roll-call/status',
    authenticate,
    authorize(DM_AND_ADMIN),
    validateDMSubClassAccess,
    dmRollCallController.getStatus
);
router.get('/dm-roll-call',
    authenticate,
    authorize(DM_AND_ADMIN),
    validateDMSubClassAccess,
    dmRollCallController.getRollCall
);
router.post('/dm-roll-call',
    authenticate,
    authorize(DM_AND_ADMIN),
    validateDMSubClassAccess,
    dmRollCallController.recordRollCall
);

// === UNIFIED ROLL CALL (PRESENT / LATE / ABSENT) ===

router.get('/roll-call', authenticate, authorize(DM_AND_ADMIN), disciplineController.getRollCall);
router.post('/roll-call', authenticate, authorize(DM_AND_ADMIN), disciplineController.recordRollCall);

// === IN-CLASS PERIOD ROLL CALL (teacher) ===

const PERIOD_ROLL_CALL_ROLES = [...DM_AND_ADMIN, 'TEACHER'];
router.get('/teacher-periods/:id/roll-call', authenticate, authorize(PERIOD_ROLL_CALL_ROLES), disciplineController.getPeriodRollCall);
router.post('/teacher-periods/:id/roll-call', authenticate, authorize(PERIOD_ROLL_CALL_ROLES), disciplineController.recordPeriodRollCall);

// === BROKEN PROPERTY ===

router.post('/broken-property', authenticate, authorize(DM_AND_ADMIN), brokenPropertyController.createBrokenProperty);
router.get('/broken-property', authenticate, authorize([...DM_AND_ADMIN, 'BURSAR', 'FEE_AUDITOR']), brokenPropertyController.listBrokenProperty);
router.get('/broken-property/:id', authenticate, authorize([...DM_AND_ADMIN, 'BURSAR', 'FEE_AUDITOR']), brokenPropertyController.getBrokenPropertyById);
router.put('/broken-property/:id', authenticate, authorize(DM_AND_ADMIN), brokenPropertyController.updateBrokenProperty);
router.delete('/broken-property/:id', authenticate, authorize(ADMIN_DELETE), brokenPropertyController.deleteBrokenProperty);

// === SATURDAY PUNISHMENTS ===

router.post('/saturday-punishments', authenticate, authorize(DM_AND_ADMIN), saturdayPunishmentController.createSaturdayPunishment);
router.get('/saturday-punishments', authenticate, authorize(DM_AND_ADMIN), saturdayPunishmentController.listSaturdayPunishments);
router.get('/saturday-punishments/:id', authenticate, authorize(DM_AND_ADMIN), saturdayPunishmentController.getSaturdayPunishmentById);
router.put('/saturday-punishments/:id', authenticate, authorize(DM_AND_ADMIN), saturdayPunishmentController.updateSaturdayPunishment);
router.delete('/saturday-punishments/:id', authenticate, authorize(ADMIN_DELETE), saturdayPunishmentController.deleteSaturdayPunishment);

// === DAILY OVERVIEW (Dean of Discipline dashboard) ===
// Static path — must be before /:studentId catch-all.
router.get('/daily-overview', authenticate, authorize(DM_AND_ADMIN), disciplineController.getDailyOverview);

// === DISCIPLINE ISSUES (per student / by id) ===
// IMPORTANT: keep these LAST so static paths above don't get captured by /:studentId
router.put('/:id', authenticate, authorize(DM_AND_ADMIN), disciplineController.updateDisciplineIssue);
router.get('/:studentId', authenticate, authorize(DM_VIEW_ROLES), disciplineController.getDisciplineHistory);

export default router;
