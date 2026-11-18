/**
 * Discipline duty roster (Discipline Coordinator), one per month, in the four tables
 * of the paper roster:
 *   SATURDAY_CONTROL  week, date, class, discipline master(s)
 *   PREPS_CONTROL     time, discipline master(s), class
 *   COORDINATORS      block (zone), classes (position), coordinator(s)
 *   ZONES             time, zone, position, discipline master(s), activity
 *
 *   GET /duty-roster?month=YYYY-MM     the month's rows by section (+ previous month that has a roster)
 *   PUT /duty-roster                   { month, entries: [...] } replaces the whole month
 *   GET /duty-roster/staff             discipline staff to assign
 */
import { Router, Request, Response } from 'express';
import prisma from '../../../config/db';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

const WRITERS = ['DISCIPLINE_COORDINATOR'];
const READERS = ['DISCIPLINE_COORDINATOR', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_DISCIPLINE', 'SENIOR_DISCIPLINE_MASTER', 'DISCIPLINE_MASTER'];
export const SECTIONS = ['SATURDAY_CONTROL', 'PREPS_CONTROL', 'COORDINATORS', 'ZONES'] as const;
type Section = typeof SECTIONS[number];
const STAFF_ROLES = ['DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR'];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The case-conversion middleware turns keys inside arrays into snake_case (userId -> user_id),
// so entries are read in either spelling.
const field = (e: any, camel: string) => e?.[camel] ?? e?.[camel.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)];
const fail = (res: Response, e: unknown, status = 500) =>
    res.status(status).json({ success: false, error: (e as Error)?.message || String(e) });
const txt = (v: unknown, max = 300) => (v == null ? null : String(v).trim().slice(0, max) || null);

const toRow = (e: any, names: Map<number, string>) => {
    const ids = (e.assignee_ids || '').split(',').map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
    return {
        id: e.id,
        section: e.section as Section,
        sortOrder: e.sort_order,
        week: e.week,
        date: e.date ? e.date.toISOString().slice(0, 10) : null,
        timeLabel: e.time_label,
        zone: e.zone,
        position: e.position,
        classLabel: e.class_label,
        activity: e.activity,
        assigneeIds: ids,
        assigneeNames: ids.map((id: number) => names.get(id)).filter(Boolean),
        assigneeNote: e.assignee_note,
    };
};

router.get('/staff', authenticate, authorize(READERS), async (_req: Request, res: Response) => {
    try {
        const users = await prisma.user.findMany({
            where: { user_roles: { some: { role: { in: STAFF_ROLES as any } } } },
            select: { id: true, name: true, gender: true, user_roles: { select: { role: true } } },
            orderBy: { name: 'asc' },
        });
        res.json({
            success: true,
            data: users.map(u => ({ id: u.id, name: u.name, gender: u.gender, roles: Array.from(new Set(u.user_roles.map(r => r.role))) })),
        });
    } catch (e) {
        fail(res, e);
    }
});

