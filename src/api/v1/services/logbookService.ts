// src/api/v1/services/logbookService.ts
import prisma from '../../../config/db';
import { getAcademicYearId } from '../../../utils/academicYear';

export type LogbookStatusInput = 'COMPLETED' | 'PARTIAL' | 'NOT_TAUGHT';

export interface LogbookCreateInput {
    teacher_period_id: number;
    lesson_id: number;
    date_taught: string | Date;
    status?: LogbookStatusInput;
    notes?: string | null;
    homework_given?: string | null;
}

export interface LogbookUpdateInput {
    lesson_id?: number;
    date_taught?: string | Date;
    status?: LogbookStatusInput;
    notes?: string | null;
    homework_given?: string | null;
}

const entryInclude = {
    teacher_period: {
        include: {
            period: true,
            subject: { select: { id: true, name: true } },
            sub_class: {
                select: { id: true, name: true, class_id: true, class: { select: { id: true, name: true } } },
            },
            // The review page's Teacher column reads teacherPeriod.teacher.name;
            // without this it was always "—".
            teacher: { select: { id: true, name: true, matricule: true } },
        },
    },
    lesson: {
        include: {
            chapter: { include: { module: { select: { id: true, code: true, title: true } } } },
            term: { select: { id: true, name: true } },
        },
    },
    taught_by: { select: { id: true, name: true } },
    reviewed_by: { select: { id: true, name: true } },
};

function toDate(d: string | Date): Date {
    return d instanceof Date ? d : new Date(d);
}

/**
 * Validates that the lesson belongs to a scheme matching the teacher_period's
 * subject + class + academic year. Prevents teachers from logging a Physics
 * lesson against their Chemistry period.
 */
async function assertLessonMatchesTeacherPeriod(teacher_period_id: number, lesson_id: number) {
    const tp = await prisma.teacherPeriod.findUnique({
        where: { id: teacher_period_id },
        include: { sub_class: { select: { class_id: true } } },
    });
    if (!tp) {
        const err: any = new Error('Teacher period not found');
        err.code = 'NOT_FOUND';
        throw err;
    }

    const lesson = await prisma.schemeLesson.findUnique({
        where: { id: lesson_id },
        include: { chapter: { include: { module: { include: { subject_scheme: true } } } } },
    });
    if (!lesson) {
        const err: any = new Error('Lesson not found');
        err.code = 'NOT_FOUND';
        throw err;
    }

    const scheme = lesson.chapter.module.subject_scheme;
    if (
        scheme.subject_id !== tp.subject_id ||
        scheme.class_id !== tp.sub_class.class_id ||
        scheme.academic_year_id !== tp.academic_year_id
    ) {
        const err: any = new Error(
            'Lesson does not belong to the scheme of this teacher period (subject/class/year mismatch).',
        );
        err.code = 'VALIDATION';
        throw err;
    }
    return { tp, lesson };
}

export async function createEntry(input: LogbookCreateInput, taught_by_id: number) {
    await assertLessonMatchesTeacherPeriod(input.teacher_period_id, input.lesson_id);

    // The teacher submitting must be the timetabled teacher (super-managers bypass this in controller).
    return prisma.logbookEntry.create({
        data: {
            teacher_period_id: input.teacher_period_id,
            lesson_id: input.lesson_id,
            date_taught: toDate(input.date_taught),
            status: input.status ?? 'COMPLETED',
            notes: input.notes ?? null,
            homework_given: input.homework_given ?? null,
            taught_by_id,
        },
        include: entryInclude,
    });
}

export async function updateEntry(id: number, input: LogbookUpdateInput) {
    const existing = await prisma.logbookEntry.findUnique({ where: { id } });
    if (!existing) {
        const err: any = new Error('Logbook entry not found');
        err.code = 'NOT_FOUND';
        throw err;
    }
    if (input.lesson_id && input.lesson_id !== existing.lesson_id) {
        await assertLessonMatchesTeacherPeriod(existing.teacher_period_id, input.lesson_id);
    }
    return prisma.logbookEntry.update({
        where: { id },
        data: {
            ...(input.lesson_id !== undefined && { lesson_id: input.lesson_id }),
            ...(input.date_taught !== undefined && { date_taught: toDate(input.date_taught) }),
            ...(input.status && { status: input.status }),
            ...(input.notes !== undefined && { notes: input.notes }),
            ...(input.homework_given !== undefined && { homework_given: input.homework_given }),
        },
        include: entryInclude,
    });
}

export async function deleteEntry(id: number) {
    await prisma.logbookEntry.delete({ where: { id } });
}

export async function getEntryById(id: number) {
    return prisma.logbookEntry.findUnique({ where: { id }, include: entryInclude });
}

