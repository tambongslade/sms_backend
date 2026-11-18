/**
 * Administrators' assiduity / punctuality (Discipline Coordinator).
 *
 *   GET  /admin-attendance/personnel                 the assiduity list (+ who was taken off it)
 *   PUT  /admin-attendance/personnel/:userId         add someone / set their post / take them off ({ post?, included })
 *   GET  /admin-attendance/users?search=             staff to add to the list
 *   GET  /admin-attendance/day?date=YYYY-MM-DD       the list with that day's status + arrival time
 *   PUT  /admin-attendance/day                       { date, entries: [{ userId, status|null, arrivalTime?, note? }] }
 *   GET  /admin-attendance/report?from=&to=          arrival times per person per day (the weekly report)
 *
 * Users holding an administrator role are on the list automatically; AdminAttendanceMember
 * rows add other staff, override the post, or take someone off.
 */
import { Router, Request, Response } from 'express';
import prisma from '../../../config/db';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

const WRITERS = ['DISCIPLINE_COORDINATOR'];
const READERS = ['DISCIPLINE_COORDINATOR', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_DISCIPLINE'];

// Administrator roles that put someone on the list, with the post shown on the report.
export const ADMIN_ROLE_POSTS: Record<string, string> = {
    VICE_PRINCIPAL: 'V.P',
    DEAN_OF_STUDIES: 'D.O.S',
    DEAN_OF_DISCIPLINE: 'D.O.D',
    SENIOR_DISCIPLINE_MASTER: 'S.D.M',
    DISCIPLINE_MASTER: 'D.M',
    BURSAR: 'BURSAR',
    SECRETARY: 'SEC',
    NURSE: 'S.N',
};
const ROLE_ORDER = Object.keys(ADMIN_ROLE_POSTS);

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The case-conversion middleware turns keys inside arrays into snake_case (userId -> user_id),
// so entries are read in either spelling.
const field = (e: any, camel: string) => e?.[camel] ?? e?.[camel.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)];
const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const schoolToday = () => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10); // Cameroon, UTC+1
const fail = (res: Response, e: unknown, status = 500) =>
    res.status(status).json({ success: false, error: (e as Error)?.message || String(e) });

export interface PersonnelRow {
    userId: number;
    name: string;
    post: string;
    source: 'role' | 'added';
}

/** The assiduity list (alphabetical, like the paper report) and the people taken off it. */
export async function listPersonnel(): Promise<{ personnel: PersonnelRow[]; removed: PersonnelRow[] }> {
    const [roleUsers, members] = await Promise.all([
        prisma.user.findMany({
            where: { user_roles: { some: { role: { in: ROLE_ORDER as any } } } },
            select: { id: true, name: true, user_roles: { select: { role: true } } },
        }),
        prisma.adminAttendanceMember.findMany({
            include: { user: { select: { id: true, name: true, user_roles: { select: { role: true } } } } },
        }),
    ]);
    const memberByUser = new Map(members.map(m => [m.user_id, m]));
    const rolePost = (roles: { role: string }[]) => {
        const held = roles.map(r => r.role).filter(r => ADMIN_ROLE_POSTS[r]);
        held.sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
        return held.map(r => ADMIN_ROLE_POSTS[r]).filter((p, i, a) => a.indexOf(p) === i).join('/') || '';
    };
    const personnel: PersonnelRow[] = [];
    const removed: PersonnelRow[] = [];
    const seen = new Set<number>();
    for (const u of roleUsers) {
        seen.add(u.id);
        const m = memberByUser.get(u.id);
        const row: PersonnelRow = { userId: u.id, name: u.name, post: m?.post?.trim() || rolePost(u.user_roles), source: 'role' };
        (m && !m.included ? removed : personnel).push(row);
    }
    for (const m of members) {
        if (seen.has(m.user_id)) continue;
        const row: PersonnelRow = { userId: m.user_id, name: m.user.name, post: m.post?.trim() || rolePost(m.user.user_roles), source: 'added' };
        (m.included ? personnel : removed).push(row);
    }
    const byName = (a: PersonnelRow, b: PersonnelRow) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return { personnel: personnel.sort(byName), removed: removed.sort(byName) };
}

