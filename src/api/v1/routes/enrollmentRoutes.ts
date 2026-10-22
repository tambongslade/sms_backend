import { Router } from 'express';
import * as enrollmentController from '../controllers/enrollmentController';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// STEP 1: Bursar registers student into class
// POST /enrollment/register - Register a new student into a class (no subclass yet)
// Only BURSAR and SUPER_MANAGER can register students
router.post('/register',
    authenticate,
    authorize(['BURSAR', 'SUPER_MANAGER']),
    enrollmentController.registerStudentToClass
);

// STEP 2: VP records interview marks
// POST /enrollment/interview - Record interview marks for a student
// Only VICE_PRINCIPAL and SUPER_MANAGER can record interviews
router.post('/interview',
    authenticate,
    authorize(['VICE_PRINCIPAL', 'SUPER_MANAGER']),
    enrollmentController.recordInterviewMark
);

// STEP 3: VP assigns student to subclass
// POST /enrollment/assign-subclass - Assign student to specific subclass after interview
// Only VICE_PRINCIPAL and SUPER_MANAGER can assign subclasses
router.post('/assign-subclass',
    authenticate,
    authorize(['VICE_PRINCIPAL', 'SUPER_MANAGER']),
    enrollmentController.assignStudentToSubclass
);

// VP Dashboard: View students awaiting assignment
// GET /enrollment/unassigned - Get all students awaiting subclass assignment
router.get('/unassigned',
    authenticate,
    authorize(['VICE_PRINCIPAL', 'PRINCIPAL', 'SUPER_MANAGER', 'BURSAR']),
    enrollmentController.getUnassignedStudents
);

// GET /enrollment/available-subclasses/:classId - Get available subclasses for a class
router.get('/available-subclasses/:classId',
    authenticate,
    authorize(['VICE_PRINCIPAL', 'PRINCIPAL', 'SUPER_MANAGER', 'BURSAR']),
    enrollmentController.getAvailableSubclasses
);

// GET /enrollment/stats - Get enrollment workflow statistics
router.get('/stats',
    authenticate,
    authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'MANAGER', 'BURSAR']),
    enrollmentController.getEnrollmentStats
);

// GET /enrollment/status/:studentId - Get enrollment workflow status for specific student
// Multiple roles can check student status
router.get('/status/:studentId',
    authenticate,
    authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'MANAGER', 'BURSAR']),
    enrollmentController.getStudentEnrollmentStatus
);

// GET /enrollment/student/:id/status - Alias for student enrollment status (for backward compatibility)
// Multiple roles can check student status
router.get('/student/:id/status',
    authenticate,
    authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'MANAGER', 'BURSAR']),
    enrollmentController.getStudentEnrollmentStatus
);

export default router; 