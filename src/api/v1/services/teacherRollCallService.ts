// src/api/v1/services/teacherRollCallService.ts
//
// Per-period roll call taken by the teacher in their own classes.
// Keyed by (teacher_period_id, date). Read access is opened to the
// discipline chain (SDM / Dean of Discipline / VP / Principal).

import prisma from '../../../config/db';
import { DayOfWeek, Prisma, TeacherRollCallStatus } from '@prisma/client';
import { getAcademicYearId } from '../../../utils/academicYear';

// ---------- Helpers ----------

function normalizeDate(input: Date | string): Date {
    const d = typeof input === 'string' ? new Date(input) : new Date(input.getTime());
    if (Number.isNaN(d.getTime())) throw badRequest('Invalid date');
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

function isToday(date: Date): boolean {
    const t = new Date();
    return (
        date.getUTCFullYear() === t.getUTCFullYear() &&
        date.getUTCMonth() === t.getUTCMonth() &&
        date.getUTCDate() === t.getUTCDate()
    );
}

function toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
    return (h || 0) * 60 + (m || 0);
}

function currentDayOfWeek(): DayOfWeek {
    const days: DayOfWeek[] = [
        DayOfWeek.SUNDAY,
        DayOfWeek.MONDAY,
        DayOfWeek.TUESDAY,
        DayOfWeek.WEDNESDAY,
        DayOfWeek.THURSDAY,
        DayOfWeek.FRIDAY,
        DayOfWeek.SATURDAY,
    ];
    return days[new Date().getDay()];
}

function currentMinutes(): number {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
}

function badRequest(msg: string): Error {
    const e: any = new Error(msg); e.statusCode = 400; return e;
}
function forbidden(msg: string): Error {
    const e: any = new Error(msg); e.statusCode = 403; return e;
}
function notFound(msg: string): Error {
    const e: any = new Error(msg); e.statusCode = 404; return e;
}

// ---------- Teacher: "what am I teaching right now?" ----------

/**
 * Returns the TeacherPeriod the teacher is currently teaching (or null),
 * along with the class roster and any already-recorded roll call for today.
 * Timezone: server local time — the Period.start_time/end_time strings are
 * treated as school-local wall-clock times.
 */
export async function getCurrentPeriodForTeacher(teacherId: number) {
    const yearId = await getAcademicYearId();
    if (!yearId) {
        return {
            period: null,
            total_students: 0,
            roster: [],
            roll_call: null,
            next_period: null,
        };
    }

    const dow = currentDayOfWeek();
    const now = currentMinutes();

    // Pull the teacher's entire timetable once — used both for detecting the
    // current period and for computing the next one.
    const allTeacherPeriods = await prisma.teacherPeriod.findMany({
        where: { teacher_id: teacherId, academic_year_id: yearId },
        include: {
            period: true,
            subject: { select: { id: true, name: true, category: true } },
            sub_class: { include: { class: { select: { id: true, name: true } } } },
        },
    });

    const nonBreakToday = allTeacherPeriods.filter(
        (tp) => tp.period.day_of_week === dow && !tp.period.is_break,
    );

    const current = nonBreakToday.find((tp) => {
        const start = toMinutes(tp.period.start_time);
        const end = toMinutes(tp.period.end_time);
        return now >= start && now < end;
    });

    const nextPeriod = computeNextPeriod(allTeacherPeriods, dow, now);

    if (!current) {
        return {
            period: null,
            total_students: 0,
            roster: [],
            roll_call: null,
            next_period: nextPeriod,
        };
    }

    const view = await loadRollCallView(current.id, teacherId, new Date());
    return {
        ...view,
        total_students: view.roster.length,
        next_period: nextPeriod,
    };
}

// ---------- Next period lookup ----------
// Search order: (1) remaining periods today after `now`, then (2) days ahead
// until we find any teacher period. Returns null if the teacher has no future
// periods at all (empty timetable).

const DAY_ORDER: DayOfWeek[] = [
    DayOfWeek.MONDAY,
    DayOfWeek.TUESDAY,
    DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY,
    DayOfWeek.FRIDAY,
    DayOfWeek.SATURDAY,
    DayOfWeek.SUNDAY,
];

