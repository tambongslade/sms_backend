// Swagger documentation can be found in src/config/swagger/docs/subjectDocs.ts
import { Router } from 'express';
import * as subjectController from '../controllers/subjectController';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// GET /subjects - List all subjects
// All authenticated users can view subjects
router.get('/', authenticate, subjectController.getAllSubjects);

// POST /subjects - Create a new subject
// Only SUPER_MANAGER, PRINCIPAL can create subjects
router.post('/', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL']), subjectController.createSubject);

// GET /subjects/:id - Get subject details
// All authenticated users can view subject details
router.get('/:id', authenticate, subjectController.getSubjectById);

// PUT /subjects/:id - Update subject details
// Only SUPER_MANAGER, PRINCIPAL can update subjects
router.put('/:id', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL']), subjectController.updateSubject);

// DELETE /subjects/:id - Delete a subject
// Only SUPER_MANAGER, PRINCIPAL can delete subjects
router.delete('/:id', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL']), subjectController.deleteSubject);

// POST /subjects/:id/teachers - Assign a teacher to a subject
// Only SUPER_MANAGER, MANAGER, PRINCIPAL, VICE_PRINCIPAL, DEAN_OF_STUDIES can assign teachers
router.post('/:id/teachers', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_STUDIES']), subjectController.assignTeacher);

// POST /subjects/:id/sub-classes - Link subject to a sub-class (with coefficient)
// Only SUPER_MANAGER, PRINCIPAL can link subjects to sub-classes
router.post('/:id/sub-classes', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL']), subjectController.linkSubjectToSubClass);

// DELETE /subjects/:subjectId/sub-classes/:subClassId - Unlink subject from a sub-class
// Only SUPER_MANAGER, PRINCIPAL can unlink subjects
router.delete('/:subjectId/sub-classes/:subClassId', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL']), subjectController.unlinkSubjectFromSubClass);

// POST /subjects/:subjectId/classes/:classId - Assign a subject to all sub_classes of a class
// Only SUPER_MANAGER, PRINCIPAL can assign subjects to classes
router.post('/:subjectId/classes/:classId', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL']), subjectController.assignSubjectToClass);

export default router;
