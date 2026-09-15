// src/api/v1/controllers/userController.ts
import { Role } from '@prisma/client'; // Import Role enum
import { Request, Response } from 'express';
import { extractPaginationAndFilters } from '../../../utils/pagination';
import * as userService from '../services/userService';
import * as studentService from '../services/studentService'; // Added import for studentService
import * as subjectService from '../services/subjectService';

// Helper function to transform user data
export const transformUser = (user: any) => {
    const transformed: any = { ...user }; // Clone user

    // If user has subject_teachers relation data
    if (transformed.subject_teachers && Array.isArray(transformed.subject_teachers)) {
        // Map subject_teachers to subjects containing only subject info
        transformed.subjects = transformed.subject_teachers.map((st: any) => st.subject).filter(Boolean);
        // Remove the original subject_teachers key
        delete transformed.subject_teachers;
    }

    // Potentially add other transformations here if needed (e.g., for VP/DM assignments)

    return transformed;
};

export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
    try {
        // Define allowed filters for users in snake_case
        const allowedFilters = ['name', 'email', 'gender', 'role', 'include_roles', 'phone', 'academic_year_id'];

        // Extract pagination and filter parameters from the request
        const { paginationOptions, filterOptions } = extractPaginationAndFilters(req.finalQuery, allowedFilters);

        const result = await userService.getAllUsers(paginationOptions, filterOptions);

        // Transform each user in the data array
        const transformedData = result.data.map(transformUser);

        res.json({
            success: true,
            data: transformedData,
            meta: result.meta
        });
    } catch (error: any) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// PARENT is intentionally excluded — parents are not personnel and have their own endpoints.
const PERSONNEL_VALID_ROLES = new Set<Role>([
    'SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'CONTROLLER',
    'TEACHER', 'DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER', 'DEAN_OF_DISCIPLINE',
    'DISCIPLINE_COORDINATOR',
    'DEAN_OF_STUDIES', 'FEE_AUDITOR', 'SECRETARY', 'NURSE', 'GUIDANCE_COUNSELOR', 'HOD'
] as unknown as Role[]);

const PERSONNEL_VALID_GENDERS = new Set(['Male', 'Female']);
const PERSONNEL_VALID_STATUSES = new Set(['ACTIVE', 'INACTIVE', 'SUSPENDED']);
const PERSONNEL_VALID_SORT_BY = new Set([
    'id', 'name', 'email', 'matricule', 'phone', 'gender', 'status',
    'created_at', 'updated_at', 'date_of_birth', 'last_seen_at'
]);

