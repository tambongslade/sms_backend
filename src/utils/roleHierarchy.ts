import { Role } from '@prisma/client';

export enum RoleTier {
    EXECUTIVE = 1,        // SUPER_MANAGER, MANAGER
    HEAD_OF_SCHOOL = 2,   // PRINCIPAL
    SENIOR_LEADERSHIP = 3,// VP, BURSAR, SECRETARY, DISCIPLINE_COORDINATOR
    DEPT_HEAD = 4,        // DOS, DOD, SDM, HOD
    FIELD_STAFF = 5,      // TEACHER, DM, NURSE, FEE_AUDITOR, GUIDANCE_COUNSELOR, CONTROLLER
    EXTERNAL = 6,         // PARENT
}

export const ROLE_TIER: Record<Role, RoleTier> = {
    SUPER_MANAGER: RoleTier.EXECUTIVE,
    MANAGER: RoleTier.EXECUTIVE,

    PRINCIPAL: RoleTier.HEAD_OF_SCHOOL,

    VICE_PRINCIPAL: RoleTier.SENIOR_LEADERSHIP,
    BURSAR: RoleTier.SENIOR_LEADERSHIP,
    SECRETARY: RoleTier.SENIOR_LEADERSHIP,
    DISCIPLINE_COORDINATOR: RoleTier.SENIOR_LEADERSHIP,

    CONTROLLER: RoleTier.FIELD_STAFF,

    DEAN_OF_STUDIES: RoleTier.DEPT_HEAD,
    DEAN_OF_DISCIPLINE: RoleTier.DEPT_HEAD,
    SENIOR_DISCIPLINE_MASTER: RoleTier.DEPT_HEAD,
    HOD: RoleTier.DEPT_HEAD,

    TEACHER: RoleTier.FIELD_STAFF,
    DISCIPLINE_MASTER: RoleTier.FIELD_STAFF,
    NURSE: RoleTier.FIELD_STAFF,
    FEE_AUDITOR: RoleTier.FIELD_STAFF,
    GUIDANCE_COUNSELOR: RoleTier.FIELD_STAFF,

    PARENT: RoleTier.EXTERNAL,
};

// Direct report-to relationship. null = top of chain.
export const ROLE_PARENT: Record<Role, Role | null> = {
    SUPER_MANAGER: null,
    MANAGER: null,

    PRINCIPAL: 'SUPER_MANAGER',

    VICE_PRINCIPAL: 'PRINCIPAL',
    BURSAR: 'PRINCIPAL',
    SECRETARY: 'PRINCIPAL',
    DISCIPLINE_COORDINATOR: 'PRINCIPAL', // reports directly to PRINCIPAL — parallel to VP but scoped to the discipline chain

    DEAN_OF_STUDIES: 'VICE_PRINCIPAL',
    DEAN_OF_DISCIPLINE: 'VICE_PRINCIPAL',
    SENIOR_DISCIPLINE_MASTER: 'DEAN_OF_DISCIPLINE',
    HOD: 'DEAN_OF_STUDIES',

    TEACHER: 'HOD',
    DISCIPLINE_MASTER: 'SENIOR_DISCIPLINE_MASTER',
    FEE_AUDITOR: 'BURSAR',
    CONTROLLER: 'PRINCIPAL', // reports directly to PRINCIPAL — independence from BURSAR is required for the four-eyes audit
    NURSE: 'PRINCIPAL',
    GUIDANCE_COUNSELOR: 'PRINCIPAL', // provisional — GC scope is TBD

    PARENT: null,
};

export enum Department {
    ACADEMIC = 'ACADEMIC',
    DISCIPLINE = 'DISCIPLINE',
    FINANCE = 'FINANCE',
    WELFARE = 'WELFARE',
    FRONT_OFFICE = 'FRONT_OFFICE',
    EXECUTIVE = 'EXECUTIVE',
    EXTERNAL = 'EXTERNAL',
}