router.get('/personnel', authenticate, authorize(READERS), async (_req: Request, res: Response) => {
    try {
        res.json({ success: true, data: await listPersonnel() });
    } catch (e) {
        fail(res, e);
    }
});

router.put('/personnel/:userId', authenticate, authorize(WRITERS), async (req: Request, res: Response) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) return fail(res, new Error('Invalid user'), 400);
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!user) return fail(res, new Error('User not found'), 404);
        const post = typeof req.body?.post === 'string' ? req.body.post.trim().slice(0, 40) : undefined;
        const included = typeof req.body?.included === 'boolean' ? req.body.included : true;
        const row = await prisma.adminAttendanceMember.upsert({
            where: { user_id: userId },
            create: { user_id: userId, post: post || null, included },
            update: { ...(post !== undefined ? { post: post || null } : {}), included },
        });
        res.json({ success: true, data: { userId: row.user_id, post: row.post, included: row.included } });
    } catch (e) {
        fail(res, e);
    }
});

router.get('/users', authenticate, authorize(WRITERS), async (req: Request, res: Response) => {
    try {
        const q = String(req.query.search || '').trim();
        if (q.length < 2) return res.json({ success: true, data: [] });
        const users = await prisma.user.findMany({
            where: {
                OR: [{ name: { contains: q, mode: 'insensitive' } }, { matricule: { contains: q, mode: 'insensitive' } }],
                user_roles: { some: { role: { not: 'PARENT' } } },
            },
            select: { id: true, name: true, matricule: true, user_roles: { select: { role: true } } },
            orderBy: { name: 'asc' },
            take: 20,
        });
        res.json({
            success: true,
            data: users.map(u => ({ id: u.id, name: u.name, matricule: u.matricule, roles: Array.from(new Set(u.user_roles.map(r => r.role))) })),
        });
    } catch (e) {
        fail(res, e);
    }
});

router.get('/day', authenticate, authorize(READERS), async (req: Request, res: Response) => {
    try {
        const date = String(req.query.date || schoolToday());
        if (!DATE_RE.test(date)) return fail(res, new Error('date must be YYYY-MM-DD'), 400);
        const { personnel } = await listPersonnel();
        const records = await prisma.adminAttendance.findMany({
            where: { date: toDate(date), removed: false },
            include: { recorded_by: { select: { name: true } } },
        });
        const byUser = new Map(records.map(r => [r.user_id, r]));
        res.json({
            success: true,
            data: {
                date,
                today: schoolToday(),
                rows: personnel.map(p => {
                    const r = byUser.get(p.userId);
                    return {
                        ...p,
                        status: r?.status ?? null,
                        arrivalTime: r?.arrival_time ?? null,
                        note: r?.note ?? null,
                        recordedBy: r?.recorded_by?.name ?? null,
                    };
                }),
            },
        });
    } catch (e) {
        fail(res, e);
    }
});