router.get('/', authenticate, authorize(READERS), async (req: Request, res: Response) => {
    try {
        const month = String(req.query.month || '');
        if (!MONTH_RE.test(month)) return fail(res, new Error('month must be YYYY-MM'), 400);
        const [entries, previous] = await Promise.all([
            prisma.dutyRosterEntry.findMany({ where: { month, removed: false }, orderBy: [{ section: 'asc' }, { sort_order: 'asc' }, { id: 'asc' }] }),
            prisma.dutyRosterEntry.findFirst({ where: { month: { lt: month }, removed: false }, orderBy: { month: 'desc' }, select: { month: true } }),
        ]);
        const ids = Array.from(new Set(entries.flatMap(e => (e.assignee_ids || '').split(',').map(Number)).filter(n => n > 0)));
        const names = new Map(
            (ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map(u => [u.id, u.name])
        );
        const rows = entries.map(e => toRow(e, names));
        const updated = entries.reduce<Date | null>((m, e) => (!m || e.updated_at > m ? e.updated_at : m), null);
        res.json({
            success: true,
            data: {
                month,
                previousMonth: previous?.month ?? null,
                updatedAt: updated ? updated.toISOString() : null,
                sections: Object.fromEntries(SECTIONS.map(s => [s, rows.filter(r => r.section === s)])),
            },
        });
    } catch (e) {
        fail(res, e);
    }
});

router.put('/', authenticate, authorize(WRITERS), async (req: Request, res: Response) => {
    try {
        const month = String(req.body?.month || '');
        if (!MONTH_RE.test(month)) return fail(res, new Error('month must be YYYY-MM'), 400);
        const entries: any[] = Array.isArray(req.body?.entries) ? req.body.entries : [];
        if (entries.length > 300) return fail(res, new Error('Too many rows'), 400);
        const userId = (req as any).user?.id;
        if (!userId) return fail(res, new Error('Unauthenticated'), 401);

        const allIds = new Set<number>();
        const data = entries.map((e, i) => {
            const section = String(e?.section || '') as Section;
            if (!SECTIONS.includes(section)) throw Object.assign(new Error(`Row ${i + 1}: unknown section`), { status: 400 });
            const date = e?.date ? String(e.date) : null;
            if (date && !DATE_RE.test(date)) throw Object.assign(new Error(`Row ${i + 1}: date must be YYYY-MM-DD`), { status: 400 });
            const week = e?.week == null || e.week === '' ? null : Number(e.week);
            if (week !== null && (!Number.isInteger(week) || week < 1 || week > 6)) throw Object.assign(new Error(`Row ${i + 1}: week must be 1-6`), { status: 400 });
            const rawIds = field(e, 'assigneeIds');
            const ids: number[] = Array.isArray(rawIds)
                ? Array.from(new Set<number>(rawIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)))
                : [];
            ids.forEach(id => allIds.add(id));
            const id = Number(e?.id);
            return {
                id: Number.isInteger(id) && id > 0 ? id : null,
                month,
                section,
                sort_order: field(e, 'sortOrder') != null && Number.isInteger(Number(field(e, 'sortOrder'))) ? Number(field(e, 'sortOrder')) : i,
                week,
                date: date ? new Date(`${date}T00:00:00.000Z`) : null,
                time_label: txt(field(e, 'timeLabel'), 80),
                zone: txt(e?.zone, 120),
                position: txt(e?.position, 120),
                class_label: txt(field(e, 'classLabel'), 120),
                activity: txt(e?.activity, 500),
                assignee_ids: ids.length ? ids.join(',') : null,
                assignee_note: txt(field(e, 'assigneeNote'), 200),
                created_by_id: userId,
            };
        });
        if (allIds.size) {
            const found = await prisma.user.count({ where: { id: { in: Array.from(allIds) } } });
            if (found !== allIds.size) return fail(res, new Error('One or more assigned people were not found.'), 400);
        }
        // Update rows that came back with their id, create the new ones, and mark the rest
        // removed (kept, not deleted, so the change syncs to the other server).
        const result = await prisma.$transaction(async tx => {
            const existing = await tx.dutyRosterEntry.findMany({ where: { month, removed: false }, select: { id: true } });
            const existingIds = new Set(existing.map(r => r.id));
            const keep = new Set<number>();
            let created = 0, updated = 0, removed = 0;
            for (const { id, created_by_id, ...fields } of data) {
                if (id && existingIds.has(id)) {
                    await tx.dutyRosterEntry.update({ where: { id }, data: fields });
                    keep.add(id);
                    updated += 1;
                } else {
                    await tx.dutyRosterEntry.create({ data: { ...fields, created_by_id } });
                    created += 1;
                }
            }
            for (const id of existingIds) {
                if (keep.has(id)) continue;
                await tx.dutyRosterEntry.update({ where: { id }, data: { removed: true } });
                removed += 1;
            }
            return { created, updated, removed };
        });
        res.json({ success: true, data: { month, rows: data.length, ...result } });
    } catch (e: any) {
        fail(res, e, e?.status || 500);
    }
});

export default router;
