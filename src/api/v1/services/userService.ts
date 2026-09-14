// src/api/v1/services/userService.ts

import prisma, { Gender, User, Role, UserRole, UserStatus, RoleAssignment, AssignmentRole, UserSettings, Theme, NotificationCategory } from '../../../config/db';
import bcrypt from 'bcrypt';
import { paginate, PaginationOptions, FilterOptions, PaginatedResult } from '../../../utils/pagination';
import { getAcademicYearId, getCurrentAcademicYear } from '../../../utils/academicYear'; // Import the utility
import { generateStaffMatricule } from '../../../utils/matriculeGenerator'; // Import staff matricule generator
import { SUBCLASS_MAX_STUDENTS } from '../../../utils/capacity';
import * as disciplineService from './disciplineService'; // Import discipline service for SDM dashboard

// Type definition for the input data for registering with roles
export interface RegisterWithRolesData {
    name: string;
    email: string;
    password: string;
    gender: Gender;
    date_of_birth: string; // Expecting date string from request
    phone: string;
    address: string;
    roles: { role: Role; academic_year_id?: number }[];
}

export async function getAllUsers(
    paginationOptions?: PaginationOptions,
    filterOptions?: FilterOptions
): Promise<PaginatedResult<User>> {
    // Process complex filters for users
    const processedFilters: any = { ...filterOptions };

    // Get the current academic year ID for role assignments (not for roles themselves)
    const currentAcademicYear = await getCurrentAcademicYear();
    const currentAcademicYearId = currentAcademicYear?.id;
    
    // Check if academic year filter is provided for role filtering
    const roleAcademicYearId = filterOptions?.academic_year_id ? 
        parseInt(filterOptions.academic_year_id as string) : 
        currentAcademicYearId;

    // Define what relations to include
    const include: any = {
        // Include user roles filtered by academic year
        user_roles: roleAcademicYearId ? {
            where: {
                academic_year_id: roleAcademicYearId
            }
        } : {
            where: {
                academic_year_id: null // Global roles only when no academic year specified
            }
        },
        // Include role assignments filtered by current year
        role_assignments: currentAcademicYearId ? {
            where: { academic_year_id: currentAcademicYearId },
            include: {
                sub_class: true,
                subject: true
            }
        } : undefined,
        // Include subject assignments if the user is a teacher
        subject_teachers: {
            include: {
                subject: true // Include the actual subject details
            }
        }
    };

    // Handle role filtering in the main query's where clause
    if (filterOptions?.role) {
        processedFilters.user_roles = {
            some: {
                role: filterOptions.role,
                academic_year_id: roleAcademicYearId || null
            }
        };
        delete processedFilters.role;
    }

    // Remove the academic_year_id filter from processedFilters as it's handled above
    delete processedFilters.academic_year_id;
    
    // Remove the includeRoles filter if present, as it's no longer needed
    delete processedFilters.includeRoles;

    return paginate<User>(
        prisma.user,
        paginationOptions,
        processedFilters,
        include // Pass the expanded include object
    );
}

// Personnel = staff users. PARENT is NOT personnel and is never returned here.
export interface SearchPersonnelParams {
    q?: string;
    name?: string;
    email?: string;
    matricule?: string;
    phone?: string;
    roles?: Role[];
    gender?: Gender;
    status?: UserStatus;
    academic_year_id?: number;
    page?: number;
    limit?: number;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
}

export const PERSONNEL_ROLES: Role[] = [
    'SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'CONTROLLER',
    'TEACHER', 'DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER', 'DEAN_OF_DISCIPLINE',
    'DISCIPLINE_COORDINATOR',
    'DEAN_OF_STUDIES', 'FEE_AUDITOR', 'SECRETARY', 'NURSE', 'GUIDANCE_COUNSELOR', 'HOD'
];

// Roles the DISCIPLINE_COORDINATOR is allowed to manage as personnel.
// The coordinator is a scoped personnel-management role: it can hit the same
// /users/* endpoints as a Principal, but only against users whose entire role
// set falls within this list. Enforced in assertPersonnelScope below so that
// route middleware alone cannot be bypassed via API surface changes.
export const DISCIPLINE_COORDINATOR_MANAGED_ROLES: Role[] = [
    'DISCIPLINE_MASTER',
    'SENIOR_DISCIPLINE_MASTER',
    'DEAN_OF_DISCIPLINE',
];

// Roles that bypass the coordinator's target-scope filter — i.e. these are the
// senior admins for whom /users/* is unrestricted. If the actor holds any of
// these, no scope check is performed.
const PERSONNEL_MANAGEMENT_BYPASS_ROLES: Role[] = [
    'SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY',
];

export async function assertPersonnelScope(actorRoles: Role[], targetUserId: number): Promise<void> {
    if (actorRoles.some(r => PERSONNEL_MANAGEMENT_BYPASS_ROLES.includes(r))) return;

    if (!actorRoles.includes('DISCIPLINE_COORDINATOR')) {
        const err: any = new Error('Not authorized to manage this user');
        err.statusCode = 403;
        throw err;
    }

    const target = await prisma.user.findUnique({
        where: { id: targetUserId },
        include: { user_roles: { select: { role: true } } },
    });
    if (!target) {
        const err: any = new Error(`User ${targetUserId} not found`);
        err.statusCode = 404;
        throw err;
    }
    const targetRoles = target.user_roles.map(r => r.role);
    const outOfScope = targetRoles.filter(r => !DISCIPLINE_COORDINATOR_MANAGED_ROLES.includes(r));
    if (outOfScope.length > 0) {
        const err: any = new Error(
            `DISCIPLINE_COORDINATOR can only manage users whose roles are within [${DISCIPLINE_COORDINATOR_MANAGED_ROLES.join(', ')}]; ` +
            `target holds: ${outOfScope.join(', ')}`
        );
        err.statusCode = 403;
        throw err;
    }
}

export function assertRoleWithinCoordinatorScope(actorRoles: Role[], role: Role): void {
    if (actorRoles.some(r => PERSONNEL_MANAGEMENT_BYPASS_ROLES.includes(r))) return;
    if (!actorRoles.includes('DISCIPLINE_COORDINATOR')) return;
    if (!DISCIPLINE_COORDINATOR_MANAGED_ROLES.includes(role)) {
        const err: any = new Error(
            `DISCIPLINE_COORDINATOR may only touch roles within [${DISCIPLINE_COORDINATOR_MANAGED_ROLES.join(', ')}]; refusing '${role}'`
        );
        err.statusCode = 403;
        throw err;
    }
}

const SORTABLE_FIELDS = new Set([
    'id', 'name', 'email', 'matricule', 'phone', 'gender', 'status',
    'created_at', 'updated_at', 'date_of_birth', 'last_seen_at'
]);

export async function searchPersonnel(params: SearchPersonnelParams): Promise<PaginatedResult<User>> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 100) : 20;
    const skip = (page - 1) * limit;

    const currentAcademicYear = await getCurrentAcademicYear();
    const roleAcademicYearId = params.academic_year_id ?? currentAcademicYear?.id;

    const where: any = { AND: [] };

    // Free-text search across name, email, matricule, phone
    if (params.q && params.q.trim()) {
        const term = params.q.trim();
        where.AND.push({
            OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { matricule: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term, mode: 'insensitive' } }
            ]
        });
    }

    if (params.name) where.AND.push({ name: { contains: params.name, mode: 'insensitive' } });
    if (params.email) where.AND.push({ email: { contains: params.email, mode: 'insensitive' } });
    if (params.matricule) where.AND.push({ matricule: { contains: params.matricule, mode: 'insensitive' } });
    if (params.phone) where.AND.push({ phone: { contains: params.phone, mode: 'insensitive' } });
    if (params.gender) where.AND.push({ gender: params.gender });
    // Default to ACTIVE so soft-deleted (INACTIVE) users are hidden unless the
    // caller explicitly requests another status.
    where.AND.push({ status: params.status ?? 'ACTIVE' });

    // Role scoping. If explicit roles provided, intersect with PERSONNEL_ROLES so PARENT can never be included.
    const rolesToMatch: Role[] = (params.roles && params.roles.length > 0)
        ? params.roles.filter(r => PERSONNEL_ROLES.includes(r))
        : PERSONNEL_ROLES;

    where.AND.push({
        user_roles: {
            some: {
                role: { in: rolesToMatch },
                // Global roles have null year, year-specific ones match current/requested year
                OR: [
                    { academic_year_id: null },
                    ...(roleAcademicYearId ? [{ academic_year_id: roleAcademicYearId }] : [])
                ]
            }
        }
    });

    if (where.AND.length === 0) delete where.AND;

    const sortBy = params.sort_by && SORTABLE_FIELDS.has(params.sort_by) ? params.sort_by : 'name';
    const sortOrder: 'asc' | 'desc' = params.sort_order === 'desc' ? 'desc' : 'asc';

    const include: any = {
        user_roles: {
            where: {
                OR: [
                    { academic_year_id: null },
                    ...(roleAcademicYearId ? [{ academic_year_id: roleAcademicYearId }] : [])
                ]
            }
        },
        subject_teachers: { include: { subject: true } }
    };

    const [total, data] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
            where,
            skip,
            take: limit,
            orderBy: { [sortBy]: sortOrder },
            include
        })
    ]);

    return {
        data,
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        }
    };
}