export async function listEntries(filter: {
    teacher_id?: number;
    sub_class_id?: number;
    class_id?: number;
    subject_id?: number;
    /** Restrict to these subjects (HOD department scoping). [] = nothing. */
    subject_ids?: number[];
    teacher_period_id?: number;
    lesson_id?: number;
    academic_year_id?: number;
    from?: string | Date;
    to?: string | Date;
    status?: LogbookStatusInput;
    reviewed?: boolean;
}) {
    const academic_year_id = await getAcademicYearId(filter.academic_year_id);

    return prisma.logbookEntry.findMany({
        where: {
            ...(filter.teacher_period_id && { teacher_period_id: filter.teacher_period_id }),
            ...(filter.lesson_id && { lesson_id: filter.lesson_id }),
            ...(filter.teacher_id && { taught_by_id: filter.teacher_id }),
            ...(filter.status && { status: filter.status }),
            ...(filter.reviewed !== undefined &&
                (filter.reviewed
                    ? { reviewed_at: { not: null } }
                    : { reviewed_at: null })),
            ...(filter.from || filter.to
                ? {
                      date_taught: {
                          ...(filter.from && { gte: toDate(filter.from) }),
                          ...(filter.to && { lte: toDate(filter.to) }),
                      },
                  }
                : {}),
            teacher_period: {
                ...(academic_year_id && { academic_year_id }),
                ...(filter.sub_class_id && { sub_class_id: filter.sub_class_id }),
                ...(filter.class_id && { sub_class: { class_id: filter.class_id } }),
                ...(filter.subject_ids
                    ? {
                          subject_id: filter.subject_id
                              ? (filter.subject_ids.includes(filter.subject_id) ? filter.subject_id : -1)
                              : { in: filter.subject_ids },
                      }
                    : filter.subject_id
                        ? { subject_id: filter.subject_id }
                        : {}),
            },
        },
        include: entryInclude,
        orderBy: [{ date_taught: 'desc' }, { id: 'desc' }],
        take: 200,
    });
}

/**
 * Options for the Logbook Review filters (teachers / classes / sub-classes /
 * subjects), taken from the academic year's timetable so they match what can
 * actually appear in the list. `subject_ids` scopes to an HOD's department.
 */
export async function getReviewFilterOptions(filter: { academic_year_id?: number; subject_ids?: number[] }) {
    const academic_year_id = await getAcademicYearId(filter.academic_year_id);
    const periods = await prisma.teacherPeriod.findMany({
        where: {
            ...(academic_year_id && { academic_year_id }),
            ...(filter.subject_ids && { subject_id: { in: filter.subject_ids } }),
        },
        select: {
            teacher: { select: { id: true, name: true, matricule: true } },
            subject: { select: { id: true, name: true } },
            sub_class: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
        },
    });
    const teachers = new Map<number, { id: number; name: string; matricule: string | null }>();
    const subjects = new Map<number, { id: number; name: string }>();
    const classes = new Map<number, { id: number; name: string }>();
    const subClasses = new Map<number, { id: number; name: string; class_id: number; class_name: string }>();
    for (const p of periods) {
        if (p.teacher) teachers.set(p.teacher.id, p.teacher);
        subjects.set(p.subject.id, p.subject);
        classes.set(p.sub_class.class.id, p.sub_class.class);
        subClasses.set(p.sub_class.id, {
            id: p.sub_class.id,
            name: p.sub_class.name,
            class_id: p.sub_class.class.id,
            class_name: p.sub_class.class.name,
        });
    }
    const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
    return {
        teachers: [...teachers.values()].sort(byName),
        subjects: [...subjects.values()].sort(byName),
        classes: [...classes.values()].sort(byName),
        sub_classes: [...subClasses.values()].sort((a, b) => a.class_name.localeCompare(b.class_name) || a.name.localeCompare(b.name)),
    };
}

export async function reviewEntry(
    id: number,
    reviewed_by_id: number,
    reviewer_notes?: string | null,
) {
    return prisma.logbookEntry.update({
        where: { id },
        data: {
            reviewed_by_id,
            reviewed_at: new Date(),
            reviewer_notes: reviewer_notes ?? null,
        },
        include: entryInclude,
    });
}

/**
 * Coverage report: for a given scheme, returns each lesson with the count of
 * logbook entries that have COMPLETED it. Useful for VP / Dean / HOD dashboards.
 */
export async function getSchemeCoverage(subject_scheme_id: number) {
    const scheme = await prisma.subjectScheme.findUnique({
        where: { id: subject_scheme_id },
        include: {
            modules: {
                orderBy: { order: 'asc' },
                include: {
                    chapters: {
                        orderBy: { order: 'asc' },
                        include: {
                            lessons: {
                                orderBy: { order: 'asc' },
                                include: {
                                    _count: { select: { logbook_entries: true } },
                                    logbook_entries: {
                                        select: { id: true, status: true, date_taught: true, taught_by_id: true },
                                        orderBy: { date_taught: 'desc' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    });
    if (!scheme) return null;

    let total = 0;
    let completed = 0;
    // The response-side snake_to_camel middleware mangles `_count` into
    // `Count` (regex replaces the leading `_c` with `C`), so clients can never
    // read `_count.logbook_entries`. Flatten it into `logbook_entry_count`
    // on each lesson.
    const flatScheme = {
        ...scheme,
        modules: scheme.modules.map((m) => ({
            ...m,
            chapters: m.chapters.map((c) => ({
                ...c,
                lessons: c.lessons.map(({ _count, ...lesson }) => {
                    total += 1;
                    if (lesson.logbook_entries.some((e) => e.status === 'COMPLETED')) completed += 1;
                    return { ...lesson, logbook_entry_count: _count.logbook_entries };
                }),
            })),
        })),
    };

    return {
        scheme: flatScheme,
        summary: {
            total_lessons: total,
            completed_lessons: completed,
            coverage_percent: total === 0 ? 0 : Math.round((completed / total) * 100),
        },
    };
}
