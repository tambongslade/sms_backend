// Keeps the photo files of the two servers the same.
//
// The database sync copies a student's photo *name* to the other server but not the picture itself, so a
// photo taken on the school server was blank online and the other way round. This copies the files:
//
//  - Both servers answer, behind the sync key: the list of their photo files (and of photos deleted there),
//    one file to download, one file to store, one file to delete.
//  - The server that runs the data sync (the school server: it can reach the online server, not the other
//    way round) compares the two lists every minute, copies what is missing on either side and deletes on
//    each side what was deleted on the other. A deleted photo is never copied back.
//
// Photo names are unique (student-<id>-<time>.jpg), so a file is never replaced, only added or deleted.

import express, { Router, Request, Response, NextFunction } from 'express';
import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import { PHOTO_DIRECTORIES } from '../utils/fileUpload';
import { deletedPhotoNames, recordPhotoDeletion } from '../utils/photoDeletions';

const DIRS: Record<string, string> = {
    students: PHOTO_DIRECTORIES.STUDENT_PHOTOS_DIR,
    users: PHOTO_DIRECTORIES.USER_PHOTOS_DIR,
};
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.(jpe?g|png|webp|gif)$/i;
const INTERVAL_MS = 60_000;
const MAX_TRANSFERS_PER_ROUND = 300;
/** A file changed this recently may still be being written: it waits for the next round. */
const SETTLE_MS = 30_000;

interface PhotoEntry {
    dir: string;
    name: string;
    size: number;
    /** Milliseconds since the file last changed. */
    ageMs: number;
}
interface PhotoList {
    files: PhotoEntry[];
    deleted: string[];
}

function listLocal(): PhotoList {
    const files: PhotoEntry[] = [];
    for (const [dir, abs] of Object.entries(DIRS)) {
        let names: string[] = [];
        try {
            names = fs.readdirSync(abs);
        } catch {
            continue;
        }
        for (const name of names) {
            if (!NAME.test(name)) continue;
            try {
                const st = fs.statSync(path.join(abs, name));
                if (st.isFile() && st.size > 0) files.push({ dir, name, size: st.size, ageMs: Math.max(0, Date.now() - st.mtimeMs) });
            } catch {
                /* removed meanwhile */
            }
        }
    }
    return { files, deleted: [...deletedPhotoNames()] };
}

/** Absolute path of a photo, or null if the folder or name is not acceptable. */
function photoPath(dir: string, name: string): string | null {
    const abs = DIRS[dir];
    if (!abs || !NAME.test(name)) return null;
    return path.join(abs, name);
}

/** Writes through a temporary file, so a half-received photo is never served. */
function writeAtomically(target: string, data: Buffer): void {
    const tmp = `${target}.${process.pid}.${Date.now()}.part`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
}

// ---------------------------------------------------------------- routes (both servers)

export function attachPhotoSyncRoutes(router: Router, requireSyncAuth: (req: Request, res: Response, next: NextFunction) => void) {
    router.get('/sync/photos/list', requireSyncAuth, (_req: Request, res: Response) => {
        res.json({ success: true, data: listLocal() });
    });

    router.get('/sync/photos/file/:dir/:name', requireSyncAuth, (req: Request, res: Response) => {
        const p = photoPath(req.params.dir, req.params.name);
        if (!p) return res.status(400).json({ success: false, error: 'Bad photo name' });
        if (!fs.existsSync(p)) return res.status(404).json({ success: false, error: 'No such photo' });
        const ext = path.extname(p).slice(1).toLowerCase();
        res.setHeader('Content-Type', ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg');
        fs.createReadStream(p)
            .on('error', () => res.destroy())
            .pipe(res as any);
    });

    router.put(
        '/sync/photos/file/:dir/:name',
        requireSyncAuth,
        (express as any).raw({ type: () => true, limit: '25mb' }),
        (req: Request, res: Response) => {
            const p = photoPath(req.params.dir, req.params.name);
            if (!p) return res.status(400).json({ success: false, error: 'Bad photo name' });
            if (deletedPhotoNames().has(req.params.name)) {
                return res.status(409).json({ success: false, error: 'This photo was deleted here' });
            }
            if (fs.existsSync(p)) return res.json({ success: true, data: { stored: false } });
            const body = req.body;
            if (!Buffer.isBuffer(body) || body.length === 0) {
                return res.status(400).json({ success: false, error: 'Empty photo' });
            }
            try {
                writeAtomically(p, body);
                res.json({ success: true, data: { stored: true } });
            } catch (err: any) {
                res.status(500).json({ success: false, error: err?.message || 'Could not store the photo' });
            }
        },
    );

    router.delete('/sync/photos/file/:dir/:name', requireSyncAuth, (req: Request, res: Response) => {
        const p = photoPath(req.params.dir, req.params.name);
        if (!p) return res.status(400).json({ success: false, error: 'Bad photo name' });
        recordPhotoDeletion(req.params.name);
        try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ success: false, error: err?.message || 'Could not delete the photo' });
        }
    });
}