export const searchPersonnel = async (req: Request, res: Response): Promise<void> => {
    try {
        const query = (req as any).finalQuery || req.query;

        // Pagination validation
        const pageRaw = query.page;
        const limitRaw = query.limit;
        const page = pageRaw !== undefined ? parseInt(pageRaw as string, 10) : 1;
        const limit = limitRaw !== undefined ? parseInt(limitRaw as string, 10) : 20;

        if (pageRaw !== undefined && (isNaN(page) || page < 1)) {
            res.status(400).json({ success: false, error: 'page must be a positive integer' });
            return;
        }
        if (limitRaw !== undefined && (isNaN(limit) || limit < 1 || limit > 100)) {
            res.status(400).json({ success: false, error: 'limit must be an integer between 1 and 100' });
            return;
        }

        // Sort validation
        const sortBy = (query.sort_by || query.sortBy) as string | undefined;
        const sortOrderRaw = (query.sort_order || query.sortOrder) as string | undefined;
        if (sortBy && !PERSONNEL_VALID_SORT_BY.has(sortBy)) {
            res.status(400).json({
                success: false,
                error: `Invalid sort_by. Allowed: ${Array.from(PERSONNEL_VALID_SORT_BY).join(', ')}`
            });
            return;
        }
        if (sortOrderRaw && !['asc', 'desc'].includes(sortOrderRaw)) {
            res.status(400).json({ success: false, error: "sort_order must be 'asc' or 'desc'" });
            return;
        }

        // Roles: accept `role` (single or csv) or `roles` (csv/array)
        const rolesInput = query.roles ?? query.role;
        let roles: Role[] | undefined;
        if (rolesInput !== undefined && rolesInput !== '') {
            const list = Array.isArray(rolesInput)
                ? rolesInput
                : String(rolesInput).split(',').map(s => s.trim()).filter(Boolean);
            const invalid = list.filter(r => !PERSONNEL_VALID_ROLES.has(r as Role));
            if (invalid.length > 0) {
                res.status(400).json({
                    success: false,
                    error: `Invalid role(s): ${invalid.join(', ')}. PARENT is not personnel; allowed roles: ${Array.from(PERSONNEL_VALID_ROLES).join(', ')}`
                });
                return;
            }
            roles = list as Role[];
        }

        // Gender validation
        const gender = query.gender as string | undefined;
        if (gender && !PERSONNEL_VALID_GENDERS.has(gender)) {
            res.status(400).json({ success: false, error: "gender must be 'Male' or 'Female'" });
            return;
        }

        // Status validation
        const status = query.status as string | undefined;
        if (status && !PERSONNEL_VALID_STATUSES.has(status)) {
            res.status(400).json({ success: false, error: 'status must be ACTIVE, INACTIVE, or SUSPENDED' });
            return;
        }

        // Academic year id validation
        let academicYearId: number | undefined;
        const yearRaw = query.academic_year_id ?? query.academicYearId;
        if (yearRaw !== undefined && yearRaw !== '') {
            const parsed = parseInt(yearRaw as string, 10);
            if (isNaN(parsed) || parsed < 1) {
                res.status(400).json({ success: false, error: 'academic_year_id must be a positive integer' });
                return;
            }
            academicYearId = parsed;
        }

        const result = await userService.searchPersonnel({
            q: query.q as string | undefined,
            name: query.name as string | undefined,
            email: query.email as string | undefined,
            matricule: query.matricule as string | undefined,
            phone: query.phone as string | undefined,
            roles,
            gender: gender as any,
            status: status as any,
            academic_year_id: academicYearId,
            page,
            limit,
            sort_by: sortBy,
            sort_order: sortOrderRaw === 'desc' ? 'desc' : 'asc'
        });

        res.json({
            success: true,
            data: result.data.map(transformUser),
            meta: result.meta
        });
    } catch (error: any) {
        console.error('Error searching personnel:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to search personnel'
        });
    }
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const userData = req.body;
        // Basic validation
        if (!userData.name || !userData.email || !userData.password || !userData.gender || !userData.date_of_birth || !userData.address) {
            res.status(400).json({ success: false, error: 'Missing required user fields' });
            return;
        }
        // Pass status if provided
        const newUser = await userService.createUser(userData);
        res.status(201).json({
            success: true,
            data: newUser
        });
    } catch (error: any) {
        console.error('Error creating user:', error);
        if (error.code === 'P2002') {
            res.status(409).json({ success: false, error: 'User with this email already exists' });
        } else {
            res.status(500).json({ success: false, error: error.message });
        }
    }
};

export const registerAndAssignRoles = async (req: Request, res: Response): Promise<void> => {
    try {
        const userData = req.body;
        // Basic validation for user data
        if (!userData.name || !userData.email || !userData.password || !userData.gender || !userData.date_of_birth || !userData.address) {
            res.status(400).json({ success: false, error: 'Missing required user fields' });
            return;
        }
        if (!userData.roles || !Array.isArray(userData.roles) || userData.roles.length === 0) {
            res.status(400).json({ success: false, error: 'Roles array is required and cannot be empty' });
            return;
        }
        for (const roleData of userData.roles) {
            if (!roleData.role) {
                res.status(400).json({ success: false, error: `Invalid role provided: ${roleData.role}` });
                return;
            }
        }
        // Pass status if provided
        const newUserWithRoles = await userService.registerAndAssignRoles(userData);
        res.status(201).json({
            success: true,
            data: newUserWithRoles
        });
    } catch (error: any) {
        console.error('Error registering user with roles:', error);
        if (error.code === 'P2002') {
            res.status(409).json({ success: false, error: 'User with this email already exists' });
        } else if (error.message.includes('Invalid role')) {
            res.status(400).json({ success: false, error: error.message });
        } else {
            res.status(500).json({ success: false, error: error.message });
        }
    }
};

// Extends the Express Request type to include the user property
interface AuthenticatedRequest extends Request {
    user?: {
        id: number;
        userId: number;
        // Include other user properties if available and needed
    };
}