// ---------- Teacher management search (management-side) ----------

export interface SearchTeachersParams {
    q?: string;
    name?: string;
    email?: string;
    matricule?: string;
    phone?: string;
    gender?: Gender;
    status?: UserStatus;
    subject_id?: number;
    sub_class_id?: number;
    academic_year_id?: number;
    is_hod?: boolean;
    hod_subject_id?: number;
    is_class_master?: boolean;
    class_master_of_sub_class_id?: number;
    min_hours_per_week?: number;
    max_hours_per_week?: number;
    has_assignments?: boolean;
    page?: number;
    limit?: number;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
}

const TEACHER_SORTABLE_FIELDS = new Set([
    'id', 'name', 'email', 'matricule', 'phone', 'gender', 'status',
    'created_at', 'updated_at', 'date_of_birth', 'last_seen_at', 'total_hours_per_week'
]);

export async function searchTeachers(params: SearchTeachersParams): Promise<PaginatedResult<any>> {
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 100) : 20;
    const skip = (page - 1) * limit;

    const currentAcademicYear = await getCurrentAcademicYear();
    const academicYearId = params.academic_year_id ?? currentAcademicYear?.id;

    const where: any = { AND: [] as any[] };

    // Must have TEACHER role (global or year-scoped)
    where.AND.push({
        user_roles: {
            some: {
                role: 'TEACHER',
                OR: [
                    { academic_year_id: null },
                    ...(academicYearId ? [{ academic_year_id: academicYearId }] : [])
                ]
            }
        }
    });

    // Free-text search
    if (params.q && params.q.trim()) {
        const term = params.q.trim();
        where.AND.push({
            OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { matricule: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term, mode: 'insensitive' } }
            ]
        });
    }

    if (params.name) where.AND.push({ name: { contains: params.name, mode: 'insensitive' } });
    if (params.email) where.AND.push({ email: { contains: params.email, mode: 'insensitive' } });
    if (params.matricule) where.AND.push({ matricule: { contains: params.matricule, mode: 'insensitive' } });
    if (params.phone) where.AND.push({ phone: { contains: params.phone, mode: 'insensitive' } });
    if (params.gender) where.AND.push({ gender: params.gender });
    // Default to ACTIVE so soft-deleted (INACTIVE) users are hidden unless the
    // caller explicitly requests another status.
    where.AND.push({ status: params.status ?? 'ACTIVE' });

    // Subject-taught filter (via SubjectTeacher)
    if (params.subject_id) {
        where.AND.push({
            subject_teachers: { some: { subject_id: params.subject_id } }
        });
    }

    // Subclass-taught filter (via TeacherPeriod for the academic year)
    if (params.sub_class_id) {
        where.AND.push({
            teacher_periods: {
                some: {
                    sub_class_id: params.sub_class_id,
                    ...(academicYearId ? { academic_year_id: academicYearId } : {})
                }
            }
        });
    }

    // HOD filters
    if (params.hod_subject_id) {
        where.AND.push({ hod_subjects: { some: { id: params.hod_subject_id } } });
    } else if (params.is_hod === true) {
        where.AND.push({ hod_subjects: { some: {} } });
    } else if (params.is_hod === false) {
        where.AND.push({ hod_subjects: { none: {} } });
    }

    // Class master filters
    if (params.class_master_of_sub_class_id) {
        where.AND.push({ class_master_of: { some: { id: params.class_master_of_sub_class_id } } });
    } else if (params.is_class_master === true) {
        where.AND.push({ class_master_of: { some: {} } });
    } else if (params.is_class_master === false) {
        where.AND.push({ class_master_of: { none: {} } });
    }

    // Hours per week range
    if (params.min_hours_per_week !== undefined || params.max_hours_per_week !== undefined) {
        const hoursFilter: any = {};
        if (params.min_hours_per_week !== undefined) hoursFilter.gte = params.min_hours_per_week;
        if (params.max_hours_per_week !== undefined) hoursFilter.lte = params.max_hours_per_week;
        where.AND.push({ total_hours_per_week: hoursFilter });
    }

    // has_assignments: any subject_teachers OR teacher_periods for the year
    if (params.has_assignments === true) {
        where.AND.push({
            OR: [
                { subject_teachers: { some: {} } },
                {
                    teacher_periods: {
                        some: academicYearId ? { academic_year_id: academicYearId } : {}
                    }
                }
            ]
        });
    } else if (params.has_assignments === false) {
        where.AND.push({ subject_teachers: { none: {} } });
        where.AND.push({
            teacher_periods: {
                none: academicYearId ? { academic_year_id: academicYearId } : {}
            }
        });
    }

    if (where.AND.length === 0) delete where.AND;

    const sortBy = params.sort_by && TEACHER_SORTABLE_FIELDS.has(params.sort_by) ? params.sort_by : 'name';
    const sortOrder: 'asc' | 'desc' = params.sort_order === 'desc' ? 'desc' : 'asc';

    const include: any = {
        user_roles: {
            where: {
                OR: [
                    { academic_year_id: null },
                    ...(academicYearId ? [{ academic_year_id: academicYearId }] : [])
                ]
            }
        },
        subject_teachers: { include: { subject: true } },
        hod_subjects: { select: { id: true, name: true, category: true } },
        class_master_of: {
            select: {
                id: true,
                name: true,
                class: { select: { id: true, name: true } }
            }
        },
        teacher_periods: {
            where: academicYearId ? { academic_year_id: academicYearId } : {},
            select: {
                sub_class_id: true,
                subject_id: true,
                sub_class: {
                    select: {
                        id: true,
                        name: true,
                        class: { select: { id: true, name: true } }
                    }
                },
                subject: { select: { id: true, name: true, category: true } }
            }
        }
    };

    const [total, data] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
            where,
            skip,
            take: limit,
            orderBy: { [sortBy]: sortOrder },
            include
        })
    ]);

    // Shape response: derive subjects, subclasses, HOD info, class-master info
    const shaped = data.map((t: any) => {
        const subjectsMap = new Map<number, any>();
        for (const st of t.subject_teachers || []) {
            if (st.subject) subjectsMap.set(st.subject.id, st.subject);
        }
        for (const tp of t.teacher_periods || []) {
            if (tp.subject && !subjectsMap.has(tp.subject.id)) subjectsMap.set(tp.subject.id, tp.subject);
        }

        const subClassMap = new Map<number, any>();
        for (const tp of t.teacher_periods || []) {
            if (tp.sub_class && !subClassMap.has(tp.sub_class.id)) subClassMap.set(tp.sub_class.id, tp.sub_class);
        }

        return {
            id: t.id,
            name: t.name,
            email: t.email,
            matricule: t.matricule,
            phone: t.phone,
            whatsapp_number: t.whatsapp_number,
            gender: t.gender,
            status: t.status,
            date_of_birth: t.date_of_birth,
            address: t.address,
            photo: t.photo,
            total_hours_per_week: t.total_hours_per_week,
            last_seen_at: t.last_seen_at,
            created_at: t.created_at,
            updated_at: t.updated_at,
            roles: (t.user_roles || []).map((ur: any) => ({
                role: ur.role,
                academic_year_id: ur.academic_year_id
            })),
            subjects: Array.from(subjectsMap.values()),
            sub_classes: Array.from(subClassMap.values()),
            is_hod: (t.hod_subjects || []).length > 0,
            hod_subjects: t.hod_subjects || [],
            is_class_master: (t.class_master_of || []).length > 0,
            class_master_of: t.class_master_of || [],
            total_assignments:
                (t.subject_teachers?.length || 0) + (t.teacher_periods?.length || 0)
        };
    });

    return {
        data: shaped,
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        }
    };
}

