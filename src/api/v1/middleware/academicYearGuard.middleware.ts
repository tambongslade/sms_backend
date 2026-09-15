import { Request, Response, NextFunction } from 'express';
import { getCurrentAcademicYear } from '../../../utils/academicYear';

const HISTORY_ROLES = new Set(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'BURSAR']);
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function extractProvidedYearId(req: Request): number | null {
    const sources: any[] = [req.body, (req as any).finalQuery, req.query, req.params];
    for (const src of sources) {
        if (!src) continue;
        const raw = src.academic_year_id ?? src.academicYearId;
        if (raw === undefined || raw === null || raw === '') continue;
        const parsed = parseInt(String(raw), 10);
        if (!isNaN(parsed)) return parsed;
    }
    return null;
}

export const academicYearGuard = async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return next();

    const providedId = extractProvidedYearId(req);
    if (providedId === null) return next();

    const current = await getCurrentAcademicYear();
    if (!current || providedId === current.id) return next();

    const roles: string[] = Array.isArray(user.role) ? user.role : [];
    const isWrite = !READ_METHODS.has(req.method);

    if (isWrite) {
        return res.status(403).json({
            success: false,
            error: `Modifications must target the current academic year (id=${current.id}). Provided: ${providedId}`,
        });
    }

    if (!roles.some(r => HISTORY_ROLES.has(r))) {
        return res.status(403).json({
            success: false,
            error: `Your role can only access the current academic year (id=${current.id}). Provided: ${providedId}`,
        });
    }

    next();
};