export const getCurrentUserProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (!req.user || typeof req.user.id !== 'number') {
            res.status(401).json({ success: false, error: 'Unauthorized or user ID not found in token' });
            return;
        }

        const userId = req.user.id;
        const user = await userService.getUserById(userId);

        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found'
            });
            return;
        }
        res.json({
            success: true,
            data: transformUser(user) // Apply transformation if desired
        });
    } catch (error: any) {
        console.error('Error fetching current user profile:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// GET /users/me/dashboard?role=ROLE_NAME[&academicYearId=ID]
export const getDashboardForRole = async (req: any, res: any) => {
    try {
        const userId = req.user?.id;
        const role = req.query.role;
        const academicYearId = req.query.academicYearId ? parseInt(req.query.academicYearId) : undefined;

        if (!userId || !role) {
            return res.status(400).json({ success: false, error: 'Missing user or role parameter' });
        }

        // Check if user has the role (simplified - no academic year needed)
        const hasRole = await userService.userHasRole(userId, role);
        if (!hasRole) {
            return res.status(403).json({ success: false, error: 'User does not have the specified role' });
        }

        // Get role-specific dashboard data
        let dashboardData;

        switch (role) {
            case 'SUPER_MANAGER':
                dashboardData = await userService.getSuperManagerDashboard(academicYearId);
                break;
            case 'PRINCIPAL':
                dashboardData = await userService.getPrincipalDashboard(academicYearId);
                break;
            case 'VICE_PRINCIPAL':
                dashboardData = await userService.getVicePrincipalDashboard(userId, academicYearId);
                break;
            case 'TEACHER':
                dashboardData = await userService.getTeacherDashboard(userId, academicYearId);
                break;
            case 'DISCIPLINE_MASTER':
                dashboardData = await userService.getDisciplineMasterDashboard(userId, academicYearId);
                break;
            case 'MANAGER':
                dashboardData = await userService.getManagerDashboard(academicYearId);
                break;
            case 'BURSAR':
                dashboardData = await userService.getBursarDashboard(academicYearId);
                break;
            case 'SECRETARY':
                dashboardData = await userService.getSecretaryDashboard(userId, academicYearId);
                break;
            case 'PARENT':
                dashboardData = await userService.getParentDashboard(userId, academicYearId);
                break;
            case 'STUDENT':
                dashboardData = await userService.getStudentDashboard(userId, academicYearId);
                break;
            case 'HOD':
                // Map HOD to TEACHER dashboard with additional data
                dashboardData = await userService.getTeacherDashboard(userId, academicYearId);
                break;
            case 'GUIDANCE_COUNSELOR':
                // Map to a counselor-specific dashboard (using discipline master as base)
                dashboardData = await userService.getDisciplineMasterDashboard(userId, academicYearId);
                break;
            default:
                dashboardData = {
                    message: `Dashboard for role ${role} is not yet implemented`
                };
        }

        return res.json({
            success: true,
            data: dashboardData
        });
    } catch (error: any) {
        console.error('Error fetching dashboard:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

export const getUserById = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            res.status(400).json({
                success: false,
                error: 'Invalid user ID format. User ID must be a number.'
            });
            return;
        }
        const actorRoles = ((req as any).user?.role ?? []) as Role[];
        await userService.assertPersonnelScope(actorRoles, id);
        const user = await userService.getUserById(id);
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found'
            });
            return;
        }
        res.json({
            success: true,
            data: transformUser(user) // Apply transformation if desired
        });
    } catch (error: any) {
        console.error('Error fetching user:', error);
        res.status(error?.statusCode ?? 500).json({
            success: false,
            error: error.message
        });
    }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            res.status(400).json({ success: false, error: 'Invalid user ID format' });
            return;
        }

        const actorRoles = ((req as any).user?.role ?? []) as Role[];
        await userService.assertPersonnelScope(actorRoles, id);

        const updatedUser = await userService.updateUser(id, req.body);
        if (!updatedUser) {
            res.status(404).json({ success: false, error: 'User not found' });
            return;
        }
        res.json({ success: true, data: transformUser(updatedUser) });
    } catch (error: any) {
        console.error(`Error updating user ${req.params.id}:`, error);
        if (error.code === 'P2025') {
            res.status(404).json({ success: false, error: 'User not found' });
        } else {
            res.status(error?.statusCode ?? 500).json({ success: false, error: error.message });
        }
    }
};

/**
 * Admin reset of a personnel account's password.
 * Body: { newPassword?: string } — if omitted, resets to the default temporary password and
 * forces a change on next sign-in. Rejects parent accounts (use the bursar endpoint instead).
 */
export const resetPersonnelPassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            res.status(400).json({ success: false, error: 'Invalid user ID format' });
            return;
        }

        const actorId = req.user?.id;
        if (!actorId) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }
        const actorRoles = (((req.user as any)?.role) ?? []) as Role[];
        await userService.assertPersonnelScope(actorRoles, id);

        const { new_password } = req.body as { new_password?: string };
        if (new_password !== undefined) {
            if (typeof new_password !== 'string' || new_password.length < 8) {
                res.status(400).json({
                    success: false,
                    error: 'newPassword must be at least 8 characters long',
                });
                return;
            }
        }

        const result = await userService.resetPersonnelPassword(id, actorId, new_password);
        res.status(200).json({ success: true, data: result });
    } catch (error: any) {
        console.error(`Error resetting password for user ${req.params.id}:`, error);
        const statusCode = error?.statusCode ?? 500;
        res.status(statusCode).json({ success: false, error: error.message });
    }
};