export async function createUser(data: {
    name: string;
    email: string;
    password: string;
    gender: string;
    date_of_birth: string;
    phone: string;
    address: string;
    status?: string;
    // No roles passed directly here, so matricule will use default or be based on later role assignment
}): Promise<User> {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const matricule = await generateStaffMatricule([]);
    const normalizedStatus = data.status ? (data.status as string).toUpperCase() as UserStatus : undefined;
    return prisma.user.create({
        data: {
            name: data.name,
            email: data.email,
            password: hashedPassword,
            gender: data.gender as Gender,
            date_of_birth: new Date(data.date_of_birth),
            phone: data.phone,
            address: data.address,
            matricule: matricule,
            ...(normalizedStatus && { status: normalizedStatus as UserStatus })
        },
    });
}

export async function registerAndAssignRoles(data: RegisterWithRolesData & { status?: string }): Promise<User> {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const userRoles = data.roles.map(r => r.role);
    const matricule = await generateStaffMatricule(userRoles);
    const normalizedStatus = data.status ? (data.status as string).toUpperCase() as UserStatus : undefined;
    return prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
            data: {
                name: data.name,
                email: data.email,
                password: hashedPassword,
                gender: data.gender,
                date_of_birth: new Date(data.date_of_birth),
                phone: data.phone,
                address: data.address,
                matricule: matricule,
                ...(normalizedStatus && { status: normalizedStatus as UserStatus })
            },
        });
        if (data.roles && data.roles.length > 0) {
            const roleAssignments = data.roles.map(roleData => ({
                user_id: newUser.id,
                role: roleData.role,
                // No longer using academic_year_id
            }));
            await tx.userRole.createMany({
                data: roleAssignments,
            });
        }
        const userWithRoles = await tx.user.findUnique({
            where: { id: newUser.id },
            include: { user_roles: true },
        });
        if (!userWithRoles) {
            throw new Error("Failed to retrieve the newly created user with roles.");
        }
        return userWithRoles;
    });
}

export async function getUserById(id: number): Promise<User | null> {
    return prisma.user.findUnique({
        where: { id },
        include: { user_roles: true }
    });
}

export async function updateUser(id: number, data: Partial<User>): Promise<User> {
    if (data.password) {
        data.password = await bcrypt.hash(data.password, 10);
    }
    const normalizedStatus = data.status ? (data.status as string).toUpperCase() as UserStatus : undefined;
    // Remove id from data if present (Prisma will error if you try to update the id)
    const { id: _id, ...rest } = data;
    return prisma.user.update({
        where: { id },
        data: {
            ...rest,
            ...(normalizedStatus && { status: normalizedStatus as UserStatus })
        },
    });
}

/**
 * Admin-driven password reset for a personnel account (non-parent).
 * If `newPassword` is provided, the account gets that password and
 * `must_change_password` is cleared. If omitted, the account is reset
 * to the shared default `password123` and forced to change on next sign-in.
 *
 * Parent accounts must go through `POST /bursar/parents/:parentId/reset-password`
 * to keep the parent handover flow (temp password + WhatsApp) in one place.
 */
const DEFAULT_PERSONNEL_TEMP_PASSWORD = 'password123';

export async function resetPersonnelPassword(
    userId: number,
    actorId: number,
    newPassword?: string,
): Promise<{ user_id: number; matricule: string; name: string; must_change_password: boolean; temporary_password?: string }> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { user_roles: { select: { role: true } } },
    });

    if (!user) {
        const err: any = new Error(`User with ID ${userId} not found`);
        err.statusCode = 404;
        throw err;
    }

    const roles = user.user_roles.map(r => r.role);
    const isParentOnly = roles.length > 0 && roles.every(r => r === Role.PARENT);
    if (isParentOnly) {
        const err: any = new Error(
            'This account is a parent — use POST /bursar/parents/:parentId/reset-password',
        );
        err.statusCode = 400;
        throw err;
    }

    const usingTemp = !newPassword;
    const passwordToSet = newPassword ?? DEFAULT_PERSONNEL_TEMP_PASSWORD;
    const hashed = await bcrypt.hash(passwordToSet, 10);

    await prisma.user.update({
        where: { id: user.id },
        data: {
            password: hashed,
            must_change_password: usingTemp,
        },
    });

    // Audit trail: never log the actual password — only whether the default was used.
    try {
        await prisma.auditLog.create({
            data: {
                user_id: actorId,
                action: 'PASSWORD_RESET',
                table_name: 'User',
                record_id: String(user.id),
                new_values: {
                    target_user_id: user.id,
                    target_matricule: user.matricule,
                    target_roles: roles,
                    used_default_password: usingTemp,
                    must_change_password: usingTemp,
                },
            },
        });
    } catch (err) {
        console.error('Audit log write failed for PASSWORD_RESET:', err);
    }

    console.log(
        `[PERSONNEL_PASSWORD_RESET] user_id=${user.id} actor_id=${actorId} matricule=${user.matricule ?? ''} used_default=${usingTemp}`,
    );

    return {
        user_id: user.id,
        matricule: user.matricule ?? '',
        name: user.name,
        must_change_password: usingTemp,
        ...(usingTemp && { temporary_password: DEFAULT_PERSONNEL_TEMP_PASSWORD }),
    };
}

// Fields a user is allowed to change on their own profile via PUT /users/me.
// Sensitive/scoped fields (email, matricule, status, password, roles) are excluded —
// password changes must go through POST /auth/change-password so the current password is verified.
const SELF_EDITABLE_PROFILE_FIELDS = [
    'name',
    'phone',
    'whatsapp_number',
    'address',
    'photo',
    'id_card_num',
    'date_of_birth',
    'gender',
] as const;

export async function updateOwnProfile(id: number, data: Record<string, any>): Promise<User> {
    const sanitized: Record<string, any> = {};
    for (const field of SELF_EDITABLE_PROFILE_FIELDS) {
        if (data[field] !== undefined) sanitized[field] = data[field];
    }
    if (sanitized.date_of_birth && typeof sanitized.date_of_birth === 'string') {
        sanitized.date_of_birth = new Date(sanitized.date_of_birth);
    }
    return prisma.user.update({
        where: { id },
        data: sanitized,
        include: { user_roles: true },
    });
}

// ---------- User settings (preferences) ----------

const SETTINGS_DEFAULTS = {
    theme: Theme.SYSTEM,
    language: 'en',
    timezone: 'Africa/Douala',
    notifications_email: true,
    notifications_sms: false,
    notifications_push: true,
    notifications_in_app: true,
    quiet_hours_enabled: false,
    quiet_hours_start: null as string | null,
    quiet_hours_end: null as string | null,
    muted_categories: [] as NotificationCategory[],
};

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function getOrCreateUserSettings(userId: number): Promise<UserSettings> {
    const existing = await prisma.userSettings.findUnique({ where: { user_id: userId } });
    if (existing) return existing;
    return prisma.userSettings.create({
        data: { user_id: userId, ...SETTINGS_DEFAULTS },
    });
}

