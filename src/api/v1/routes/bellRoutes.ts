/**
 * School bell: lets the Super Manager control the ESP8266 bell module ("alarme-ecole") from the SMS.
 *
 *   browser --> this backend --http--> bell module on the school network (default http://192.168.88.115)
 *
 * The module only lives on the school network, so this works on the school server. Elsewhere (the online server)
 * the module cannot be reached and every call answers 503 with a clear message.
 *
 * Env: BELL_MODULE_URL (default http://192.168.88.115), BELL_MODULE_TIMEOUT_MS (default 4000).
 *
 * Module API used: GET /etat, GET|POST /horaires (text, one bell per line "HH:MM|days|seconds|label", days bit0 = Monday),
 * POST /config (activees, broche, actifBas), POST /heure?t=<epoch>, POST /sonner?s=<1..60>, POST /arreter.
 */
import { Router, Request, Response } from 'express';
import axios, { AxiosError } from 'axios';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

const MODULE_URL = (process.env.BELL_MODULE_URL || 'http://192.168.88.115').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.BELL_MODULE_TIMEOUT_MS) || 4000;
const MAX_BELLS = 40; // the module's own limit
const LABEL_BYTES = 39; // the module keeps 39 bytes of a label
// "Hold to ring": each heartbeat rings for this long, so the bell stops on its own if the release never arrives.
const HOLD_SECONDS = 3;

type ModuleState = {
    heureValide: boolean;
    heure: string;
    date: string;
    source: string;
    sonne: boolean;
    libelle: string;
    prochaine: string;
    activees: boolean;
    broche: number;
    actifBas: boolean;
    lcd: string;
    ip: string;
    rssi: number;
};

type Bell = { time: string; days: number[]; seconds: number; label: string };

const client = axios.create({ baseURL: MODULE_URL, timeout: TIMEOUT_MS });

const post = (path: string, params?: Record<string, string | number>) =>
    client.post<ModuleState>(path, null, { params }).then((r) => r.data);

// Days bitmask (bit0 = Monday ... bit6 = Sunday) <-> [1..7] (1 = Monday)
const daysFromMask = (mask: number) => [1, 2, 3, 4, 5, 6, 7].filter((d) => mask & (1 << (d - 1)));
const maskFromDays = (days: number[]) => days.reduce((m, d) => m | (1 << (d - 1)), 0);

const parseSchedule = (text: string): Bell[] =>
    text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
            const [time, days, seconds, ...label] = line.split('|');
            return { time, days: daysFromMask(Number(days)), seconds: Number(seconds), label: label.join('|') };
        });

const truncateBytes = (s: string, max: number) => {
    let out = '';
    for (const ch of s) {
        if (Buffer.byteLength(out + ch) > max) break;
        out += ch;
    }
    return out;
};

// Returns an error message, or null when the list is valid.
const validateBells = (bells: unknown): string | null => {
    if (!Array.isArray(bells)) return 'bells must be a list';
    if (bells.length > MAX_BELLS) return `The module holds at most ${MAX_BELLS} bells`;
    for (const [i, b] of bells.entries()) {
        const n = `Bell ${i + 1}`;
        if (!b || typeof b !== 'object') return `${n} is invalid`;
        const { time, days, seconds, label } = b as Bell;
        const m = /^(\d{2}):(\d{2})$/.exec(String(time));
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return `${n}: time must be HH:MM`;
        if (!Array.isArray(days) || days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7))
            return `${n}: choose at least one day`;
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) return `${n}: duration must be 1 to 120 seconds`;
        if (typeof label !== 'string') return `${n}: label is invalid`;
    }
    return null;
};

const toLine = (b: Bell) =>
    `${b.time}|${maskFromDays(b.days)}|${b.seconds}|${truncateBytes(b.label.replace(/[|\r\n"]/g, ' ').trim(), LABEL_BYTES)}`;

const fail = (res: Response, error: unknown) => {
    const e = error as AxiosError;
    if (e.isAxiosError && !e.response) {
        return res.status(503).json({
            success: false,
            reachable: false,
            error: `The bell module (${MODULE_URL}) cannot be reached from this server. It can only be controlled from the school server, on the school network.`,
        });
    }
    if (e.isAxiosError && e.response) {
        return res.status(502).json({ success: false, error: `The bell module answered: ${String(e.response.data || e.response.status)}` });
    }
    return res.status(500).json({ success: false, error: (error as Error)?.message || 'Bell error' });
};