export const updateCurrentUserProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (!req.user || typeof req.user.id !== 'number') {
            res.status(401).json({ success: false, error: 'Unauthorized or user ID not found in token' });
            return;
        }

        const userId = req.user.id;
        // Route through updateOwnProfile so email/matricule/status/password/roles cannot be
        // altered here. Password changes must go through POST /auth/change-password.
        const updatedUser = await userService.updateOwnProfile(userId, req.body);

        res.json({
            success: true,
            data: transformUser(updatedUser)
        });
    } catch (error: any) {
        console.error('Error updating current user profile:', error);
        if (error.code === 'P2025') {
            res.status(404).json({ success: false, error: 'User not found' });
        } else {
            res.status(500).json({ success: false, error: error.message });
        }
    }
};

export const getCurrentUserSettings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (!req.user || typeof req.user.id !== 'number') {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }
        const settings = await userService.getOrCreateUserSettings(req.user.id);
        res.json({ success: true, data: settings });
    } catch (error: any) {
        console.error('Error fetching user settings:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const updateCurrentUserSettings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (!req.user || typeof req.user.id !== 'number') {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }
        const settings = await userService.updateUserSettings(req.user.id, req.body);
        res.json({ success: true, data: settings });
    } catch (error: any) {
        console.error('Error updating user settings:', error);
        const status = error.message?.startsWith('Invalid') || error.message?.includes('must be') ? 400 : 500;
        res.status(status).json({ success: false, error: error.message });
    }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id);
        await userService.deleteUser(id);
        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error: any) {
        console.error('Error deleting user:', error);
        if (error.code === 'P2025') { // Record to delete not found
            res.status(404).json({ success: false, error: 'User not found' });
        } else {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
};

export const assignRole = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = parseInt(req.params.id);
        const roleData = {
            role: req.body.role as Role,
            // Removed academic_year_id since we're no longer using it
        };

        // Validate role
        if (!roleData.role || !Object.values(Role).includes(roleData.role)) {
            res.status(400).json({ success: false, error: `Invalid role provided: ${roleData.role}` });
            return;
        }

        const actorRoles = ((req as any).user?.role ?? []) as Role[];
        userService.assertRoleWithinCoordinatorScope(actorRoles, roleData.role);
        await userService.assertPersonnelScope(actorRoles, userId);

        const newRole = await userService.assignRole(userId, roleData);
        res.status(201).json({
            success: true,
            data: newRole
        });
    } catch (error: any) {
        console.error('Error assigning role:', error);
        if (error.code === 'P2003') { // Foreign key constraint failed
            res.status(404).json({ success: false, error: 'User not found' });
        } else {
            res.status(error?.statusCode ?? 500).json({ success: false, error: error.message });
        }
    }
};

export const removeRole = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = parseInt(req.params.id);
        const userRoleId = req.params.roleId ? parseInt(req.params.roleId) : undefined; // Optional roleId from URL
        const roleFromBody = req.body.role; // Role name from request body

        const actorRoles = ((req as any).user?.role ?? []) as Role[];
        await userService.assertPersonnelScope(actorRoles, userId);
        if (roleFromBody) userService.assertRoleWithinCoordinatorScope(actorRoles, roleFromBody as Role);

        // Support two scenarios:
        // 1. Remove by role ID: DELETE /users/:id/roles/:roleId
        // 2. Remove by role name: DELETE /users/:id/roles (with role in body)

        if (userRoleId !== undefined) {
            // Scenario 1: Remove by role ID
            if (isNaN(userRoleId)) {
                res.status(400).json({ success: false, error: 'Invalid role ID provided' });
                return;
            }
            await userService.removeRoleById(userId, userRoleId);
        } else if (roleFromBody) {
            // Scenario 2: Remove by role name
            await userService.removeRoleByName(userId, roleFromBody);
        } else {
            res.status(400).json({
                success: false,
                error: 'Either roleId in URL or role in request body is required'
            });
            return;
        }

        res.json({
            success: true,
            message: 'Role assignment removed successfully'
        });
    } catch (error: any) {
        console.error('Error removing role:', error);
        res.status(error?.statusCode ?? 404).json({ // Assume error means not found or doesn't belong to user
            success: false,
            error: error.message
        });
    }
};

/**
 * Create a user with role and optional assignments
 * @param req Request object containing user data, role and optional assignments
 * @param res Response object
 */
