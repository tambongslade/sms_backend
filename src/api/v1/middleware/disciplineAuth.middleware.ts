import { Request, Response, NextFunction } from 'express';
import prisma from '../../../config/db';
import { getAcademicYearId } from '../../../utils/academicYear';

// Roles whose reach covers all sub-classes for discipline operations.
// DISCIPLINE_MASTER is intentionally NOT in this set — it's the whole point of the middleware.
const DM_SCOPE_BYPASS_ROLES = new Set([
    'SUPER_MANAGER',
    'MANAGER',
    'PRINCIPAL',
    'VICE_PRINCIPAL',
    'SENIOR_DISCIPLINE_MASTER',
    'DEAN_OF_DISCIPLINE',
    'DISCIPLINE_COORDINATOR',
]);

function extractSubClassId(req: Request): number | null {
    const raw =
        (req.body && (req.body.sub_class_id ?? req.body.subClassId)) ??
        (req.query && (req.query.sub_class_id ?? req.query.subClassId)) ??
        (req.params && (req.params.subClassId ?? req.params.sub_class_id));
    if (raw === undefined || raw === null || raw === '') return null;
    const parsed = parseInt(raw as string, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Enforce that a DISCIPLINE_MASTER only touches sub-classes they've been assigned to via
 * RoleAssignment for the current academic year. Bypasses for admins/senior staff.
 */
export const validateDMSubClassAccess = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const user = req.user;
        if (!user) {
            res.status(401).json({ success: false, error: 'Unauthenticated' });
            return;
        }
        const roles: string[] = (user.role as any) || [];

        if (roles.some((r) => DM_SCOPE_BYPASS_ROLES.has(r))) {
            next();
            return;
        }

        if (!roles.includes('DISCIPLINE_MASTER')) {
            res.status(403).json({
                success: false,
                error: 'DISCIPLINE_MASTER role required',
            });
            return;
        }

        const subClassId = extractSubClassId(req);
        if (subClassId === null) {
            res.status(400).json({
                success: false,
                error: 'sub_class_id is required',
            });
            return;
        }

        const yearId = await getAcademicYearId();
        if (!yearId) {
            res.status(400).json({
                success: false,
                error: 'No current academic year is set',
            });
            return;
        }

        const assignment = await prisma.roleAssignment.findFirst({
            where: {
                user_id: user.id,
                role_type: 'DISCIPLINE_MASTER',
                sub_class_id: subClassId,
                academic_year_id: yearId,
            },
            select: { id: true },
        });

        if (!assignment) {
            res.status(403).json({
                success: false,
                error: 'Access denied: you are not assigned as Discipline Master of this sub-class for the current academic year',
            });
            return;
        }

        next();
    } catch (err: any) {
        console.error('validateDMSubClassAccess error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to validate DM sub-class access',
        });
    }
};

/**
 * Same enforcement as validateDMSubClassAccess, but the sub-class is resolved
 * indirectly by looking up an entity (e.g. StudentAbsence -> Enrollment -> sub_class).
 * Use for endpoints keyed by absence/enrollment ID.
 */
export const validateDMAccessForEnrollment = (
    resolveEnrollmentId: (req: Request) => Promise<number | null>
) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const user = req.user;
            if (!user) {
                res.status(401).json({ success: false, error: 'Unauthenticated' });
                return;
            }
            const roles: string[] = (user.role as any) || [];
            if (roles.some((r) => DM_SCOPE_BYPASS_ROLES.has(r))) {
                next();
                return;
            }
            if (!roles.includes('DISCIPLINE_MASTER')) {
                res.status(403).json({ success: false, error: 'DISCIPLINE_MASTER role required' });
                return;
            }

            const enrollmentId = await resolveEnrollmentId(req);
            if (!enrollmentId) {
                res.status(400).json({ success: false, error: 'Could not resolve enrollment' });
                return;
            }
            const enrollment = await prisma.enrollment.findUnique({
                where: { id: enrollmentId },
                select: { sub_class_id: true, academic_year_id: true },
            });
            if (!enrollment || !enrollment.sub_class_id) {
                res.status(404).json({ success: false, error: 'Enrollment not found or not assigned to a sub-class' });
                return;
            }

            const yearId = enrollment.academic_year_id;
            const assignment = await prisma.roleAssignment.findFirst({
                where: {
                    user_id: user.id,
                    role_type: 'DISCIPLINE_MASTER',
                    sub_class_id: enrollment.sub_class_id,
                    academic_year_id: yearId,
                },
                select: { id: true },
            });
            if (!assignment) {
                res.status(403).json({
                    success: false,
                    error: 'Access denied: you are not assigned as Discipline Master of this sub-class',
                });
                return;
            }
            next();
        } catch (err: any) {
            console.error('validateDMAccessForEnrollment error:', err);
            res.status(500).json({ success: false, error: 'Failed to validate DM enrollment access' });
        }
    };
};

/**
 * Resolver helpers for common cases.
 */
export const resolveEnrollmentIdFromAbsenceParam = async (req: Request): Promise<number | null> => {
    const absenceId = parseInt(req.params.id, 10);
    if (Number.isNaN(absenceId)) return null;
    const absence = await prisma.studentAbsence.findUnique({
        where: { id: absenceId },
        select: { enrollment_id: true },
    });
    return absence?.enrollment_id ?? null;
};
