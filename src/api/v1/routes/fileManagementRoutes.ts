/**
 * File Management: the LAN file-sharing app, opened from inside the SMS.
 *
 * The file app (C:\Users\ADMIN\lan-share, a separate Node process on the school server) does not know SMS passwords.
 * This router sits in front of it:
 *
 *   POST /session   (Bearer token)  -> the SMS login is checked, the person's role is turned into a file profile, and a
 *                                      one-minute signed ticket is returned as a URL.
 *   GET  /open?t=   (the iframe)    -> the ticket is exchanged for an HttpOnly session cookie scoped to this path.
 *   ANY  /app/*     (cookie)        -> proxied to the file app with a signed X-SMS-Identity header. The file app trusts
 *                                      that header only when its HMAC matches the shared FILE_APP_SECRET.
 *
 * An iframe cannot send an Authorization header, which is why the cookie exists. It is mounted BEFORE express.json()
 * and the case-conversion middleware (see app.ts) so uploads stream through untouched.
 *
 * Two ways to run the file app, chosen by FILE_APP_URL:
 *   - FILE_APP_URL set   -> proxy to that separate process (the school server: the standalone app that the LAN PCs also use).
 *   - FILE_APP_URL empty -> EMBEDDED: the same file app runs inside this backend (src/filemanagement), storing its files on
 *                           this server's disk. No second process and no tunnel (the online server).
 *
 * Env: FILE_APP_SECRET (signs the identity this router hands to the file app; in proxy mode it must equal the file app's
 * sms-secret.txt). Embedded mode also reads FILE_APP_DIR (data root, default <cwd>/data/file-management),
 * FILE_APP_ARCHIVE_DIR, FILE_APP_TEMP_DIR, FILE_APP_MAX_MB (default 32) and FILE_APP_RETENTION_DAYS (default 7).
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { authenticate } from '../middleware/auth.middleware';
import prisma from '../../../config/db';

const router = Router();

const MOUNT = '/api/v1/file-management';
const COOKIE = 'fm_session';
const TICKET_MS = 60 * 1000;
const SESSION_MS = 8 * 60 * 60 * 1000;

const secret = () => process.env.FILE_APP_SECRET || '';
const embedded = () => !process.env.FILE_APP_URL;
const fileAppUrl = () => new URL(process.env.FILE_APP_URL || 'http://127.0.0.1:8080');

// SMS role -> file profile. PARENT (and STUDENT) are absent on purpose: no access.
const ROLE_PROFILE: Record<string, string> = {
    SUPER_MANAGER: 'management',
    MANAGER: 'management',
    PRINCIPAL: 'administration',
    VICE_PRINCIPAL: 'administration',
    DEAN_OF_STUDIES: 'administration',
    HOD: 'administration',
    FEE_AUDITOR: 'administration',
    GUIDANCE_COUNSELOR: 'administration',
    SECRETARY: 'administration',
    CONTROLLER: 'administration',
    BURSAR: 'administration',
    NURSE: 'administration',
    DISCIPLINE_MASTER: 'discipline',
    SENIOR_DISCIPLINE_MASTER: 'discipline',
    DEAN_OF_DISCIPLINE: 'discipline',
    DISCIPLINE_COORDINATOR: 'discipline',
    TEACHER: 'default',
};
const RANK = ['default', 'discipline', 'administration', 'management'];
// SMS roles that manage ARCHIVES (move/copy files, create folders). On the school server this is decided by the server PC.
const MANAGER_ROLES = new Set(['SUPER_MANAGER', 'MANAGER']);

/**
 * The file profile for a set of SMS roles, or null when the person gets no access (parents/students only).
 * A person with several roles gets the best profile; a role that is not in the table still gets Default,
 * so a role added to the SMS later never locks its owner out.
 */
export function profileForRoles(roles: string[]): string | null {
    const list = [...new Set((roles || []).filter(Boolean))];
    if (list.length && list.every((r) => r === 'PARENT' || r === 'STUDENT')) return null;
    const mapped = list.map((r) => ROLE_PROFILE[r]).filter(Boolean);
    if (!mapped.length) return 'default';
    return mapped.sort((a, b) => RANK.indexOf(b) - RANK.indexOf(a))[0];
}

