// src/api/v1/services/teacherPeriodAttendanceService.ts
//
// DM evaluates a teacher during each scheduled period on a given date.
// Records presence (PRESENT/LATE/ABSENT) plus four behavioural checkboxes:
// well_dressed, class_management, punctuality, assiduity.
// Keyed on (teacher_period_id, date) — one record per timetable slot per day.

import prisma, {
    Prisma,
    TeacherPeriodAttendance,
    TeacherPeriodAttendanceStatus,
    DayOfWeek,
} from '../../../config/db';
import { getAcademicYearId } from '../../../utils/academicYear';
import { getFullSchoolTimetable } from './timetableService';

const DAY_INDEX_TO_ENUM: DayOfWeek[] = [
    'SUNDAY' as DayOfWeek,
    'MONDAY' as DayOfWeek,
    'TUESDAY' as DayOfWeek,
    'WEDNESDAY' as DayOfWeek,
    'THURSDAY' as DayOfWeek,
    'FRIDAY' as DayOfWeek,
    'SATURDAY' as DayOfWeek,
];

function normalizeDate(input: Date | string): Date {
    const d = typeof input === 'string' ? new Date(input) : new Date(input.getTime());
    if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

function dayOfWeekFromDate(d: Date): DayOfWeek {
    return DAY_INDEX_TO_ENUM[d.getUTCDay()];
}

const attendanceInclude = {
    teacher_period: {
        include: {
            period: true,
            subject: { select: { id: true, name: true, category: true } },
            sub_class: { include: { class: { select: { id: true, name: true } } } },
            teacher: { select: { id: true, name: true, matricule: true, phone: true } },
        },
    },
    recorded_by: { select: { id: true, name: true, matricule: true } },
} satisfies Prisma.TeacherPeriodAttendanceInclude;

/**
 * List a DM's day view: every TeacherPeriod scheduled for that date's day-of-week
 * (optionally filtered by sub_class_id) joined with any attendance already recorded.
 * When `restrictToSubClassIds` is provided the caller (DM) only sees those sub-classes.
 */
export async function listDayAttendance(opts: {
    date: Date | string;
    academic_year_id?: number;
    sub_class_id?: number;
    restrict_to_sub_class_ids?: number[]; // null/undefined = no restriction
}) {
    const yearId = opts.academic_year_id ?? (await getAcademicYearId());
    if (!yearId) throw new Error('No current academic year is set');

    const dateOnly = normalizeDate(opts.date);
    const dow = dayOfWeekFromDate(dateOnly);

    const subClassFilter: Prisma.IntFilter<'TeacherPeriod'> | number | undefined = (() => {
        if (opts.sub_class_id) {
            if (opts.restrict_to_sub_class_ids && !opts.restrict_to_sub_class_ids.includes(opts.sub_class_id)) {
                throw new Error('Access denied: you are not assigned as Discipline Master of this sub-class');
            }
            return opts.sub_class_id;
        }
        if (opts.restrict_to_sub_class_ids) {
            if (opts.restrict_to_sub_class_ids.length === 0) return -1; // impossible id -> empty result
            return { in: opts.restrict_to_sub_class_ids };
        }
        return undefined;
    })();

    const periods = await prisma.teacherPeriod.findMany({
        where: {
            academic_year_id: yearId,
            period: { day_of_week: dow },
            ...(subClassFilter !== undefined && { sub_class_id: subClassFilter as any }),
        },
        include: {
            period: true,
            subject: { select: { id: true, name: true, category: true } },
            sub_class: { include: { class: { select: { id: true, name: true } } } },
            teacher: { select: { id: true, name: true, matricule: true, phone: true } },
        },
        orderBy: [{ sub_class_id: 'asc' }, { period: { start_time: 'asc' } }],
    });

    const teacherPeriodIds = periods.map((p) => p.id);
    const attendances = teacherPeriodIds.length
        ? await prisma.teacherPeriodAttendance.findMany({
              where: { teacher_period_id: { in: teacherPeriodIds }, date: dateOnly },
              include: { recorded_by: { select: { id: true, name: true, matricule: true } } },
          })
        : [];

    const byPeriodId = new Map<number, (typeof attendances)[number]>();
    for (const a of attendances) byPeriodId.set(a.teacher_period_id, a);

    return {
        date: dateOnly,
        day_of_week: dow,
        academic_year_id: yearId,
        periods: periods.map((p) => ({
            teacher_period_id: p.id,
            period: p.period,
            subject: p.subject,
            sub_class: p.sub_class,
            teacher: p.teacher,
            attendance: byPeriodId.get(p.id) ?? null,
        })),
    };
}

export async function getById(id: number): Promise<TeacherPeriodAttendance | null> {
    return prisma.teacherPeriodAttendance.findUnique({
        where: { id },
        include: attendanceInclude,
    });
}

export interface AttendanceEntryInput {
    teacher_period_id: number;
    status: TeacherPeriodAttendanceStatus;
    well_dressed?: boolean;
    class_management?: boolean;
    punctuality?: boolean;
    assiduity?: boolean;
    reason?: string;
    notes?: string;
}

/**
 * Bulk-upsert attendance rows for a single date. Every entry's teacher_period_id
 * must exist AND (if `restrict_to_sub_class_ids` is set) belong to a sub-class
 * the caller is DM of, AND the period's day_of_week must match `date`.
 */
export async function upsertAttendance(input: {
    date: Date | string;
    entries: AttendanceEntryInput[];
    recorded_by_id: number;
    academic_year_id?: number;
    restrict_to_sub_class_ids?: number[];
}) {
    if (!Array.isArray(input.entries) || input.entries.length === 0) {
        throw new Error('entries must be a non-empty array');
    }

    const yearId = input.academic_year_id ?? (await getAcademicYearId());
    if (!yearId) throw new Error('No current academic year is set');

    const dateOnly = normalizeDate(input.date);
    const dow = dayOfWeekFromDate(dateOnly);

    const teacherPeriodIds = Array.from(new Set(input.entries.map((e) => e.teacher_period_id)));
    if (teacherPeriodIds.some((id) => !Number.isInteger(id) || id <= 0)) {
        throw new Error('Every entry requires a valid teacher_period_id');
    }

    const teacherPeriods = await prisma.teacherPeriod.findMany({
        where: { id: { in: teacherPeriodIds }, academic_year_id: yearId },
        include: { period: { select: { day_of_week: true } } },
    });
    const byId = new Map(teacherPeriods.map((tp) => [tp.id, tp]));

    for (const entry of input.entries) {
        const tp = byId.get(entry.teacher_period_id);
        if (!tp) {
            throw new Error(`TeacherPeriod ${entry.teacher_period_id} not found for the current academic year`);
        }
        if (tp.period.day_of_week !== dow) {
            throw new Error(
                `TeacherPeriod ${entry.teacher_period_id} is scheduled on ${tp.period.day_of_week}, not ${dow}`
            );
        }
        if (input.restrict_to_sub_class_ids && !input.restrict_to_sub_class_ids.includes(tp.sub_class_id)) {
            throw new Error(
                `Access denied: sub-class ${tp.sub_class_id} is not one of your assigned sub-classes`
            );
        }
    }

    const results = await prisma.$transaction(
        input.entries.map((entry) =>
            prisma.teacherPeriodAttendance.upsert({
                where: {
                    teacher_period_id_date: {
                        teacher_period_id: entry.teacher_period_id,
                        date: dateOnly,
                    },
                },
                create: {
                    teacher_period_id: entry.teacher_period_id,
                    academic_year_id: yearId,
                    date: dateOnly,
                    status: entry.status,
                    well_dressed: entry.well_dressed ?? false,
                    class_management: entry.class_management ?? false,
                    punctuality: entry.punctuality ?? false,
                    assiduity: entry.assiduity ?? false,
                    reason: entry.reason?.trim() || null,
                    notes: entry.notes?.trim() || null,
                    recorded_by_id: input.recorded_by_id,
                },
                update: {
                    status: entry.status,
                    well_dressed: entry.well_dressed ?? false,
                    class_management: entry.class_management ?? false,
                    punctuality: entry.punctuality ?? false,
                    assiduity: entry.assiduity ?? false,
                    reason: entry.reason?.trim() || null,
                    notes: entry.notes?.trim() || null,
                    recorded_by_id: input.recorded_by_id,
                },
                include: attendanceInclude,
            })
        )
    );

    return { date: dateOnly, academic_year_id: yearId, records: results };
}

export interface UpdateAttendanceInput {
    status?: TeacherPeriodAttendanceStatus;
    well_dressed?: boolean;
    class_management?: boolean;
    punctuality?: boolean;
    assiduity?: boolean;
    reason?: string | null;
    notes?: string | null;
}

export async function updateAttendance(
    id: number,
    patch: UpdateAttendanceInput,
    opts: { restrict_to_sub_class_ids?: number[] }
): Promise<TeacherPeriodAttendance> {
    const existing = await prisma.teacherPeriodAttendance.findUnique({
        where: { id },
        include: { teacher_period: { select: { sub_class_id: true } } },
    });
    if (!existing) throw new Error(`TeacherPeriodAttendance ${id} not found`);

    if (
        opts.restrict_to_sub_class_ids &&
        !opts.restrict_to_sub_class_ids.includes(existing.teacher_period.sub_class_id)
    ) {
        throw new Error('Access denied: this record belongs to a sub-class you are not assigned to');
    }

    return prisma.teacherPeriodAttendance.update({
        where: { id },
        data: {
            ...(patch.status !== undefined && { status: patch.status }),
            ...(patch.well_dressed !== undefined && { well_dressed: patch.well_dressed }),
            ...(patch.class_management !== undefined && { class_management: patch.class_management }),
            ...(patch.punctuality !== undefined && { punctuality: patch.punctuality }),
            ...(patch.assiduity !== undefined && { assiduity: patch.assiduity }),
            ...(patch.reason !== undefined && { reason: patch.reason?.toString().trim() || null }),
            ...(patch.notes !== undefined && { notes: patch.notes?.toString().trim() || null }),
        },
        include: attendanceInclude,
    });
}

export async function deleteAttendance(
    id: number,
    opts: { restrict_to_sub_class_ids?: number[] }
): Promise<void> {
    const existing = await prisma.teacherPeriodAttendance.findUnique({
        where: { id },
        include: { teacher_period: { select: { sub_class_id: true } } },
    });
    if (!existing) throw new Error(`TeacherPeriodAttendance ${id} not found`);

    if (
        opts.restrict_to_sub_class_ids &&
        !opts.restrict_to_sub_class_ids.includes(existing.teacher_period.sub_class_id)
    ) {
        throw new Error('Access denied: this record belongs to a sub-class you are not assigned to');
    }

    await prisma.teacherPeriodAttendance.delete({ where: { id } });
}

/**
 * Resolve the list of sub-classes the caller is DM of for the given academic year.
 * Returns `null` when the caller has a bypass role (i.e. no restriction applies).
 */
export async function getDmSubClassRestriction(
    userId: number,
    roles: string[],
    academicYearId?: number
): Promise<number[] | null> {
    const BYPASS = new Set([
        'SUPER_MANAGER',
        'MANAGER',
        'PRINCIPAL',
        'VICE_PRINCIPAL',
        'SENIOR_DISCIPLINE_MASTER',
        'DEAN_OF_DISCIPLINE',
    ]);
    if (roles.some((r) => BYPASS.has(r))) return null;

    const yearId = academicYearId ?? (await getAcademicYearId());
    if (!yearId) throw new Error('No current academic year is set');

    const assignments = await prisma.roleAssignment.findMany({
        where: {
            user_id: userId,
            role_type: 'DISCIPLINE_MASTER',
            academic_year_id: yearId,
            sub_class_id: { not: null },
        },
        select: { sub_class_id: true },
    });
    return assignments.map((a) => a.sub_class_id as number);
}

/**
 * Weekly teacher-attendance overview, shaped like the school-wide timetable:
 * the full-school timetable (bell-schedule groups, sub-class columns, the
 * teacher+subject in every slot -- exactly what /timetables/full-school
 * returns) plus the attendance the discipline masters recorded for that week.
 * Slot ids are TeacherPeriod ids, so the client joins
 * attendance[].teacher_period_id + date onto slot.id + the day column.
 * Read-only: nothing is stored here, a record a DM saves shows up on the next
 * fetch. (/timetables/full-school itself is not open to the Dean of Discipline,
 * hence this endpoint.)
 */
export async function getWeekOverview(opts: {
    week_start: Date | string;
    academic_year_id?: number;
}) {
    const yearId = opts.academic_year_id ?? (await getAcademicYearId());
    if (!yearId) throw new Error('No current academic year is set');

    // Snap any date in the week back to its Monday (UTC, like every other date here).
    const anchor = normalizeDate(opts.week_start);
    const back = (anchor.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
    const weekStart = new Date(anchor.getTime() - back * 86400000);
    const days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(weekStart.getTime() + i * 86400000);
        return { date: date.toISOString().slice(0, 10), day_of_week: dayOfWeekFromDate(date) };
    });
    const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);

    const [timetable, attendances] = await Promise.all([
        getFullSchoolTimetable(yearId),
        prisma.teacherPeriodAttendance.findMany({
            where: { academic_year_id: yearId, date: { gte: weekStart, lte: weekEnd } },
            include: { recorded_by: { select: { id: true, name: true } } },
        }),
    ]);

    return {
        ...timetable,
        week_start: days[0].date,
        week_end: days[6].date,
        today: new Date().toISOString().slice(0, 10),
        days,
        attendance: attendances.map((a) => ({
            teacher_period_id: a.teacher_period_id,
            date: a.date.toISOString().slice(0, 10),
            status: a.status,
            reason: a.reason,
            recorded_by: a.recorded_by,
        })),
    };
}