export async function updateUserSettings(
    userId: number,
    data: Partial<{
        theme: Theme;
        language: string;
        timezone: string;
        notifications_email: boolean;
        notifications_sms: boolean;
        notifications_push: boolean;
        notifications_in_app: boolean;
        quiet_hours_enabled: boolean;
        quiet_hours_start: string | null;
        quiet_hours_end: string | null;
        muted_categories: NotificationCategory[];
    }>
): Promise<UserSettings> {
    if (data.theme !== undefined && !Object.values(Theme).includes(data.theme)) {
        throw new Error(`Invalid theme. Allowed: ${Object.values(Theme).join(', ')}`);
    }
    for (const key of ['quiet_hours_start', 'quiet_hours_end'] as const) {
        const val = data[key];
        if (val !== undefined && val !== null && !HHMM_REGEX.test(val)) {
            throw new Error(`${key} must be in HH:MM 24-hour format`);
        }
    }
    if (data.muted_categories !== undefined) {
        const invalid = data.muted_categories.filter(
            c => !Object.values(NotificationCategory).includes(c)
        );
        if (invalid.length > 0) {
            throw new Error(`Invalid notification categories: ${invalid.join(', ')}`);
        }
    }

    return prisma.userSettings.upsert({
        where: { user_id: userId },
        create: { user_id: userId, ...SETTINGS_DEFAULTS, ...data },
        update: data,
    });
}

export async function deleteUser(id: number): Promise<User> {
    // Soft delete: personnel have FK references across ~40 tables (marks history,
    // audit log, financial records, discipline, chat, inventory, salary, etc.).
    // Hard-deleting would either fail or destroy historical records, so we mark
    // the user INACTIVE and revoke role assignments. Auth already blocks login
    // when status !== 'ACTIVE', and personnel search filters INACTIVE by default.
    return prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { id } });
        if (!existing) {
            const err: any = new Error('User not found');
            err.code = 'P2025';
            throw err;
        }

        await tx.userRole.deleteMany({ where: { user_id: id } });

        return tx.user.update({
            where: { id },
            data: { status: 'INACTIVE' },
        });
    });
}

export async function assignRole(user_id: number, data: { role: Role; academic_year_id?: number }): Promise<UserRole> {
    // Check if the role assignment already exists
    const existingRole = await prisma.userRole.findFirst({
        where: {
            user_id,
            role: data.role,
        }
    });

    // If the role already exists, return it to indicate idempotency
    if (existingRole) {
        return existingRole;
    }

    // Otherwise, create a new role assignment
    return prisma.userRole.create({
        data: {
            user_id,
            role: data.role,
        },
    });
}

export async function removeRole(user_id: number, user_role_id: number): Promise<void> {
    // Ensure the role belongs to the user before deleting
    const roleToDelete = await prisma.userRole.findUnique({
        where: { id: user_role_id }
    });

    if (!roleToDelete || roleToDelete.user_id !== user_id) {
        throw new Error('Role assignment not found or does not belong to the user.');
    }

    await prisma.userRole.delete({
        where: { id: user_role_id },
    });
}

// Remove role by ID (alias for backward compatibility)
export async function removeRoleById(user_id: number, user_role_id: number): Promise<void> {
    return removeRole(user_id, user_role_id);
}

// Remove role by name (simplified - no academic year needed)
export async function removeRoleByName(user_id: number, roleName: Role): Promise<void> {
    // Find the role assignment for this user and role
    const roleToDelete = await prisma.userRole.findFirst({
        where: {
            user_id: user_id,
            role: roleName
        }
    });

    if (!roleToDelete) {
        throw new Error('Role assignment not found for this user.');
    }

    await prisma.userRole.delete({
        where: { id: roleToDelete.id },
    });
}

/**
 * Sets (replaces) the roles for a specific user within the current academic year.
 * It first deletes all existing roles for the user in the current academic year,
 * then creates the new roles provided.
 * @param userId - The ID of the user.
 * @param roles - An array of Role enums to assign to the user for the current academic year.
 * @returns A promise resolving to the list of created UserRole objects.
 * @throws Error if there is no current academic year defined.
 */
export async function setUserRolesForAcademicYear(userId: number, roles: Role[]): Promise<UserRole[]> {
    const currentAcademicYear = await getCurrentAcademicYear();
    if (!currentAcademicYear) {
        throw new Error('Cannot set roles: No current academic year is defined.');
    }
    const academicYearId = currentAcademicYear.id;

    // Ensure the user exists
    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    if (!userExists) {
        throw new Error(`User with ID ${userId} not found.`);
    }

    // Deduplicate the input roles array
    const uniqueRoles = [...new Set(roles)];

    return prisma.$transaction(async (tx) => {
        // 1. Delete existing roles for the user for this academic year
        await tx.userRole.deleteMany({
            where: {
                user_id: userId,
                academic_year_id: academicYearId,
            },
        });

        // 2. Prepare data for new unique roles with academic_year_id
        const newRoleData = uniqueRoles.map(role => ({
            user_id: userId,
            role: role,
            academic_year_id: academicYearId,
        }));

        // 3. Create the new roles if any unique roles were provided
        if (newRoleData.length > 0) {
            await tx.userRole.createMany({
                data: newRoleData,
            });
        }

        // 4. Return the newly created roles for this academic year
        return tx.userRole.findMany({
            where: {
                user_id: userId,
                academic_year_id: academicYearId,
            },
        });
    });
}

// Note: Keeping createUserWithRole for potential specific use cases, but registerAndAssignRoles is more general
export async function createUserWithRole(userData: {
    email: string;
    password: string;
    name: string;
    gender: Gender;
    date_of_birth: Date;
    phone: string;
    address: string;
    role: Role;
    status?: string;
    parentAssignments?: { studentId: number }[];
    teacherAssignments?: { subjectId: number }[];
}): Promise<any> {
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    const matricule = await generateStaffMatricule([userData.role]);
    const normalizedStatus = userData.status ? (userData.status as string).toUpperCase() as UserStatus : undefined;
    return prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
            data: {
                email: userData.email,
                password: hashedPassword,
                name: userData.name,
                gender: userData.gender,
                date_of_birth: userData.date_of_birth,
                phone: userData.phone,
                address: userData.address,
                matricule: matricule,
                ...(normalizedStatus && { status: normalizedStatus as UserStatus })
            },
        });
        await tx.userRole.create({
            data: {
                user_id: newUser.id,
                role: userData.role,
            },
        });
        if (userData.role === 'PARENT' && userData.parentAssignments?.length) {
            const parentAssignmentPromises = userData.parentAssignments.map(assignment =>
                tx.parentStudent.create({
                    data: {
                        parent_id: newUser.id,
                        student_id: assignment.studentId,
                    },
                })
            );
            await Promise.all(parentAssignmentPromises);
        }
        if (userData.role === 'TEACHER' && userData.teacherAssignments?.length) {
            const teacherAssignmentPromises = userData.teacherAssignments.map(assignment =>
                tx.subjectTeacher.create({
                    data: {
                        teacher_id: newUser.id,
                        subject_id: assignment.subjectId,
                    },
                })
            );
            await Promise.all(teacherAssignmentPromises);
        }
        return tx.user.findUnique({
            where: { id: newUser.id },
            include: {
                user_roles: true,
                ...(userData.role === 'PARENT' ? {
                    parent_students: {
                        include: { student: true }
                    }
                } : {}),
                ...(userData.role === 'TEACHER' ? {
                    subject_teachers: {
                        include: { subject: true }
                    }
                } : {})
            }
        });
    });
}

/**
 * Assigns a user as Vice Principal for a specific sub_class, defaulting to the current academic year.
 * Ensures the user has the VICE_PRINCIPAL role for the target year.
 */
export async function assignVicePrincipalToSubclass(
    userId: number,
    subClassId: number,
    academicYearId?: number
): Promise<RoleAssignment> {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error('Academic Year ID is required but could not be determined.');
    }

    // Verify user exists and has the VICE_PRINCIPAL role for the target year or globally
    const user = await prisma.user.findFirst({
        where: {
            id: userId,
            user_roles: {
                some: {
                    role: Role.VICE_PRINCIPAL,
                }
            }
        }
    });
    if (!user) {
        throw new Error(`User with ID ${userId} not found or does not have the VICE_PRINCIPAL role for the academic year ${yearId}.`);
    }

    // Verify sub_class exists
    const sub_class = await prisma.subClass.findUnique({ where: { id: subClassId } });
    if (!sub_class) {
        throw new Error(`Subclass with ID ${subClassId} not found.`);
    }

    // Create assignment using RoleAssignment - simplified approach
    return prisma.roleAssignment.create({
        data: {
            user_id: userId,
            role_type: 'VICE_PRINCIPAL',
            sub_class_id: subClassId,
            academic_year_id: yearId,
        }
    });
}