export const createUserWithRole = async (req: Request, res: Response): Promise<void> => {
    try {
        const userData = req.body;
        if (!userData.email || !userData.password || !userData.name || !userData.gender ||
            !userData.date_of_birth || !userData.phone || !userData.address || !userData.role) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
            return;
        }
        // Privilege-escalation guard: a SECRETARY (without any higher admin role) may
        // only create users with TEACHER or PARENT roles.
        const requesterRoles = (req.user?.role as string[] | undefined) || [];
        const hasAdminRole = requesterRoles.some(r =>
            ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR'].includes(r)
        );
        const isOnlySecretary = requesterRoles.includes('SECRETARY') && !hasAdminRole;
        if (isOnlySecretary && !['TEACHER', 'PARENT'].includes(userData.role)) {
            res.status(403).json({
                success: false,
                error: 'Secretary can only create users with TEACHER or PARENT role'
            });
            return;
        }
        if (typeof userData.date_of_birth === 'string') {
            userData.date_of_birth = new Date(userData.date_of_birth);
        }
        // Pass status if provided
        const result = await userService.createUserWithRole(userData);
        res.status(201).json({
            success: true,
            message: `User created successfully with role ${userData.role}`,
            data: result
        });
    } catch (error: any) {
        console.error('Error creating user with role:', error);
        if (error.code === 'P2002') {
            res.status(409).json({
                success: false,
                error: 'A user with this email already exists'
            });
            return;
        }
        if (error.message.includes('not found')) {
            res.status(404).json({
                success: false,
                error: error.message
            });
            return;
        }
        res.status(500).json({
            success: false,
            error: `Failed to create user: ${error.message}`
        });
    }
};

/**
 * Sets (replaces) the roles for a user for the current academic year.
 * Expects an array of roles in the request body.
 */
export const setUserRolesForCurrentAcademicYear = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = parseInt(req.params.id);
        const roles = req.body.roles as Role[]; // Expecting an array of roles

        if (isNaN(userId)) {
            res.status(400).json({ success: false, error: 'Invalid User ID' });
            return;
        }

        if (!Array.isArray(roles)) {
            res.status(400).json({ success: false, error: 'Roles must be provided as an array' });
            return;
        }

        // Validate each role in the array
        for (const role of roles) {
            if (!Object.values(Role).includes(role)) {
                res.status(400).json({ success: false, error: `Invalid role provided: ${role}` });
                return;
            }
        }

        const actorRoles = ((req as any).user?.role ?? []) as Role[];
        await userService.assertPersonnelScope(actorRoles, userId);
        // Every role in the incoming set must also be within the coordinator's scope,
        // so a coordinator can't add e.g. HOD to a Discipline Master account.
        for (const role of roles) userService.assertRoleWithinCoordinatorScope(actorRoles, role);

        const updatedRoles = await userService.setUserRolesForAcademicYear(userId, roles);
        res.json({
            success: true,
            message: 'User roles updated successfully for the current academic year',
            data: updatedRoles
        });
    } catch (error: any) {
        console.error('Error setting user roles for academic year:', error);
        if (error.message.includes('User with ID') || error.message.includes('not found')) {
            res.status(404).json({ success: false, error: error.message });
        } else if (error.message.includes('No current academic year')) {
            res.status(400).json({ success: false, error: error.message });
        } else {
            res.status(500).json({ success: false, error: 'An internal error occurred while setting user roles' });
        }
    }
};

export const assignVicePrincipal = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = parseInt(req.params.userId);
        // Expect snake_case from req.body due to middleware
        const { sub_class_id, academic_year_id } = req.body;

        if (isNaN(userId) || !sub_class_id || typeof sub_class_id !== 'number') {
            res.status(400).json({ success: false, error: 'Invalid User ID or Subclass ID provided.' });
            return;
        }
        if (academic_year_id !== undefined && typeof academic_year_id !== 'number') {
            res.status(400).json({ success: false, error: 'Invalid Academic Year ID provided.' });
            return;
        }

        // Pass snake_case values to service (service maps internally if needed)
        const assignment = await userService.assignVicePrincipalToSubclass(userId, sub_class_id, academic_year_id);
        res.status(201).json({ success: true, data: assignment });

    } catch (error: any) {
        console.error('Error assigning vice principal:', error);
        if (error.message.includes('not found') || error.message.includes('does not have')) {
            res.status(404).json({ success: false, error: error.message });
        } else if (error.message.includes('Academic Year ID is required')) {
            res.status(400).json({ success: false, error: error.message });
        } else {
            res.status(500).json({ success: false, error: 'Failed to assign vice principal.' });
        }
    }
};

