import prisma from '../config/db';
import { Role } from '@prisma/client';

const STAFF_MATRICULE_PREFIX = 'SS';
const STUDENT_MATRICULE_PREFIX = 'SS'; // As per your format SS{YY}STD{NNN}
const STUDENT_TYPE_CODE = 'STD';

const POSITION_CODES = {
    SUPER_MANAGER: 'CEO',
    MANAGER: 'SA',
    PRINCIPAL: 'SA',
    VICE_PRINCIPAL: 'SA',
    BURSAR: 'SA',
    DEAN_OF_STUDIES: 'SA',
    DEAN_OF_DISCIPLINE: 'SA',
    DISCIPLINE_COORDINATOR: 'SA',
    SENIOR_DISCIPLINE_MASTER: 'SA',
    FEE_AUDITOR: 'SA',
    SECRETARY: 'SA',
    TEACHER: 'ST',
    HOD: 'ST',
    DISCIPLINE_MASTER: 'SO',
    GUIDANCE_COUNSELOR: 'SO',
    NURSE: 'SO',
    PARENT: 'SO'
};

// Defines the hierarchy for determining the matricule position code.
// Highest role in this list that the user has will determine the code.
const MATRICULE_ROLE_PRIORITY: Role[] = [
    Role.SUPER_MANAGER,            // CEO prefix
    Role.MANAGER,                  // SA prefix
    Role.PRINCIPAL,                // SA prefix
    Role.VICE_PRINCIPAL,           // SA prefix
    Role.DISCIPLINE_COORDINATOR,   // SA prefix - ranked above DoS/DoD as the discipline-side senior leadership seat
    Role.DEAN_OF_STUDIES,          // SA prefix
    Role.DEAN_OF_DISCIPLINE,       // SA prefix
    Role.SENIOR_DISCIPLINE_MASTER, // SA prefix
    Role.BURSAR,                   // SA prefix
    Role.FEE_AUDITOR,              // SA prefix
    Role.SECRETARY,                // SA prefix
    Role.TEACHER,                  // ST prefix
    Role.HOD,                      // ST prefix (Head of Department is teacher role)
    Role.DISCIPLINE_MASTER,        // SO prefix
    Role.GUIDANCE_COUNSELOR,       // SO prefix
    Role.NURSE,                    // SO prefix
    Role.PARENT                    // SO prefix
];

/**
 * Determines the position code based on user roles and hierarchy.
 * @param roles Array of user roles.
 * @returns The position code (CEO, SA, ST, SO).
 */
export function getPositionCodeForRoles(roles: Role[] | undefined | null): string {
    if (!roles || roles.length === 0) {
        return 'SO'; // Default fallback for users without roles
    }

    for (const priorityRole of MATRICULE_ROLE_PRIORITY) {
        if (roles.includes(priorityRole)) {
            switch (priorityRole) {
                case Role.SUPER_MANAGER:
                    return POSITION_CODES.SUPER_MANAGER;
                case Role.MANAGER:
                    return POSITION_CODES.MANAGER;
                case Role.PRINCIPAL:
                    return POSITION_CODES.PRINCIPAL;
                case Role.VICE_PRINCIPAL:
                    return POSITION_CODES.VICE_PRINCIPAL;
                case Role.BURSAR:
                    return POSITION_CODES.BURSAR;
                case Role.DEAN_OF_STUDIES:
                    return POSITION_CODES.DEAN_OF_STUDIES;
                case Role.DEAN_OF_DISCIPLINE:
                    return POSITION_CODES.DEAN_OF_DISCIPLINE;
                case Role.DISCIPLINE_COORDINATOR:
                    return POSITION_CODES.DISCIPLINE_COORDINATOR;
                case Role.SENIOR_DISCIPLINE_MASTER:
                    return POSITION_CODES.SENIOR_DISCIPLINE_MASTER;
                case Role.FEE_AUDITOR:
                    return POSITION_CODES.FEE_AUDITOR;
                case Role.SECRETARY:
                    return POSITION_CODES.SECRETARY;
                case Role.TEACHER:
                    return POSITION_CODES.TEACHER;
                case Role.HOD:
                    return POSITION_CODES.HOD;
                case Role.DISCIPLINE_MASTER:
                    return POSITION_CODES.DISCIPLINE_MASTER;
                case Role.GUIDANCE_COUNSELOR:
                    return POSITION_CODES.GUIDANCE_COUNSELOR;
                case Role.NURSE:
                    return POSITION_CODES.NURSE;
                case Role.PARENT:
                    return POSITION_CODES.PARENT;
            }
        }
    }
    // Default fallback if no roles match
    return 'SO';
}