/**
 * Removes a Vice Principal assignment from a sub_class for a specific academic year.
 */
export async function removeVicePrincipalFromSubclass(
    userId: number,
    subClassId: number,
    academicYearId?: number
): Promise<void> {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error('Academic Year ID is required but could not be determined.');
    }

    await prisma.roleAssignment.deleteMany({
        where: {
            user_id: userId,
            role_type: 'VICE_PRINCIPAL',
            sub_class_id: subClassId,
            academic_year_id: yearId
        }
    });
}

/**
 * Assigns a user as Discipline Master for a specific sub_class, defaulting to the current academic year.
 * Ensures the user has the DISCIPLINE_MASTER role for the target year.
 */
export async function assignDisciplineMasterToSubclass(
    userId: number,
    subClassId: number,
    academicYearId?: number
): Promise<RoleAssignment> {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error('Academic Year ID is required but could not be determined.');
    }

    // Verify user exists and has the DISCIPLINE_MASTER role for the target year or globally
    const user = await prisma.user.findFirst({
        where: {
            id: userId,
            user_roles: {
                some: {
                    role: Role.DISCIPLINE_MASTER
                }
            }
        }
    });
    if (!user) {
        throw new Error(`User with ID ${userId} not found or does not have the DISCIPLINE_MASTER role for the academic year ${yearId}.`);
    }

    // Verify sub_class exists
    const sub_class = await prisma.subClass.findUnique({ where: { id: subClassId } });
    if (!sub_class) {
        throw new Error(`Subclass with ID ${subClassId} not found.`);
    }

    // Create assignment using RoleAssignment - simplified approach
    return prisma.roleAssignment.create({
        data: {
            user_id: userId,
            role_type: 'DISCIPLINE_MASTER',
            sub_class_id: subClassId,
            academic_year_id: yearId,
        }
    });
}

/**
 * Removes a Discipline Master assignment from a sub_class for a specific academic year.
 */
export async function removeDisciplineMasterFromSubclass(
    userId: number,
    subClassId: number,
    academicYearId?: number
): Promise<void> {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error('Academic Year ID is required but could not be determined.');
    }

    await prisma.roleAssignment.deleteMany({
        where: {
            user_id: userId,
            role_type: 'DISCIPLINE_MASTER',
            sub_class_id: subClassId,
            academic_year_id: yearId
        }
    });
}

/**
 * Assigns a DM to every sub-class of a given Class for the target academic year.
 * Idempotent per (user, sub_class, year): skips sub-classes already assigned.
 */
export async function assignDisciplineMasterToClass(
    userId: number,
    classId: number,
    academicYearId?: number
): Promise<RoleAssignment[]> {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error('Academic Year ID is required but could not be determined.');
    }

    const user = await prisma.user.findFirst({
        where: {
            id: userId,
            user_roles: { some: { role: Role.DISCIPLINE_MASTER } }
        }
    });
    if (!user) {
        throw new Error(`User ${userId} not found or does not have the DISCIPLINE_MASTER role.`);
    }

    const klass = await prisma.class.findUnique({
        where: { id: classId },
        include: { sub_classes: { select: { id: true } } }
    });
    if (!klass) {
        throw new Error(`Class ${classId} not found.`);
    }
    if (klass.sub_classes.length === 0) {
        return [];
    }

    // Find existing assignments to avoid duplicate creates
    const existing = await prisma.roleAssignment.findMany({
        where: {
            user_id: userId,
            role_type: 'DISCIPLINE_MASTER',
            academic_year_id: yearId,
            sub_class_id: { in: klass.sub_classes.map(sc => sc.id) }
        },
        select: { sub_class_id: true }
    });
    const existingIds = new Set(existing.map(e => e.sub_class_id));
    const toCreate = klass.sub_classes.filter(sc => !existingIds.has(sc.id));

    if (toCreate.length === 0) {
        return prisma.roleAssignment.findMany({
            where: {
                user_id: userId,
                role_type: 'DISCIPLINE_MASTER',
                academic_year_id: yearId,
                sub_class_id: { in: klass.sub_classes.map(sc => sc.id) }
            }
        });
    }

    await prisma.roleAssignment.createMany({
        data: toCreate.map(sc => ({
            user_id: userId,
            role_type: 'DISCIPLINE_MASTER' as const,
            sub_class_id: sc.id,
            academic_year_id: yearId
        }))
    });

    return prisma.roleAssignment.findMany({
        where: {
            user_id: userId,
            role_type: 'DISCIPLINE_MASTER',
            academic_year_id: yearId,
            sub_class_id: { in: klass.sub_classes.map(sc => sc.id) }
        }
    });
}

/**
 * Removes every DM sub-class assignment under a Class for the given year.
 */
export async function removeDisciplineMasterFromClass(
    userId: number,
    classId: number,
    academicYearId?: number
): Promise<void> {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) return;

    const klass = await prisma.class.findUnique({
        where: { id: classId },
        include: { sub_classes: { select: { id: true } } }
    });
    if (!klass || klass.sub_classes.length === 0) return;

    await prisma.roleAssignment.deleteMany({
        where: {
            user_id: userId,
            role_type: 'DISCIPLINE_MASTER',
            academic_year_id: yearId,
            sub_class_id: { in: klass.sub_classes.map(sc => sc.id) }
        }
    });
}

export interface Teacher {
    id: number;
    name: string;
    email: string;
    gender: Gender;
    subjects: {
        id: number;
        name: string;
        category: string;
    }[];
}

export async function getAllTeachers(subjectId?: number): Promise<Teacher[]> {
    // Find users with TEACHER role
    const teachers = await prisma.user.findMany({
        where: {
            user_roles: {
                some: {
                    role: 'TEACHER'
                }
            },
            // If subject_id is provided, filter teachers who teach that subject
            ...(subjectId && {
                subject_teachers: {
                    some: {
                        subject_id: subjectId
                    }
                }
            })
        },
        include: {
            subject_teachers: {
                include: {
                    subject: true
                }
            }
        }
    });

    // Transform data to desired format
    return teachers.map(teacher => ({
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        gender: teacher.gender,
        subjects: teacher.subject_teachers.map(st => ({
            id: st.subject.id,
            name: st.subject.name,
            category: st.subject.category
        }))
    }));
}

// Utility: Check if a user has a specific role (simplified - no academic year needed)
export async function userHasRole(userId: number, role: Role): Promise<boolean> {
    const userRole = await prisma.userRole.findFirst({
        where: {
            user_id: userId,
            role
        }
    });
    return !!userRole;
}

// Legacy function for backward compatibility - just calls the simplified version
export async function userHasRoleForAcademicYear(userId: number, role: Role, academicYearId?: number): Promise<boolean> {
    return userHasRole(userId, role);
}

/**
 * Dashboard service functions for different roles
 */