export const removeVicePrincipal = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = parseInt(req.params.userId);
        const subClassId = parseInt(req.params.subClassId); // Param name from route
        // Expect snake_case from req.finalQuery due to middleware
        const academic_year_id = req.finalQuery.academic_year_id ? parseInt(req.finalQuery.academic_year_id as string) : undefined;

        if (isNaN(userId) || isNaN(subClassId)) {
            res.status(400).json({ success: false, error: 'Invalid User ID or Subclass ID in URL.' });
            return;
        }
        // Check the original finalQuery param existence before validating the parsed number
        if (req.finalQuery.academic_year_id && academic_year_id === undefined) {
            res.status(400).json({ success: false, error: 'Invalid Academic Year ID format in finalQuery parameter.' });
            return;
        }

        // Pass potentially undefined academic_year_id to service
        await userService.removeVicePrincipalFromSubclass(userId, subClassId, academic_year_id);
        res.status(200).json({ success: true, message: 'Vice Principal assignment removed successfully.' });

    } catch (error: any) {
        console.error('Error removing vice principal assignment:', error);
        if (error.message.includes('Academic Year ID is required')) {
            res.status(400).json({ success: false, error: error.message });
        } else {
            // Assume success even if record didn't exist, as the state is achieved
            res.status(200).json({ success: true, message: 'Vice Principal assignment removed successfully (or did not exist).' });
        }
    }
};

export const assignDisciplineMaster = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = parseInt(req.params.userId);
        // Expect snake_case from req.body due to middleware
        const { sub_class_id, academic_year_id } = req.body;

        if (isNaN(userId) || !sub_class_id || typeof sub_class_id !== 'number') {
            res.status(400).json({ success: false, error: 'Invalid User ID or Subclass ID provided.' });
            return;
        }
        if (academic_year_id !== undefined && typeof academic_year_id !== 'number') {
            res.status(400).json({ success: false, error: 'Invalid Academic Year ID provided.' });
            return;
        }

        // Pass snake_case values to service
        const assignment = await userService.assignDisciplineMasterToSubclass(userId, sub_class_id, academic_year_id);
        res.status(201).json({ success: true, data: assignment });

    } catch (error: any) {
        console.error('Error assigning discipline master:', error);
        if (error.message.includes('not found') || error.message.includes('does not have')) {
            res.status(404).json({ success: false, error: error.message });
        } else if (error.message.includes('Academic Year ID is required')) {
            res.status(400).json({ success: false, error: error.message });
        } else {
            res.status(500).json({ success: false, error: 'Failed to assign discipline master.' });
        }
    }
};

export const removeDisciplineMaster = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = parseInt(req.params.userId);
        const subClassId = parseInt(req.params.subClassId); // Param name from route
        // Expect snake_case from req.finalQuery due to middleware
        const academic_year_id = req.finalQuery.academic_year_id ? parseInt(req.finalQuery.academic_year_id as string) : undefined;

        if (isNaN(userId) || isNaN(subClassId)) {
            res.status(400).json({ success: false, error: 'Invalid User ID or Subclass ID in URL.' });
            return;
        }
        // Check the original finalQuery param existence before validating the parsed number
        if (req.finalQuery.academic_year_id && academic_year_id === undefined) {
            res.status(400).json({ success: false, error: 'Invalid Academic Year ID format in finalQuery parameter.' });
            return;
        }

        // Pass potentially undefined academic_year_id to service
        await userService.removeDisciplineMasterFromSubclass(userId, subClassId, academic_year_id);
        res.status(200).json({ success: true, message: 'Discipline Master assignment removed successfully.' });

    } catch (error: any) {
        console.error('Error removing discipline master assignment:', error);
        if (error.message.includes('Academic Year ID is required')) {
            res.status(400).json({ success: false, error: error.message });
        } else {
            res.status(200).json({ success: true, message: 'Discipline Master assignment removed successfully (or did not exist).' });
        }
    }
};

// Fan-out helper: assign a DM to every sub-class under a Class for the given year.
export const assignDisciplineMasterToClass = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = parseInt(req.params.userId);
        const { class_id, academic_year_id } = req.body;

        if (isNaN(userId) || !class_id || typeof class_id !== 'number') {
            res.status(400).json({ success: false, error: 'Invalid User ID or Class ID provided.' });
            return;
        }
        if (academic_year_id !== undefined && typeof academic_year_id !== 'number') {
            res.status(400).json({ success: false, error: 'Invalid Academic Year ID provided.' });
            return;
        }

        const assignments = await userService.assignDisciplineMasterToClass(userId, class_id, academic_year_id);
        res.status(201).json({ success: true, data: assignments });
    } catch (error: any) {
        console.error('Error assigning discipline master to class:', error);
        if (error.message.includes('not found') || error.message.includes('does not have')) {
            res.status(404).json({ success: false, error: error.message });
        } else if (error.message.includes('Academic Year ID is required')) {
            res.status(400).json({ success: false, error: error.message });
        } else {
            res.status(500).json({ success: false, error: 'Failed to assign discipline master to class.' });
        }
    }
};

