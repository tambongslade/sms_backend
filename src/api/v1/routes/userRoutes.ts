import { Router } from 'express';
import {
    getAllUsers,
    searchPersonnel,
    searchTeachers,
    createUser,
    getUserById,
    updateUser,
    updateCurrentUserProfile,
    getCurrentUserSettings,
    updateCurrentUserSettings,
    deleteUser,
    assignRole,
    removeRole,
    registerAndAssignRoles,
    createUserWithRole,
    setUserRolesForCurrentAcademicYear,
    assignVicePrincipal,
    removeVicePrincipal,
    assignDisciplineMaster,
    removeDisciplineMaster,
    assignDisciplineMasterToClass,
    removeDisciplineMasterFromClass,
    assignTeacherSubject,
    removeTeacherSubject,
    getAllTeachers,
    getCurrentUserProfile,
    getStudentsForParent,
    getDashboardForRole,
    resetPersonnelPassword,
} from '../controllers/userController';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { auditTrailMiddleware, roleChangeAuditMiddleware } from '../middleware/auditTrail.middleware';

const router = Router();

// Registration endpoint (public or specific roles)
router.post('/register-with-roles', registerAndAssignRoles);
router.post('/create-with-role', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY']), auditTrailMiddleware('User', 'CREATE_USER'), createUserWithRole);

// User CRUD operations (requires authentication, some require specific roles)
router.get('/', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DISCIPLINE_MASTER', 'BURSAR', 'SECRETARY']), getAllUsers);
router.post('/', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DISCIPLINE_MASTER', 'BURSAR', 'SECRETARY']), auditTrailMiddleware('User', 'CREATE_USER'), createUser);

// Get all teachers (optionally filtered by subject)
// Important: This route must be defined BEFORE the /:id route to avoid conflicts
router.get('/teachers', authenticate, getAllTeachers);

// Teacher management search with pagination + rich filters. Must be BEFORE /:id.
router.get('/teachers/search', authenticate, authorize([
    'SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL',
    'BURSAR', 'SECRETARY', 'DEAN_OF_STUDIES', 'HOD'
]), searchTeachers);

// Personnel search with pagination + filters. Must be BEFORE /:id.
// CONTROLLER is included but service enforces filter to DISCIPLINE_MASTER role only.
router.get('/personnel/search', authenticate, authorize([
    'SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL',
    'BURSAR', 'SECRETARY', 'DEAN_OF_STUDIES', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR', 'HOD', 'CONTROLLER'
]), searchPersonnel);

// Route for the current user's profile - MUST be before /:id
router.get('/me', authenticate, getCurrentUserProfile);
router.put('/me', authenticate, updateCurrentUserProfile); // Allow users to update their own profile

// Current user's app/notification preferences
router.get('/me/settings', authenticate, getCurrentUserSettings);
router.put('/me/settings', authenticate, updateCurrentUserSettings);

// Route for the current user's dashboard by role
router.get('/me/dashboard', authenticate, getDashboardForRole);

// GET /users/:parentId/students - Get all students linked to a specific parent user
// PRINCIPAL, SUPER_MANAGER can view. Parent can view their own.
router.get('/:parentId/students', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR']), getStudentsForParent);
// Note: Add logic in controller/service to ensure PARENT can only access their own students if parentId matches req.user.id

// DISCIPLINE_COORDINATOR is granted personnel management for its scope. The service layer
// enforces that when the actor's highest role is DISCIPLINE_COORDINATOR, the target user's
// roles must be strictly within { DISCIPLINE_MASTER, SENIOR_DISCIPLINE_MASTER, DEAN_OF_DISCIPLINE } —
// route-level authorize is not enough because the target's roles are only known at service time.
router.get('/:id', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY', 'DISCIPLINE_COORDINATOR']), getUserById);
router.put('/:id', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY', 'DISCIPLINE_COORDINATOR']), auditTrailMiddleware('User', 'UPDATE_USER'), updateUser);
router.delete('/:id', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR']), auditTrailMiddleware('User', 'DELETE_USER'), deleteUser); // Only SUPER_MANAGER can delete

// POST /users/:id/reset-password — admin reset of a personnel account's password.
// Body: { newPassword?: string }. Omit newPassword to reset to the default and force change on next sign-in.
// Parent accounts must go through POST /bursar/parents/:parentId/reset-password instead.
router.post('/:id/reset-password',
    authenticate,
    authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DISCIPLINE_COORDINATOR']),
    resetPersonnelPassword,
);

// Role management
router.post('/:id/roles', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'DISCIPLINE_COORDINATOR']), roleChangeAuditMiddleware, assignRole); // Single role assignment
router.delete('/:id/roles', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'DISCIPLINE_COORDINATOR']), roleChangeAuditMiddleware, removeRole); // Remove role (specify role in body)
router.put('/:id/roles/academic-year', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'DISCIPLINE_COORDINATOR']), roleChangeAuditMiddleware, setUserRolesForCurrentAcademicYear); // New route for setting roles
router.delete('/:id/roles/:roleId', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'DISCIPLINE_COORDINATOR']), roleChangeAuditMiddleware, removeRole); // RoleId here is the UserRole record ID

// Specific Assignments (Vice Principal, Discipline Master)
// Assign VP to Subclass (Defaults to current year if academicYearId is omitted in body)
router.post('/:userId/assignments/vice-principal', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR']), assignVicePrincipal);
// Remove VP from Subclass (Requires subClassId in path. Defaults to current year if academicYearId query param omitted)
router.delete('/:userId/assignments/vice-principal/:subClassId', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR']), removeVicePrincipal);

// Assign DM to Subclass (Defaults to current year if academicYearId is omitted in body)
// SDM and Dean of Discipline are included per the discipline reporting chain
// (DM → SDM → Dean of Discipline → VP/Principal).
// CONTROLLER (personnel oversight over DMs) may also assign.
router.post('/:userId/assignments/discipline-master', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR', 'SENIOR_DISCIPLINE_MASTER', 'CONTROLLER']), assignDisciplineMaster);
// Remove DM from Subclass (Requires subClassId in path. Defaults to current year if academicYearId query param omitted)
router.delete('/:userId/assignments/discipline-master/:subClassId', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR', 'SENIOR_DISCIPLINE_MASTER', 'CONTROLLER']), removeDisciplineMaster);

// Assign a DM to an entire CLASS (fans out to every sub-class of that class for the year)
// Body: { class_id: number, academic_year_id?: number }
router.post('/:userId/assignments/discipline-master/class', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR', 'SENIOR_DISCIPLINE_MASTER', 'CONTROLLER']), assignDisciplineMasterToClass);
// Remove DM from an entire class (removes every sub-class assignment for that class + year)
router.delete('/:userId/assignments/discipline-master/class/:classId', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR', 'SENIOR_DISCIPLINE_MASTER', 'CONTROLLER']), removeDisciplineMasterFromClass);

// Assign Teacher to Subject
router.post('/:userId/assignments/TEACHER', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR']), assignTeacherSubject);
// Remove Teacher from Subject
router.delete('/:userId/assignments/TEACHER/:subjectId', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR']), removeTeacherSubject);

export default router;
