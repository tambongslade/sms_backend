// Swagger documentation can be found in src/config/swagger/docs/studentDocs.ts
import { Router } from 'express';
import * as studentController from '../controllers/studentController';
import { validateTeacherStudentAccess } from '../middleware/teacherAuth.middleware';
// Performance controller functions will be uncommented after implementation
// import {
//     getStudentPerformance,
//     getDetailedStudentPerformance,
//     getClassPerformanceComparison,
//     getPerformanceTrends,
//     getSubjectPerformanceAnalysis
// } from '../controllers/performanceController';
import { authenticate, authorize } from '../middleware/auth.middleware';
import upload, { PhotoType } from '../../../utils/fileUpload';

const router = Router();

// Performance Analytics (Commenting out until implementation complete)
// router.get('/performance', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER']), getStudentPerformance);

// Performance Comparison
// router.get('/performance/comparison', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER']), getClassPerformanceComparison);

// Performance Trends
// router.get('/performance/trends', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER']), getPerformanceTrends);

// Get student summary (for dashboard cards)
router.get('/summary',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'BURSAR', 'SECRETARY']),
    (req: any, res: any, next: any) => {
        const userRoles = req.user?.roles || [];
        const isTeacher = userRoles.includes('TEACHER');
        const hasHigherRole = userRoles.some((role: string) =>
            ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY'].includes(role)
        );

        if (isTeacher && !hasHigherRole) {
            return validateTeacherStudentAccess(req, res, next);
        }

        next();
    },
    studentController.getStudentsWithStatusInfo
);

// GET /students/search - Search students by name or matricule
router.get('/search',
    authenticate,
    studentController.searchStudents
);

// GET /students - List all students (with filters and optional enrollment info)
// SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL can view all students
// TEACHER can only view students from their assigned subclasses
router.get('/',
    authenticate,
    // Add teacher access validation for TEACHER role
    (req: any, res: any, next: any) => {
        const userRoles = req.user?.roles || [];
        const isTeacher = userRoles.includes('TEACHER');
        const hasHigherRole = userRoles.some((role: string) =>
            ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DISCIPLINE_MASTER', 'BURSAR', 'SECRETARY'].includes(role)
        );

        if (isTeacher && !hasHigherRole) {
            return validateTeacherStudentAccess(req, res, next);
        }

        next();
    },
    studentController.getAllStudents
);

// POST /students - Create a new student
router.post('/', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']), studentController.createStudent);

// GET /students/promotion-preview - End-of-year promotion preview with auto pass/fail decisions
router.get('/promotion-preview',
    authenticate,
    authorize(['SUPER_MANAGER', 'PRINCIPAL', 'SECRETARY']),
    studentController.getPromotionPreview
);

// POST /students/promote - Bulk-create enrollments for next academic year (class only, no subclass)
router.post('/promote',
    authenticate,
    authorize(['SUPER_MANAGER', 'PRINCIPAL', 'SECRETARY']),
    studentController.promoteStudents
);

// Performance Analytics (Commenting out until implementation complete)
// router.get('/:id/performance/detailed', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'PARENT', 'STUDENT']), getDetailedStudentPerformance);

// Subject Performance Analysis
// router.get('/:id/performance/subject-analysis', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'PARENT', 'STUDENT']), getSubjectPerformanceAnalysis);

// Discipline / student profile extensions
// GET /students/:id/siblings - Return other students who share a parent
router.get('/:id/siblings',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR', 'TEACHER', 'BURSAR', 'SECRETARY', 'PARENT']),
    studentController.getStudentSiblings
);

// GET /students/:id/previous-schools - Full history of prior schools
router.get('/:id/previous-schools',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR', 'BURSAR', 'SECRETARY']),
    studentController.listPreviousSchools
);

// POST /students/:id/previous-schools - Add a prior school entry
router.post('/:id/previous-schools',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']),
    studentController.addPreviousSchool
);

// PUT /students/:id/previous-schools/:psId - Update a prior school entry
router.put('/:id/previous-schools/:psId',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']),
    studentController.updatePreviousSchool
);

// DELETE /students/:id/previous-schools/:psId - Remove a prior school entry
router.delete('/:id/previous-schools/:psId',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']),
    studentController.deletePreviousSchool
);

// GET /students/:id/full-profile - Get comprehensive student profile with all related data
router.get('/:id/full-profile',
    authenticate,
    (req: any, res: any, next: any) => {
        const userRoles = req.user?.roles || [];
        const isTeacher = userRoles.includes('TEACHER');
        const hasHigherRole = userRoles.some((role: string) =>
            ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DISCIPLINE_MASTER', 'BURSAR', 'SECRETARY'].includes(role)
        );

        if (isTeacher && !hasHigherRole) {
            return validateTeacherStudentAccess(req, res, next);
        }

        next();
    },
    studentController.getStudentFullProfile
);

// GET /students/:id - Get student details (including parents, sub-classes)
// SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL can view any student
// TEACHER can only view students from their assigned subclasses
// PARENT can only view their linked students
// STUDENT can only view their own profile
router.get('/:id',
    authenticate,
    // Add teacher access validation for TEACHER role
    (req: any, res: any, next: any) => {
        const userRoles = req.user?.roles || [];
        const isTeacher = userRoles.includes('TEACHER');
        const hasHigherRole = userRoles.some((role: string) =>
            ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DISCIPLINE_MASTER', 'BURSAR', 'SECRETARY'].includes(role)
        );

        if (isTeacher && !hasHigherRole) {
            return validateTeacherStudentAccess(req, res, next);
        }

        next();
    },
    studentController.getStudentById
);

// PUT /students/:id - Update student information
router.put('/:id', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']), studentController.updateStudent);

// DELETE /students/:id - Permanently delete a student and all related data
router.delete('/:id', authenticate, authorize(['SUPER_MANAGER', 'BURSAR', 'SECRETARY']), studentController.deleteStudent);

// POST /students/:id/unenroll - Unenroll (dismiss) a student from an academic year
router.post('/:id/unenroll', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'SECRETARY']), studentController.unenrollStudent);