function computeNextPeriod(
    allTeacherPeriods: any[],
    today: DayOfWeek,
    currentMin: number,
) {
    const remainingToday = allTeacherPeriods
        .filter((tp) => tp.period.day_of_week === today && !tp.period.is_break)
        .filter((tp) => toMinutes(tp.period.start_time) > currentMin)
        .sort((a, b) => toMinutes(a.period.start_time) - toMinutes(b.period.start_time));

    let next: any | undefined;
    let isToday = true;
    if (remainingToday.length) {
        next = remainingToday[0];
    } else {
        isToday = false;
        const startIdx = DAY_ORDER.indexOf(today);
        for (let i = 1; i <= 7; i++) {
            const day = DAY_ORDER[(startIdx + i) % 7];
            const periodsOnDay = allTeacherPeriods
                .filter((tp) => tp.period.day_of_week === day && !tp.period.is_break)
                .sort((a, b) => toMinutes(a.period.start_time) - toMinutes(b.period.start_time));
            if (periodsOnDay.length) {
                next = periodsOnDay[0];
                break;
            }
        }
    }
    if (!next) return null;

    const startMin = toMinutes(next.period.start_time);
    return {
        teacher_period_id: next.id,
        period_id: next.period.id,
        day_of_week: next.period.day_of_week,
        is_today: isToday,
        minutes_to_start: isToday ? Math.max(0, startMin - currentMin) : null,
        start_time: next.period.start_time,
        end_time: next.period.end_time,
        period_name: next.period.name,
        subject: next.subject,
        sub_class: next.sub_class,
    };
}

/**
 * Return today's roll-call view for a specific teacher period the teacher owns.
 * Used when the teacher taps a period from their timetable.
 */
export async function getRollCallForTeacherPeriod(
    teacherPeriodId: number,
    teacherId: number,
    date: Date | string,
    allowNonOwner = false,
) {
    const tp = await prisma.teacherPeriod.findUnique({
        where: { id: teacherPeriodId },
        include: {
            period: true,
            subject: { select: { id: true, name: true, category: true } },
            sub_class: { include: { class: { select: { id: true, name: true } } } },
            teacher: { select: { id: true, name: true, matricule: true } },
        },
    });
    if (!tp) throw notFound('Teacher period not found');
    if (!allowNonOwner && tp.teacher_id !== teacherId) {
        throw forbidden('You can only view roll call for your own periods');
    }
    return loadRollCallView(teacherPeriodId, teacherId, date, tp);
}

async function loadRollCallView(
    teacherPeriodId: number,
    teacherIdForLog: number,
    date: Date | string,
    prefetched?: any,
) {
    const tp = prefetched
        ?? (await prisma.teacherPeriod.findUnique({
            where: { id: teacherPeriodId },
            include: {
                period: true,
                subject: { select: { id: true, name: true, category: true } },
                sub_class: { include: { class: { select: { id: true, name: true } } } },
                teacher: { select: { id: true, name: true, matricule: true } },
            },
        }));
    if (!tp) throw notFound('Teacher period not found');
    const dateOnly = normalizeDate(date);

    const [rollCall, enrollments] = await Promise.all([
        prisma.teacherRollCall.findUnique({
            where: { teacher_period_id_date: { teacher_period_id: teacherPeriodId, date: dateOnly } },
            include: {
                entries: true,
                recorded_by: { select: { id: true, name: true } },
            },
        }),
        prisma.enrollment.findMany({
            where: {
                sub_class_id: tp.sub_class_id,
                academic_year_id: tp.academic_year_id,
                student: { status: { not: 'WITHDRAWN' } },
            },
            include: {
                student: {
                    select: {
                        id: true,
                        matricule: true,
                        name: true,
                        nom: true,
                        prenom: true,
                        gender: true,
                    },
                },
            },
            orderBy: { student: { name: 'asc' } },
        }),
    ]);

    const statusByEnrollment = new Map<number, TeacherRollCallStatus>();
    const entryById = new Map<number, any>();
    if (rollCall) {
        for (const e of rollCall.entries) {
            statusByEnrollment.set(e.enrollment_id, e.status);
            entryById.set(e.enrollment_id, e);
        }
    }

    const roster = enrollments.map((enr) => ({
        enrollment_id: enr.id,
        student: enr.student,
        // Default to PRESENT so the frontend can render the roster pre-checked;
        // teacher only needs to flip absentees. Persisted status only exists
        // if this row is in statusByEnrollment.
        status: statusByEnrollment.get(enr.id) ?? null,
        entry: entryById.get(enr.id) ?? null,
    }));

    return {
        period: {
            teacher_period_id: tp.id,
            period_id: tp.period.id,
            day_of_week: tp.period.day_of_week,
            start_time: tp.period.start_time,
            end_time: tp.period.end_time,
            period_name: tp.period.name,
            subject: tp.subject,
            sub_class: tp.sub_class,
            teacher: tp.teacher,
        },
        date: dateOnly,
        total_students: roster.length,
        roll_call: rollCall
            ? {
                id: rollCall.id,
                recorded_by: rollCall.recorded_by,
                notes: rollCall.notes,
                created_at: rollCall.created_at,
                updated_at: rollCall.updated_at,
                entry_count: rollCall.entries.length,
            }
            : null,
        roster,
    };
}