/**
 * Generates the next sequence number for a staff matricule based on year and position.
 * @param yearLastTwoDigits YY (e.g., "23")
 * @param positionCode CEO, SA, ST, SO
 * @returns Next 4-digit sequence number (e.g., "0001")
 */
async function getNextStaffSequenceNumber(yearLastTwoDigits: string, positionCode: string): Promise<string> {
    const prefix = `${STAFF_MATRICULE_PREFIX}${yearLastTwoDigits}${positionCode}`;
    const lastUser = await prisma.user.findFirst({
        where: {
            matricule: {
                startsWith: prefix,
            },
        },
        orderBy: {
            matricule: 'desc',
        },
    });

    let nextNumber = 1;
    if (lastUser && lastUser.matricule) {
        try {
            const lastNumberStr = lastUser.matricule.substring(prefix.length);
            const lastNumber = parseInt(lastNumberStr, 10);
            if (!isNaN(lastNumber)) {
                nextNumber = lastNumber + 1;
            }
        } catch (e) {
            console.error(`Error parsing sequence number from matricule: ${lastUser.matricule}`, e);
            // Fallback to 1 or throw error
        }
    }

    if (nextNumber > 9999) {
        throw new Error(`Maximum matricule number (9999) reached for prefix ${prefix}`);
    }
    return nextNumber.toString().padStart(4, '0');
}

/**
 * Generates a new staff matricule.
 * SS{year}{position}{number}
 * @param roles Array of user roles.
 * @param customYear Optional: Full year (e.g., 2023). Defaults to current year.
 * @returns Generated staff matricule string.
 */
export async function generateStaffMatricule(roles: Role[], customYear?: number): Promise<string> {
    const year = customYear || new Date().getFullYear();
    const yearLastTwoDigits = year.toString().slice(-2);
    const positionCode = getPositionCodeForRoles(roles);
    const sequenceNumber = await getNextStaffSequenceNumber(yearLastTwoDigits, positionCode);
    return `${STAFF_MATRICULE_PREFIX}${yearLastTwoDigits}${positionCode}${sequenceNumber}`;
}

/**
 * Generates the next sequence number for a student matricule based on year.
 * @param yearLastTwoDigits YY (e.g., "23")
 * @returns Next 3-digit sequence number (e.g., "001")
 */
async function getNextStudentSequenceNumber(yearLastTwoDigits: string): Promise<string> {
    const prefix = `${STUDENT_MATRICULE_PREFIX}${yearLastTwoDigits}${STUDENT_TYPE_CODE}`;
    const lastStudent = await prisma.student.findFirst({
        where: {
            matricule: {
                startsWith: prefix,
            },
        },
        orderBy: {
            matricule: 'desc',
        },
    });

    let nextNumber = 1;
    if (lastStudent && lastStudent.matricule) {
        try {
            const lastNumberStr = lastStudent.matricule.substring(prefix.length);
            const lastNumber = parseInt(lastNumberStr, 10);
            if (!isNaN(lastNumber)) {
                nextNumber = lastNumber + 1;
            }
        } catch (e) {
            console.error(`Error parsing sequence number from student matricule: ${lastStudent.matricule}`, e);
        }
    }

    if (nextNumber > 999) {
        throw new Error(`Maximum student matricule number (999) reached for prefix ${prefix}`);
    }
    return nextNumber.toString().padStart(3, '0');
}

/**
 * Generates a new student matricule.
 * SS{YY}STD{NNN}
 * @param customYear Optional: Full year (e.g., 2023). Defaults to current year.
 * @returns Generated student matricule string.
 */
export async function generateStudentMatricule(customYear?: number): Promise<string> {
    const year = customYear || new Date().getFullYear();
    const yearLastTwoDigits = year.toString().slice(-2);
    const sequenceNumber = await getNextStudentSequenceNumber(yearLastTwoDigits);
    return `${STUDENT_MATRICULE_PREFIX}${yearLastTwoDigits}${STUDENT_TYPE_CODE}${sequenceNumber}`;
} 