// Super Manager Dashboard - System-wide statistics with enhanced features
export async function getSuperManagerDashboard(academicYearId?: number): Promise<any> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

        // Get all the counts in parallel for better performance
        const [
            academicYearCount,
            personnelCount,
            studentCount,
            classCount,
            subClassCount,
            totalFeesCollected,
            totalFeesExpected,
            teacherProfiles,
            pendingReports,
            disciplineStatistics,
            recentModifications,
            formStatistics
        ] = await Promise.all([
            // Count total academic years
            prisma.academicYear.count(),

            // Count unique users with any staff role assignment (personnel excludes PARENT)
            prisma.userRole.groupBy({
                by: ['user_id'],
                where: { role: { not: 'PARENT' } },
                _count: { user_id: true }
            }).then(result => result.length),

            // Count active student enrollments for current/specified year
            yearId ?
                prisma.enrollment.groupBy({
                    by: ['student_id'],
                    where: { academic_year_id: yearId }
                }).then(result => result.length) :
                prisma.student.count(),

            // Count total classes
            prisma.class.count(),

            // Count total sub-classes
            prisma.subClass.count(),

            // Sum total fees collected from payment transactions
            prisma.paymentTransaction.aggregate({
                _sum: { amount: true }
            }).then(result => result._sum.amount || 0),

            // Sum total fees expected
            yearId ?
                prisma.schoolFees.aggregate({
                    where: { academic_year_id: yearId },
                    _sum: { amount_expected: true }
                }).then(result => result._sum.amount_expected || 0) : 0,

            // Teacher profiles with hours and attendance
            prisma.user.findMany({
                where: {
                    user_roles: {
                        some: { role: 'TEACHER' }
                    }
                },
                include: {
                    user_roles: true,
                    subject_teachers: {
                        include: { subject: true }
                    }
                },
                take: 10 // Limit for dashboard overview
            }),

            // Pending reports count
            prisma.generatedReport.count({
                where: {
                    status: 'PENDING',
                    ...(yearId && { academic_year_id: yearId })
                }
            }),

            // Discipline statistics
            prisma.disciplineIssue.groupBy({
                by: ['issue_type'],
                _count: { id: true },
                where: yearId ? {
                    enrollment: { academic_year_id: yearId }
                } : undefined
            }),

            // Recent system modifications (audit trail)
            prisma.auditLog.findMany({
                orderBy: { created_at: 'desc' },
                take: 10,
                include: { user: true }
            }),

            // Form statistics
            prisma.formTemplate.count({
                where: { is_active: true }
            })
        ]);

        // Calculate teacher statistics
        const teacherStats = teacherProfiles.map(teacher => ({
            id: teacher.id,
            name: teacher.name,
            matricule: teacher.matricule,
            subjects: teacher.subject_teachers.map(st => st.subject.name),
            totalHoursPerWeek: teacher.total_hours_per_week || 0,
            attendanceRate: 85 // Placeholder - would calculate from actual attendance data
        }));

        // Calculate financial metrics
        const collectionRate = totalFeesExpected > 0 ?
            (totalFeesCollected / totalFeesExpected) * 100 : 0;

        return {
            // Basic counts
            academicYearCount,
            personnelCount,
            studentCount,
            classCount,
            subClassCount,

            // Financial overview
            totalFeesCollected,
            totalFeesExpected,
            collectionRate,

            // Teacher management
            totalTeachers: teacherProfiles.length,
            teacherStats,

            // Reports & Analytics
            pendingReports,
            disciplineStatistics,

            // System administration
            recentModifications,
            activeForms: formStatistics,

            // Additional metrics
            systemHealth: {
                activeUsers: personnelCount,
                enrollmentRate: studentCount > 0 ? (studentCount / (classCount * 80)) * 100 : 0,
                averageClassSize: classCount > 0 ? studentCount / classCount : 0
            }
        };
    } catch (error) {
        console.error('Error fetching Super Manager dashboard:', error);
        throw new Error('Failed to fetch dashboard data');
    }
}

// Principal Dashboard - School overview
export async function getPrincipalDashboard(academicYearId?: number): Promise<any> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

        const [
            totalStudents,
            totalTeachers,
            totalClasses,
            activeExamSequences,
            pendingDisciplineIssues,
            averageAttendanceRate
        ] = await Promise.all([
            // Count students for current academic year
            yearId ?
                prisma.enrollment.groupBy({
                    by: ['student_id'],
                    where: { academic_year_id: yearId }
                }).then(result => result.length) :
                prisma.student.count(),

            // Count teachers
            prisma.userRole.groupBy({
                by: ['user_id'],
                where: { role: 'TEACHER' }
            }).then(result => result.length),

            // Count total classes
            prisma.class.count(),

            // Count active exam sequences
            prisma.examSequence.count({
                where: {
                    status: 'OPEN',
                    ...(yearId && { academic_year_id: yearId })
                }
            }),

            // Count pending discipline issues
            yearId ?
                prisma.disciplineIssue.count({
                    where: {
                        enrollment: { academic_year_id: yearId }
                    }
                }) : 0,

            // Calculate average attendance rate (simplified)
            85 // Placeholder - could be calculated from actual attendance data
        ]);

        return {
            totalStudents,
            totalTeachers,
            totalClasses,
            activeExamSequences,
            pendingDisciplineIssues,
            averageAttendanceRate
        };
    } catch (error) {
        console.error('Error fetching Principal dashboard:', error);
        throw new Error('Failed to fetch Principal dashboard data');
    }
}

// Vice Principal Dashboard - Assigned sub-classes focus
export async function getVicePrincipalDashboard(userId: number, academicYearId?: number): Promise<any> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

        const [
            assignedSubClasses,
            totalStudentsUnderSupervision,
            recentDisciplineIssues,
            classesWithPendingReports,
            teacherAbsences
        ] = await Promise.all([
            // Count sub-classes assigned to this VP using RoleAssignment
            yearId ?
                prisma.roleAssignment.count({
                    where: {
                        user_id: userId,
                        role_type: 'VICE_PRINCIPAL',
                        academic_year_id: yearId
                    }
                }) : 0,

            // Count students in assigned sub-classes - simplified approach
            yearId ? 0 : 0, // Placeholder - complex calculation removed to fix compilation

            // Count recent discipline issues in assigned sub-classes - simplified
            0, // Placeholder for VP-specific discipline issue count

            // Count classes needing reports
            3, // Placeholder

            // Count teacher absences this week - simplified
            2 // Placeholder
        ]);

        return {
            assignedSubClasses,
            totalStudentsUnderSupervision,
            recentDisciplineIssues,
            classesWithPendingReports,
            teacherAbsences
        };
    } catch (error) {
        console.error('Error fetching Vice Principal dashboard:', error);
        throw new Error('Failed to fetch Vice Principal dashboard data');
    }
}

// Teacher Dashboard - Teaching subjects and classes
export async function getTeacherDashboard(userId: number, academicYearId?: number): Promise<any> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

        const [
            subjectsTeaching,
            totalStudentsTeaching,
            marksToEnter,
            classesTaught,
            upcomingPeriods
        ] = await Promise.all([
            // Count subjects this teacher teaches
            prisma.subjectTeacher.count({
                where: { teacher_id: userId }
            }),

            // Count total students this teacher teaches (across all sub-classes)
            prisma.subClassSubject.findMany({
                where: {
                    subject: {
                        subject_teachers: {
                            some: { teacher_id: userId }
                        }
                    }
                },
                include: {
                    sub_class: {
                        include: {
                            enrollments: yearId ? {
                                where: { academic_year_id: yearId }
                            } : true
                        }
                    }
                }
            }).then(subClassSubjects => {
                const uniqueStudents = new Set();
                subClassSubjects.forEach(scs => {
                    scs.sub_class.enrollments.forEach(enrollment => {
                        uniqueStudents.add(enrollment.student_id);
                    });
                });
                return uniqueStudents.size;
            }),

            // Count marks that need to be entered (exam papers without marks) - simplified
            10, // Placeholder

            // Count distinct sub-classes taught
            prisma.subClassSubject.groupBy({
                by: ['sub_class_id'],
                where: {
                    subject: {
                        subject_teachers: {
                            some: { teacher_id: userId }
                        }
                    }
                }
            }).then(result => result.length),

            // Count upcoming periods this week - simplified
            5 // Placeholder value
        ]);

        return {
            subjectsTeaching,
            totalStudentsTeaching,
            marksToEnter,
            classesTaught,
            upcomingPeriods
        };
    } catch (error) {
        console.error('Error fetching Teacher dashboard:', error);
        throw new Error('Failed to fetch Teacher dashboard data');
    }
}

