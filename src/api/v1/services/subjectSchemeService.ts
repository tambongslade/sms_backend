// src/api/v1/services/subjectSchemeService.ts
import prisma, { Prisma } from '../../../config/db';
import { getAcademicYearId } from '../../../utils/academicYear';

export type LessonEntryTypeInput =
    | 'LESSON'
    | 'INTEGRATION'
    | 'EVALUATION'
    | 'REMEDIATION'
    | 'REVISION'
    | 'BREAK';

export interface LessonInput {
    order: number;
    entry_type?: LessonEntryTypeInput;
    title: string;
    objectives?: string | null;
    hands_on_activities?: string | null;
    digital_resource_available?: boolean;
    digital_resources_used?: string | null;
    term_id?: number | null;
    week_number?: number | null;
    periods_count?: number;
}

export interface ChapterInput {
    order: number;
    code?: string | null;
    title: string;
    lessons?: LessonInput[];
}

export interface ModuleInput {
    order: number;
    code?: string | null;
    title: string;
    chapters?: ChapterInput[];
}

export interface SchemeBulkPayload {
    subject_id: number;
    class_id: number;
    academic_year_id?: number;
    periods_per_week: number;
    annual_teaching_hours: number;
    notes?: string | null;
    modules?: ModuleInput[];
    /** When true, an existing scheme with the same (subject, class, year) is wiped and replaced. */
    replace?: boolean;
}

const schemeInclude = {
    subject: { select: { id: true, name: true, category: true } },
    class: { select: { id: true, name: true } },
    academic_year: { select: { id: true, name: true } },
    created_by: { select: { id: true, name: true } },
    modules: {
        orderBy: { order: 'asc' as const },
        include: {
            chapters: {
                orderBy: { order: 'asc' as const },
                include: {
                    lessons: {
                        orderBy: { order: 'asc' as const },
                        include: { term: { select: { id: true, name: true } } },
                    },
                },
            },
        },
    },
};

async function resolveAcademicYearId(provided?: number): Promise<number> {
    const id = await getAcademicYearId(provided);
    if (!id) throw new Error('No academic year resolved. Provide academic_year_id or set a current academic year.');
    return id;
}

export async function listSchemes(filter: {
    subject_id?: number;
    class_id?: number;
    academic_year_id?: number;
}) {
    const academic_year_id = await resolveAcademicYearId(filter.academic_year_id);
    const rows = await prisma.subjectScheme.findMany({
        where: {
            academic_year_id,
            ...(filter.subject_id && { subject_id: filter.subject_id }),
            ...(filter.class_id && { class_id: filter.class_id }),
        },
        include: {
            subject: { select: { id: true, name: true, category: true } },
            class: { select: { id: true, name: true } },
            academic_year: { select: { id: true, name: true } },
            created_by: { select: { id: true, name: true } },
            _count: { select: { modules: true } },
        },
        orderBy: [{ class_id: 'asc' }, { subject_id: 'asc' }],
    });

    // The response-side snake_to_camel middleware mangles the `_count` key
    // (Prisma's aggregation shape) into `Count`, so clients can never read
    // `_count.modules`. Flatten it into a stable top-level field.
    return rows.map(({ _count, ...rest }) => ({
        ...rest,
        module_count: _count.modules,
    }));
}

export async function getSchemeById(id: number) {
    return prisma.subjectScheme.findUnique({
        where: { id },
        include: schemeInclude,
    });
}

export async function getSchemeByTriplet(
    subject_id: number,
    class_id: number,
    academic_year_id?: number,
) {
    const yearId = await resolveAcademicYearId(academic_year_id);
    return prisma.subjectScheme.findUnique({
        where: {
            subject_class_year_unique: {
                subject_id,
                class_id,
                academic_year_id: yearId,
            },
        },
        include: schemeInclude,
    });
}

