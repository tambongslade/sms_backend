// HOD department status: teacher load (period tracking), scheme-of-work
// coverage (curriculum) and marks-entry status, all scoped to the HOD's
// department -- the subjects whose Subject.hod_id is the HOD.
//
// Backs the HOD menu's Period Tracking, Curriculum and Performance pages,
// which used to be 404s.
import prisma from '../../../config/db';
import { getAcademicYearId } from '../../../utils/academicYear';
import { getTeacherWorkloads } from '../../../utils/teacherWorkload';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getDepartmentStatus(hodId: number, academicYearId?: number) {
    const yearId = await getAcademicYearId(academicYearId);
    const academicYear = yearId
        ? await prisma.academicYear.findUnique({ where: { id: yearId }, select: { id: true, name: true } })
        : null;

    const subjects = await prisma.subject.findMany({
        where: { hod_id: hodId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });
    const subjectIds = subjects.map((s) => s.id);

    const empty = {
        academic_year: academicYear,
        subjects,
        teachers: [] as any[],
        scheme_coverage: [] as any[],
        marks_status: { sequence: null as any, rows: [] as any[] },
    };
    if (!yearId || subjectIds.length === 0) return empty;

    // ---- Timetable rows for the department this year ----
    const periods = await prisma.teacherPeriod.findMany({
        where: { academic_year_id: yearId, subject_id: { in: subjectIds } },
        select: {
            id: true,
            period_id: true,
            teacher_id: true,
            subject_id: true,
            sub_class_id: true,
            teacher: { select: { id: true, name: true, matricule: true } },
            subject: { select: { id: true, name: true } },
            sub_class: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
        },
    });

    // Teachers: anyone timetabled on a department subject, plus anyone
    // assigned to one (SubjectTeacher) but not yet timetabled.
    const assigned = await prisma.subjectTeacher.findMany({
        where: { subject_id: { in: subjectIds } },
        select: { subject_id: true, teacher: { select: { id: true, name: true, matricule: true } } },
    });

    type T = {
        id: number; name: string; matricule: string | null;
        subjects: Set<string>; sub_classes: Set<number>; slots: Set<number>;
    };
    const teachers = new Map<number, T>();
    const ensure = (u: { id: number; name: string; matricule: string | null }) => {
        if (!teachers.has(u.id)) {
            teachers.set(u.id, { ...u, subjects: new Set(), sub_classes: new Set(), slots: new Set() });
        }
        return teachers.get(u.id)!;
    };
    const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
    for (const a of assigned) ensure(a.teacher).subjects.add(subjectName.get(a.subject_id) ?? '');
    for (const p of periods) {
        if (!p.teacher) continue;
        const t = ensure(p.teacher);
        t.subjects.add(p.subject.name);
        t.sub_classes.add(p.sub_class_id);
        t.slots.add(p.period_id); // distinct timetable slots, same rule as getTeacherWorkloads
    }

    const teacherIds = [...teachers.keys()];
    const [workloads, logbookAll, logbookWeek, lastEntries] = await Promise.all([
        getTeacherWorkloads(teacherIds, yearId),
        prisma.logbookEntry.groupBy({
            by: ['taught_by_id'],
            where: { taught_by_id: { in: teacherIds }, teacher_period: { academic_year_id: yearId, subject_id: { in: subjectIds } } },
            _count: { _all: true },
        }),
        prisma.logbookEntry.groupBy({
            by: ['taught_by_id'],
            where: {
                taught_by_id: { in: teacherIds },
                date_taught: { gte: new Date(Date.now() - 7 * DAY_MS) },
                teacher_period: { academic_year_id: yearId, subject_id: { in: subjectIds } },
            },
            _count: { _all: true },
        }),
        prisma.logbookEntry.groupBy({
            by: ['taught_by_id'],
            where: { taught_by_id: { in: teacherIds }, teacher_period: { academic_year_id: yearId, subject_id: { in: subjectIds } } },
            _max: { date_taught: true },
        }),
    ]);
    const countOf = (rows: { taught_by_id: number; _count: { _all: number } }[]) =>
        new Map(rows.map((r) => [r.taught_by_id, r._count._all]));
    const allMap = countOf(logbookAll as any);
    const weekMap = countOf(logbookWeek as any);
    const lastMap = new Map((lastEntries as any[]).map((r) => [r.taught_by_id, r._max.date_taught as Date | null]));

    const teacherRows = [...teachers.values()]
        .map((t) => {
            const deptPeriods = t.slots.size;
            return {
                id: t.id,
                name: t.name,
                matricule: t.matricule,
                subjects: [...t.subjects].filter(Boolean).sort(),
                sub_class_count: t.sub_classes.size,
                department_periods_per_week: deptPeriods,
                total_periods_per_week: workloads.get(t.id)?.weekly_periods ?? 0,
                total_hours_per_week: workloads.get(t.id)?.total_hours_per_week ?? 0,
                logbook_entries_last_7_days: weekMap.get(t.id) ?? 0,
                logbook_entries_this_year: allMap.get(t.id) ?? 0,
                last_logbook_date: lastMap.get(t.id) ?? null,
                // Logged lessons in the last 7 days vs. department periods per week.
                logbook_rate_last_7_days: deptPeriods > 0
                    ? Math.round(Math.min(1, (weekMap.get(t.id) ?? 0) / deptPeriods) * 1000) / 10
                    : null,
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    // ---- Scheme-of-work coverage per subject x class taught ----
    const taught = new Map<string, { subject_id: number; subject_name: string; class_id: number; class_name: string; teachers: Set<string> }>();
    for (const p of periods) {
        const key = `${p.subject_id}:${p.sub_class.class.id}`;
        if (!taught.has(key)) {
            taught.set(key, {
                subject_id: p.subject_id,
                subject_name: p.subject.name,
                class_id: p.sub_class.class.id,
                class_name: p.sub_class.class.name,
                teachers: new Set(),
            });
        }
        if (p.teacher) taught.get(key)!.teachers.add(p.teacher.name);
    }
    const schemes = await prisma.subjectScheme.findMany({
        where: { academic_year_id: yearId, subject_id: { in: subjectIds } },
        select: {
            id: true,
            subject_id: true,
            class_id: true,
            subject: { select: { name: true } },
            class: { select: { name: true } },
            modules: {
                select: {
                    chapters: {
                        select: {
                            lessons: {
                                select: {
                                    id: true,
                                    logbook_entries: { where: { status: 'COMPLETED' }, select: { id: true }, take: 1 },
                                },
                            },
                        },
                    },
                },
            },
        },
    });
    const coverage: any[] = [];
    const seenKeys = new Set<string>();
    for (const sc of schemes) {
        let total = 0;
        let completed = 0;
        for (const m of sc.modules) for (const c of m.chapters) for (const l of c.lessons) {
            total += 1;
            if (l.logbook_entries.length > 0) completed += 1;
        }
        const key = `${sc.subject_id}:${sc.class_id}`;
        seenKeys.add(key);
        coverage.push({
            subject_id: sc.subject_id,
            subject_name: sc.subject.name,
            class_id: sc.class_id,
            class_name: sc.class.name,
            scheme_id: sc.id,
            total_lessons: total,
            completed_lessons: completed,
            coverage_percent: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
            teachers: [...(taught.get(key)?.teachers ?? [])].sort(),
        });
    }
    // Taught on the timetable but no scheme written yet.
    for (const [key, t] of taught) {
        if (seenKeys.has(key)) continue;
        coverage.push({
            subject_id: t.subject_id,
            subject_name: t.subject_name,
            class_id: t.class_id,
            class_name: t.class_name,
            scheme_id: null,
            total_lessons: 0,
            completed_lessons: 0,
            coverage_percent: 0,
            teachers: [...t.teachers].sort(),
        });
    }
    coverage.sort((a, b) => a.subject_name.localeCompare(b.subject_name) || a.class_name.localeCompare(b.class_name));

    // ---- Marks-entry status for the current sequence ----
    const sequence =
        (await prisma.examSequence.findFirst({
            where: { academic_year_id: yearId, status: 'OPEN' },
            orderBy: { sequence_number: 'desc' },
            select: { id: true, sequence_number: true, status: true, submission_deadline: true, term: { select: { id: true, name: true } } },
        })) ??
        (await prisma.examSequence.findFirst({
            where: { academic_year_id: yearId },
            orderBy: { sequence_number: 'desc' },
            select: { id: true, sequence_number: true, status: true, submission_deadline: true, term: { select: { id: true, name: true } } },
        }));

    let marksRows: any[] = [];
    if (sequence) {
        const scs = await prisma.subClassSubject.findMany({
            where: { subject_id: { in: subjectIds } },
            select: {
                id: true,
                subject_id: true,
                subject: { select: { name: true } },
                sub_class: {
                    select: {
                        id: true,
                        name: true,
                        class: { select: { name: true } },
                        _count: {
                            select: {
                                enrollments: { where: { academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' } } } },
                            },
                        },
                    },
                },
            },
        });
        const markCounts = await prisma.mark.groupBy({
            by: ['sub_class_subject_id'],
            where: { exam_sequence_id: sequence.id, sub_class_subject_id: { in: scs.map((s) => s.id) }, score: { not: null } },
            _count: { _all: true },
        });
        const markMap = new Map((markCounts as any[]).map((m) => [m.sub_class_subject_id, m._count._all as number]));
        const teacherBySlot = new Map<string, Set<string>>();
        for (const p of periods) {
            const k = `${p.subject_id}:${p.sub_class_id}`;
            if (!teacherBySlot.has(k)) teacherBySlot.set(k, new Set());
            if (p.teacher) teacherBySlot.get(k)!.add(p.teacher.name);
        }
        marksRows = scs
            .map((s) => {
                const students = s.sub_class._count.enrollments;
                const entered = markMap.get(s.id) ?? 0;
                return {
                    sub_class_subject_id: s.id,
                    subject_id: s.subject_id,
                    subject_name: s.subject.name,
                    sub_class_id: s.sub_class.id,
                    sub_class_name: s.sub_class.name,
                    class_name: s.sub_class.class.name,
                    teachers: [...(teacherBySlot.get(`${s.subject_id}:${s.sub_class.id}`) ?? [])].sort(),
                    students,
                    marks_entered: entered,
                    percent_entered: students > 0 ? Math.round(Math.min(1, entered / students) * 1000) / 10 : 0,
                };
            })
            .filter((r) => r.students > 0)
            .sort((a, b) => a.subject_name.localeCompare(b.subject_name) || a.class_name.localeCompare(b.class_name) || a.sub_class_name.localeCompare(b.sub_class_name));
    }

    return {
        academic_year: academicYear,
        subjects,
        teachers: teacherRows,
        scheme_coverage: coverage,
        marks_status: {
            sequence: sequence
                ? {
                      id: sequence.id,
                      sequence_number: sequence.sequence_number,
                      status: sequence.status,
                      submission_deadline: sequence.submission_deadline,
                      term: sequence.term,
                  }
                : null,
            rows: marksRows,
        },
    };
}