const guard = [authenticate, authorize([Role.SUPER_MANAGER])];

// GET /bell - module state + schedule
router.get('/', ...guard, async (_req: Request, res: Response) => {
    try {
        const [state, schedule] = await Promise.all([
            client.get<ModuleState>('/etat').then((r) => r.data),
            client.get<string>('/horaires', { responseType: 'text' }).then((r) => r.data),
        ]);
        res.json({ success: true, data: { moduleUrl: MODULE_URL, serverTime: new Date().toISOString(), state, bells: parseSchedule(schedule) } });
    } catch (error) {
        fail(res, error);
    }
});

// PUT /bell/schedule { bells: Bell[] } - replaces the whole schedule (saved on the module)
router.put('/schedule', ...guard, async (req: Request, res: Response) => {
    const bells = req.body?.bells;
    const invalid = validateBells(bells);
    if (invalid) return res.status(400).json({ success: false, error: invalid });
    const sorted = [...(bells as Bell[])].sort((a, b) => a.time.localeCompare(b.time));
    try {
        const saved = await client
            .post<string>('/horaires', sorted.map(toLine).join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' }, responseType: 'text' })
            .then((r) => Number(r.data));
        if (saved !== sorted.length) {
            return res.status(502).json({ success: false, error: `The module kept ${saved} of ${sorted.length} bells` });
        }
        res.json({ success: true, data: { saved } });
    } catch (error) {
        fail(res, error);
    }
});

// PUT /bell/config { enabled?, pin? (0..8 = D0..D8), activeLow? }
router.put('/config', ...guard, async (req: Request, res: Response) => {
    const { enabled, pin, activeLow } = req.body || {};
    const params: Record<string, string | number> = {};
    if (enabled !== undefined) {
        if (typeof enabled !== 'boolean') return res.status(400).json({ success: false, error: 'enabled must be true or false' });
        params.activees = enabled ? 1 : 0;
    }
    if (pin !== undefined) {
        if (!Number.isInteger(pin) || pin < 0 || pin > 8) return res.status(400).json({ success: false, error: 'pin must be 0 to 8 (D0 to D8)' });
        params.broche = pin;
    }
    if (activeLow !== undefined) {
        if (typeof activeLow !== 'boolean') return res.status(400).json({ success: false, error: 'activeLow must be true or false' });
        params.actifBas = activeLow ? 1 : 0;
    }
    if (Object.keys(params).length === 0) return res.status(400).json({ success: false, error: 'Nothing to change' });
    try {
        res.json({ success: true, data: await post('/config', params) });
    } catch (error) {
        fail(res, error);
    }
});

// POST /bell/clock - sets the module's clock to this server's time
router.post('/clock', ...guard, async (_req: Request, res: Response) => {
    try {
        res.json({ success: true, data: await post('/heure', { t: Math.floor(Date.now() / 1000) }) });
    } catch (error) {
        fail(res, error);
    }
});

// POST /bell/ring { seconds? } - rings once for 1..60 s
router.post('/ring', ...guard, async (req: Request, res: Response) => {
    const seconds = req.body?.seconds ?? 5;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) {
        return res.status(400).json({ success: false, error: 'seconds must be 1 to 60' });
    }
    try {
        res.json({ success: true, data: await post('/sonner', { s: seconds }) });
    } catch (error) {
        fail(res, error);
    }
});

// POST /bell/hold - "hold to ring" heartbeat: the page sends it while the button is held; each one rings HOLD_SECONDS
router.post('/hold', ...guard, async (_req: Request, res: Response) => {
    try {
        res.json({ success: true, data: await post('/sonner', { s: HOLD_SECONDS }) });
    } catch (error) {
        fail(res, error);
    }
});

// POST /bell/stop - stops the bell now
router.post('/stop', ...guard, async (_req: Request, res: Response) => {
    try {
        res.json({ success: true, data: await post('/arreter') });
    } catch (error) {
        fail(res, error);
    }
});

export default router;
