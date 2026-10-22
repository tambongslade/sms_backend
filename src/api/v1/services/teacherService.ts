import prisma from '../../../config/db';
import { getAcademicYearId, getCurrentAcademicYear } from '../../../utils/academicYear';
import { paginate, PaginationOptions, FilterOptions, PaginatedResult } from '../../../utils/pagination';
import { Prisma } from '@prisma/client';
import { activeEnrollmentWhere } from '../../../utils/schoolCounts';
import { computeWorkload } from '../../../utils/teacherWorkload';
import { schoolNow, timeToMinutes, SCHOOL_TZ } from '../../../utils/schoolClock';

export interface TeacherSubject {
    id: number;
    name: string;
    category: string;
    subClasses: {
        id: number;
        name: string;
        classId: number;
        className: string;
        coefficient: number;
        periodsPerWeek: number;
        studentCount: number;
    }[];
    totalStudents: number;
    totalPeriods: number;
}

export interface TeacherStudent {
    id: number;
    name: string;
    matricule: string;
    photo?: string | null;
    enrollmentId?: number;
    /** Mean /20 of marks in this teacher's subjects this year; null when no marks yet. */
    average?: number | null;
    marksCount?: number;
    /** % of period roll-call entries this year marked PRESENT/LATE; null when never called. */
    attendanceRate?: number | null;
    /** Status in this teacher's roll call today (school timezone); null when not taken. */
    todayStatus?: 'PRESENT' | 'LATE' | 'ABSENT' | null;
    subClass: {
        id: number;
        name: string;
        class: {
            id: number;
            name: string;
        };
    };
    teacherSubjects: {
        subjectId: number;
        subjectName: string;
        coefficient: number | null;
    }[];
}

export interface TeacherSubClass {
    id: number;
    name: string;
    class: {
        id: number;
        name: string;
    };
    subjects: {
        id: number;
        name: string;
        coefficient: number | null;
        periodsPerWeek: number;
    }[];
    studentCount: number;
}

export interface TeacherDashboard {
    assignedSubjects: number;
    totalStudents: number;
    totalClasses: number;
    weeklyPeriods: number;
    totalHoursPerWeek: number;
    /** Alias of totalHoursPerWeek kept for older clients. */
    weeklyHours: number;
    marksToEnter: number;
    marksExpected: number;
    marksEntered: number;
    upcomingPeriods: number;
    attendanceRate: number | null;
}

/**
 * Check if a teacher has access to a specific subject/subclass combination
 */
export async function hasTeacherAccess(
    teacherId: number,
    subjectId?: number,
    subClassId?: number,
    academicYearId?: number
): Promise<boolean> {
    const currentYear = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) return false;

    const whereClause: any = {
        teacher_id: teacherId,
        academic_year_id: currentYear
    };

    if (subjectId) whereClause.subject_id = subjectId;
    if (subClassId) whereClause.sub_class_id = subClassId;

    const assignment = await prisma.teacherPeriod.findFirst({
        where: whereClause
    });

    return !!assignment;
}

/**
 * Get subjects assigned to a teacher with subclass details
 */
export async function getTeacherSubjects(
    teacherId: number,
    academicYearId?: number
): Promise<TeacherSubject[]> {
    const currentYear = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) return [];

    // Get teacher periods (which now contain direct teacher_id and subject_id references)
    const teacherPeriods = await prisma.teacherPeriod.findMany({
        where: {
            teacher_id: teacherId,
            academic_year_id: currentYear
        },
        include: {
            subject: true,
            sub_class: {
                include: {
                    class: true,
                    enrollments: {
                        where: activeEnrollmentWhere(currentYear),
                        select: { id: true }
                    }
                }
            }
        }
    });

    // If we have teacher periods, use them
    if (teacherPeriods.length > 0) {
        // Group by subject
        const subjectMap = new Map<number, TeacherSubject>();

        // Get SubClassSubject data for coefficient lookup
        const subClassSubjects = await prisma.subClassSubject.findMany({
            where: {
                sub_class_id: { in: [...new Set(teacherPeriods.map(tp => tp.sub_class_id))] },
                subject_id: { in: [...new Set(teacherPeriods.map(tp => tp.subject_id))] }
            }
        });

        // Create a lookup map for coefficients
        const coefficientMap = new Map<string, number>();
        subClassSubjects.forEach(scs => {
            const key = `${scs.sub_class_id}-${scs.subject_id}`;
            coefficientMap.set(key, scs.coefficient);
        });

        teacherPeriods.forEach(period => {
            const subjectId = period.subject.id;

            if (!subjectMap.has(subjectId)) {
                subjectMap.set(subjectId, {
                    id: period.subject.id,
                    name: period.subject.name,
                    category: period.subject.category,
                    subClasses: [],
                    totalStudents: 0,
                    totalPeriods: 0
                });
            }

            const subject = subjectMap.get(subjectId)!;

            // Check if this subclass is already added for this subject
            let existingSubClass = subject.subClasses.find(sc => sc.id === period.sub_class.id);

            if (!existingSubClass) {
                // Get coefficient from SubClassSubject table
                const coefficientKey = `${period.sub_class_id}-${period.subject_id}`;
                const coefficient = coefficientMap.get(coefficientKey) || 1;

                existingSubClass = {
                    id: period.sub_class.id,
                    name: period.sub_class.name,
                    classId: period.sub_class.class_id,
                    className: period.sub_class.class.name,
                    coefficient: coefficient,
                    periodsPerWeek: 0, // Will be calculated below
                    studentCount: period.sub_class.enrollments.length
                };

                subject.subClasses.push(existingSubClass);
                subject.totalStudents += period.sub_class.enrollments.length;
            }

            // Count periods per week for this subclass-subject combination
            existingSubClass.periodsPerWeek += 1;
            subject.totalPeriods += 1;
        });

        return Array.from(subjectMap.values());
    }

    // Fallback: If no teacher periods, check subject_teacher table
    const subjectTeachers = await prisma.subjectTeacher.findMany({
        where: { teacher_id: teacherId },
        include: {
            subject: true
        }
    });

    if (subjectTeachers.length === 0) {
        return [];
    }

    // For subject_teacher relationships, we need to find which subclasses teach these subjects
    const subjectIds = subjectTeachers.map(st => st.subject_id);

    // Get all subclasses that teach these subjects in the current academic year
    const subClassSubjects = await prisma.subClassSubject.findMany({
        where: {
            subject_id: { in: subjectIds }
        },
        include: {
            subject: true,
            sub_class: {
                include: {
                    class: true,
                    enrollments: {
                        where: activeEnrollmentWhere(currentYear),
                        select: { id: true }
                    }
                }
            }
        }
    });

    // Group by subject for fallback data
    const subjectMap = new Map<number, TeacherSubject>();

    subClassSubjects.forEach(scs => {
        const subjectId = scs.subject.id;

        if (!subjectMap.has(subjectId)) {
            subjectMap.set(subjectId, {
                id: scs.subject.id,
                name: scs.subject.name,
                category: scs.subject.category,
                subClasses: [],
                totalStudents: 0,
                totalPeriods: 0
            });
        }

        const subject = subjectMap.get(subjectId)!;
        subject.subClasses.push({
            id: scs.sub_class.id,
            name: scs.sub_class.name,
            classId: scs.sub_class.class_id,
            className: scs.sub_class.class.name,
            coefficient: scs.coefficient, // Use coefficient from SubClassSubject
            // No timetable slots exist for this teacher, so 0 -- the old default
            // of 1 showed a fake "1p/week" for every class.
            periodsPerWeek: 0,
            studentCount: scs.sub_class.enrollments.length
        });

        subject.totalStudents += scs.sub_class.enrollments.length;
    });

    return Array.from(subjectMap.values());
}