// ---------- Teacher: submit / update roll call ----------

export interface RollCallEntryInput {
    enrollment_id: number;
    status: TeacherRollCallStatus;
    notes?: string;
}

export async function recordTeacherRollCall(input: {
    teacher_period_id: number;
    date?: Date | string; // defaults to today
    entries: RollCallEntryInput[];
    notes?: string;
    recorded_by_id: number;
}) {
    const dateOnly = normalizeDate(input.date ?? new Date());
    if (!isToday(dateOnly)) {
        // Allow past-day corrections up to 3 days back; forbid future dates.
        const now = new Date();
        now.setUTCHours(0, 0, 0, 0);
        const diffDays = (now.getTime() - dateOnly.getTime()) / (24 * 60 * 60 * 1000);
        if (diffDays < 0) throw badRequest('Cannot record roll call for a future date');
        if (diffDays > 3) throw badRequest('Roll call can only be recorded within 3 days of the class');
    }

    const tp = await prisma.teacherPeriod.findUnique({
        where: { id: input.teacher_period_id },
        include: { period: true },
    });
    if (!tp) throw notFound('Teacher period not found');
    if (tp.teacher_id !== input.recorded_by_id) {
        throw forbidden('You can only take roll call for your own periods');
    }

    // Verify the roll-call date matches the period's day-of-week.
    const days: DayOfWeek[] = [
        DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY,
        DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY,
    ];
    if (days[dateOnly.getUTCDay()] !== tp.period.day_of_week) {
        throw badRequest(`This period is on ${tp.period.day_of_week}; the date does not match`);
    }

    // Validate all enrollments belong to this teacher's sub-class + year.
    const enrollmentIds = input.entries.map((e) => e.enrollment_id);
    if (enrollmentIds.length === 0) throw badRequest('entries required');
    const validEnrollments = await prisma.enrollment.findMany({
        where: {
            id: { in: enrollmentIds },
            sub_class_id: tp.sub_class_id,
            academic_year_id: tp.academic_year_id,
            student: { status: { not: 'WITHDRAWN' } },
        },
        select: { id: true },
    });
    const validIds = new Set(validEnrollments.map((e) => e.id));
    const invalid = enrollmentIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
        throw badRequest(`Enrollments not in this sub-class for the current year: ${invalid.join(',')}`);
    }

    const result = await prisma.$transaction(async (tx) => {
        const rc = await tx.teacherRollCall.upsert({
            where: {
                teacher_period_id_date: {
                    teacher_period_id: input.teacher_period_id,
                    date: dateOnly,
                },
            },
            create: {
                teacher_period_id: input.teacher_period_id,
                academic_year_id: tp.academic_year_id,
                date: dateOnly,
                recorded_by_id: input.recorded_by_id,
                notes: input.notes?.trim() || null,
            },
            update: {
                recorded_by_id: input.recorded_by_id,
                notes: input.notes?.trim() ?? undefined,
            },
        });

        // Replace prior entries (idempotent re-submission).
        await tx.teacherRollCallEntry.deleteMany({ where: { teacher_roll_call_id: rc.id } });

        await tx.teacherRollCallEntry.createMany({
            data: input.entries.map((e) => ({
                teacher_roll_call_id: rc.id,
                enrollment_id: e.enrollment_id,
                status: e.status,
                notes: e.notes?.trim() || null,
            })),
        });

        return tx.teacherRollCall.findUnique({
            where: { id: rc.id },
            include: {
                entries: {
                    include: {
                        enrollment: {
                            include: {
                                student: {
                                    select: {
                                        id: true, matricule: true, name: true,
                                        nom: true, prenom: true,
                                    },
                                },
                            },
                        },
                    },
                },
                recorded_by: { select: { id: true, name: true } },
            },
        });
    });

    return result;
}

