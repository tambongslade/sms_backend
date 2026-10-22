import { Router } from 'express';
import * as hodController from '../controllers/hodController';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// GET /hod/dashboard - Get HOD dashboard overview
// HOD can view their department dashboard with key metrics
router.get('/dashboard',
    authenticate,
    authorize(['HOD', 'SUPER_MANAGER']),
    hodController.getHODDashboard
);

// GET /hod/department-overview - Get comprehensive department overview
// HOD can view detailed overview of their department including all teachers and performance
router.get('/department-overview',
    authenticate,
    authorize(['HOD', 'SUPER_MANAGER']),
    hodController.getDepartmentOverview
);

// GET /hod/teachers-in-department - Get teachers in HOD's department
// HOD can browse/search teachers assigned to their subject department
// Supports pagination and search functionality
router.get('/teachers-in-department',
    authenticate,
    authorize(['HOD', 'SUPER_MANAGER']),
    hodController.getTeachersInDepartment
);

// GET /hod/subject-performance - Get subject performance analytics
// HOD can view performance analytics for their subjects across all classes
// Optional query parameter: subjectId to filter specific subject
router.get('/subject-performance',
    authenticate,
    authorize(['HOD', 'SUPER_MANAGER']),
    hodController.getSubjectPerformance
);

// POST /hod/assign-teacher-subject - Assign teacher to HOD's subject
// HOD can assign teachers to subjects they manage
// Body: { subjectId: number, teacherId: number }
router.post('/assign-teacher-subject',
    authenticate,
    authorize(['HOD', 'SUPER_MANAGER']),
    hodController.assignTeacherToSubject
);

// GET /hod/department-analytics - Get department analytics
// HOD can view comprehensive analytics for their department
// Includes performance trends, top/bottom performers, etc.
router.get('/department-analytics',
    authenticate,
    authorize(['HOD', 'SUPER_MANAGER']),
    hodController.getDepartmentAnalytics
);

// GET /hod/teacher-performance/:teacherId - Get specific teacher performance
// HOD can view detailed performance metrics for a specific teacher in their department
router.get('/teacher-performance/:teacherId',
    authenticate,
    authorize(['HOD', 'SUPER_MANAGER']),
    hodController.getTeacherPerformance
);

// GET /hod/department-status - Teacher load, scheme coverage and marks-entry
// status for the HOD's department (Period Tracking / Curriculum / Performance pages)
router.get('/department-status',
    authenticate,
    authorize(['HOD', 'SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_STUDIES']),
    hodController.getDepartmentStatus
);

// GET /hod/my-subjects - Get subjects managed by HOD
// HOD can view list of subjects they are head of
router.get('/my-subjects',
    authenticate,
    authorize(['HOD', 'SUPER_MANAGER']),
    hodController.getMySubjects
);

export default router; 