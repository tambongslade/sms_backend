// src/api/v1/middleware/portalAudit.middleware.ts
//
// Fire-and-forget audit logger for the unauthenticated parent portal.
//
// Emits a `[PORTAL]` line to stdout for every request hitting `/parents/*`,
// capturing enough context (timestamp, IP, method, path, matricule, UA) to
// support later fraud/abuse investigations. This is intentionally
// console-based for now; a dedicated DB table is a future task.
//
// The middleware never blocks the request — it logs synchronously (cheap)
// and immediately calls `next()`.
import { Request, Response, NextFunction } from 'express';

export function portalAudit(req: Request, _res: Response, next: NextFunction): void {
    try {
        const entry = {
            ts: new Date().toISOString(),
            ip: req.ip || 'unknown',
            method: req.method,
            path: req.url,
            matricule: req.params?.matricule ?? null,
            userAgent: req.get('user-agent') || null,
        };
        console.log('[PORTAL]', JSON.stringify(entry));
    } catch (err) {
        // Never let audit failure break the request.
        console.error('[PORTAL] audit log failed:', err);
    }
    next();
}

export default portalAudit;