export async function createScheme(
    data: {
        subject_id: number;
        class_id: number;
        academic_year_id?: number;
        periods_per_week: number;
        annual_teaching_hours: number;
        notes?: string | null;
    },
    created_by_id: number,
) {
    const academic_year_id = await resolveAcademicYearId(data.academic_year_id);

    // One scheme per subject/class/year (subject_class_year_unique). Check up
    // front so the user gets a readable 409 instead of a raw Prisma P2002.
    const existing = await prisma.subjectScheme.findUnique({
        where: {
            subject_class_year_unique: {
                subject_id: Number(data.subject_id),
                class_id: Number(data.class_id),
                academic_year_id,
            },
        },
        select: {
            id: true,
            subject: { select: { name: true } },
            class: { select: { name: true } },
            academic_year: { select: { name: true } },
        },
    });
    if (existing) {
        const err: any = new Error(
            `A scheme of work already exists for ${existing.subject?.name ?? 'this subject'} — ` +
            `${existing.class?.name ?? 'this class'} (${existing.academic_year?.name ?? 'this academic year'}). ` +
            `Open the existing scheme to edit it instead.`,
        );
        err.code = 'CONFLICT';
        err.existing_id = existing.id;
        throw err;
    }

    return prisma.subjectScheme.create({
        data: {
            subject_id: data.subject_id,
            class_id: data.class_id,
            academic_year_id,
            periods_per_week: data.periods_per_week,
            annual_teaching_hours: data.annual_teaching_hours,
            notes: data.notes ?? null,
            created_by_id,
        },
        include: schemeInclude,
    });
}

export async function updateScheme(
    id: number,
    data: {
        periods_per_week?: number;
        annual_teaching_hours?: number;
        notes?: string | null;
    },
) {
    // Whitelist the editable header fields. The request body arrives with
    // BOTH the camelCase keys the client sent and their snake_case copies
    // (caseConversion middleware merges rather than replaces), so passing
    // `data` straight to Prisma failed every header save with an
    // "Unknown argument `periodsPerWeek`" 500.
    const patch: { periods_per_week?: number; annual_teaching_hours?: number; notes?: string | null } = {};
    if (data.periods_per_week !== undefined && data.periods_per_week !== null) {
        const n = Number(data.periods_per_week);
        if (!Number.isInteger(n) || n < 0) {
            const err: any = new Error('periodsPerWeek must be a non-negative whole number');
            err.code = 'BAD_REQUEST';
            throw err;
        }
        patch.periods_per_week = n;
    }
    if (data.annual_teaching_hours !== undefined && data.annual_teaching_hours !== null) {
        const n = Number(data.annual_teaching_hours);
        if (!Number.isInteger(n) || n < 0) {
            const err: any = new Error('annualTeachingHours must be a non-negative whole number');
            err.code = 'BAD_REQUEST';
            throw err;
        }
        patch.annual_teaching_hours = n;
    }
    if (data.notes !== undefined) {
        patch.notes = data.notes === null ? null : String(data.notes).trim() || null;
    }
    return prisma.subjectScheme.update({
        where: { id },
        data: patch,
        include: schemeInclude,
    });
}

export async function deleteScheme(id: number) {
    // Block deletion if any LogbookEntry references a lesson in this scheme.
    const linked = await prisma.logbookEntry.count({
        where: { lesson: { chapter: { module: { subject_scheme_id: id } } } },
    });
    if (linked > 0) {
        const err: any = new Error(
            `Cannot delete scheme: ${linked} logbook entr${linked === 1 ? 'y' : 'ies'} reference its lessons.`,
        );
        err.code = 'CONFLICT';
        throw err;
    }
    await prisma.subjectScheme.delete({ where: { id } });
}

// ------- Bulk tree create / replace -------