// ---------------------------------------------------------------- client (the server that runs the sync)

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastErrorLogged = 0;

function peer(): AxiosInstance | null {
    const base = process.env.REMOTE_SYNC_URL || '';
    const key = process.env.SYNC_API_KEY || '';
    if (!base || !key) return null;
    return axios.create({
        baseURL: base,
        headers: { Authorization: `Bearer ${key}`, 'X-Server-ID': process.env.SERVER_ID || 'local' },
        timeout: 60_000,
        maxContentLength: 30 * 1024 * 1024,
        maxBodyLength: 30 * 1024 * 1024,
    });
}

export async function syncPhotosOnce(): Promise<{ pushed: number; pulled: number; deleted: number; failed: number }> {
    const api = peer();
    if (!api) return { pushed: 0, pulled: 0, deleted: 0, failed: 0 };

    const remote: PhotoList = (await api.get('/photos/list')).data?.data;
    if (!remote || !Array.isArray(remote.files)) throw new Error('unexpected photo list from the other server');
    const local = listLocal();

    const key = (e: { dir: string; name: string }) => `${e.dir}/${e.name}`;
    const localSet = new Set(local.files.map(key));
    const remoteSet = new Set(remote.files.map(key));
    const deleted = new Set([...local.deleted, ...(remote.deleted || [])]);
    const out = { pushed: 0, pulled: 0, deleted: 0, failed: 0 };
    let budget = MAX_TRANSFERS_PER_ROUND;

    // Deleted on either side: delete on both.
    for (const e of local.files) {
        if (!deleted.has(e.name) || budget-- <= 0) continue;
        const p = photoPath(e.dir, e.name);
        try {
            if (p && fs.existsSync(p)) fs.unlinkSync(p);
            recordPhotoDeletion(e.name);
            out.deleted++;
        } catch {
            out.failed++;
        }
    }
    for (const e of remote.files) {
        if (!deleted.has(e.name) || budget-- <= 0) continue;
        try {
            await api.delete(`/photos/file/${e.dir}/${encodeURIComponent(e.name)}`);
            out.deleted++;
        } catch {
            out.failed++;
        }
    }

    // Missing on the other server: send it.
    for (const e of local.files) {
        if (deleted.has(e.name) || remoteSet.has(key(e)) || e.ageMs < SETTLE_MS || budget-- <= 0) continue;
        const p = photoPath(e.dir, e.name);
        if (!p) continue;
        try {
            await api.put(`/photos/file/${e.dir}/${encodeURIComponent(e.name)}`, fs.readFileSync(p), {
                headers: { 'Content-Type': 'application/octet-stream' },
            });
            out.pushed++;
        } catch {
            out.failed++;
        }
    }

    // Missing here: fetch it.
    for (const e of remote.files) {
        if (deleted.has(e.name) || localSet.has(key(e)) || (e.ageMs ?? SETTLE_MS) < SETTLE_MS || budget-- <= 0) continue;
        const p = photoPath(e.dir, e.name);
        if (!p) continue;
        try {
            const res = await api.get(`/photos/file/${e.dir}/${encodeURIComponent(e.name)}`, { responseType: 'arraybuffer' });
            const data = Buffer.from(res.data);
            if (data.length === 0) throw new Error('empty');
            if (!fs.existsSync(p)) writeAtomically(p, data);
            out.pulled++;
        } catch {
            out.failed++;
        }
    }
    return out;
}

async function round(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const r = await syncPhotosOnce();
        if (r.pushed || r.pulled || r.deleted || r.failed) {
            console.log(`[PHOTO-SYNC] sent ${r.pushed}, received ${r.pulled}, deleted ${r.deleted}, failed ${r.failed}`);
        }
    } catch (err: any) {
        // The other server can be out of reach for hours (school internet): say so at most once an hour.
        if (Date.now() - lastErrorLogged > 3_600_000) {
            lastErrorLogged = Date.now();
            console.warn(`[PHOTO-SYNC] other server not reachable: ${err?.response?.status ?? ''} ${err?.message ?? err}`);
        }
    } finally {
        running = false;
    }
}

/** Starts the minute-by-minute photo sync; only where the data sync to the other server is set up. */
export function startPhotoSync(): void {
    if (timer || (process.env.PHOTO_SYNC || '').toLowerCase() === 'off') return;
    if (!process.env.REMOTE_SYNC_URL || !process.env.SYNC_API_KEY) return;
    console.log('[PHOTO-SYNC] started: photo files are kept the same on both servers');
    setTimeout(round, 20_000);
    timer = setInterval(round, INTERVAL_MS);
}

export function stopPhotoSync(): void {
    if (timer) clearInterval(timer);
    timer = null;
}