const sign = (data: string) => crypto.createHmac('sha256', secret()).update(data).digest('hex');
const seal = (obj: object) => {
    const data = Buffer.from(JSON.stringify(obj)).toString('base64url');
    return `${data}.${sign(data)}`;
};
function unseal(token: string, type: 't' | 's'): { uid: number; name: string; profile: string; page?: string; mgr?: boolean } | null {
    if (!secret() || !token) return null;
    const [data, sig] = String(token).split('.');
    if (!data || !sig) return null;
    const a = Buffer.from(sig);
    const b = Buffer.from(sign(data));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const o = JSON.parse(Buffer.from(data, 'base64url').toString());
        return o.typ === type && o.exp > Date.now() && o.uid ? o : null;
    } catch {
        return null;
    }
}

function cookieValue(req: Request, name: string): string {
    for (const part of String(req.headers.cookie || '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return '';
}

const isHttps = (req: Request) => (req as any).secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

// The project's express typings (src/types/global.d.ts) are a minimal shim, so only json/status/send/writeHead are typed.
const html = (res: Response, code: number, body: string) => {
    res.status(code);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(body);
};
const redirect = (res: Response, code: number, to: string) => {
    res.writeHead(code, { Location: to });
    res.end();
};
const NOTE = (msg: string) => `<p style="font-family:sans-serif">${msg}</p>`;

// ---- 1. ticket ----
router.post('/session', authenticate, async (req: Request, res: Response) => {
    if (!secret()) {
        res.status(503).json({ success: false, error: 'File Management is not set up on this server.' });
        return;
    }
    try {
        const roles = ((req.user as any)?.role as string[]) || [];
        const profile = profileForRoles(roles);
        if (!profile) {
            res.status(403).json({ success: false, error: 'Your account does not have access to File Management.' });
            return;
        }
        const user = await prisma.user.findUnique({ where: { id: (req.user as any).id }, select: { name: true } });
        // ?page=archives opens the ARCHIVES explorer directly (the "Archives" menu entry); anything else opens file sharing
        const page = String((req as any).query?.page || '') === 'archives' ? 'archives' : 'files';
        const mgr = roles.some((r) => MANAGER_ROLES.has(r));
        const ticket = seal({ typ: 't', uid: (req.user as any).id, name: user?.name || 'User', profile, page, mgr, exp: Date.now() + TICKET_MS });
        res.json({ success: true, data: { url: `${MOUNT}/open?t=${encodeURIComponent(ticket)}` } });
    } catch (e) {
        console.error('File Management session error:', e);
        res.status(500).json({ success: false, error: 'Could not open File Management.' });
    }
});

// ---- 2. ticket -> cookie ----
router.get('/open', (req: Request, res: Response) => {
    const who = unseal(String(req.query.t || ''), 't');
    if (!who) {
        html(res, 401, NOTE('This link has expired. Close this page and open File Management again.'));
        return;
    }
    const session = seal({ typ: 's', uid: who.uid, name: who.name, profile: who.profile, mgr: !!who.mgr, exp: Date.now() + SESSION_MS });
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(session)}; Path=${MOUNT}; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${isHttps(req) ? '; Secure' : ''}`);
    redirect(res, 302, `${MOUNT}/app/${who.page === 'archives' ? 'archives' : ''}?embed=1`);
});

// ---- 3. proxy to the file app ----
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const DROP_REQ = new Set(['host', 'cookie', 'authorization', 'x-forwarded-for', 'x-sms-identity', 'x-sms-signature']);

// ---- embedded file app (no separate process, no tunnel) ----
let embeddedShare: any = null;
function getEmbedded() {
    if (embeddedShare) return embeddedShare;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createLanShare } = require('../../../filemanagement/lanShare');
    const root = path.resolve(process.env.FILE_APP_DIR || path.join(process.cwd(), 'data', 'file-management'));
    const archiveDir = path.resolve(process.env.FILE_APP_ARCHIVE_DIR || path.join(root, 'archives'));
    fs.mkdirSync(archiveDir, { recursive: true });
    // First start: the same top-level ARCHIVES folders the school server has. Folders with a rule (MANAGEMENT DOCUMENTS,
    // ADMINISTRATIVE DOCUMENTS, DISCIPLINE) are only visible to the matching profiles.
    if (fs.readdirSync(archiveDir).length === 0) {
        for (const f of ['ADMINISTRATIVE DOCUMENTS', 'DISCIPLINE', 'MANAGEMENT DOCUMENTS', 'PICTURES', 'VIDEOS']) fs.mkdirSync(path.join(archiveDir, f), { recursive: true });
    }
    embeddedShare = createLanShare({
        dir: path.join(root, 'data'),
        archiveDir,
        tempDir: path.resolve(process.env.FILE_APP_TEMP_DIR || path.join(root, 'transfers')),
        maxBytes: (Number(process.env.FILE_APP_MAX_MB) || 32) * 1024 * 1024,
        retentionDays: process.env.FILE_APP_RETENTION_DAYS === undefined ? 7 : Number(process.env.FILE_APP_RETENTION_DAYS),
        trustProxy: true,
        smsSecret: secret(),
        smsOnly: true,        // nothing here ever acts as the "server PC": every request carries a signed SMS identity
        adminPassword: '',
    });
    return embeddedShare;
}

router.use('/app', (req: Request, res: Response) => {
    const rest = String((req as any).originalUrl).slice((MOUNT + '/app').length);   // '', '?x', '/', '/api/events?device=..'
    if (rest === '' || rest.startsWith('?')) {
        redirect(res, 301, `${MOUNT}/app/${rest}`);
        return;
    }
    const who = unseal(cookieValue(req, COOKIE), 's');
    if (!who) {
        html(res, 401, NOTE('Your File Management session has expired. Close this page and open File Management again from the menu.'));
        return;
    }

    const identity = Buffer.from(JSON.stringify({ uid: who.uid, name: who.name, profile: who.profile, mgr: !!who.mgr, ts: Date.now() })).toString('base64url');

    if (embedded()) {
        try {
            const r: any = req;
            r.headers['x-forwarded-for'] = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop()!.trim();
            r.headers['x-forwarded-proto'] = isHttps(req) ? 'https' : 'http';
            r.headers['x-sms-identity'] = identity;
            r.headers['x-sms-signature'] = sign(identity);
            r.url = rest;
            res.setHeader('X-Accel-Buffering', 'no');   // nginx: do not buffer the live-update stream or downloads
            Promise.resolve(getEmbedded()(r, res, () => { if (!res.headersSent) html(res, 404, NOTE('Not found.')); })).catch((e: any) => {
                console.error('File Management (embedded) error:', e);
                if (!res.headersSent) html(res, 500, NOTE('File Management hit a problem. Try again in a moment.'));
                else res.end();
            });
        } catch (e) {
            console.error('File Management (embedded) could not start:', e);
            html(res, 503, NOTE('File Management is not available right now. Try again in a moment.'));
        }
        return;
    }

    const target = fileAppUrl();
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && !DROP_REQ.has(k) && v !== undefined) headers[k] = v;
    headers.host = target.host;
    headers['x-forwarded-for'] = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop()!.trim();   // the address our own front end saw
    headers['x-forwarded-proto'] = isHttps(req) ? 'https' : 'http';
    headers['x-sms-identity'] = identity;
    headers['x-sms-signature'] = sign(identity);

    const up = http.request({ hostname: target.hostname, port: target.port || 80, path: rest, method: req.method, headers }, (ur) => {
        const out: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(ur.headers)) if (!HOP.has(k) && v !== undefined) out[k] = v;
        res.writeHead(ur.statusCode || 502, out);
        ur.pipe(res);                                  // streams, so live notifications (SSE) and downloads are not buffered
    });
    up.on('error', () => {
        if (!res.headersSent) html(res, 502, NOTE('File Management is not available right now. Try again in a moment.'));
        else res.end();
    });
    res.on('close', () => up.destroy());
    req.pipe(up);
});

export default router;