export async function bulkCreateOrReplaceScheme(
    payload: SchemeBulkPayload,
    created_by_id: number,
) {
    const academic_year_id = await resolveAcademicYearId(payload.academic_year_id);

    return prisma.$transaction(async (tx) => {
        const existing = await tx.subjectScheme.findUnique({
            where: {
                subject_class_year_unique: {
                    subject_id: payload.subject_id,
                    class_id: payload.class_id,
                    academic_year_id,
                },
            },
            select: { id: true },
        });

        if (existing && !payload.replace) {
            const err: any = new Error(
                'A scheme already exists for this subject/class/year. Pass replace=true to overwrite.',
            );
            err.code = 'CONFLICT';
            throw err;
        }

        // If replacing, ensure no logbook entries depend on its lessons (otherwise data would be lost).
        if (existing && payload.replace) {
            const linked = await tx.logbookEntry.count({
                where: { lesson: { chapter: { module: { subject_scheme_id: existing.id } } } },
            });
            if (linked > 0) {
                const err: any = new Error(
                    `Cannot replace scheme: ${linked} logbook entr${linked === 1 ? 'y' : 'ies'} reference its lessons.`,
                );
                err.code = 'CONFLICT';
                throw err;
            }
            await tx.subjectScheme.delete({ where: { id: existing.id } });
        }

        return tx.subjectScheme.create({
            data: {
                subject_id: payload.subject_id,
                class_id: payload.class_id,
                academic_year_id,
                periods_per_week: payload.periods_per_week,
                annual_teaching_hours: payload.annual_teaching_hours,
                notes: payload.notes ?? null,
                created_by_id,
                modules: payload.modules?.length
                    ? {
                          create: payload.modules.map((m) => ({
                              order: m.order,
                              code: m.code ?? null,
                              title: m.title,
                              chapters: m.chapters?.length
                                  ? {
                                        create: m.chapters.map((c) => ({
                                            order: c.order,
                                            code: c.code ?? null,
                                            title: c.title,
                                            lessons: c.lessons?.length
                                                ? {
                                                      create: c.lessons.map((l) => ({
                                                          order: l.order,
                                                          entry_type: l.entry_type ?? 'LESSON',
                                                          title: l.title,
                                                          objectives: l.objectives ?? null,
                                                          hands_on_activities: l.hands_on_activities ?? null,
                                                          digital_resource_available:
                                                              l.digital_resource_available ?? false,
                                                          digital_resources_used: l.digital_resources_used ?? null,
                                                          term_id: l.term_id ?? null,
                                                          week_number: l.week_number ?? null,
                                                          periods_count: l.periods_count ?? 1,
                                                      })),
                                                  }
                                                : undefined,
                                        })),
                                    }
                                  : undefined,
                          })),
                      }
                    : undefined,
            },
            include: schemeInclude,
        });
    });
}

// ------- Module / Chapter / Lesson piecemeal CRUD -------

export async function addModule(subject_scheme_id: number, data: ModuleInput) {
    return prisma.schemeModule.create({
        data: {
            subject_scheme_id,
            order: data.order,
            code: data.code ?? null,
            title: data.title,
            chapters: data.chapters?.length
                ? {
                      create: data.chapters.map((c) => ({
                          order: c.order,
                          code: c.code ?? null,
                          title: c.title,
                          lessons: c.lessons?.length
                              ? {
                                    create: c.lessons.map((l) => ({
                                        order: l.order,
                                        entry_type: l.entry_type ?? 'LESSON',
                                        title: l.title,
                                        objectives: l.objectives ?? null,
                                        hands_on_activities: l.hands_on_activities ?? null,
                                        digital_resource_available: l.digital_resource_available ?? false,
                                        digital_resources_used: l.digital_resources_used ?? null,
                                        term_id: l.term_id ?? null,
                                        week_number: l.week_number ?? null,
                                        periods_count: l.periods_count ?? 1,
                                    })),
                                }
                              : undefined,
                      })),
                  }
                : undefined,
        },
        include: {
            chapters: { orderBy: { order: 'asc' }, include: { lessons: { orderBy: { order: 'asc' } } } },
        },
    });
}

export async function updateModule(
    id: number,
    data: { order?: number; code?: string | null; title?: string },
) {
    // Whitelist: req.body may carry extra keys (e.g. moduleId/id) that Prisma rejects.
    return prisma.schemeModule.update({
        where: { id },
        data: {
            ...(data.order !== undefined && { order: Number(data.order) }),
            ...(data.code !== undefined && { code: data.code }),
            ...(data.title !== undefined && { title: data.title }),
        },
    });
}

export async function deleteModule(id: number) {
    await prisma.schemeModule.delete({ where: { id } });
}