export const ROLE_DEPARTMENT: Record<Role, Department> = {
    SUPER_MANAGER: Department.EXECUTIVE,
    MANAGER: Department.EXECUTIVE,
    PRINCIPAL: Department.EXECUTIVE,

    DEAN_OF_STUDIES: Department.ACADEMIC,
    HOD: Department.ACADEMIC,
    TEACHER: Department.ACADEMIC,

    DEAN_OF_DISCIPLINE: Department.DISCIPLINE,
    DISCIPLINE_COORDINATOR: Department.DISCIPLINE,
    SENIOR_DISCIPLINE_MASTER: Department.DISCIPLINE,
    DISCIPLINE_MASTER: Department.DISCIPLINE,

    BURSAR: Department.FINANCE,
    FEE_AUDITOR: Department.FINANCE,
    CONTROLLER: Department.FINANCE,

    NURSE: Department.WELFARE,
    GUIDANCE_COUNSELOR: Department.WELFARE,

    VICE_PRINCIPAL: Department.FRONT_OFFICE,
    SECRETARY: Department.FRONT_OFFICE,

    PARENT: Department.EXTERNAL,
};

// Roles a PARENT is allowed to message directly (via the /chat DM system + parent directory).
// Extended 2026-07-21 to include HOD, VICE_PRINCIPAL, DEAN_OF_STUDIES per product requirement:
// parents can now reach any Head of Department through the subject directory.
export const PARENT_CONTACTABLE_ROLES: Role[] = [
    'TEACHER',
    'HOD',
    'BURSAR',
    'VICE_PRINCIPAL',
    'DEAN_OF_STUDIES',
    'GUIDANCE_COUNSELOR', // operational TBD — still listed so the rule is in one place
    'PRINCIPAL',
];

const ADMIN_TIERS = new Set<RoleTier>([
    RoleTier.EXECUTIVE,
    RoleTier.HEAD_OF_SCHOOL,
    RoleTier.SENIOR_LEADERSHIP,
]);

const STAFF_TIERS = new Set<RoleTier>([
    RoleTier.DEPT_HEAD,
    RoleTier.FIELD_STAFF,
]);

export function getTier(role: Role): RoleTier {
    return ROLE_TIER[role];
}

// Lower tier number = higher authority. outranks('PRINCIPAL', 'TEACHER') === true
export function outranks(a: Role, b: Role): boolean {
    return ROLE_TIER[a] < ROLE_TIER[b];
}

export function outranksOrEqual(a: Role, b: Role): boolean {
    return ROLE_TIER[a] <= ROLE_TIER[b];
}

export function sameTier(a: Role, b: Role): boolean {
    return ROLE_TIER[a] === ROLE_TIER[b];
}

// Walk up the reporting chain. Includes the role itself.
export function getReportingChain(role: Role): Role[] {
    const chain: Role[] = [role];
    let current: Role | null = ROLE_PARENT[role];
    while (current) {
        chain.push(current);
        current = ROLE_PARENT[current];
    }
    return chain;
}

export function getAllRoles(): Role[] {
    return Object.keys(ROLE_TIER) as Role[];
}

export function getRolesAtOrAbove(tier: RoleTier): Role[] {
    return getAllRoles().filter(r => ROLE_TIER[r] <= tier);
}

export function getRolesAtTier(tier: RoleTier): Role[] {
    return getAllRoles().filter(r => ROLE_TIER[r] === tier);
}

export function getRolesInDepartment(department: Department): Role[] {
    return getAllRoles().filter(r => ROLE_DEPARTMENT[r] === department);
}

export function isAdminRole(role: Role): boolean {
    return ADMIN_TIERS.has(ROLE_TIER[role]);
}

export function isStaffRole(role: Role): boolean {
    return STAFF_TIERS.has(ROLE_TIER[role]);
}

// Highest-ranking role from a list (lowest tier number). null if empty.
export function highestRole(roles: Role[]): Role | null {
    if (roles.length === 0) return null;
    return roles.reduce((best, r) => (ROLE_TIER[r] < ROLE_TIER[best] ? r : best));
}

// Convenience: does this set of user roles meet the minimum tier?
export function userHasMinTier(userRoles: Role[], minTier: RoleTier): boolean {
    return userRoles.some(r => ROLE_TIER[r] <= minTier);
}
