// src/utils/teacherWorkload.ts
//
// Teacher weekly workload derived from the timetable (TeacherPeriod rows).
// User.total_hours_per_week is a manual column that nothing ever writes, so
// every screen reading it showed "0 h". The timetable is the source of truth.
//
// - weekly_periods: distinct timetable slots (period_id) the teacher holds in
//   the year. A slot shared by two sub-classes (combined lesson) counts once,
//   and BREAK periods never count.
// - total_hours_per_week: the clock time of those slots, in hours (1 decimal).
//   Periods are not a fixed length (55 min, 110 min preps, ...), so this is the
//   summed start→end duration, not weekly_periods × 1h.

import prisma from '../config/db';

export interface TeacherWorkload {
    weekly_periods: number;
    total_minutes: number;
    total_hours_per_week: number;
}

export interface WorkloadPeriodRow {
    period_id: number;
    period?: {
        start_time: string;
        end_time: string;
        is_break?: boolean | null;
        type?: string | null;
    } | null;
}

export const EMPTY_WORKLOAD: TeacherWorkload = { weekly_periods: 0, total_minutes: 0, total_hours_per_week: 0 };

const toMinutes = (hhmm: string): number => {
    const [h, m] = String(hhmm || '').split(':').map((x) => parseInt(x, 10));
    return (h || 0) * 60 + (m || 0);
};

export function periodDurationMinutes(start: string, end: string): number {
    const d = toMinutes(end) - toMinutes(start);
    return d > 0 ? d : 0;
}

/** Workload from already-loaded TeacherPeriod rows (with `period` included). */
export function computeWorkload(rows: WorkloadPeriodRow[]): TeacherWorkload {
    const seen = new Set<number>();
    let minutes = 0;
    for (const row of rows) {
        const p = row.period;
        if (!p || p.is_break || p.type === 'BREAK') continue;
        if (seen.has(row.period_id)) continue;
        seen.add(row.period_id);
        minutes += periodDurationMinutes(p.start_time, p.end_time);
    }
    return {
        weekly_periods: seen.size,
        total_minutes: minutes,
        total_hours_per_week: Math.round((minutes / 60) * 10) / 10,
    };
}

/** Workload for many teachers in one query. Teachers with no slots map to EMPTY_WORKLOAD. */
export async function getTeacherWorkloads(
    teacherIds: number[],
    academicYearId?: number | null,
): Promise<Map<number, TeacherWorkload>> {
    const result = new Map<number, TeacherWorkload>();
    if (teacherIds.length === 0) return result;

    const rows = await prisma.teacherPeriod.findMany({
        where: {
            teacher_id: { in: teacherIds },
            ...(academicYearId ? { academic_year_id: academicYearId } : {}),
        },
        select: {
            teacher_id: true,
            period_id: true,
            period: { select: { start_time: true, end_time: true, is_break: true, type: true } },
        },
    });

    const byTeacher = new Map<number, WorkloadPeriodRow[]>();
    for (const r of rows) {
        if (r.teacher_id == null) continue;
        const list = byTeacher.get(r.teacher_id) ?? [];
        list.push(r);
        byTeacher.set(r.teacher_id, list);
    }
    for (const id of teacherIds) {
        const list = byTeacher.get(id);
        result.set(id, list ? computeWorkload(list) : { ...EMPTY_WORKLOAD });
    }
    return result;
}