export async function addChapter(module_id: number, data: ChapterInput) {
    return prisma.schemeChapter.create({
        data: {
            module_id,
            order: data.order,
            code: data.code ?? null,
            title: data.title,
            lessons: data.lessons?.length
                ? {
                      create: data.lessons.map((l) => ({
                          order: l.order,
                          entry_type: l.entry_type ?? 'LESSON',
                          title: l.title,
                          objectives: l.objectives ?? null,
                          hands_on_activities: l.hands_on_activities ?? null,
                          digital_resource_available: l.digital_resource_available ?? false,
                          digital_resources_used: l.digital_resources_used ?? null,
                          term_id: l.term_id ?? null,
                          week_number: l.week_number ?? null,
                          periods_count: l.periods_count ?? 1,
                      })),
                  }
                : undefined,
        },
        include: { lessons: { orderBy: { order: 'asc' } } },
    });
}

export async function updateChapter(
    id: number,
    data: { order?: number; code?: string | null; title?: string },
) {
    // Whitelist: req.body may carry extra keys (e.g. moduleId/id) that Prisma rejects.
    return prisma.schemeChapter.update({
        where: { id },
        data: {
            ...(data.order !== undefined && { order: Number(data.order) }),
            ...(data.code !== undefined && { code: data.code }),
            ...(data.title !== undefined && { title: data.title }),
        },
    });
}

export async function deleteChapter(id: number) {
    await prisma.schemeChapter.delete({ where: { id } });
}

export async function addLesson(chapter_id: number, data: LessonInput) {
    return prisma.schemeLesson.create({
        data: {
            chapter_id,
            order: data.order,
            entry_type: data.entry_type ?? 'LESSON',
            title: data.title,
            objectives: data.objectives ?? null,
            hands_on_activities: data.hands_on_activities ?? null,
            digital_resource_available: data.digital_resource_available ?? false,
            digital_resources_used: data.digital_resources_used ?? null,
            term_id: data.term_id ?? null,
            week_number: data.week_number ?? null,
            periods_count: data.periods_count ?? 1,
        },
    });
}

export async function updateLesson(
    id: number,
    data: Partial<Omit<LessonInput, 'order'>> & { order?: number },
) {
    return prisma.schemeLesson.update({
        where: { id },
        data: {
            ...(data.order !== undefined && { order: data.order }),
            ...(data.entry_type && { entry_type: data.entry_type }),
            ...(data.title !== undefined && { title: data.title }),
            ...(data.objectives !== undefined && { objectives: data.objectives }),
            ...(data.hands_on_activities !== undefined && { hands_on_activities: data.hands_on_activities }),
            ...(data.digital_resource_available !== undefined && {
                digital_resource_available: data.digital_resource_available,
            }),
            ...(data.digital_resources_used !== undefined && {
                digital_resources_used: data.digital_resources_used,
            }),
            ...(data.term_id !== undefined && { term_id: data.term_id }),
            ...(data.week_number !== undefined && { week_number: data.week_number }),
            ...(data.periods_count !== undefined && { periods_count: data.periods_count }),
        },
    });
}

export async function deleteLesson(id: number) {
    const usage = await prisma.logbookEntry.count({ where: { lesson_id: id } });
    if (usage > 0) {
        const err: any = new Error(
            `Cannot delete lesson: referenced by ${usage} logbook entr${usage === 1 ? 'y' : 'ies'}.`,
        );
        err.code = 'CONFLICT';
        throw err;
    }
    await prisma.schemeLesson.delete({ where: { id } });
}

// ------- Teacher-facing reads -------

/**
 * Returns the scheme that applies to a given teacher_period (resolved from its
 * subject + sub_class.class + academic_year). Used by a teacher when opening
 * the logbook form.
 */
export async function getSchemeForTeacherPeriod(teacher_period_id: number) {
    const tp = await prisma.teacherPeriod.findUnique({
        where: { id: teacher_period_id },
        include: { sub_class: { select: { class_id: true } } },
    });
    if (!tp) return null;
    return prisma.subjectScheme.findUnique({
        where: {
            subject_class_year_unique: {
                subject_id: tp.subject_id,
                class_id: tp.sub_class.class_id,
                academic_year_id: tp.academic_year_id,
            },
        },
        include: schemeInclude,
    });
}