router.put('/day', authenticate, authorize(WRITERS), async (req: Request, res: Response) => {
    try {
        const date = String(req.body?.date || '');
        if (!DATE_RE.test(date)) return fail(res, new Error('date must be YYYY-MM-DD'), 400);
        if (date > schoolToday()) return fail(res, new Error('You cannot record a day that has not come yet.'), 400);
        const entries: any[] = Array.isArray(req.body?.entries) ? req.body.entries : [];
        const recorder = (req as any).user?.id;
        if (!recorder) return fail(res, new Error('Unauthenticated'), 401);

        // Validate everything first so a bad row saves nothing.
        const clean: { userId: number; status: 'PRESENT' | 'LATE' | 'ABSENT' | null; time: string | null; note: string | null }[] = [];
        for (const e of entries) {
            const userId = Number(field(e, 'userId'));
            if (!Number.isInteger(userId) || userId <= 0) return fail(res, new Error('Invalid user in entries'), 400);
            const status = e?.status == null || e.status === '' ? null : String(e.status).toUpperCase();
            if (status !== null && !['PRESENT', 'LATE', 'ABSENT'].includes(status)) return fail(res, new Error(`Invalid status "${e.status}"`), 400);
            const rawTime = field(e, 'arrivalTime');
            let time: string | null = rawTime ? String(rawTime).trim() : null;
            if (time && !TIME_RE.test(time)) return fail(res, new Error(`Invalid arrival time "${time}" (use HH:MM)`), 400);
            if (time) time = time.padStart(5, '0');
            if (status === 'LATE' && !time) return fail(res, new Error('Enter the arrival time for everyone marked late.'), 400);
            if (status === 'ABSENT' || status === null) time = null;
            const note = e?.note ? String(e.note).trim().slice(0, 200) : null;
            clean.push({ userId, status: status as any, time, note });
        }

        const day = toDate(date);
        let saved = 0, cleared = 0;
        await prisma.$transaction(async tx => {
            for (const e of clean) {
                if (e.status === null) {
                    // Kept as removed rather than deleted, so the clearing syncs to the other server.
                    const existing = await tx.adminAttendance.findUnique({ where: { user_id_date: { user_id: e.userId, date: day } } });
                    if (existing && !existing.removed) {
                        await tx.adminAttendance.update({ where: { id: existing.id }, data: { removed: true, recorded_by_id: recorder } });
                        cleared += 1;
                    }
                    continue;
                }
                await tx.adminAttendance.upsert({
                    where: { user_id_date: { user_id: e.userId, date: day } },
                    create: { user_id: e.userId, date: day, status: e.status, arrival_time: e.time, note: e.note, recorded_by_id: recorder },
                    update: { status: e.status, arrival_time: e.time, note: e.note, removed: false, recorded_by_id: recorder },
                });
                saved += 1;
            }
        });
        res.json({ success: true, data: { date, saved, cleared } });
    } catch (e) {
        fail(res, e);
    }
});

router.get('/report', authenticate, authorize(READERS), async (req: Request, res: Response) => {
    try {
        const from = String(req.query.from || '');
        const to = String(req.query.to || from);
        if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) return fail(res, new Error('from / to must be YYYY-MM-DD, from <= to'), 400);
        const days: string[] = [];
        for (let d = toDate(from).getTime(); d <= toDate(to).getTime() && days.length < 31; d += 86400000) {
            const dt = new Date(d);
            if (dt.getUTCDay() !== 0 && dt.getUTCDay() !== 6) days.push(isoOf(dt)); // school days only
        }
        const [{ personnel }, records] = await Promise.all([
            listPersonnel(),
            prisma.adminAttendance.findMany({ where: { date: { gte: toDate(from), lte: toDate(to) }, removed: false } }),
        ]);
        const cell = new Map(records.map(r => [`${r.user_id}|${isoOf(r.date)}`, r]));
        const listed = new Set(personnel.map(p => p.userId));
        // Anyone recorded in the range but since taken off the list still shows on that report.
        const extraIds = Array.from(new Set(records.map(r => r.user_id).filter(id => !listed.has(id))));
        const extra = extraIds.length
            ? (await prisma.user.findMany({ where: { id: { in: extraIds } }, select: { id: true, name: true } }))
                .map(u => ({ userId: u.id, name: u.name, post: '', source: 'added' as const }))
            : [];
        const rows = [...personnel, ...extra].map(p => ({
            ...p,
            days: Object.fromEntries(days.map(d => {
                const r = cell.get(`${p.userId}|${d}`);
                return [d, r ? { status: r.status, arrivalTime: r.arrival_time, note: r.note } : null];
            })),
        }));
        const totals = { present: 0, late: 0, absent: 0 };
        for (const r of records) {
            if (!days.includes(isoOf(r.date))) continue;
            totals[r.status.toLowerCase() as 'present' | 'late' | 'absent'] += 1;
        }
        res.json({ success: true, data: { from, to, days, rows, totals } });
    } catch (e) {
        fail(res, e);
    }
});

export default router;
