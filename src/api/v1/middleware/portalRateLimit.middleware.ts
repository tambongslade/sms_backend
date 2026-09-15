// src/api/v1/middleware/portalRateLimit.middleware.ts
//
// Rate limiter for the unauthenticated parent portal (`/parents/*`).
//
// The portal is gated only by knowledge of a child's matricule, which makes
// endpoints enumerable. This limiter caps each source IP to 60 requests per
// minute, killing brute-force matricule guessing while leaving legitimate
// parent traffic (multi-screen refreshes) unaffected.
//
// The school-wide `/parents/announcements` endpoint is exempt because it
// carries no matricule and is intentionally public.
import rateLimit from 'express-rate-limit';

export const portalRateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60,             // 60 requests per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    // Per-IP limit (default keyGenerator uses req.ip) so a single household
    // isn't throttled just because multiple parents share a matricule.
    keyGenerator: (req) => req.ip || 'unknown',
    // Skip the school-wide announcements endpoint (no matricule to guess).
    // The router is mounted at `/parents`, so `req.url` here is the path
    // relative to that mount point (e.g. "/announcements").
    skip: (req) => (req.url || '').split('?')[0] === '/announcements',
    handler: (_req, res) => {
        res.status(429).json({
            success: false,
            error: 'Too many requests. Please slow down.',
        });
    },
});

export default portalRateLimit;