/**
 * Get students that a teacher teaches (across all subjects/subclasses).
 *
 * Paginated in the database (not by loading every enrolment of every period),
 * with real per-student figures for the page:
 * - average: mean /20 of the student's marks in this teacher's subjects for the year (null if none)
 * - attendanceRate: % of period roll-call entries this year marked PRESENT or LATE (null if never called)
 * - todayStatus: status in this teacher's roll call today (school timezone), null if not taken yet
 */
export async function getTeacherStudents(
    teacherId: number,
    filters: {
        subClassId?: number;
        subjectId?: number;
        academicYearId?: number;
        search?: string;
    } = {},
    paginationOptions?: PaginationOptions
): Promise<PaginatedResult<TeacherStudent>> {
    const page = paginationOptions?.page || 1;
    const limit = paginationOptions?.limit || 10;
    const empty = { data: [], meta: { total: 0, page, limit, totalPages: 0 } };

    const currentYear = filters.academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) return empty;

    const teacherPeriods = await prisma.teacherPeriod.findMany({
        where: {
            teacher_id: teacherId,
            academic_year_id: currentYear,
            ...(filters.subClassId ? { sub_class_id: filters.subClassId } : {}),
            ...(filters.subjectId ? { subject_id: filters.subjectId } : {})
        },
        select: { sub_class_id: true, subject: { select: { id: true, name: true } } }
    });
    if (teacherPeriods.length === 0) return empty;

    // sub_class_id -> subject_id -> name
    const subjectsBySubClass = new Map<number, Map<number, string>>();
    for (const tp of teacherPeriods) {
        const m = subjectsBySubClass.get(tp.sub_class_id) ?? new Map<number, string>();
        m.set(tp.subject.id, tp.subject.name);
        subjectsBySubClass.set(tp.sub_class_id, m);
    }
    const subClassIds = [...subjectsBySubClass.keys()];
    const subjectIds = [...new Set(teacherPeriods.map(tp => tp.subject.id))];

    const subClassSubjects = await prisma.subClassSubject.findMany({
        where: { sub_class_id: { in: subClassIds }, subject_id: { in: subjectIds } },
        select: { id: true, sub_class_id: true, subject_id: true, coefficient: true }
    });
    const scsByKey = new Map(subClassSubjects.map(s => [`${s.sub_class_id}-${s.subject_id}`, s]));
    const teacherScsIds = subClassSubjects
        .filter(s => subjectsBySubClass.get(s.sub_class_id)?.has(s.subject_id))
        .map(s => s.id);

    const term = filters.search?.trim();
    const where: Prisma.EnrollmentWhereInput = {
        AND: [
            activeEnrollmentWhere(currentYear),
            { sub_class_id: { in: subClassIds } },
            ...(term
                ? [{
                    student: {
                        OR: [
                            { name: { contains: term, mode: 'insensitive' as const } },
                            { matricule: { contains: term, mode: 'insensitive' as const } }
                        ]
                    }
                }]
                : [])
        ]
    };

    const [total, enrollments] = await Promise.all([
        prisma.enrollment.count({ where }),
        prisma.enrollment.findMany({
            where,
            orderBy: { student: { name: 'asc' } },
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id: true,
                sub_class_id: true,
                photo: true,
                student: { select: { id: true, name: true, matricule: true } },
                sub_class: { select: { id: true, name: true, class: { select: { id: true, name: true } } } }
            }
        })
    ]);

    const enrollmentIds = enrollments.map(e => e.id);
    const today = schoolNow().dateOnly;

    const [marks, attendanceGroups, todayEntries] = enrollmentIds.length === 0
        ? [[], [], []] as [any[], any[], any[]]
        : await Promise.all([
            prisma.mark.findMany({
                where: {
                    enrollment_id: { in: enrollmentIds },
                    sub_class_subject_id: { in: teacherScsIds },
                    score: { not: null },
                    exam_sequence: { academic_year_id: currentYear }
                },
                select: { enrollment_id: true, score: true }
            }),
            prisma.teacherRollCallEntry.groupBy({
                by: ['enrollment_id', 'status'],
                where: {
                    enrollment_id: { in: enrollmentIds },
                    teacher_roll_call: { academic_year_id: currentYear }
                },
                _count: { _all: true }
            }),
            prisma.teacherRollCallEntry.findMany({
                where: {
                    enrollment_id: { in: enrollmentIds },
                    teacher_roll_call: { date: today, teacher_period: { teacher_id: teacherId } }
                },
                select: { enrollment_id: true, status: true, updated_at: true },
                orderBy: { updated_at: 'asc' } // later rows overwrite -> latest wins
            })
        ]);

    const markAgg = new Map<number, { sum: number; n: number }>();
    for (const m of marks) {
        const a = markAgg.get(m.enrollment_id) ?? { sum: 0, n: 0 };
        a.sum += m.score ?? 0;
        a.n += 1;
        markAgg.set(m.enrollment_id, a);
    }
    const attAgg = new Map<number, { present: number; total: number }>();
    for (const g of attendanceGroups as any[]) {
        const a = attAgg.get(g.enrollment_id) ?? { present: 0, total: 0 };
        a.total += g._count._all;
        if (g.status === 'PRESENT' || g.status === 'LATE') a.present += g._count._all;
        attAgg.set(g.enrollment_id, a);
    }
    const todayStatus = new Map<number, string>();
    for (const e of todayEntries) todayStatus.set(e.enrollment_id, e.status);

    const data: TeacherStudent[] = enrollments.map(e => {
        const subjects = subjectsBySubClass.get(e.sub_class_id ?? -1) ?? new Map<number, string>();
        const mk = markAgg.get(e.id);
        const att = attAgg.get(e.id);
        return {
            id: e.student.id,
            name: e.student.name,
            matricule: e.student.matricule,
            photo: e.photo ?? null,
            enrollmentId: e.id,
            subClass: {
                id: e.sub_class?.id ?? 0,
                name: e.sub_class?.name ?? '',
                class: { id: e.sub_class?.class.id ?? 0, name: e.sub_class?.class.name ?? '' }
            },
            teacherSubjects: [...subjects.entries()].map(([subjectId, subjectName]) => ({
                subjectId,
                subjectName,
                coefficient: scsByKey.get(`${e.sub_class_id}-${subjectId}`)?.coefficient ?? null
            })),
            average: mk && mk.n > 0 ? Math.round((mk.sum / mk.n) * 100) / 100 : null,
            marksCount: mk?.n ?? 0,
            attendanceRate: att && att.total > 0 ? Math.round((att.present / att.total) * 1000) / 10 : null,
            todayStatus: (todayStatus.get(e.id) as TeacherStudent['todayStatus']) ?? null
        };
    });

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
}