// POST /students/:id/parents - Link parent to student (alternative endpoint)
router.post('/:id/parents', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']), studentController.linkParent);

// POST /students/:id/link-parent - Link parent to student
router.post('/:id/link-parent', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']), studentController.linkParent);

// DELETE /students/:studentId/parents/:parentId - Remove parent-student relationship
router.delete('/:studentId/parents/:parentId', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']), studentController.unlinkParent);

// GET /students/:studentId/parents - Get all parents linked to a student
router.get('/:studentId/parents',
    authenticate,
    // authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'PARENT']),
    studentController.getParentsByStudentId
);

// POST /students/:id/assign-class - Assign student to a class (creates enrollment with class only)
router.post('/:id/assign-class', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']), studentController.assignStudentToClass);

// POST /students/:id/enroll - Enroll student into a subclass (final enrollment level)
router.post('/:id/enroll', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']), studentController.enrollStudent);

// POST /students/:id/assign-subclass - Assign student to a subclass (if enrolled in academic year but no subclass)
router.post('/:id/assign-subclass', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']), studentController.assignStudentToSubclass);

// GET /students/:id/status - Get student status information (new/old/repeater)
// SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL can view any student status
// TEACHER can only view status for students from their assigned subclasses
router.get('/:id/status',
    authenticate,
    // authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'BURSAR']),
    // Add teacher access validation for TEACHER role
    (req: any, res: any, next: any) => {
        const userRoles = req.user?.roles || [];
        const isTeacher = userRoles.includes('TEACHER');
        const hasHigherRole = userRoles.some((role: string) =>
            ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DISCIPLINE_MASTER', 'BURSAR', 'SECRETARY'].includes(role)
        );

        if (isTeacher && !hasHigherRole) {
            return validateTeacherStudentAccess(req, res, next);
        }

        next();
    },
    studentController.getStudentStatusInfo
);

// GET /students/subclass/:id - Get all students in a specific subclass
router.get('/subclass/:id',
    authenticate,
    // authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'BURSAR']),
    (req: any, res: any, next: any) => {
        const userRoles = req.user?.roles || [];
        const isTeacher = userRoles.includes('TEACHER');
        const hasHigherRole = userRoles.some((role: string) =>
            ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY'].includes(role)
        );

        if (isTeacher && !hasHigherRole) {
            return validateTeacherStudentAccess(req, res, next);
        }

        next();
    },
    studentController.getStudentsBySubclass
);

// GET /students/subclass/:id/export - Download class list (subclass) as Excel
router.get('/subclass/:id/export',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']),
    studentController.exportStudentsBySubclass
);

// GET /students/subclass/:id/export/pdf - Download class list (subclass) as PDF
router.get('/subclass/:id/export/pdf',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']),
    studentController.exportStudentsBySubclassPdf
);

// GET /students/class/:classId/export - Download class list (full class, multi-sheet by subclass) as Excel
router.get('/class/:classId/export',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']),
    studentController.exportStudentsByClass
);

// GET /students/class/:classId/export/pdf - Download class list (full class) as PDF (one section per subclass)
router.get('/class/:classId/export/pdf',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']),
    studentController.exportStudentsByClassPdf
);

// GET /students/class/:classId - Get all students in a class
router.get('/class/:classId',
    authenticate,
    // authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'BURSAR']),
    (req: any, res: any, next: any) => {
        const userRoles = req.user?.roles || [];
        const isTeacher = userRoles.includes('TEACHER');
        const hasHigherRole = userRoles.some((role: string) =>
            ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DISCIPLINE_MASTER', 'BURSAR', 'SECRETARY'].includes(role)
        );

        if (isTeacher && !hasHigherRole) {
            return validateTeacherStudentAccess(req, res, next);
        }

        next();
    },
    studentController.getStudentsBySubclass  // Using existing method for now
);

// GET /students/parent/:parentId - Get all students for a specific parent
// SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL can view any parent's students
// PARENT can only view their own students
router.get('/parent/:parentId',
    authenticate,
    // authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'PARENT', 'BURSAR']),
    studentController.getStudentsByParent
);

// GET /api/v1/students/enrollments/:enrollmentId - Get student by enrollment ID
router.get('/enrollments/:enrollmentId',
    authenticate,
    studentController.getStudentByEnrollmentId
);

// Photo management routes
// POST /students/:id/photo - Upload student photo (requires authentication)
router.post('/:id/photo',
    authenticate,
    authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'TEACHER', 'SECRETARY']),
    (req: any, res: any, next: any) => {
        // Set photo type for multer
        req.body.photoType = PhotoType.STUDENT;
        req.params.entityId = req.params.id;
        next();
    },
    upload.single('photo'),
    studentController.uploadStudentPhoto
);

// PUT /students/:id/enrollment-photo - Update student enrollment photo
router.put('/:id/enrollment-photo',
    authenticate,
    authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']),
    studentController.updateStudentEnrollmentPhoto
);

// GET /students/:id/enrollment-photo - Get student enrollment photo info
router.get('/:id/enrollment-photo',
    authenticate,
    authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'TEACHER', 'PARENT', 'SECRETARY']),
    studentController.getStudentEnrollmentPhoto
);


export default router;