// ---------- Teacher: my roll calls (today / range) ----------

export async function listMyRollCalls(
    teacherId: number,
    opts: { from?: Date | string; to?: Date | string; limit?: number },
) {
    const yearId = await getAcademicYearId();
    const limit = Math.min(opts.limit && opts.limit > 0 ? opts.limit : 100, 500);
    const where: Prisma.TeacherRollCallWhereInput = {
        teacher_period: { teacher_id: teacherId },
        ...(yearId ? { academic_year_id: yearId } : {}),
    };
    if (opts.from) where.date = { ...(where.date as any), gte: normalizeDate(opts.from) };
    if (opts.to) where.date = { ...(where.date as any), lte: normalizeDate(opts.to) };

    return prisma.teacherRollCall.findMany({
        where,
        include: {
            teacher_period: {
                include: {
                    period: true,
                    subject: { select: { id: true, name: true } },
                    sub_class: { include: { class: { select: { id: true, name: true } } } },
                },
            },
            _count: { select: { entries: true } },
            entries: {
                where: { status: { in: ['ABSENT', 'LATE'] } },
                select: { id: true, status: true, enrollment_id: true },
            },
        },
        orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
        take: limit,
    });
}

// ---------- Oversight (SDM / Dean of Discipline / VP / Principal) ----------

export interface OversightFilters {
    date?: Date | string;
    from?: Date | string;
    to?: Date | string;
    sub_class_id?: number;
    teacher_id?: number;
    subject_id?: number;
    only_with_absences?: boolean;
    limit?: number;
}

export async function listRollCallsForOversight(opts: OversightFilters) {
    const yearId = await getAcademicYearId();
    const limit = Math.min(opts.limit && opts.limit > 0 ? opts.limit : 100, 500);

    const dateFilter: any = {};
    if (opts.date) dateFilter.equals = normalizeDate(opts.date);
    else {
        if (opts.from) dateFilter.gte = normalizeDate(opts.from);
        if (opts.to) dateFilter.lte = normalizeDate(opts.to);
    }

    const tpFilter: Prisma.TeacherPeriodWhereInput = {};
    if (opts.teacher_id) tpFilter.teacher_id = opts.teacher_id;
    if (opts.subject_id) tpFilter.subject_id = opts.subject_id;
    if (opts.sub_class_id) tpFilter.sub_class_id = opts.sub_class_id;

    const where: Prisma.TeacherRollCallWhereInput = {
        ...(yearId ? { academic_year_id: yearId } : {}),
        ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
        ...(Object.keys(tpFilter).length ? { teacher_period: tpFilter } : {}),
        ...(opts.only_with_absences
            ? { entries: { some: { status: { in: ['ABSENT', 'LATE'] } } } }
            : {}),
    };

    return prisma.teacherRollCall.findMany({
        where,
        include: {
            teacher_period: {
                include: {
                    period: true,
                    subject: { select: { id: true, name: true } },
                    sub_class: { include: { class: { select: { id: true, name: true } } } },
                    teacher: { select: { id: true, name: true, matricule: true } },
                },
            },
            recorded_by: { select: { id: true, name: true } },
            _count: { select: { entries: true } },
            entries: {
                where: { status: { in: ['ABSENT', 'LATE'] } },
                include: {
                    enrollment: {
                        select: {
                            id: true,
                            student: { select: { id: true, matricule: true, name: true } },
                        },
                    },
                },
            },
        },
        orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
        take: limit,
    });
}

export async function getRollCallDetail(rollCallId: number) {
    const rc = await prisma.teacherRollCall.findUnique({
        where: { id: rollCallId },
        include: {
            teacher_period: {
                include: {
                    period: true,
                    subject: { select: { id: true, name: true } },
                    sub_class: { include: { class: { select: { id: true, name: true } } } },
                    teacher: { select: { id: true, name: true, matricule: true } },
                },
            },
            recorded_by: { select: { id: true, name: true } },
            entries: {
                include: {
                    enrollment: {
                        select: {
                            id: true,
                            student: {
                                select: {
                                    id: true, matricule: true, name: true,
                                    nom: true, prenom: true, gender: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    });
    if (!rc) throw notFound('Roll call not found');
    return rc;
}