/**
 * Get subclasses that a teacher teaches
 */
export async function getTeacherSubClasses(
    teacherId: number,
    academicYearId?: number
): Promise<TeacherSubClass[]> {
    const currentYear = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) return [];

    const teacherPeriods = await prisma.teacherPeriod.findMany({
        where: {
            teacher_id: teacherId,
            academic_year_id: currentYear
        },
        select: {
            sub_class_id: true,
            period_id: true,
            subject: { select: { id: true, name: true } },
            sub_class: { select: { id: true, name: true, class: { select: { id: true, name: true } } } }
        }
    });
    if (teacherPeriods.length === 0) return [];

    const subClassIds = [...new Set(teacherPeriods.map(tp => tp.sub_class_id))];
    const [subClassSubjects, enrollmentCounts] = await Promise.all([
        prisma.subClassSubject.findMany({
            where: {
                sub_class_id: { in: subClassIds },
                subject_id: { in: [...new Set(teacherPeriods.map(tp => tp.subject.id))] }
            },
            select: { sub_class_id: true, subject_id: true, coefficient: true }
        }),
        prisma.enrollment.groupBy({
            by: ['sub_class_id'],
            where: { AND: [activeEnrollmentWhere(currentYear), { sub_class_id: { in: subClassIds } }] },
            _count: { _all: true }
        })
    ]);
    const coefficientMap = new Map(subClassSubjects.map(s => [`${s.sub_class_id}-${s.subject_id}`, s.coefficient]));
    const countMap = new Map(enrollmentCounts.map(c => [c.sub_class_id, c._count._all]));

    // Group by subclass; count distinct timetable slots per subject.
    const subClassMap = new Map<number, TeacherSubClass>();
    const slotSets = new Map<string, Set<number>>();
    for (const tp of teacherPeriods) {
        let subClass = subClassMap.get(tp.sub_class_id);
        if (!subClass) {
            subClass = {
                id: tp.sub_class.id,
                name: tp.sub_class.name,
                class: { id: tp.sub_class.class.id, name: tp.sub_class.class.name },
                subjects: [],
                studentCount: countMap.get(tp.sub_class_id) ?? 0
            };
            subClassMap.set(tp.sub_class_id, subClass);
        }
        const key = `${tp.sub_class_id}-${tp.subject.id}`;
        const slots = slotSets.get(key) ?? new Set<number>();
        slots.add(tp.period_id);
        slotSets.set(key, slots);
        let subject = subClass.subjects.find(s => s.id === tp.subject.id);
        if (!subject) {
            subject = {
                id: tp.subject.id,
                name: tp.subject.name,
                coefficient: coefficientMap.get(key) ?? null,
                periodsPerWeek: 0
            };
            subClass.subjects.push(subject);
        }
        subject.periodsPerWeek = slots.size;
    }

    return Array.from(subClassMap.values());
}

/**
 * Get teacher dashboard statistics. Every figure is computed from real data:
 * - weeklyPeriods / totalHoursPerWeek: distinct timetable slots and their clock time
 * - totalStudents: active students in the teacher's sub-classes
 * - marksToEnter: (active students x teacher's subjects) per OPEN sequence whose
 *   term has started, minus marks already entered with a score
 * - attendanceRate: teacher's own attendance as recorded per period by the
 *   discipline master (PRESENT or LATE / all records); null when nothing recorded
 * - upcomingPeriods: periods still to start today (school timezone)
 */