export const removeDisciplineMasterFromClass = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = parseInt(req.params.userId);
        const classId = parseInt(req.params.classId);
        const academic_year_id = req.finalQuery.academic_year_id ? parseInt(req.finalQuery.academic_year_id as string) : undefined;

        if (isNaN(userId) || isNaN(classId)) {
            res.status(400).json({ success: false, error: 'Invalid User ID or Class ID in URL.' });
            return;
        }

        await userService.removeDisciplineMasterFromClass(userId, classId, academic_year_id);
        res.status(200).json({ success: true, message: 'Discipline Master class assignment removed successfully.' });
    } catch (error: any) {
        console.error('Error removing discipline master from class:', error);
        res.status(200).json({ success: true, message: 'Discipline Master class assignment removed (or did not exist).' });
    }
};

// Management-side teacher search with pagination, sorting, and rich filters.
// Roles allowed by route: SUPER_MANAGER, MANAGER, PRINCIPAL, VICE_PRINCIPAL,
// BURSAR, SECRETARY, DEAN_OF_STUDIES, HOD.
const TEACHER_SEARCH_VALID_GENDERS = new Set(['Male', 'Female']);
const TEACHER_SEARCH_VALID_STATUSES = new Set(['ACTIVE', 'INACTIVE', 'SUSPENDED']);
const TEACHER_SEARCH_VALID_SORT_BY = new Set([
    'id', 'name', 'email', 'matricule', 'phone', 'gender', 'status',
    'created_at', 'updated_at', 'date_of_birth', 'last_seen_at', 'total_hours_per_week'
]);

const parseBoolParam = (v: any): boolean | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const s = String(v).toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return undefined;
};

const parseIntParam = (v: any, res: Response, name: string): number | undefined | null => {
    if (v === undefined || v === null || v === '') return undefined;
    const parsed = parseInt(v as string, 10);
    if (isNaN(parsed) || parsed < 0) {
        res.status(400).json({ success: false, error: `${name} must be a non-negative integer` });
        return null;
    }
    return parsed;
};

export const searchTeachers = async (req: Request, res: Response): Promise<void> => {
    try {
        const query = (req as any).finalQuery || req.query;

        // Pagination validation
        const pageRaw = query.page;
        const limitRaw = query.limit;
        const page = pageRaw !== undefined ? parseInt(pageRaw as string, 10) : 1;
        const limit = limitRaw !== undefined ? parseInt(limitRaw as string, 10) : 20;

        if (pageRaw !== undefined && (isNaN(page) || page < 1)) {
            res.status(400).json({ success: false, error: 'page must be a positive integer' });
            return;
        }
        if (limitRaw !== undefined && (isNaN(limit) || limit < 1 || limit > 100)) {
            res.status(400).json({ success: false, error: 'limit must be an integer between 1 and 100' });
            return;
        }

        // Sort validation
        const sortBy = (query.sort_by || query.sortBy) as string | undefined;
        const sortOrderRaw = (query.sort_order || query.sortOrder) as string | undefined;
        if (sortBy && !TEACHER_SEARCH_VALID_SORT_BY.has(sortBy)) {
            res.status(400).json({
                success: false,
                error: `Invalid sort_by. Allowed: ${Array.from(TEACHER_SEARCH_VALID_SORT_BY).join(', ')}`
            });
            return;
        }
        if (sortOrderRaw && !['asc', 'desc'].includes(sortOrderRaw)) {
            res.status(400).json({ success: false, error: "sort_order must be 'asc' or 'desc'" });
            return;
        }

        // Gender/status validation
        const gender = query.gender as string | undefined;
        if (gender && !TEACHER_SEARCH_VALID_GENDERS.has(gender)) {
            res.status(400).json({ success: false, error: "gender must be 'Male' or 'Female'" });
            return;
        }
        const status = query.status as string | undefined;
        if (status && !TEACHER_SEARCH_VALID_STATUSES.has(status)) {
            res.status(400).json({ success: false, error: 'status must be ACTIVE, INACTIVE, or SUSPENDED' });
            return;
        }

        // Numeric param validation (parseIntParam sends 400 on error and returns null)
        const subjectId = parseIntParam(query.subject_id, res, 'subject_id');
        if (subjectId === null) return;
        const subClassId = parseIntParam(query.sub_class_id, res, 'sub_class_id');
        if (subClassId === null) return;
        const academicYearId = parseIntParam(query.academic_year_id, res, 'academic_year_id');
        if (academicYearId === null) return;
        const hodSubjectId = parseIntParam(query.hod_subject_id, res, 'hod_subject_id');
        if (hodSubjectId === null) return;
        const classMasterSubClassId = parseIntParam(
            query.class_master_of_sub_class_id, res, 'class_master_of_sub_class_id'
        );
        if (classMasterSubClassId === null) return;
        const minHours = parseIntParam(query.min_hours_per_week, res, 'min_hours_per_week');
        if (minHours === null) return;
        const maxHours = parseIntParam(query.max_hours_per_week, res, 'max_hours_per_week');
        if (maxHours === null) return;

        const result = await userService.searchTeachers({
            q: query.q as string | undefined,
            name: query.name as string | undefined,
            email: query.email as string | undefined,
            matricule: query.matricule as string | undefined,
            phone: query.phone as string | undefined,
            gender: gender as any,
            status: status as any,
            subject_id: subjectId,
            sub_class_id: subClassId,
            academic_year_id: academicYearId,
            is_hod: parseBoolParam(query.is_hod),
            hod_subject_id: hodSubjectId,
            is_class_master: parseBoolParam(query.is_class_master),
            class_master_of_sub_class_id: classMasterSubClassId,
            min_hours_per_week: minHours,
            max_hours_per_week: maxHours,
            has_assignments: parseBoolParam(query.has_assignments),
            page,
            limit,
            sort_by: sortBy,
            sort_order: sortOrderRaw === 'desc' ? 'desc' : 'asc'
        });

        res.json({
            success: true,
            data: result.data,
            meta: result.meta
        });
    } catch (error: any) {
        console.error('Error searching teachers:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to search teachers'
        });
    }
};

