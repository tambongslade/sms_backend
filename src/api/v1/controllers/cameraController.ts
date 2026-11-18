// Camera menu: live CCTV for the school's leadership (CAMERA_ROLES).
//
// A browser cannot send an Authorization header when it opens a WebSocket, so the page
// first asks for a stream ticket (a JWT valid for 2 minutes, good only for camera streams)
// and puts it in the stream URL. nginx calls `authorize` for every stream it is asked to
// open and only connects the viewer to go2rtc when this answers 204.
//
// The ticket is checked when a stream opens; a stream already playing keeps going after
// the ticket expires, the page simply gets a fresh ticket for the next one.

import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../../../config/db';
import { CAMERAS } from '../../../config/cameras';

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const TICKET_PURPOSE = 'camera-stream';
const TICKET_TTL_SECONDS = 120;
const STREAM_PATTERN = /^cam(\d{1,2})(_hd)?$/;

// Who may watch. Checked here rather than with authorize(): authorize() lets every
// MANAGER through anything, and this list must stay exactly what the school chose.
export const CAMERA_ROLES = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_DISCIPLINE'];

const mayWatch = (roles: unknown) => Array.isArray(roles) && roles.some(r => CAMERA_ROLES.includes(r));

/** GET /cameras: the channels to show. */
export const listCameras = (req: Request, res: Response) => {
    if (!mayWatch((req as any).user?.role)) {
        return res.status(403).json({ success: false, error: "You don't have permission to perform this action." });
    }
    res.json({ success: true, data: CAMERAS });
};

/** GET /cameras/stream-ticket: a short-lived ticket to open camera streams. */
export const getStreamTicket = (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!mayWatch(user?.role)) {
        return res.status(403).json({ success: false, error: "You don't have permission to perform this action." });
    }
    const ticket = jwt.sign({ id: user.id, purpose: TICKET_PURPOSE }, JWT_SECRET, { expiresIn: TICKET_TTL_SECONDS });
    res.json({ success: true, data: { ticket, expiresIn: TICKET_TTL_SECONDS } });
};

/**
 * GET /cameras/authorize: nginx auth_request target, never called by the browser.
 * nginx passes the stream URL the viewer asked for in X-Original-URI. 204 = let it through.
 */
export const authorizeStream = async (req: Request, res: Response) => {
    try {
        const original = new URL(String(req.headers['x-original-uri'] || ''), 'http://local');
        const src = original.searchParams.get('src') || '';
        const ticket = original.searchParams.get('ticket') || '';

        const match = STREAM_PATTERN.exec(src);
        if (!match || !CAMERAS.some(c => c.channel === Number(match[1]))) return res.status(403).end();
        if (!ticket) return res.status(401).end();

        const payload = jwt.verify(ticket, JWT_SECRET) as { id?: number; purpose?: string };
        if (payload.purpose !== TICKET_PURPOSE || !payload.id) return res.status(401).end();

        // Re-read the account: a ticket must not outlive a removed role or a disabled account.
        const user = await prisma.user.findUnique({
            where: { id: payload.id },
            select: { status: true, user_roles: { select: { role: true } } },
        });
        if (!user || user.status !== 'ACTIVE') return res.status(401).end();
        if (!mayWatch(user.user_roles.map(r => r.role as string))) return res.status(403).end();

        return res.status(204).end();
    } catch {
        return res.status(401).end();
    }
};