export async function getTeacherDashboard(
    teacherId: number,
    academicYearId?: number
): Promise<TeacherDashboard> {
    const currentYear = academicYearId || (await getCurrentAcademicYear())?.id;
    const emptyDashboard: TeacherDashboard = {
        assignedSubjects: 0,
        totalStudents: 0,
        totalClasses: 0,
        weeklyPeriods: 0,
        totalHoursPerWeek: 0,
        weeklyHours: 0,
        marksToEnter: 0,
        marksExpected: 0,
        marksEntered: 0,
        upcomingPeriods: 0,
        attendanceRate: null
    };
    if (!currentYear) return emptyDashboard;

    const teacherPeriods = await prisma.teacherPeriod.findMany({
        where: { teacher_id: teacherId, academic_year_id: currentYear },
        select: {
            subject_id: true,
            sub_class_id: true,
            period_id: true,
            period: { select: { start_time: true, end_time: true, is_break: true, type: true, day_of_week: true } }
        }
    });
    if (teacherPeriods.length === 0) return emptyDashboard;

    const subClassIds = [...new Set(teacherPeriods.map(tp => tp.sub_class_id))];
    const subjectIds = [...new Set(teacherPeriods.map(tp => tp.subject_id))];
    const workload = computeWorkload(teacherPeriods);

    const now = schoolNow();
    const upcomingPeriods = new Set(
        teacherPeriods
            .filter(tp => tp.period.day_of_week === now.dayOfWeek && !tp.period.is_break
                && timeToMinutes(tp.period.start_time) > now.minutes)
            .map(tp => tp.period_id)
    ).size;

    const pairKeys = new Set(teacherPeriods.map(tp => `${tp.sub_class_id}-${tp.subject_id}`));

    const [enrollmentCounts, subClassSubjects, openSequences, attendanceGroups] = await Promise.all([
        prisma.enrollment.groupBy({
            by: ['sub_class_id'],
            where: { AND: [activeEnrollmentWhere(currentYear), { sub_class_id: { in: subClassIds } }] },
            _count: { _all: true }
        }),
        prisma.subClassSubject.findMany({
            where: { sub_class_id: { in: subClassIds }, subject_id: { in: subjectIds } },
            select: { id: true, sub_class_id: true, subject_id: true }
        }),
        prisma.examSequence.findMany({
            where: {
                academic_year_id: currentYear,
                status: 'OPEN',
                term: { OR: [{ start_date: null }, { start_date: { lte: new Date() } }] }
            },
            select: { id: true }
        }),
        prisma.teacherPeriodAttendance.groupBy({
            by: ['status'],
            where: { academic_year_id: currentYear, teacher_period: { teacher_id: teacherId } },
            _count: { _all: true }
        })
    ]);

    const countBySubClass = new Map(enrollmentCounts.map(c => [c.sub_class_id, c._count._all]));
    const totalStudents = enrollmentCounts.reduce((s, c) => s + c._count._all, 0);

    const teacherScs = subClassSubjects.filter(s => pairKeys.has(`${s.sub_class_id}-${s.subject_id}`));
    const sequenceIds = openSequences.map(s => s.id);
    const marksExpected = teacherScs.reduce((s, scs) => s + (countBySubClass.get(scs.sub_class_id) ?? 0), 0) * sequenceIds.length;
    const marksEntered = marksExpected === 0 ? 0 : await prisma.mark.count({
        where: {
            sub_class_subject_id: { in: teacherScs.map(s => s.id) },
            exam_sequence_id: { in: sequenceIds },
            score: { not: null },
            enrollment: activeEnrollmentWhere(currentYear)
        }
    });

    const attTotal = attendanceGroups.reduce((s, g) => s + g._count._all, 0);
    const attPresent = attendanceGroups
        .filter(g => g.status === 'PRESENT' || g.status === 'LATE')
        .reduce((s, g) => s + g._count._all, 0);

    return {
        assignedSubjects: subjectIds.length,
        totalStudents,
        totalClasses: subClassIds.length,
        weeklyPeriods: workload.weekly_periods,
        totalHoursPerWeek: workload.total_hours_per_week,
        weeklyHours: workload.total_hours_per_week,
        marksToEnter: Math.max(marksExpected - marksEntered, 0),
        marksExpected,
        marksEntered,
        upcomingPeriods,
        attendanceRate: attTotal > 0 ? Math.round((attPresent / attTotal) * 1000) / 10 : null
    };
}

/**
 * Get subclass IDs that a teacher teaches
 */
export async function getTeacherSubClassIds(
    teacherId: number,
    academicYearId?: number
): Promise<number[]> {
    const currentYear = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) return [];

    const periods = await prisma.teacherPeriod.findMany({
        where: {
            teacher_id: teacherId,
            academic_year_id: currentYear
        },
        select: { sub_class_id: true },
        distinct: ['sub_class_id']
    });

    return periods.map(period => period.sub_class_id);
}

/**
 * Get subject IDs that a teacher teaches
 */
export async function getTeacherSubjectIds(
    teacherId: number,
    academicYearId?: number
): Promise<number[]> {
    const currentYear = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) return [];

    const periods = await prisma.teacherPeriod.findMany({
        where: {
            teacher_id: teacherId,
            academic_year_id: currentYear
        },
        select: { subject_id: true },
        distinct: ['subject_id']
    });

    return periods.map(period => period.subject_id);
}

// =============================
// TEACHER ATTENDANCE MANAGEMENT
// =============================

export interface TeacherAttendanceRecord {
    id: number;
    date: string;
    status: 'PRESENT' | 'ABSENT' | 'LATE' | 'SICK_LEAVE' | 'AUTHORIZED_LEAVE';
    reason?: string;
    periodId?: number;
    periodName?: string;
    recordedBy: string;
    createdAt: string;
}

export interface StudentAttendanceRecord {
    id: number;
    studentId: number;
    studentName: string;
    studentMatricule: string;
    date: string;
    status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
    reason?: string;
    periodId?: number;
    periodName?: string;
    subClassName: string;
    subjectName: string;
}