// Get all teachers with their subjects
export const getAllTeachers = async (req: Request, res: Response): Promise<void> => {
    try {
        // Get subject_id filter if provided
        const subject_id = req.finalQuery.subject_id ? parseInt(req.finalQuery.subject_id as string) : undefined;

        // Make sure the subject_id is a valid number if provided
        if (req.finalQuery.subject_id && isNaN(subject_id as number)) {
            res.status(400).json({
                success: false,
                error: "Invalid subject ID format"
            });
            return;
        }

        // Use the service function to get teachers
        const formattedTeachers = await userService.getAllTeachers(subject_id);

        res.json({
            success: true,
            data: formattedTeachers
        });
    } catch (error: any) {
        console.error('Error fetching teachers:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getStudentsForParent = async (req: Request, res: Response): Promise<void> => {
    try {
        const parentId = parseInt(req.params.parentId);
        if (isNaN(parentId)) {
            res.status(400).json({ success: false, error: 'Invalid Parent ID format' });
            return;
        }

        const academicYearId = req.finalQuery.academic_year_id ?
            parseInt(req.finalQuery.academic_year_id as string) : undefined;

        if (req.finalQuery.academic_year_id && isNaN(academicYearId as number)) {
            res.status(400).json({ success: false, error: 'Invalid Academic Year ID format in query' });
            return;
        }
        // Call the function from studentService
        const students = await studentService.getStudentsByParentId(parentId, academicYearId);

        res.json({
            success: true,
            data: students
        });
    } catch (error: any) {
        console.error('Error fetching students for parent:', error);
        if (error.message.includes('not found')) {
            res.status(404).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

export const assignTeacherSubject = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = parseInt(req.params.userId);
        const { subject_id } = req.body;

        if (isNaN(userId)) {
            res.status(400).json({ success: false, error: 'Invalid User ID.' });
            return;
        }

        if (!subject_id || typeof subject_id !== 'number') {
            res.status(400).json({ success: false, error: 'Subject ID is required.' });
            return;
        }

        const assignment = await subjectService.assignTeacher(subject_id, { teacher_id: userId });
        res.status(201).json({ success: true, message: 'Teacher assigned to subject successfully.', data: assignment });

    } catch (error: any) {
        console.error('Error assigning teacher to subject:', error);
        if (error.message.includes('not found')) {
            res.status(404).json({ success: false, error: error.message });
        } else {
            res.status(500).json({ success: false, error: error.message });
        }
    }
};

export const removeTeacherSubject = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = parseInt(req.params.userId);
        const subjectId = parseInt(req.params.subjectId);

        if (isNaN(userId) || isNaN(subjectId)) {
            res.status(400).json({ success: false, error: 'Invalid User ID or Subject ID.' });
            return;
        }

        await subjectService.removeTeacher(subjectId, userId);
        res.status(200).json({ success: true, message: 'Teacher removed from subject successfully.' });

    } catch (error: any) {
        console.error('Error removing teacher from subject:', error);
        if (error.message.includes('not found')) {
            res.status(404).json({ success: false, error: error.message });
        } else {
            res.status(500).json({ success: false, error: error.message });
        }
    }
};
