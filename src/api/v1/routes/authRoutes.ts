import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticate } from '../middleware/auth.middleware';
import { authAuditMiddleware } from '../middleware/auditTrail.middleware';

// Swagger documentation can be found in src/config/swagger/docs/authDocs.ts

const router = Router();

// POST /auth/login - Authenticate user and get token
router.post('/login', authAuditMiddleware, authController.login);

// POST /auth/register - Register a new user
router.post('/register', authController.register);

// POST /auth/logout - Invalidate a user's token
router.post('/logout', authenticate, authAuditMiddleware, authController.logout);

// POST /auth/change-password - Change the authenticated user's password
router.post('/change-password', authenticate, authAuditMiddleware, authController.changePassword);

// GET /auth/me - Get current user's profile
router.get('/me', authenticate, authController.getProfile);

// POST /auth/session-note - the app reports why it ended (or kept) a session after a 401.
// No auth on purpose (the token may be the problem); it only writes one log line.
const noteHits = new Map<string, { n: number; reset: number }>();
router.post('/session-note', (req, res) => {
    const ip = String(req.ip || '');
    const now = Date.now();
    const hit = noteHits.get(ip);
    if (!hit || hit.reset < now) noteHits.set(ip, { n: 1, reset: now + 60_000 });
    else if (++hit.n > 30) return res.status(204).end();
    if (noteHits.size > 5000) noteHits.clear();

    const clip = (v: unknown, max: number) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);
    const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');
    let claims: { id?: number; exp?: number } | null = null;
    try { claims = bearer ? JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()) : null; } catch { /* not a JWT */ }
    const b = req.body || {};
    console.warn(
        `[SESSION-NOTE] action=${clip(b.action, 12)} user=${claims?.id ?? '-'} ` +
        `tokenExp=${claims?.exp ? new Date(claims.exp * 1000).toISOString() : '-'} ` +
        `endpoint=${clip(b.endpoint, 120)} server="${clip(b.message, 120)}" ` +
        `page=${clip(b.page, 80)} app=${clip(b.app, 12)}`
    );
    res.status(204).end();
});

export default router;
