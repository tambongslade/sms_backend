import { Router } from 'express';
import * as examController from '../controllers/examController';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { validateTeacherMarksAccess, validateTeacherSubjectAccess } from '../middleware/teacherAuth.middleware';
import { Role } from '@prisma/client';
import * as resultsController from '../controllers/resultsController';

// Swagger documentation can be found in src/config/swagger/docs/examDocs.ts

// Main exams router
const router = Router();

// GET /exams - List all exams
// All authenticated users can view exams list
router.get('/', authenticate, examController.getAllExams);

// GET /exams/papers - List all exam papers
// All authenticated users can view exam papers
router.get('/papers', authenticate, examController.getAllExamPapers);

// POST /exams - Create a new exam sequence
// Only SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL can create exam sequences
router.post('/', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL']), examController.createExam);

// POST /exams/papers - Create a new exam paper
// Only SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL can create exam papers
// TEACHER may create papers only for subjects they teach (checked in the controller)
router.post('/papers', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER']), examController.createExamPaper);

// DELETE /exams/papers/:id - Delete an exam paper
// Only SUPER_MANAGER, PRINCIPAL can delete exam papers
// VICE_PRINCIPAL and TEACHER may delete papers too; TEACHER only for subjects they teach (checked in the controller)
router.delete('/papers/:id', authenticate, authorize([Role.SUPER_MANAGER, Role.PRINCIPAL, Role.VICE_PRINCIPAL, Role.TEACHER]), examController.deleteExamPaper);

// GET /exams/marksheet/pdf - Mark sheet for one subject in one subclass (sequences 1–6)
// Teachers are limited to subjects they teach in that subclass (checked in the controller)
router.get(
    '/marksheet/pdf',
    authenticate,
    authorize([
        'SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL',
        'DEAN_OF_STUDIES', 'HOD', 'SECRETARY', 'BURSAR', 'TEACHER',
    ]),
    examController.exportMarksheetPdf
);

// GET /exams/:id - Get exam details
// All authenticated users can view exam details
router.get('/:id', authenticate, examController.getExamById);

// PATCH /exams/:id/status - Update exam sequence status (New Route)
// Only SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL can finalize
router.patch(
    '/:id/status',
    authenticate,
    authorize([Role.SUPER_MANAGER, Role.MANAGER, Role.PRINCIPAL, Role.VICE_PRINCIPAL]),
    examController.updateExamSequenceStatusController
);

// PATCH /exams/:id/deadline - Set or clear submission deadline
router.patch(
    '/:id/deadline',
    authenticate,
    authorize([Role.SUPER_MANAGER, Role.MANAGER, Role.PRINCIPAL, Role.VICE_PRINCIPAL]),
    examController.setSubmissionDeadline
);

// GET /exams/:id/submission-tracking - Mark submission progress per class/subject
router.get(
    '/:id/submission-tracking',
    authenticate,
    authorize([Role.SUPER_MANAGER, Role.MANAGER, Role.PRINCIPAL, Role.VICE_PRINCIPAL, Role.DEAN_OF_STUDIES]),
    examController.getMarkSubmissionTracking
);

// GET /exams/:id/missing-marks - Students with no mark in some subject, and which subjects
router.get(
    '/:id/missing-marks',
    authenticate,
    authorize([Role.SUPER_MANAGER, Role.MANAGER, Role.PRINCIPAL, Role.VICE_PRINCIPAL, Role.DEAN_OF_STUDIES]),
    examController.getStudentsMissingMarks
);

// GET /exams/:id/pending-teachers - Teachers who haven't completed mark submission
router.get(
    '/:id/pending-teachers',
    authenticate,
    authorize([Role.SUPER_MANAGER, Role.MANAGER, Role.PRINCIPAL, Role.VICE_PRINCIPAL]),
    examController.getPendingTeachers
);

// PUT /exams/:id - Update an exam sequence
// Only SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL can update exam sequences
router.put('/:id', authenticate, authorize([Role.SUPER_MANAGER, Role.MANAGER, Role.PRINCIPAL, Role.VICE_PRINCIPAL]), examController.updateExam);

// DELETE /exams/:id - Delete an exam
// Only SUPER_MANAGER, PRINCIPAL can delete exams
router.delete('/:id', authenticate, authorize([Role.SUPER_MANAGER, Role.MANAGER, Role.PRINCIPAL]), examController.deleteExam);

// GET /exams/papers/:examId/with-questions - Get a specific exam paper with its questions
router.get('/papers/:examId/with-questions', authenticate, examController.getExamPaperWithQuestions);

// POST /exams/papers/:id/questions - Add questions to an exam paper
router.post('/papers/:id/questions', authenticate, examController.addQuestionsToExam);

// POST /exams/papers/:id/generate - Generate exam paper (randomize/manual)
router.post('/papers/:id/generate', authenticate, examController.generateExam);

export const reportCardsRouter = Router();

// Term and annual report cards (generated on demand from resultsService)
const REPORT_CARD_STAFF = ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_STUDIES'];
reportCardsRouter.get('/term/subclass/:subClassId', authenticate, authorize(REPORT_CARD_STAFF), resultsController.termSubclassCards);
reportCardsRouter.get('/term/student/:studentId', authenticate, authorize(REPORT_CARD_STAFF), resultsController.termStudentCard);
reportCardsRouter.get('/annual/subclass/:subClassId', authenticate, authorize(REPORT_CARD_STAFF), resultsController.annualSubclassCards);
reportCardsRouter.get('/annual/student/:studentId', authenticate, authorize(REPORT_CARD_STAFF), resultsController.annualStudentCard);

// GET /report-cards/student/:studentId - Downloads a generated report card for a student
reportCardsRouter.get('/student/:studentId', authenticate, examController.generateStudentReportCard);

// GET /report-cards/student/:studentId/availability - Check if a student's report card is available
reportCardsRouter.get('/student/:studentId/availability', authenticate, examController.checkStudentReportCardAvailability);

// POST /report-cards/student/:studentId/generate - Triggers the regeneration of a student's report card
reportCardsRouter.post(
    '/student/:studentId/generate',
    authenticate,
    authorize([Role.SUPER_MANAGER, Role.PRINCIPAL, Role.VICE_PRINCIPAL]),
    examController.regenerateStudentReportCard
);

// GET /report-cards/subclass/:subClassId - Downloads a generated combined report for a sub_class
reportCardsRouter.get('/subclass/:subClassId', authenticate, examController.generateSubclassReportCards);

// GET /report-cards/subclass/:subClassId/availability - Check if a subclass's report cards are available
reportCardsRouter.get('/subclass/:subClassId/availability', authenticate, examController.checkSubclassReportCardAvailability);

// POST /report-cards/subclass/:subClassId/generate - Triggers the regeneration of a subclass's combined report
reportCardsRouter.post(
    '/subclass/:subClassId/generate',
    authenticate,
    authorize([Role.SUPER_MANAGER, Role.PRINCIPAL, Role.VICE_PRINCIPAL]),
    examController.regenerateSubclassReportCards
);

// Marks router (will be mounted at /marks)
export const marksRouter = Router();

// GET /marks - List all marks (with filters)
// SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL can view all marks
// TEACHER can only view marks for their assigned subjects/subclasses
marksRouter.get('/',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_STUDIES', 'TEACHER']),
    // Add teacher access validation for TEACHER role only
    (req: any, res: any, next: any) => {
        // Check if user has TEACHER role
        const userRoles: string[] = req.user?.role || req.user?.roles || [];
        const isTeacher = userRoles.includes('TEACHER');
        const hasHigherRole = userRoles.some((role: string) =>
            ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL'].includes(role)
        );

        // If user is TEACHER only (no higher roles), apply subject access validation
        if (isTeacher && !hasHigherRole) {
            return validateTeacherSubjectAccess(req, res, next);
        }

        next();
    },
    examController.getAllMarks
);

// GET /marks/entry-sheet - Whole-class roster with saved marks for one sequence/subclass/subject
// TEACHER limited to subjects they teach in that subclass (checked in the controller)
marksRouter.get('/entry-sheet',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER']),
    examController.getMarkEntrySheet
);

// POST /marks/bulk - Save many marks for one sequence/subclass/subject in one transaction
marksRouter.post('/bulk',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER']),
    examController.saveMarkEntrySheet
);

// POST /marks - Create a new mark
// Only SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL, TEACHER can create marks
// TEACHER can only create marks for their assigned subjects/subclasses
marksRouter.post('/',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER']),
    // Add teacher marks access validation for TEACHER role
    (req: any, res: any, next: any) => {
        const userRoles: string[] = req.user?.role || req.user?.roles || [];
        const isTeacher = userRoles.includes('TEACHER');
        const hasHigherRole = userRoles.some((role: string) =>
            ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL'].includes(role)
        );

        if (isTeacher && !hasHigherRole) {
            return validateTeacherMarksAccess(req, res, next);
        }

        next();
    },
    examController.createMark
);

// PUT /marks/:id - Update a mark
// Only SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL, TEACHER can update marks
// TEACHER can only update marks for their assigned subjects/subclasses
marksRouter.put('/:id',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER']),
    // Add teacher marks access validation for TEACHER role
    (req: any, res: any, next: any) => {
        const userRoles: string[] = req.user?.role || req.user?.roles || [];
        const isTeacher = userRoles.includes('TEACHER');
        const hasHigherRole = userRoles.some((role: string) =>
            ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL'].includes(role)
        );

        if (isTeacher && !hasHigherRole) {
            return validateTeacherMarksAccess(req, res, next);
        }

        next();
    },
    examController.updateMark
);

// DELETE /marks/:id - Delete a mark
// Only SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL, TEACHER can delete marks
// TEACHER can only delete marks for their assigned subjects/subclasses
marksRouter.delete('/:id',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER']),
    // Add teacher marks access validation for TEACHER role
    (req: any, res: any, next: any) => {
        const userRoles: string[] = req.user?.role || req.user?.roles || [];
        const isTeacher = userRoles.includes('TEACHER');
        const hasHigherRole = userRoles.some((role: string) =>
            ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL'].includes(role)
        );

        if (isTeacher && !hasHigherRole) {
            return validateTeacherMarksAccess(req, res, next);
        }

        next();
    },
    examController.deleteMark
);

export default router;