export interface AttendanceStatistics {
    totalStudents: number;
    presentToday: number;
    absentToday: number;
    lateToday: number;
    attendanceRate: number;
    weeklyTrends: Array<{
        date: string;
        presentCount: number;
        absentCount: number;
        lateCount: number;
        attendanceRate: number;
    }>;
    subClassBreakdown: Array<{
        subClassId: number;
        subClassName: string;
        totalStudents: number;
        attendanceRate: number;
        absentStudents: number;
    }>;
}

/**
 * Get teacher's own attendance records
 */
export async function getMyAttendance(
    teacherId: number,
    filters: {
        startDate?: string;
        endDate?: string;
        academicYearId?: number;
    } = {},
    paginationOptions?: PaginationOptions
): Promise<PaginatedResult<TeacherAttendanceRecord>> {
    const currentYear = filters.academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) {
        return { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } };
    }

    const whereClause: any = {
        teacher_id: teacherId
    };

    // Apply date filters
    if (filters.startDate || filters.endDate) {
        whereClause.created_at = {};
        if (filters.startDate) {
            whereClause.created_at.gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
            whereClause.created_at.lte = new Date(filters.endDate);
        }
    }

    const teacherAbsences = await prisma.teacherAbsence.findMany({
        where: whereClause,
        include: {
            assigned_by: { select: { name: true } },
            teacher_period: {
                include: {
                    period: true,
                    subject: true
                }
            }
        },
        orderBy: { created_at: 'desc' }
    });

    // Transform data
    const attendanceRecords: TeacherAttendanceRecord[] = teacherAbsences.map(absence => ({
        id: absence.id,
        date: absence.created_at.toISOString().split('T')[0],
        status: (absence.reason?.includes('SICK') ? 'SICK_LEAVE' :
            absence.reason?.includes('AUTHORIZED') ? 'AUTHORIZED_LEAVE' :
                'ABSENT') as any,
        reason: absence.reason || undefined,
        periodId: absence.teacher_period?.period.id,
        periodName: absence.teacher_period?.period.name,
        recordedBy: absence.assigned_by.name,
        createdAt: absence.created_at.toISOString()
    }));

    // Apply pagination manually for arrays
    if (paginationOptions) {
        const page = paginationOptions.page || 1;
        const limit = paginationOptions.limit || 10;
        const skip = (page - 1) * limit;

        // Apply sorting if specified
        if (paginationOptions.sortBy) {
            attendanceRecords.sort((a, b) => {
                const aValue = (a as any)[paginationOptions.sortBy!];
                const bValue = (b as any)[paginationOptions.sortBy!];

                if (paginationOptions.sortOrder === 'desc') {
                    return bValue > aValue ? 1 : -1;
                }
                return aValue > bValue ? 1 : -1;
            });
        }

        const paginatedData = attendanceRecords.slice(skip, skip + limit);
        const totalPages = Math.ceil(attendanceRecords.length / limit);

        return {
            data: paginatedData,
            meta: {
                total: attendanceRecords.length,
                page,
                limit,
                totalPages
            }
        };
    }

    return {
        data: attendanceRecords,
        meta: {
            total: attendanceRecords.length,
            page: 1,
            limit: attendanceRecords.length,
            totalPages: 1
        }
    };
}

/**
 * Record student attendance for teacher's classes
 */
export async function recordStudentAttendance(
    teacherId: number,
    attendanceData: {
        studentId: number;
        subClassId: number;
        subjectId: number;
        status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
        reason?: string;
        periodId?: number;
        date?: string;
        academicYearId?: number;
    }
): Promise<StudentAttendanceRecord> {
    const currentYear = attendanceData.academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) {
        throw new Error('No current academic year found');
    }

    // Verify teacher has access to this subclass/subject combination
    const hasAccess = await hasTeacherAccess(
        teacherId,
        attendanceData.subjectId,
        attendanceData.subClassId,
        currentYear
    );

    if (!hasAccess) {
        throw new Error('Teacher does not have access to this class/subject combination');
    }

    // Get student enrollment
    const enrollment = await prisma.enrollment.findFirst({
        where: {
            student_id: attendanceData.studentId,
            sub_class_id: attendanceData.subClassId,
            academic_year_id: currentYear
        },
        include: {
            student: true,
            sub_class: {
                include: { class: true }
            }
        }
    });

    if (!enrollment) {
        throw new Error('Student is not enrolled in the specified class');
    }

    // Find teacher period for context
    const teacherPeriod = await prisma.teacherPeriod.findFirst({
        where: {
            teacher_id: teacherId,
            subject_id: attendanceData.subjectId,
            sub_class_id: attendanceData.subClassId,
            academic_year_id: currentYear,
            ...(attendanceData.periodId && { period_id: attendanceData.periodId })
        },
        include: {
            period: true,
            subject: true
        }
    });

    // Record attendance only for absences/lateness (following existing pattern)
    if (attendanceData.status === 'ABSENT' || attendanceData.status === 'LATE' || attendanceData.status === 'EXCUSED') {
        // Check if record already exists for this period
        const existingAbsence = await prisma.studentAbsence.findFirst({
            where: {
                enrollment_id: enrollment.id,
                teacher_period_id: teacherPeriod?.id,
                created_at: {
                    gte: new Date(attendanceData.date || new Date().toISOString().split('T')[0]),
                    lt: new Date(new Date(attendanceData.date || new Date()).getTime() + 24 * 60 * 60 * 1000)
                }
            }
        });

        if (existingAbsence) {
            throw new Error('Attendance record already exists for this student and period');
        }

        const absence = await prisma.studentAbsence.create({
            data: {
                enrollment_id: enrollment.id,
                assigned_by_id: teacherId,
                teacher_period_id: teacherPeriod?.id,
                absence_type: attendanceData.status === 'LATE' ? 'MORNING_LATENESS' : 'CLASS_ABSENCE'
            }
        });

        return {
            id: absence.id,
            studentId: enrollment.student.id,
            studentName: enrollment.student.name,
            studentMatricule: enrollment.student.matricule || '',
            date: absence.created_at.toISOString().split('T')[0],
            status: attendanceData.status,
            reason: attendanceData.reason,
            periodId: teacherPeriod?.period.id,
            periodName: teacherPeriod?.period.name,
            subClassName: enrollment.sub_class?.name || '',
            subjectName: teacherPeriod?.subject.name || ''
        };
    }

    // For PRESENT status, return a success response without creating a record
    return {
        id: 0, // No actual record for present status
        studentId: enrollment.student.id,
        studentName: enrollment.student.name,
        studentMatricule: enrollment.student.matricule || '',
        date: attendanceData.date || new Date().toISOString().split('T')[0],
        status: 'PRESENT',
        reason: undefined,
        periodId: teacherPeriod?.period.id,
        periodName: teacherPeriod?.period.name,
        subClassName: enrollment.sub_class?.name || '',
        subjectName: teacherPeriod?.subject.name || ''
    };
}