// Discipline Master Dashboard - Student discipline focus
export async function getDisciplineMasterDashboard(userId: number, academicYearId?: number): Promise<any> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

        // Get lateness statistics
        const latenessStats = await disciplineService.getLatenessStatistics(yearId);

        const [
            pendingDisciplineIssues,
            resolvedThisWeek,
            studentsWithMultipleIssues,
            averageResolutionTime,
            attendanceRate
        ] = await Promise.all([
            // Count discipline issues - simplified
            yearId ?
                prisma.disciplineIssue.count({
                    where: {
                        enrollment: { academic_year_id: yearId }
                    }
                }) : 0,

            // Count resolved issues this week - simplified
            3, // Placeholder

            // Count students with multiple discipline issues
            prisma.disciplineIssue.groupBy({
                by: ['enrollment_id'],
                where: {
                    ...(yearId && {
                        enrollment: { academic_year_id: yearId }
                    })
                },
                having: {
                    enrollment_id: {
                        _count: { gt: 1 }
                    }
                }
            }).then(result => result.length),

            // Average resolution time (placeholder)
            3.5, // days

            // Overall attendance rate (placeholder)
            87 // percentage
        ]);

        return {
            // Basic discipline stats
            pendingDisciplineIssues,
            resolvedThisWeek,
            studentsWithMultipleIssues,
            averageResolutionTime,
            attendanceRate,

            // Enhanced lateness tracking
            latenessIncidents: latenessStats.totalLatenessToday,
            absenteeismCases: 0, // Placeholder

            // New detailed lateness statistics
            lateness: {
                today: latenessStats.totalLatenessToday,
                thisWeek: latenessStats.totalLatenessThisWeek,
                thisMonth: latenessStats.totalLatenessThisMonth,
                chronicallyLateStudents: latenessStats.chronicallyLateStudents.length,
                byClass: latenessStats.latenessByClass
            },

            // Chronic offenders summary
            chronicOffenders: latenessStats.chronicallyLateStudents.slice(0, 5), // Top 5 for dashboard

            // Quick access data for SDM daily tasks
            todaysSummary: {
                date: new Date().toISOString().split('T')[0],
                totalLateStudents: latenessStats.totalLatenessToday,
                needsAttention: latenessStats.chronicallyLateStudents.filter(s => s.lateness_count >= 5).length
            }
        };
    } catch (error) {
        console.error('Error fetching Discipline Master dashboard:', error);
        throw new Error('Failed to fetch Discipline Master dashboard data');
    }
}

// Manager Dashboard - Simplified Super Manager functions for "old people"
export async function getManagerDashboard(academicYearId?: number): Promise<any> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

        // Get comprehensive management data in parallel
        const [
            // School Overview - Finance
            totalFeesCollected,
            totalFeesExpected,
            pendingPayments,
            
            // School Overview - Students & Classes
            totalStudents,
            totalClasses,
            totalSubClasses,
            
            // School Overview - Personnel
            totalTeachers,
            totalStaff,
            
            // Teacher Management
            teacherProfiles,
            teacherAttendanceStats,
            
            // Discipline Management
            disciplineStatistics,
            pendingDisciplineIssues,
            
            // Reports & Analytics
            pendingReports,
            overdueReports,
            recentReportSubmissions,
            
            // Form Management
            activeForms,
            formSubmissions,
            
            // Audit Trail - who modified what
            recentModifications,
            
            // Class Profiles
            classUtilization
        ] = await Promise.all([
            // Financial Overview
            prisma.paymentTransaction.aggregate({
                _sum: { amount: true },
                where: yearId ? { academic_year_id: yearId } : undefined
            }).then(result => result._sum.amount || 0),

            prisma.schoolFees.aggregate({
                where: yearId ? { academic_year_id: yearId } : undefined,
                _sum: { amount_expected: true }
            }).then(result => result._sum.amount_expected || 0),

            prisma.schoolFees.count({
                where: {
                    ...(yearId && { academic_year_id: yearId }),
                    amount_paid: { lt: prisma.schoolFees.fields.amount_expected }
                }
            }),

            // Student & Class Overview
            yearId ?
                prisma.enrollment.groupBy({
                    by: ['student_id'],
                    where: { academic_year_id: yearId }
                }).then(result => result.length) :
                prisma.student.count(),

            prisma.class.count(),
            prisma.subClass.count(),

            // Personnel Overview
            prisma.userRole.count({
                where: { role: 'TEACHER' }
            }),

            prisma.userRole.groupBy({
                by: ['user_id'],
                where: {
                    role: { in: ['TEACHER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'DISCIPLINE_MASTER'] }
                }
            }).then(result => result.length),

            // Teacher Management Details
            prisma.user.findMany({
                where: {
                    user_roles: {
                        some: { role: 'TEACHER' }
                    }
                },
                select: {
                    id: true,
                    name: true,
                    matricule: true,
                    total_hours_per_week: true,
                    subject_teachers: {
                        include: { subject: { select: { name: true } } }
                    },
                    created_at: true
                },
                take: 10 // Limit for dashboard overview
            }),

            // Teacher Attendance Stats (placeholder - would calculate from actual data)
            Promise.resolve({ averageAttendance: 92.5, presentToday: 45, totalTeachers: 50 }),

            // Discipline Statistics
            prisma.disciplineIssue.groupBy({
                by: ['issue_type'],
                _count: { id: true },
                where: yearId ? {
                    enrollment: { academic_year_id: yearId }
                } : undefined
            }),

            prisma.disciplineIssue.count({
                where: {
                    ...(yearId && { 
                        enrollment: { academic_year_id: yearId } 
                    })
                }
            }),

            // Reports Analytics
            prisma.generatedReport.count({
                where: {
                    status: 'PENDING',
                    ...(yearId && { academic_year_id: yearId })
                }
            }),

            prisma.generatedReport.count({
                where: {
                    status: 'PENDING',
                    created_at: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Older than 7 days
                    ...(yearId && { academic_year_id: yearId })
                }
            }),

            prisma.generatedReport.findMany({
                where: yearId ? { academic_year_id: yearId } : undefined,
                orderBy: { created_at: 'desc' },
                take: 5,
                select: {
                    id: true,
                    report_type: true,
                    status: true,
                    created_at: true,
                    student_id: true
                }
            }),

            // Form Management
            prisma.formTemplate.count({
                where: { is_active: true }
            }),

            prisma.formSubmission.count({
                where: {
                    submitted_at: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
                }
            }),

            // Audit Trail
            prisma.auditLog.findMany({
                orderBy: { created_at: 'desc' },
                take: 10,
                include: { 
                    user: { select: { name: true, matricule: true } }
                }
            }),

            // Class Utilization
            prisma.subClass.findMany({
                select: {
                    id: true,
                    name: true,
                    current_students: true,
                    class: {
                        select: {
                            name: true,
                            max_students: true
                        }
                    }
                }
            })
        ]);

        // Calculate key metrics
        const collectionRate = totalFeesExpected > 0 ? 
            (totalFeesCollected / totalFeesExpected) * 100 : 0;

        const teacherStats = teacherProfiles.map(teacher => ({
            id: teacher.id,
            name: teacher.name,
            matricule: teacher.matricule,
            subjects: teacher.subject_teachers.map(st => st.subject.name),
            totalHoursPerWeek: teacher.total_hours_per_week || 0,
            attendanceRate: 85 + Math.random() * 10 // Placeholder - would calculate from actual data
        }));

        const classProfileStats = classUtilization.map(subclass => {
            const current = subclass.current_students || 0;
            return {
                id: subclass.id,
                name: subclass.name,
                className: subclass.class.name,
                currentStudents: current,
                maxStudents: SUBCLASS_MAX_STUDENTS,
                utilizationRate: (current / SUBCLASS_MAX_STUDENTS) * 100
            };
        });

        const averageClassUtilization = classProfileStats.length > 0 ?
            classProfileStats.reduce((sum, cls) => sum + cls.utilizationRate, 0) / classProfileStats.length : 0;

        // Format discipline statistics
        const disciplineOverview = disciplineStatistics.reduce((acc, stat) => {
            acc[stat.issue_type] = stat._count.id;
            return acc;
        }, {} as Record<string, number>);

        return {
            // School Overview - Financial
            schoolOverview: {
                financial: {
                    totalFeesCollected,
                    totalFeesExpected,
                    collectionRate: Math.round(collectionRate * 100) / 100,
                    pendingPayments,
                    outstandingAmount: totalFeesExpected - totalFeesCollected
                },
                
                // School Overview - Academic
                academic: {
                    totalStudents,
                    totalClasses,
                    totalSubClasses,
                    averageStudentsPerClass: totalClasses > 0 ? Math.round(totalStudents / totalClasses) : 0
                },

                // School Overview - Personnel
                personnel: {
                    totalTeachers,
                    totalStaff,
                    teacherAttendanceRate: teacherAttendanceStats.averageAttendance,
                    presentToday: teacherAttendanceStats.presentToday
                }
            },

            // Teacher Management & Analytics
            teacherAnalytics: {
                totalTeachers,
                teacherProfiles: teacherStats,
                attendanceStats: teacherAttendanceStats,
                averageHoursPerWeek: teacherStats.length > 0 ? 
                    teacherStats.reduce((sum, t) => sum + t.totalHoursPerWeek, 0) / teacherStats.length : 0
            },

            // Class Profiles
            classProfiles: {
                totalClasses: totalSubClasses,
                averageUtilization: Math.round(averageClassUtilization * 100) / 100,
                classDetails: classProfileStats,
                underutilizedClasses: classProfileStats.filter(cls => cls.utilizationRate < 70).length,
                fullClasses: classProfileStats.filter(cls => cls.utilizationRate > 90).length
            },

            // Discipline Management
            disciplineManagement: {
                pendingIssues: pendingDisciplineIssues,
                disciplineBreakdown: disciplineOverview,
                totalIssuesThisMonth: Object.values(disciplineOverview).reduce((sum, count) => sum + count, 0)
            },

            // Reports & Analytics
            reportsAnalytics: {
                pendingReports,
                overdueReports,
                completionRate: (pendingReports + overdueReports) > 0 ? 
                    Math.round((1 - (pendingReports + overdueReports) / (pendingReports + overdueReports + recentReportSubmissions.length)) * 100) : 100,
                recentSubmissions: recentReportSubmissions.map(report => ({
                    id: report.id,
                    type: report.report_type,
                    submittedBy: 'System', // Use placeholder since generated_by field doesn't exist
                    submittedAt: report.created_at,
                    status: report.status
                }))
            },

            // Form Management (for form creation and assignment)
            formManagement: {
                activeForms,
                recentSubmissions: formSubmissions,
                formsNeedingReview: Math.floor(Math.random() * 5) // Placeholder
            },

            // Audit Trail - showing who modified what
            auditTrail: {
                recentModifications: recentModifications.map(log => ({
                    id: log.id,
                    action: log.action,
                    modifiedBy: log.user?.name || 'System',
                    userMatricule: log.user?.matricule || 'N/A',
                    timestamp: log.created_at,
                    details: log.old_values || {} // Use old_values since changes field doesn't exist
                })),
                modificationsToday: recentModifications.filter(log => 
                    log.created_at > new Date(Date.now() - 24 * 60 * 60 * 1000)
                ).length
            },

            // System Statistics
            systemStats: {
                totalUsers: totalStaff,
                activeUsers: totalStaff, // Would calculate from last login
                systemUptime: 99.5, // Placeholder
                lastDataUpdate: new Date().toISOString()
            },

            // Summary for quick overview
            summary: {
                studentsEnrolled: totalStudents,
                teachersActive: totalTeachers,
                classesRunning: totalSubClasses,
                feesCollected: Math.round(collectionRate),
                pendingTasks: pendingReports + pendingDisciplineIssues + overdueReports,
                systemHealth: 'Good' // Would calculate based on various factors
            },

            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.error('Error fetching Manager dashboard:', error);
        throw new Error('Failed to fetch Manager dashboard data');
    }
}

// Bursar Dashboard - Financial overview
export async function getBursarDashboard(academicYearId?: number): Promise<any> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

        const [
            totalFeesExpected,
            totalFeesCollected,
            pendingPayments,
            collectionRate,
            recentTransactions
        ] = await Promise.all([
            // Total fees expected for the academic year
            yearId ?
                prisma.schoolFees.aggregate({
                    where: { academic_year_id: yearId },
                    _sum: { amount_expected: true }
                }).then(result => result._sum.amount_expected || 0) : 0,

            // Total fees collected
            yearId ?
                prisma.schoolFees.aggregate({
                    where: { academic_year_id: yearId },
                    _sum: { amount_paid: true }
                }).then(result => result._sum.amount_paid || 0) : 0,

            // Count of pending payments
            yearId ?
                prisma.schoolFees.count({
                    where: {
                        academic_year_id: yearId,
                        amount_paid: { lt: prisma.schoolFees.fields.amount_expected }
                    }
                }) : 0,

            // Calculate collection rate (placeholder calculation)
            75, // percentage

            // Count recent transactions (last 7 days)
            prisma.paymentTransaction.count({
                where: {
                    created_at: {
                        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                    }
                }
            })
        ]);

        return {
            totalFeesExpected,
            totalFeesCollected,
            pendingPayments,
            collectionRate,
            recentTransactions
        };
    } catch (error) {
        console.error('Error fetching Bursar dashboard:', error);
        throw new Error('Failed to fetch Bursar dashboard data');
    }
}

// Secretary Dashboard - student/teacher administration overview
export async function getSecretaryDashboard(userId: number, academicYearId?: number): Promise<any> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [
            totalStudents,
            studentsThisYear,
            studentsCreatedLast7Days,
            totalTeachers,
            teachersCreatedLast7Days,
            totalClasses,
            totalSubclasses,
            studentsWithoutPhoto,
            recentStudents,
            recentTeachers
        ] = await Promise.all([
            prisma.student.count(),

            yearId
                ? prisma.enrollment.count({
                    where: { academic_year_id: yearId },
                })
                : 0,

            prisma.student.count({
                where: { created_at: { gte: since } },
            }),

            prisma.userRole.findMany({
                where: { role: Role.TEACHER },
                distinct: ['user_id'],
                select: { user_id: true },
            }).then(rows => rows.length),

            prisma.user.count({
                where: {
                    created_at: { gte: since },
                    user_roles: { some: { role: Role.TEACHER } },
                },
            }),

            prisma.class.count(),
            prisma.subClass.count(),

            yearId
                ? prisma.enrollment.count({
                    where: { academic_year_id: yearId, photo: null },
                })
                : 0,

            prisma.student.findMany({
                orderBy: { created_at: 'desc' },
                take: 10,
                select: {
                    id: true,
                    matricule: true,
                    name: true,
                    gender: true,
                    created_at: true,
                },
            }),

            prisma.user.findMany({
                where: { user_roles: { some: { role: Role.TEACHER } } },
                orderBy: { created_at: 'desc' },
                take: 10,
                select: {
                    id: true,
                    matricule: true,
                    name: true,
                    email: true,
                    created_at: true,
                },
            }),
        ]);

        return {
            totals: {
                totalStudents,
                studentsEnrolledThisYear: studentsThisYear,
                totalTeachers,
                totalClasses,
                totalSubclasses,
                studentsWithoutPhoto,
            },
            recentActivity: {
                studentsCreatedLast7Days,
                teachersCreatedLast7Days,
                recentStudents,
                recentTeachers,
            },
        };
    } catch (error) {
        console.error('Error fetching Secretary dashboard:', error);
        throw new Error('Failed to fetch Secretary dashboard data');
    }
}

// Parent Dashboard - Child's school progress
export async function getParentDashboard(userId: number, academicYearId?: number): Promise<any> {
    try {
        // Import the parent service here to avoid circular dependency
        const parentService = await import('./parentService');
        return await parentService.getParentDashboard(userId, academicYearId);
    } catch (error) {
        console.error('Error fetching Parent dashboard:', error);
        throw new Error('Failed to fetch Parent dashboard data');
    }
}

// Student Dashboard - Personal academic progress
export async function getStudentDashboard(userId: number, academicYearId?: number): Promise<any> {
    try {
        return {
            currentClass: 'Form 1',
            currentSubClass: 'Form 1A',
            totalSubjects: 8,
            completedExams: 12,
            hasPendingFees: false,
            disciplineIssues: 0
        };
    } catch (error) {
        console.error('Error fetching Student dashboard:', error);
        throw new Error('Failed to fetch Student dashboard data');
    }
}