/**
 * Get attendance statistics for teacher's classes
 */
export async function getAttendanceStatistics(
    teacherId: number,
    filters: {
        subClassId?: number;
        subjectId?: number;
        startDate?: string;
        endDate?: string;
        academicYearId?: number;
    } = {}
): Promise<AttendanceStatistics> {
    const currentYear = filters.academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) {
        throw new Error('No current academic year found');
    }

    // Get teacher's assigned subclasses
    const teacherPeriods = await prisma.teacherPeriod.findMany({
        where: {
            teacher_id: teacherId,
            academic_year_id: currentYear,
            ...(filters.subClassId && { sub_class_id: filters.subClassId }),
            ...(filters.subjectId && { subject_id: filters.subjectId })
        },
        include: {
            sub_class: {
                include: {
                    class: true,
                    enrollments: {
                        where: { academic_year_id: currentYear }
                    }
                }
            },
            subject: true
        }
    });

    if (teacherPeriods.length === 0) {
        return {
            totalStudents: 0,
            presentToday: 0,
            absentToday: 0,
            lateToday: 0,
            attendanceRate: 0,
            weeklyTrends: [],
            subClassBreakdown: []
        };
    }

    // Get unique subclasses and total students
    const uniqueSubClasses = Array.from(
        new Set(teacherPeriods.map(tp => tp.sub_class_id))
    ).map(subClassId => {
        const period = teacherPeriods.find(tp => tp.sub_class_id === subClassId)!;
        return {
            id: period.sub_class.id,
            name: period.sub_class.name,
            enrollments: period.sub_class.enrollments
        };
    });

    const totalStudents = uniqueSubClasses.reduce((sum, sc) => sum + sc.enrollments.length, 0);

    // Get today's date range
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // Get absences for today
    const todayAbsences = await prisma.studentAbsence.findMany({
        where: {
            teacher_period_id: { in: teacherPeriods.map(tp => tp.id) },
            created_at: {
                gte: todayStart,
                lt: todayEnd
            }
        },
        include: {
            enrollment: true
        }
    });

    const absentToday = todayAbsences.filter(abs => abs.absence_type === 'CLASS_ABSENCE').length;
    const lateToday = todayAbsences.filter(abs => abs.absence_type === 'MORNING_LATENESS').length;
    const presentToday = totalStudents - absentToday - lateToday;

    // Calculate weekly trends (last 7 days)
    const weeklyTrends = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

        const dayAbsences = await prisma.studentAbsence.findMany({
            where: {
                teacher_period_id: { in: teacherPeriods.map(tp => tp.id) },
                created_at: {
                    gte: dayStart,
                    lt: dayEnd
                }
            }
        });

        const dayAbsentCount = dayAbsences.filter(abs => abs.absence_type === 'CLASS_ABSENCE').length;
        const dayLateCount = dayAbsences.filter(abs => abs.absence_type === 'MORNING_LATENESS').length;
        const dayPresentCount = totalStudents - dayAbsentCount - dayLateCount;

        weeklyTrends.push({
            date: date.toISOString().split('T')[0],
            presentCount: dayPresentCount,
            absentCount: dayAbsentCount,
            lateCount: dayLateCount,
            attendanceRate: totalStudents > 0 ? (dayPresentCount / totalStudents) * 100 : 0
        });
    }

    // Calculate subclass breakdown
    const subClassBreakdown = await Promise.all(
        uniqueSubClasses.map(async (subClass) => {
            const subClassPeriods = teacherPeriods.filter(tp => tp.sub_class_id === subClass.id);

            const subClassAbsences = await prisma.studentAbsence.findMany({
                where: {
                    teacher_period_id: { in: subClassPeriods.map(tp => tp.id) },
                    created_at: {
                        gte: todayStart,
                        lt: todayEnd
                    }
                }
            });

            const absentStudents = subClassAbsences.filter(abs => abs.absence_type === 'CLASS_ABSENCE').length;
            const presentStudents = subClass.enrollments.length - absentStudents;

            return {
                subClassId: subClass.id,
                subClassName: subClass.name,
                totalStudents: subClass.enrollments.length,
                attendanceRate: subClass.enrollments.length > 0 ? (presentStudents / subClass.enrollments.length) * 100 : 0,
                absentStudents
            };
        })
    );

    return {
        totalStudents,
        presentToday,
        absentToday,
        lateToday,
        attendanceRate: totalStudents > 0 ? (presentToday / totalStudents) * 100 : 0,
        weeklyTrends,
        subClassBreakdown
    };
}

/**
 * Get attendance records for a specific subclass
 */
export async function getSubClassAttendance(
    teacherId: number,
    subClassId: number,
    filters: {
        date?: string;
        subjectId?: number;
        academicYearId?: number;
    } = {},
    paginationOptions?: PaginationOptions
): Promise<PaginatedResult<StudentAttendanceRecord>> {
    const currentYear = filters.academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) {
        return { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } };
    }

    // Verify teacher has access to this subclass
    const hasAccess = await hasTeacherAccess(
        teacherId,
        filters.subjectId,
        subClassId,
        currentYear
    );

    if (!hasAccess) {
        throw new Error('Teacher does not have access to this class');
    }

    // Get all students in the subclass
    const enrollments = await prisma.enrollment.findMany({
        where: {
            sub_class_id: subClassId,
            academic_year_id: currentYear,
            student: { status: { not: 'WITHDRAWN' } }
        },
        include: {
            student: true,
            sub_class: {
                include: { class: true }
            }
        }
    });

    // Get teacher periods for this subclass
    const teacherPeriods = await prisma.teacherPeriod.findMany({
        where: {
            teacher_id: teacherId,
            sub_class_id: subClassId,
            academic_year_id: currentYear,
            ...(filters.subjectId && { subject_id: filters.subjectId })
        },
        include: {
            period: true,
            subject: true
        }
    });

    // Get absence records
    const whereClause: any = {
        teacher_period_id: { in: teacherPeriods.map(tp => tp.id) }
    };

    if (filters.date) {
        const date = new Date(filters.date);
        const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

        whereClause.created_at = {
            gte: dayStart,
            lt: dayEnd
        };
    }

    const absences = await prisma.studentAbsence.findMany({
        where: whereClause,
        include: {
            enrollment: {
                include: {
                    student: true,
                    sub_class: true
                }
            },
            teacher_period: {
                include: {
                    period: true,
                    subject: true
                }
            }
        },
        orderBy: { created_at: 'desc' }
    });

    // Transform to attendance records
    const attendanceRecords: StudentAttendanceRecord[] = [];

    // Add absence records
    absences.forEach(absence => {
        attendanceRecords.push({
            id: absence.id,
            studentId: absence.enrollment.student.id,
            studentName: absence.enrollment.student.name,
            studentMatricule: absence.enrollment.student.matricule || '',
            date: absence.created_at.toISOString().split('T')[0],
            status: absence.absence_type === 'MORNING_LATENESS' ? 'LATE' : 'ABSENT',
            reason: undefined,
            periodId: absence.teacher_period?.period.id,
            periodName: absence.teacher_period?.period.name,
            subClassName: absence.enrollment.sub_class?.name || '',
            subjectName: absence.teacher_period?.subject.name || ''
        });
    });

    // If specific date requested, add present students
    if (filters.date) {
        const absentStudentIds = new Set(absences.map(abs => abs.enrollment.student_id));

        enrollments.forEach(enrollment => {
            if (!absentStudentIds.has(enrollment.student_id)) {
                // This student was present
                attendanceRecords.push({
                    id: 0, // No actual record for present
                    studentId: enrollment.student.id,
                    studentName: enrollment.student.name,
                    studentMatricule: enrollment.student.matricule || '',
                    date: filters.date!,
                    status: 'PRESENT',
                    reason: undefined,
                    periodId: undefined,
                    periodName: undefined,
                    subClassName: enrollment.sub_class?.name || '',
                    subjectName: filters.subjectId ? teacherPeriods.find(tp => tp.subject_id === filters.subjectId)?.subject.name || '' : ''
                });
            }
        });
    }

    // Apply pagination manually for arrays
    if (paginationOptions) {
        const page = paginationOptions.page || 1;
        const limit = paginationOptions.limit || 10;
        const skip = (page - 1) * limit;

        // Apply sorting if specified
        if (paginationOptions.sortBy) {
            attendanceRecords.sort((a, b) => {
                const aValue = (a as any)[paginationOptions.sortBy!];
                const bValue = (b as any)[paginationOptions.sortBy!];

                if (paginationOptions.sortOrder === 'desc') {
                    return bValue > aValue ? 1 : -1;
                }
                return aValue > bValue ? 1 : -1;
            });
        }

        const paginatedData = attendanceRecords.slice(skip, skip + limit);
        const totalPages = Math.ceil(attendanceRecords.length / limit);

        return {
            data: paginatedData,
            meta: {
                total: attendanceRecords.length,
                page,
                limit,
                totalPages
            }
        };
    }

    return {
        data: attendanceRecords,
        meta: {
            total: attendanceRecords.length,
            page: 1,
            limit: attendanceRecords.length,
            totalPages: 1
        }
    };
}

export interface CurrentNextSubject {
    current: {
        period: {
            id: number;
            name: string;
            startTime: string;
            endTime: string;
            dayOfWeek: string;
        };
        subject: {
            id: number;
            name: string;
            category: string;
        };
        subClass: {
            id: number;
            name: string;
            className: string;
        };
        isActive: boolean;
        minutesRemaining?: number;
    } | null;
    next: {
        period: {
            id: number;
            name: string;
            startTime: string;
            endTime: string;
            dayOfWeek: string;
        };
        subject: {
            id: number;
            name: string;
            category: string;
        };
        subClass: {
            id: number;
            name: string;
            className: string;
        };
        minutesToStart?: number;
        isToday: boolean;
    } | null;
    requestTime: string;
    currentDay: string;
}

/**
 * Get teacher's current and next subjects based on timetable and current time
 */
export async function getTeacherCurrentAndNextSubjects(teacherId: number, academicYearId?: number): Promise<CurrentNextSubject> {
    // Get current academic year if not provided
    const currentAcademicYear = academicYearId ?
        await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
        await getCurrentAcademicYear();

    if (!currentAcademicYear) {
        throw new Error('No active academic year found');
    }

    // School-local (Africa/Douala) wall clock; the server itself runs in Europe/Berlin.
    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-GB', { hour12: false, timeZone: SCHOOL_TZ }); // HH:MM:SS format
    const currentDay = schoolNow(now).dayOfWeek;

    // Get all teacher periods for current academic year
    const teacherPeriods = await prisma.teacherPeriod.findMany({
        where: {
            teacher_id: teacherId,
            academic_year_id: currentAcademicYear.id
        },
        include: {
            period: true,
            subject: true,
            sub_class: {
                include: {
                    class: true
                }
            }
        },
        orderBy: [
            { period: { day_of_week: 'asc' } },
            { period: { start_time: 'asc' } }
        ]
    });

    if (teacherPeriods.length === 0) {
        return {
            current: null,
            next: null,
            requestTime: now.toISOString(),
            currentDay
        };
    }

    // Find current period (if any)
    const todayPeriods = teacherPeriods.filter(tp => tp.period.day_of_week === currentDay);
    let currentPeriod = null;
    let nextPeriod = null;

    // Check for current period
    for (const tp of todayPeriods) {
        const startTime = tp.period.start_time;
        const endTime = tp.period.end_time;

        if (currentTime >= startTime && currentTime <= endTime) {
            // Calculate minutes remaining
            const [endHour, endMinute] = endTime.split(':').map(Number);
            const [currentHour, currentMinuteNum] = currentTime.split(':').map(Number);
            const endMinutes = endHour * 60 + endMinute;
            const currentMinutes = currentHour * 60 + currentMinuteNum;
            const minutesRemaining = endMinutes - currentMinutes;

            currentPeriod = {
                period: {
                    id: tp.period.id,
                    name: tp.period.name,
                    startTime: tp.period.start_time,
                    endTime: tp.period.end_time,
                    dayOfWeek: tp.period.day_of_week
                },
                subject: {
                    id: tp.subject.id,
                    name: tp.subject.name,
                    category: tp.subject.category
                },
                subClass: {
                    id: tp.sub_class.id,
                    name: tp.sub_class.name,
                    className: tp.sub_class.class.name
                },
                isActive: true,
                minutesRemaining: Math.max(0, minutesRemaining)
            };
            break;
        }
    }

    // Find next period
    // First, check for remaining periods today
    const upcomingTodayPeriods = todayPeriods.filter(tp => tp.period.start_time > currentTime);

    if (upcomingTodayPeriods.length > 0) {
        const nextTp = upcomingTodayPeriods[0];

        // Calculate minutes to start
        const [startHour, startMinute] = nextTp.period.start_time.split(':').map(Number);
        const [currentHour, currentMinuteNum] = currentTime.split(':').map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const currentMinutes = currentHour * 60 + currentMinuteNum;
        const minutesToStart = startMinutes - currentMinutes;

        nextPeriod = {
            period: {
                id: nextTp.period.id,
                name: nextTp.period.name,
                startTime: nextTp.period.start_time,
                endTime: nextTp.period.end_time,
                dayOfWeek: nextTp.period.day_of_week
            },
            subject: {
                id: nextTp.subject.id,
                name: nextTp.subject.name,
                category: nextTp.subject.category
            },
            subClass: {
                id: nextTp.sub_class.id,
                name: nextTp.sub_class.name,
                className: nextTp.sub_class.class.name
            },
            minutesToStart: Math.max(0, minutesToStart),
            isToday: true
        };
    } else {
        // Look for next period in upcoming days
        const dayOrder = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
        const currentDayIndex = dayOrder.indexOf(currentDay);

        for (let i = 1; i <= 7; i++) {
            const nextDayIndex = (currentDayIndex + i) % 7;
            const nextDay = dayOrder[nextDayIndex];

            const nextDayPeriods = teacherPeriods.filter(tp => tp.period.day_of_week === nextDay);
            if (nextDayPeriods.length > 0) {
                const nextTp = nextDayPeriods[0]; // First period of the day

                nextPeriod = {
                    period: {
                        id: nextTp.period.id,
                        name: nextTp.period.name,
                        startTime: nextTp.period.start_time,
                        endTime: nextTp.period.end_time,
                        dayOfWeek: nextTp.period.day_of_week
                    },
                    subject: {
                        id: nextTp.subject.id,
                        name: nextTp.subject.name,
                        category: nextTp.subject.category
                    },
                    subClass: {
                        id: nextTp.sub_class.id,
                        name: nextTp.sub_class.name,
                        className: nextTp.sub_class.class.name
                    },
                    isToday: false
                };
                break;
            }
        }
    }

    return {
        current: currentPeriod,
        next: nextPeriod,
        requestTime: now.toISOString(),
        currentDay
    };
}

export async function getTeacherTimetable(teacherId: number, academicYearId?: number) {
    const yearId = academicYearId || (await getCurrentAcademicYear())?.id;

    const teacherPeriods = await prisma.teacherPeriod.findMany({
        where: {
            teacher_id: teacherId,
            academic_year_id: yearId,
        },
        include: {
            period: true,
            subject: true,
            sub_class: {
                include: {
                    class: true,
                },
            },
        },
        orderBy: [
            { period: { day_of_week: 'asc' } },
            { period: { start_time: 'asc' } },
        ],
    });

    const totalClasses = new Set(teacherPeriods.map(tp => tp.sub_class_id)).size;
    const totalSubjects = new Set(teacherPeriods.map(tp => tp.subject_id)).size;

    // Periods vs hours: periods aren't a fixed length (55 min lessons, 110 min
    // preps), so both are returned. A combined lesson (one slot, two
    // sub-classes) counts once; break periods never count.
    const workload = computeWorkload(teacherPeriods);

    const today = schoolNow().dayOfWeek;
    const todayClasses = teacherPeriods.filter(tp => tp.period.day_of_week === today).length;

    // SubClass.current_students is a cache that is only ever incremented, so it
    // drifts (QA: "12 students" on a class of 53). Overwrite it with the live
    // count of active students for the year.
    const subClassIds = [...new Set(teacherPeriods.map(tp => tp.sub_class_id))];
    const counts = subClassIds.length === 0 ? [] : await prisma.enrollment.groupBy({
        by: ['sub_class_id'],
        where: { AND: [activeEnrollmentWhere(yearId), { sub_class_id: { in: subClassIds } }] },
        _count: { _all: true },
    });
    const countBySubClass = new Map(counts.map(c => [c.sub_class_id, c._count._all]));

    return {
        summary: {
            totalClasses,
            totalSubjects,
            weeklyPeriods: workload.weekly_periods,
            totalHoursPerWeek: workload.total_hours_per_week,
            todayClasses,
        },
        schedule: teacherPeriods.map(tp => ({
            ...tp,
            teacher_period_id: tp.id,
            sub_class: { ...tp.sub_class, current_students: countBySubClass.get(tp.sub_class_id) ?? 0 },
        })),
    };
}
