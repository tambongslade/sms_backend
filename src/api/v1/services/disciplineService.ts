// src/api/v1/services/disciplineService.ts
import {
    StudentAbsence, TeacherAbsence, DisciplineIssue, DisciplineType, AbsenceType, DayOfWeek,
    StudentWarning, ParentSummons, WarningReason, SummonsTrigger, SummonsStatus, MakeupStatus,
    Prisma
} from '@prisma/client';
import prisma from '../../../config/db';
import { getAcademicYearId, getStudentSubclassByStudentAndYear } from '../../../utils/academicYear';
import { paginate, PaginationOptions, FilterOptions, PaginatedResult } from '../../../utils/pagination';

const SATURDAY_PUNISHMENT_THRESHOLD = 3;

// Absence-based auto-trigger thresholds per term (unexcused CLASS_ABSENCE rows).
const CONSECUTIVE_ABSENCE_THRESHOLD = 3;
const CUMULATIVE_ABSENCE_THRESHOLD = 6;
const WARNING_LEVEL_THRESHOLDS = [3, 6, 9] as const;

const DAY_OF_WEEK_FROM_INDEX: DayOfWeek[] = [
    'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
] as DayOfWeek[];

/**
 * Resolve the Term that contains `date` for the given academic year.
 * Used to scope the 3-strike lateness counter.
 */
export async function findTermForDate(date: Date, academicYearId: number) {
    return prisma.term.findFirst({
        where: {
            academic_year_id: academicYearId,
            start_date: { lte: date },
            end_date: { gte: date },
        },
    });
}

/**
 * Count MORNING_LATENESS StudentAbsence rows for an enrollment within a term window.
 */
async function countLatenessInTerm(enrollmentId: number, termStart: Date, termEnd: Date): Promise<number> {
    return prisma.studentAbsence.count({
        where: {
            enrollment_id: enrollmentId,
            absence_type: AbsenceType.MORNING_LATENESS,
            created_at: { gte: termStart, lte: termEnd },
        },
    });
}

/**
 * Count SaturdayPunishment rows created within a term window for an enrollment.
 * Used to suppress duplicate alerts after the DM already scheduled one.
 */
async function countPunishmentsInTerm(enrollmentId: number, termStart: Date, termEnd: Date): Promise<number> {
    return prisma.saturdayPunishment.count({
        where: {
            enrollment_id: enrollmentId,
            created_at: { gte: termStart, lte: termEnd },
        },
    });
}

// SDM Lateness tracking interface
export interface LatenessRecord {
    student_id: number;
    minutes_late?: number;
    reason?: string;
    arrival_time?: string; // HH:MM format
}

export interface BulkLatenessData {
    date: string; // YYYY-MM-DD
    records: LatenessRecord[];
    academic_year_id?: number;
}

/**
 * Record morning lateness for a single student (SDM use)
 */
export async function recordMorningLateness(data: {
    student_id: number;
    academic_year_id?: number;
    assigned_by_id: number;
    minutes_late?: number;
    reason?: string;
    arrival_time?: string;
    action_taken?: string;
    date?: string;
}): Promise<{ absence: StudentAbsence; pending_punishment_alert: { lateness_count_in_term: number; term_id: number | null } | null }> {
    // Get current academic year if not provided
    const yearId = data.academic_year_id ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error("No academic year found and none provided");
    }

    // Get student enrollment for the academic year
    const enrollment = await getStudentSubclassByStudentAndYear(data.student_id, yearId);
    if (!enrollment) {
        throw new Error(`Student with ID ${data.student_id} is not enrolled in the specified academic year`);
    }

    // Check if lateness already recorded for today
    const today = data.date ? new Date(data.date) : new Date();
    const startOfDay = new Date(today.getTime());
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today.getTime());
    endOfDay.setHours(23, 59, 59, 999);

    const existingLateness = await prisma.studentAbsence.findFirst({
        where: {
            enrollment_id: enrollment.id,
            absence_type: AbsenceType.MORNING_LATENESS,
            created_at: {
                gte: startOfDay,
                lte: endOfDay
            }
        }
    });

    if (existingLateness) {
        throw new Error(`Morning lateness already recorded for this student today`);
    }

    // Create lateness record
    const latenessRecord = await prisma.studentAbsence.create({
        data: {
            enrollment_id: enrollment.id,
            assigned_by_id: data.assigned_by_id,
            absence_type: AbsenceType.MORNING_LATENESS,
        },
        include: {
            enrollment: {
                include: {
                    student: true,
                    sub_class: { include: { class: true } }
                }
            },
            assigned_by: true
        }
    });

    // Also create a discipline issue for chronic lateness tracking
    await prisma.disciplineIssue.create({
        data: {
            enrollment_id: enrollment.id,
            issue_type: DisciplineType.MORNING_LATENESS,
            description: `Student arrived ${data.minutes_late || 'late'} minutes late at ${data.arrival_time || 'unknown time'}. Reason: ${data.reason || 'No reason provided'}`,
            notes: `Recorded on ${today.toISOString().split('T')[0]} by SDM`,
            action_taken: data.action_taken ?? null,
            assigned_by_id: data.assigned_by_id,
            reviewed_by_id: data.assigned_by_id // Auto-assign SDM as reviewer for lateness
        }
    });

    // Compute 3-strike alert (per term)
    let pendingAlert: { lateness_count_in_term: number; term_id: number | null } | null = null;
    const term = await findTermForDate(today, yearId);
    if (term?.start_date && term?.end_date) {
        const latenessCount = await countLatenessInTerm(enrollment.id, term.start_date, term.end_date);
        const expectedPunishments = Math.floor(latenessCount / SATURDAY_PUNISHMENT_THRESHOLD);
        const existingPunishments = await countPunishmentsInTerm(enrollment.id, term.start_date, term.end_date);
        if (expectedPunishments > existingPunishments) {
            pendingAlert = { lateness_count_in_term: latenessCount, term_id: term.id };
        }
    }

    return { absence: latenessRecord, pending_punishment_alert: pendingAlert };
}

/**
 * Record bulk morning lateness for multiple students (SDM daily use)
 */
export async function recordBulkMorningLateness(data: BulkLatenessData, assignedById: number): Promise<{
    success: Array<{ absence: StudentAbsence; pending_punishment_alert: any }>;
    errors: { student_id: number; error: string }[];
    new_alerts: Array<{ student_id: number; lateness_count_in_term: number; term_id: number | null }>;
}> {
    const results: Array<{ absence: StudentAbsence; pending_punishment_alert: any }> = [];
    const errors: { student_id: number; error: string }[] = [];
    const newAlerts: Array<{ student_id: number; lateness_count_in_term: number; term_id: number | null }> = [];

    // Get current academic year if not provided
    const yearId = data.academic_year_id ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error("No academic year found and none provided");
    }

    for (const record of data.records) {
        try {
            const latenessRecord = await recordMorningLateness({
                student_id: record.student_id,
                academic_year_id: yearId,
                assigned_by_id: assignedById,
                minutes_late: record.minutes_late,
                reason: record.reason,
                arrival_time: record.arrival_time,
                date: data.date,
            });
            results.push(latenessRecord);
            if (latenessRecord.pending_punishment_alert) {
                newAlerts.push({
                    student_id: record.student_id,
                    lateness_count_in_term: latenessRecord.pending_punishment_alert.lateness_count_in_term,
                    term_id: latenessRecord.pending_punishment_alert.term_id,
                });
            }
        } catch (error: any) {
            errors.push({
                student_id: record.student_id,
                error: error.message
            });
        }
    }

    return { success: results, errors, new_alerts: newAlerts };
}

/**
 * Get lateness statistics for SDM dashboard
 */
export async function getLatenessStatistics(academicYearId?: number): Promise<{
    totalLatenessToday: number;
    totalLatenessThisWeek: number;
    totalLatenessThisMonth: number;
    chronicallyLateStudents: any[];
    latenessByClass: any[];
}> {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error("No academic year found");
    }

    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));
    
    const startOfWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalLatenessToday, totalLatenessThisWeek, totalLatenessThisMonth] = await Promise.all([
        // Today's lateness
        prisma.studentAbsence.count({
            where: {
                absence_type: AbsenceType.MORNING_LATENESS,
                created_at: { gte: startOfDay, lte: endOfDay },
                enrollment: { academic_year_id: yearId }
            }
        }),

        // This week's lateness
        prisma.studentAbsence.count({
            where: {
                absence_type: AbsenceType.MORNING_LATENESS,
                created_at: { gte: startOfWeek },
                enrollment: { academic_year_id: yearId }
            }
        }),

        // This month's lateness
        prisma.studentAbsence.count({
            where: {
                absence_type: AbsenceType.MORNING_LATENESS,
                created_at: { gte: startOfMonth },
                enrollment: { academic_year_id: yearId }
            }
        })
    ]);

    // Get chronically late students (3+ times this month)
    const chronicallyLateStudents = await prisma.studentAbsence.groupBy({
        by: ['enrollment_id'],
        where: {
            absence_type: AbsenceType.MORNING_LATENESS,
            created_at: { gte: startOfMonth },
            enrollment: { academic_year_id: yearId }
        },
        having: {
            enrollment_id: { _count: { gte: 3 } }
        },
        _count: { enrollment_id: true }
    });

    // Get detailed info for chronically late students
    const chronicStudentDetails = await Promise.all(
        chronicallyLateStudents.map(async (record) => {
            const enrollment = await prisma.enrollment.findUnique({
                where: { id: record.enrollment_id },
                include: {
                    student: true,
                    sub_class: { include: { class: true } }
                }
            });
            
            return {
                student: enrollment?.student,
                class: enrollment?.sub_class?.class?.name,
                subclass: enrollment?.sub_class?.name,
                lateness_count: record._count.enrollment_id
            };
        })
    );

    // Get lateness by class breakdown
    const latenessByClass = await prisma.studentAbsence.groupBy({
        by: ['enrollment_id'],
        where: {
            absence_type: AbsenceType.MORNING_LATENESS,
            created_at: { gte: startOfMonth },
            enrollment: { academic_year_id: yearId }
        },
        _count: { enrollment_id: true }
    });

    // Process by class
    const classBreakdown = new Map<string, number>();
    for (const record of latenessByClass) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: record.enrollment_id },
            include: { sub_class: { include: { class: true } } }
        });
        
        if (enrollment?.sub_class?.class) {
            const className = enrollment.sub_class.class.name;
            classBreakdown.set(className, (classBreakdown.get(className) || 0) + record._count.enrollment_id);
        }
    }

    return {
        totalLatenessToday,
        totalLatenessThisWeek,
        totalLatenessThisMonth,
        chronicallyLateStudents: chronicStudentDetails,
        latenessByClass: Array.from(classBreakdown.entries()).map(([className, count]) => ({
            class_name: className,
            lateness_count: count
        }))
    };
}

/**
 * Get daily lateness report for SDM
 */
export async function getDailyLatenessReport(date?: string, academicYearId?: number): Promise<any[]> {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error("No academic year found");
    }

    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    const latenessRecords = await prisma.studentAbsence.findMany({
        where: {
            absence_type: AbsenceType.MORNING_LATENESS,
            created_at: { gte: startOfDay, lte: endOfDay },
            enrollment: { academic_year_id: yearId }
        },
        include: {
            enrollment: {
                include: {
                    student: true,
                    sub_class: { include: { class: true } }
                }
            },
            assigned_by: true
        },
        orderBy: { created_at: 'asc' }
    });

    return latenessRecords.map(record => ({
        id: record.id,
        student: {
            id: record.enrollment.student.id,
            name: record.enrollment.student.name,
            matricule: record.enrollment.student.matricule
        },
        class: record.enrollment.sub_class?.class?.name,
        subclass: record.enrollment.sub_class?.name,
        recorded_time: record.created_at,
        recorded_by: record.assigned_by.name
    }));
}

export async function recordStudentAttendance(data: {
    enrollment_id?: number;
    student_id?: number;
    academic_year_id?: number;
    assigned_by_id: number;
    teacher_period_id?: number;
}): Promise<StudentAbsence> {
    // Handle the case where student_id is provided instead of enrollment_id
    if (data.student_id && !data.enrollment_id) {
        const enrollment = await getStudentSubclassByStudentAndYear(
            data.student_id,
            data.academic_year_id
        );

        if (!enrollment) {
            throw new Error(`Student with ID ${data.student_id} is not enrolled in the specified academic year`);
        }

        data.enrollment_id = enrollment.id;
    }

    return prisma.studentAbsence.create({
        data: {
            enrollment_id: data.enrollment_id!,
            assigned_by_id: data.assigned_by_id,
            teacher_period_id: data.teacher_period_id
        },
    });
}

export async function recordTeacherAttendance(data: {
    teacher_id: number;
    assigned_by_id: number;
    reason: string;
    teacher_period_id?: number;
}): Promise<TeacherAbsence> {
    return prisma.teacherAbsence.create({
        data,
    });
}

export async function recordDisciplineIssue(data: {
    enrollment_id?: number;
    student_id?: number;
    academic_year_id?: number;
    issue_type: DisciplineType;
    description: string;
    notes?: string;
    action_taken?: string;
    assigned_by_id: number;
    reviewed_by_id: number;
}): Promise<DisciplineIssue> {
    // Handle the case where student_id is provided instead of enrollment_id
    if (data.student_id && !data.enrollment_id) {
        const enrollment = await getStudentSubclassByStudentAndYear(
            data.student_id,
            data.academic_year_id
        );

        if (!enrollment) {
            throw new Error(`Student with ID ${data.student_id} is not enrolled in the specified academic year`);
        }

        data.enrollment_id = enrollment.id;
    }

    return prisma.disciplineIssue.create({
        data: {
            enrollment_id: data.enrollment_id!,
            issue_type: data.issue_type,
            description: data.description,
            notes: data.notes,
            action_taken: data.action_taken ?? null,
            assigned_by_id: data.assigned_by_id,
            reviewed_by_id: data.reviewed_by_id
        },
    });
}

/**
 * Update a discipline issue (action_taken, notes, description).
 * Used when the DM wants to record the consequence after the fact.
 */
export async function updateDisciplineIssue(id: number, data: {
    description?: string;
    notes?: string;
    action_taken?: string | null;
}): Promise<DisciplineIssue> {
    const existing = await prisma.disciplineIssue.findUnique({ where: { id } });
    if (!existing) throw new Error(`DisciplineIssue ${id} not found`);
    return prisma.disciplineIssue.update({
        where: { id },
        data: {
            ...(data.description !== undefined && { description: data.description }),
            ...(data.notes !== undefined && { notes: data.notes }),
            ...(data.action_taken !== undefined && { action_taken: data.action_taken }),
        },
    });
}

/**
 * List enrollments with pending 3-strike alerts (current term).
 * Returns students who have reached a new 3-strike threshold but for whom
 * the DM has not yet scheduled the corresponding Saturday punishment.
 */
export async function getLatenessAlerts(academicYearId?: number): Promise<Array<{
    enrollment_id: number;
    student: { id: number; name: string; matricule: string };
    class_name: string | null;
    sub_class_name: string | null;
    lateness_count_in_term: number;
    pending_punishments_scheduled: number;
    punishments_owed: number;
    term: { id: number; name: string };
}>> {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) throw new Error('No academic year found');

    const today = new Date();
    const term = await findTermForDate(today, yearId);
    if (!term?.start_date || !term?.end_date) return [];

    const grouped = await prisma.studentAbsence.groupBy({
        by: ['enrollment_id'],
        where: {
            absence_type: AbsenceType.MORNING_LATENESS,
            created_at: { gte: term.start_date, lte: term.end_date },
            enrollment: { academic_year_id: yearId },
        },
        _count: { enrollment_id: true },
        having: { enrollment_id: { _count: { gte: SATURDAY_PUNISHMENT_THRESHOLD } } },
    });

    const alerts: Array<any> = [];
    for (const row of grouped) {
        const latenessCount = row._count.enrollment_id;
        const expected = Math.floor(latenessCount / SATURDAY_PUNISHMENT_THRESHOLD);
        const punishmentCount = await countPunishmentsInTerm(row.enrollment_id, term.start_date, term.end_date);
        if (expected <= punishmentCount) continue;

        const enrollment = await prisma.enrollment.findUnique({
            where: { id: row.enrollment_id },
            include: { student: true, sub_class: { include: { class: true } }, class: true },
        });
        if (!enrollment) continue;

        alerts.push({
            enrollment_id: row.enrollment_id,
            student: {
                id: enrollment.student.id,
                name: enrollment.student.name,
                matricule: enrollment.student.matricule,
            },
            class_name: enrollment.sub_class?.class?.name ?? enrollment.class?.name ?? null,
            sub_class_name: enrollment.sub_class?.name ?? null,
            lateness_count_in_term: latenessCount,
            pending_punishments_scheduled: punishmentCount,
            punishments_owed: expected - punishmentCount,
            term: { id: term.id, name: term.name },
        });
    }

    return alerts;
}

// =====================================================================
// Bulk absence form (DM walks into a subclass, ticks who's absent)
// =====================================================================

export interface AbsenceFormData {
    subclass: { id: number; name: string; class_name: string };
    date: string;
    day_of_week: DayOfWeek;
    students: Array<{ enrollment_id: number; student_id: number; name: string; matricule: string }>;
    periods: Array<{
        teacher_period_id: number;
        period_name: string;
        start_time: string;
        end_time: string;
        subject_name: string;
        teacher_name: string;
    }>;
}

export async function getAbsenceFormData(subClassId: number, date: string, academicYearId?: number): Promise<AbsenceFormData> {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) throw new Error('No academic year found');

    const subClass = await prisma.subClass.findUnique({
        where: { id: subClassId },
        include: { class: true },
    });
    if (!subClass) throw new Error(`Subclass ${subClassId} not found`);

    const target = new Date(date);
    if (isNaN(target.getTime())) throw new Error('Invalid date');
    const dayOfWeek = DAY_OF_WEEK_FROM_INDEX[target.getDay()];

    const enrollments = await prisma.enrollment.findMany({
        where: { sub_class_id: subClassId, academic_year_id: yearId },
        include: { student: true },
        orderBy: { student: { name: 'asc' } },
    });

    const teacherPeriods = await prisma.teacherPeriod.findMany({
        where: {
            sub_class_id: subClassId,
            academic_year_id: yearId,
            period: { day_of_week: dayOfWeek },
        },
        include: {
            period: true,
            subject: true,
            teacher: { select: { id: true, name: true } },
        },
        orderBy: { period: { start_time: 'asc' } },
    });

    return {
        subclass: { id: subClass.id, name: subClass.name, class_name: subClass.class.name },
        date: target.toISOString().slice(0, 10),
        day_of_week: dayOfWeek,
        students: enrollments.map(e => ({
            enrollment_id: e.id,
            student_id: e.student.id,
            name: e.student.name,
            matricule: e.student.matricule,
        })),
        periods: teacherPeriods.map(tp => ({
            teacher_period_id: tp.id,
            period_name: tp.period.name,
            start_time: tp.period.start_time,
            end_time: tp.period.end_time,
            subject_name: tp.subject.name,
            teacher_name: tp.teacher.name,
        })),
    };
}

export interface BulkAbsenceInput {
    date: string;
    sub_class_id: number;
    academic_year_id?: number;
    assigned_by_id: number;
    absences: Array<{ student_id: number; period_ids?: number[] }>;
}

/**
 * Mark a batch of students absent on a given date. If period_ids is omitted,
 * one full-day StudentAbsence is created (teacher_period_id = null).
 * If provided, one row per period is created.
 */
export async function bulkRecordAbsences(input: BulkAbsenceInput): Promise<{
    created: number;
    skipped: Array<{ student_id: number; reason: string }>;
}> {
    const yearId = input.academic_year_id ?? await getAcademicYearId();
    if (!yearId) throw new Error('No academic year found');

    const target = new Date(input.date);
    if (isNaN(target.getTime())) throw new Error('Invalid date');

    let created = 0;
    const skipped: Array<{ student_id: number; reason: string }> = [];
    const affectedEnrollmentIds = new Set<number>();

    for (const entry of input.absences) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { student_id_academic_year_id: { student_id: entry.student_id, academic_year_id: yearId } },
        });
        if (!enrollment) {
            skipped.push({ student_id: entry.student_id, reason: 'Not enrolled in this academic year' });
            continue;
        }
        if (enrollment.sub_class_id !== input.sub_class_id) {
            skipped.push({ student_id: entry.student_id, reason: 'Student is not in the requested subclass' });
            continue;
        }

        const periodIds = entry.period_ids && entry.period_ids.length > 0 ? entry.period_ids : [null];

        for (const periodId of periodIds) {
            try {
                await prisma.studentAbsence.create({
                    data: {
                        enrollment_id: enrollment.id,
                        assigned_by_id: input.assigned_by_id,
                        absence_type: AbsenceType.CLASS_ABSENCE,
                        teacher_period_id: periodId ?? null,
                    },
                });
                created++;
                affectedEnrollmentIds.add(enrollment.id);
            } catch (err: any) {
                // Unique constraint = already recorded; silently skip
                if (err.code === 'P2002') continue;
                skipped.push({ student_id: entry.student_id, reason: err.message });
            }
        }
    }

    // Fire threshold triggers once per affected enrollment (idempotent evaluator).
    for (const enrollmentId of affectedEnrollmentIds) {
        await evaluateAbsenceTriggers(enrollmentId, input.assigned_by_id);
    }

    return { created, skipped };
}

export async function updateStudentAbsence(id: number, data: {
    teacher_period_id?: number | null;
    absence_type?: AbsenceType;
}): Promise<StudentAbsence> {
    const existing = await prisma.studentAbsence.findUnique({ where: { id } });
    if (!existing) throw new Error(`StudentAbsence ${id} not found`);
    return prisma.studentAbsence.update({
        where: { id },
        data: {
            ...(data.teacher_period_id !== undefined && { teacher_period_id: data.teacher_period_id }),
            ...(data.absence_type !== undefined && { absence_type: data.absence_type }),
        },
    });
}

export async function deleteStudentAbsence(id: number): Promise<void> {
    await prisma.studentAbsence.delete({ where: { id } });
}

export async function getAllDisciplineIssues(
    paginationOptions?: PaginationOptions,
    filterOptions?: FilterOptions,
    academicYearId?: number
): Promise<PaginatedResult<DisciplineIssue>> {
    // Get current academic year if not explicitly provided
    const yearId = await getAcademicYearId(academicYearId);

    // Process complex filters
    const processedFilters: any = { ...filterOptions };

    // Filter by student ID across academic years
    if (filterOptions?.student_id) {
        const studentId = parseInt(filterOptions.student_id as string);

        if (yearId) {
            // If academic year is specified, get the specific enrollment
            const enrollment = await getStudentSubclassByStudentAndYear(studentId, yearId);
            if (enrollment) {
                processedFilters.enrollment_id = enrollment.id;
            } else {
                // If no enrollment found for this student in this year, return empty result
                return {
                    data: [],
                    meta: {
                        total: 0,
                        page: paginationOptions?.page || 1,
                        limit: paginationOptions?.limit || 10,
                        totalPages: 0
                    }
                };
            }
        } else {
            // If no specific academic year, get all enrollments for this student
            processedFilters.enrollment = {
                student_id: studentId
            };
        }
        delete processedFilters.student_id;
    }

    // Filter by class
    if (filterOptions?.class_id) {
        processedFilters.enrollment = {
            ...(processedFilters.enrollment || {}),
            sub_class: {
                class_id: parseInt(filterOptions.class_id as string)
            }
        };
        delete processedFilters.class_id;
    }

    // Filter by sub_class
    if (filterOptions?.sub_class_id) {
        processedFilters.enrollment = {
            ...(processedFilters.enrollment || {}),
            sub_class_id: parseInt(filterOptions.sub_class_id as string)
        };
        delete processedFilters.sub_class_id;
    }

    // Filter by date range
    if (filterOptions?.start_date && filterOptions?.end_date) {
        processedFilters.created_at = {
            gte: new Date(filterOptions.start_date as string),
            lte: new Date(filterOptions.end_date as string)
        };
        delete processedFilters.start_date;
        delete processedFilters.end_date;
    }

    // Include relations
    const include: any = {};

    // Include staff who assigned the issue
    if (filterOptions?.includeAssignedBy === 'true') {
        include.assigned_by = true;
        delete processedFilters.includeAssignedBy;
    }

    // Include staff who reviewed the issue
    if (filterOptions?.includeReviewedBy === 'true') {
        include.reviewed_by = true;
        delete processedFilters.includeReviewedBy;
    }

    // Include student information
    if (filterOptions?.includeStudent === 'true') {
        include.enrollment = {
            include: {
                student: true,
                sub_class: {
                    include: {
                        class: true
                    }
                }
            }
        };
        delete processedFilters.includeStudent;
    }

    return paginate<DisciplineIssue>(
        prisma.disciplineIssue,
        paginationOptions,
        processedFilters,
        Object.keys(include).length > 0 ? include : undefined
    );
}

export async function getDisciplineHistory(
    studentId?: number,
    enrollmentId?: number,
    academicYearId?: number
): Promise<DisciplineIssue[]> {
    const include = {
        assigned_by: { select: { id: true, name: true, matricule: true } },
        reviewed_by: { select: { id: true, name: true, matricule: true } },
        enrollment: {
            select: {
                id: true,
                academic_year_id: true,
                academic_year: { select: { id: true, name: true } },
                class: { select: { id: true, name: true } },
                sub_class: { select: { id: true, name: true } },
            },
        },
    };

    if (enrollmentId) {
        return prisma.disciplineIssue.findMany({
            where: { enrollment_id: enrollmentId },
            orderBy: { created_at: 'desc' },
            include,
        });
    }

    if (studentId) {
        return prisma.disciplineIssue.findMany({
            where: {
                enrollment: {
                    student_id: studentId,
                    ...(academicYearId && { academic_year_id: academicYearId }),
                },
            },
            orderBy: { created_at: 'desc' },
            include,
        });
    }

    return prisma.disciplineIssue.findMany({ orderBy: { created_at: 'desc' }, include });
}

// =====================================================================
// Unified roll call (PRESENT / LATE / ABSENT)
// =====================================================================

export type RollCallStatus = 'PRESENT' | 'LATE' | 'ABSENT';
export type PeriodAttendanceStatus = 'PRESENT' | 'ABSENT';

export interface RollCallStudent {
    enrollment_id: number;
    student_id: number;
    name: string;
    matricule: string;
    status: RollCallStatus;
    absence_id: number | null;
}

export interface DailyRollCall {
    subclass: { id: number; name: string; class_name: string };
    date: string;
    day_of_week: DayOfWeek;
    students: RollCallStudent[];
    summary: { total: number; present: number; late: number; absent: number };
}

function dayWindow(dateStr: string): { start: Date; end: Date; target: Date } {
    const target = new Date(dateStr);
    if (isNaN(target.getTime())) throw new Error('Invalid date');
    const start = new Date(target);
    start.setHours(0, 0, 0, 0);
    const end = new Date(target);
    end.setHours(23, 59, 59, 999);
    return { start, end, target };
}

export async function getDailyRollCall(subClassId: number, date: string, academicYearId?: number): Promise<DailyRollCall> {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) throw new Error('No academic year found');

    const subClass = await prisma.subClass.findUnique({
        where: { id: subClassId },
        include: { class: true },
    });
    if (!subClass) throw new Error(`Subclass ${subClassId} not found`);

    const { start, end, target } = dayWindow(date);
    const dayOfWeek = DAY_OF_WEEK_FROM_INDEX[target.getDay()];

    const enrollments = await prisma.enrollment.findMany({
        where: { sub_class_id: subClassId, academic_year_id: yearId },
        include: { student: true },
        orderBy: { student: { name: 'asc' } },
    });

    const enrollmentIds = enrollments.map(e => e.id);
    const dayAbsences = await prisma.studentAbsence.findMany({
        where: {
            enrollment_id: { in: enrollmentIds },
            teacher_period_id: null,
            created_at: { gte: start, lte: end },
        },
    });
    const byEnrollment = new Map<number, typeof dayAbsences[number]>();
    for (const a of dayAbsences) byEnrollment.set(a.enrollment_id, a);

    let present = 0, late = 0, absent = 0;
    const students: RollCallStudent[] = enrollments.map(e => {
        const rec = byEnrollment.get(e.id);
        let status: RollCallStatus = 'PRESENT';
        if (rec?.absence_type === AbsenceType.MORNING_LATENESS) status = 'LATE';
        else if (rec?.absence_type === AbsenceType.CLASS_ABSENCE) status = 'ABSENT';

        if (status === 'PRESENT') present++;
        else if (status === 'LATE') late++;
        else absent++;

        return {
            enrollment_id: e.id,
            student_id: e.student.id,
            name: e.student.name,
            matricule: e.student.matricule,
            status,
            absence_id: rec?.id ?? null,
        };
    });

    return {
        subclass: { id: subClass.id, name: subClass.name, class_name: subClass.class.name },
        date: target.toISOString().slice(0, 10),
        day_of_week: dayOfWeek,
        students,
        summary: { total: students.length, present, late, absent },
    };
}

export interface DailyRollCallInput {
    sub_class_id: number;
    date: string;
    entries: Array<{ enrollment_id: number; status: RollCallStatus }>;
    assigned_by_id: number;
    academic_year_id?: number;
}

export async function recordDailyRollCall(input: DailyRollCallInput): Promise<{
    updated: number;
    skipped: Array<{ enrollment_id: number; reason: string }>;
}> {
    const yearId = input.academic_year_id ?? await getAcademicYearId();
    if (!yearId) throw new Error('No academic year found');

    const { start, end } = dayWindow(input.date);

    const enrollmentIds = input.entries.map(e => e.enrollment_id);
    const enrollments = await prisma.enrollment.findMany({
        where: { id: { in: enrollmentIds }, academic_year_id: yearId, sub_class_id: input.sub_class_id },
        select: { id: true },
    });
    const validIds = new Set(enrollments.map(e => e.id));

    let updated = 0;
    const skipped: Array<{ enrollment_id: number; reason: string }> = [];

    await prisma.$transaction(async (tx) => {
        for (const entry of input.entries) {
            if (!validIds.has(entry.enrollment_id)) {
                skipped.push({ enrollment_id: entry.enrollment_id, reason: 'Not enrolled in this subclass for this year' });
                continue;
            }

            await tx.studentAbsence.deleteMany({
                where: {
                    enrollment_id: entry.enrollment_id,
                    teacher_period_id: null,
                    created_at: { gte: start, lte: end },
                },
            });

            if (entry.status === 'LATE') {
                await tx.studentAbsence.create({
                    data: {
                        enrollment_id: entry.enrollment_id,
                        assigned_by_id: input.assigned_by_id,
                        absence_type: AbsenceType.MORNING_LATENESS,
                    },
                });
            } else if (entry.status === 'ABSENT') {
                await tx.studentAbsence.create({
                    data: {
                        enrollment_id: entry.enrollment_id,
                        assigned_by_id: input.assigned_by_id,
                        absence_type: AbsenceType.CLASS_ABSENCE,
                    },
                });
            }
            // PRESENT: rows already wiped above

            updated++;
        }
    });

    // Fire threshold triggers for enrollments newly marked ABSENT.
    for (const entry of input.entries) {
        if (entry.status === 'ABSENT' && validIds.has(entry.enrollment_id)) {
            await evaluateAbsenceTriggers(entry.enrollment_id, input.assigned_by_id);
        }
    }

    return { updated, skipped };
}

// =====================================================================
// In-class roll call (teacher marks one TeacherPeriod)
// =====================================================================

export interface PeriodRollCallStudent {
    enrollment_id: number;
    student_id: number;
    name: string;
    matricule: string;
    status: PeriodAttendanceStatus;
    absence_id: number | null;
}

export interface PeriodRollCall {
    teacher_period: {
        id: number;
        sub_class_id: number;
        sub_class_name: string;
        class_name: string;
        period_name: string;
        start_time: string;
        end_time: string;
        subject_name: string;
        teacher_id: number;
        teacher_name: string;
        day_of_week: DayOfWeek;
    };
    academic_year_id: number;
    students: PeriodRollCallStudent[];
    summary: { total: number; present: number; absent: number };
}

async function loadTeacherPeriod(teacherPeriodId: number) {
    const tp = await prisma.teacherPeriod.findUnique({
        where: { id: teacherPeriodId },
        include: {
            period: true,
            subject: true,
            sub_class: { include: { class: true } },
            teacher: { select: { id: true, name: true } },
        },
    });
    if (!tp) throw new Error(`TeacherPeriod ${teacherPeriodId} not found`);
    return tp;
}

export async function getPeriodRollCall(teacherPeriodId: number): Promise<PeriodRollCall> {
    const tp = await loadTeacherPeriod(teacherPeriodId);

    const enrollments = await prisma.enrollment.findMany({
        where: { sub_class_id: tp.sub_class_id, academic_year_id: tp.academic_year_id },
        include: { student: true },
        orderBy: { student: { name: 'asc' } },
    });

    const existing = await prisma.studentAbsence.findMany({
        where: {
            teacher_period_id: teacherPeriodId,
            enrollment_id: { in: enrollments.map(e => e.id) },
        },
    });
    const byEnrollment = new Map<number, typeof existing[number]>();
    for (const a of existing) byEnrollment.set(a.enrollment_id, a);

    let present = 0, absent = 0;
    const students: PeriodRollCallStudent[] = enrollments.map(e => {
        const rec = byEnrollment.get(e.id);
        const status: PeriodAttendanceStatus = rec ? 'ABSENT' : 'PRESENT';
        if (status === 'PRESENT') present++; else absent++;
        return {
            enrollment_id: e.id,
            student_id: e.student.id,
            name: e.student.name,
            matricule: e.student.matricule,
            status,
            absence_id: rec?.id ?? null,
        };
    });

    return {
        teacher_period: {
            id: tp.id,
            sub_class_id: tp.sub_class_id,
            sub_class_name: tp.sub_class.name,
            class_name: tp.sub_class.class.name,
            period_name: tp.period.name,
            start_time: tp.period.start_time,
            end_time: tp.period.end_time,
            subject_name: tp.subject.name,
            teacher_id: tp.teacher.id,
            teacher_name: tp.teacher.name,
            day_of_week: tp.period.day_of_week,
        },
        academic_year_id: tp.academic_year_id,
        students,
        summary: { total: students.length, present, absent },
    };
}

export interface PeriodRollCallInput {
    teacher_period_id: number;
    entries: Array<{ enrollment_id: number; status: PeriodAttendanceStatus }>;
    assigned_by_id: number;
    caller_user_id?: number;
    caller_is_admin?: boolean;
}

export async function recordPeriodRollCall(input: PeriodRollCallInput): Promise<{
    updated: number;
    skipped: Array<{ enrollment_id: number; reason: string }>;
}> {
    const tp = await loadTeacherPeriod(input.teacher_period_id);

    if (input.caller_user_id && !input.caller_is_admin && tp.teacher_id !== input.caller_user_id) {
        throw new Error('FORBIDDEN_NOT_PERIOD_OWNER');
    }

    const validEnrollments = await prisma.enrollment.findMany({
        where: {
            id: { in: input.entries.map(e => e.enrollment_id) },
            sub_class_id: tp.sub_class_id,
            academic_year_id: tp.academic_year_id,
        },
        select: { id: true },
    });
    const validIds = new Set(validEnrollments.map(e => e.id));

    let updated = 0;
    const skipped: Array<{ enrollment_id: number; reason: string }> = [];

    await prisma.$transaction(async (tx) => {
        for (const entry of input.entries) {
            if (!validIds.has(entry.enrollment_id)) {
                skipped.push({ enrollment_id: entry.enrollment_id, reason: 'Not enrolled in this subclass for this year' });
                continue;
            }

            if (entry.status === 'PRESENT') {
                await tx.studentAbsence.deleteMany({
                    where: {
                        enrollment_id: entry.enrollment_id,
                        teacher_period_id: input.teacher_period_id,
                    },
                });
            } else {
                const existing = await tx.studentAbsence.findUnique({
                    where: {
                        enrollment_id_teacher_period_id: {
                            enrollment_id: entry.enrollment_id,
                            teacher_period_id: input.teacher_period_id,
                        },
                    },
                });
                if (!existing) {
                    await tx.studentAbsence.create({
                        data: {
                            enrollment_id: entry.enrollment_id,
                            assigned_by_id: input.assigned_by_id,
                            absence_type: AbsenceType.CLASS_ABSENCE,
                            teacher_period_id: input.teacher_period_id,
                        },
                    });
                }
            }
            updated++;
        }
    });

    // Trigger evaluation for affected enrollments (CLASS_ABSENCE marked ABSENT).
    for (const entry of input.entries) {
        if (entry.status === 'ABSENT' && validIds.has(entry.enrollment_id)) {
            await evaluateAbsenceTriggers(entry.enrollment_id, input.assigned_by_id);
        }
    }

    return { updated, skipped };
}

// =====================================================================
// Absence trigger evaluation, excuse/makeup, warnings, summons
// =====================================================================

/**
 * Return the current term for a date, or fallback to the term whose end_date is nearest to now.
 */
async function currentTerm(academicYearId: number, date: Date) {
    const term = await prisma.term.findFirst({
        where: {
            academic_year_id: academicYearId,
            start_date: { lte: date },
            end_date: { gte: date },
        },
    });
    return term;
}

/**
 * Compute max consecutive-day run for a sorted array of absence dates.
 * "Consecutive" here = two absence dates with no PRESENT/LATE roll-call entry
 * between them (weekends/holidays don't reset the streak).
 * `presentDates` is the set of days (yyyy-mm-dd) with a confirmed present/late roll-call entry.
 */
function computeConsecutiveRuns(sortedAbsenceDays: string[], presentDates: Set<string>): number {
    if (sortedAbsenceDays.length === 0) return 0;
    let maxRun = 1;
    let currentRun = 1;
    for (let i = 1; i < sortedAbsenceDays.length; i++) {
        const prev = new Date(sortedAbsenceDays[i - 1] + 'T00:00:00Z');
        const curr = new Date(sortedAbsenceDays[i] + 'T00:00:00Z');
        // Walk day-by-day between prev and curr; any confirmed present day breaks the streak.
        let broken = false;
        const cursor = new Date(prev.getTime());
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        while (cursor.getTime() < curr.getTime()) {
            const key = cursor.toISOString().slice(0, 10);
            if (presentDates.has(key)) {
                broken = true;
                break;
            }
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        if (broken) {
            currentRun = 1;
        } else {
            currentRun += 1;
        }
        if (currentRun > maxRun) maxRun = currentRun;
    }
    return maxRun;
}

/**
 * Idempotent trigger evaluator called after any path that records a CLASS_ABSENCE.
 * Creates the delta of StudentWarning + ParentSummons rows required by the
 * cumulative and consecutive-absence thresholds. Never double-fires.
 */
export async function evaluateAbsenceTriggers(
    enrollmentId: number,
    actorUserId: number
): Promise<{ warnings: StudentWarning[]; summons: ParentSummons[] }> {
    const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        select: { id: true, academic_year_id: true },
    });
    if (!enrollment) return { warnings: [], summons: [] };

    const now = new Date();
    const term = await currentTerm(enrollment.academic_year_id, now);
    if (!term || !term.start_date || !term.end_date) {
        return { warnings: [], summons: [] };
    }

    // Unexcused CLASS_ABSENCE rows in the term, ordered by day.
    const rows = await prisma.studentAbsence.findMany({
        where: {
            enrollment_id: enrollmentId,
            absence_type: 'CLASS_ABSENCE',
            is_excused: false,
            created_at: { gte: term.start_date, lte: term.end_date },
        },
        select: { id: true, created_at: true },
        orderBy: { created_at: 'asc' },
    });
    // Dedupe by day
    const seen = new Set<string>();
    const days: string[] = [];
    const absenceIdsByDay = new Map<string, number>();
    for (const r of rows) {
        const key = r.created_at.toISOString().slice(0, 10);
        if (!seen.has(key)) {
            seen.add(key);
            days.push(key);
            absenceIdsByDay.set(key, r.id);
        }
    }
    const cumulative = days.length;

    // Build presentDates set from DMRollCallEntry + daily roll-call.
    const presentSlots = await prisma.dMRollCallEntry.findMany({
        where: {
            enrollment_id: enrollmentId,
            status: { in: ['PRESENT', 'LATE'] },
            dm_roll_call: {
                academic_year_id: enrollment.academic_year_id,
                date: { gte: term.start_date, lte: term.end_date },
            },
        },
        select: { dm_roll_call: { select: { date: true } } },
    });
    const presentDates = new Set<string>();
    for (const p of presentSlots) {
        presentDates.add(p.dm_roll_call.date.toISOString().slice(0, 10));
    }

    const maxRun = computeConsecutiveRuns(days, presentDates);

    // Existing state (idempotency)
    const existingWarnings = await prisma.studentWarning.findMany({
        where: {
            enrollment_id: enrollmentId,
            reason: 'CUMULATIVE_ABSENCES',
            created_at: { gte: term.start_date, lte: term.end_date },
        },
        orderBy: { warning_level: 'desc' },
    });
    const highestExistingLevel = existingWarnings.length > 0 ? Math.max(...existingWarnings.map(w => w.warning_level)) : 0;

    const existingConsecSummons = await prisma.parentSummons.count({
        where: {
            enrollment_id: enrollmentId,
            trigger_type: 'CONSECUTIVE_ABSENCES',
            created_at: { gte: term.start_date, lte: term.end_date },
        },
    });
    const existingCumulativeSummons = await prisma.parentSummons.findFirst({
        where: {
            enrollment_id: enrollmentId,
            trigger_type: 'CUMULATIVE_ABSENCES',
            status: { in: ['PENDING', 'SCHEDULED'] },
            created_at: { gte: term.start_date, lte: term.end_date },
        },
    });

    const createdWarnings: StudentWarning[] = [];
    const createdSummons: ParentSummons[] = [];

    // 1. Warning ladder: create one warning per newly-crossed threshold.
    let nextLevel = highestExistingLevel + 1;
    for (const threshold of WARNING_LEVEL_THRESHOLDS) {
        const level = WARNING_LEVEL_THRESHOLDS.indexOf(threshold) + 1;
        if (level < nextLevel) continue;
        if (cumulative >= threshold) {
            const w = await prisma.studentWarning.create({
                data: {
                    enrollment_id: enrollmentId,
                    warning_level: level,
                    reason: 'CUMULATIVE_ABSENCES',
                    description: `Auto-issued: ${cumulative} unexcused absences this term (threshold: ${threshold})`,
                    trigger_absence_count: cumulative,
                    issued_by_id: actorUserId,
                },
            });
            createdWarnings.push(w);
            nextLevel = level + 1;
        }
    }

    // 2. Cumulative summons (≥6 unexcused).
    if (cumulative >= CUMULATIVE_ABSENCE_THRESHOLD && !existingCumulativeSummons) {
        const parentId = await pickPreferredParentId(enrollmentId);
        const s = await prisma.parentSummons.create({
            data: {
                enrollment_id: enrollmentId,
                parent_id: parentId,
                reason: `Auto-summons: ${cumulative} cumulative unexcused absences this term`,
                trigger_type: 'CUMULATIVE_ABSENCES',
                trigger_absence_ids: Array.from(absenceIdsByDay.values()),
                created_by_id: actorUserId,
            },
        });
        createdSummons.push(s);
    }

    // 3. Consecutive summons: one per multiple-of-3 run.
    const expectedConsecSummons = Math.floor(maxRun / CONSECUTIVE_ABSENCE_THRESHOLD);
    const delta = expectedConsecSummons - existingConsecSummons;
    for (let i = 0; i < delta; i++) {
        const parentId = await pickPreferredParentId(enrollmentId);
        const s = await prisma.parentSummons.create({
            data: {
                enrollment_id: enrollmentId,
                parent_id: parentId,
                reason: `Auto-summons: consecutive absence run of ${maxRun} day${maxRun === 1 ? '' : 's'} without excuse`,
                trigger_type: 'CONSECUTIVE_ABSENCES',
                trigger_absence_ids: Array.from(absenceIdsByDay.values()),
                created_by_id: actorUserId,
            },
        });
        createdSummons.push(s);
    }

    return { warnings: createdWarnings, summons: createdSummons };
}

/**
 * Choose the preferred parent to summon: FATHER > MOTHER > any linked parent.
 * Returns null if the student has no linked parent.
 */
async function pickPreferredParentId(enrollmentId: number): Promise<number | null> {
    const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        select: { student_id: true },
    });
    if (!enrollment) return null;
    const links = await prisma.parentStudent.findMany({
        where: { student_id: enrollment.student_id },
    });
    if (links.length === 0) return null;
    const father = links.find((l) => l.relationship === 'FATHER');
    if (father) return father.parent_id;
    const mother = links.find((l) => l.relationship === 'MOTHER');
    if (mother) return mother.parent_id;
    return links[0].parent_id;
}

/**
 * Mark a StudentAbsence as excused by a parent. Reverses triggers if the
 * previously-fired warnings/summons no longer have enough unexcused absences
 * behind them: cancels newest matching summons and auto-resolves warnings.
 * Never hard-deletes to preserve the audit trail.
 */
export async function excuseAbsence(
    absenceId: number,
    data: { excused_by_parent_id: number; excuse_reason?: string; actor_user_id: number }
): Promise<{ absence: StudentAbsence; reverted_warnings: number; cancelled_summons: number }> {
    const absence = await prisma.studentAbsence.findUnique({ where: { id: absenceId } });
    if (!absence) throw new Error('ABSENCE_NOT_FOUND');
    if (absence.is_excused) throw new Error('ABSENCE_ALREADY_EXCUSED');

    const updated = await prisma.studentAbsence.update({
        where: { id: absenceId },
        data: {
            is_excused: true,
            excused_by_parent_id: data.excused_by_parent_id,
            excused_at: new Date(),
            excuse_reason: data.excuse_reason?.trim() || null,
        },
    });

    // Recompute triggers post-excuse and cancel/resolve any that no longer stand.
    const enrollmentId = absence.enrollment_id;
    const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        select: { academic_year_id: true },
    });
    if (!enrollment) return { absence: updated, reverted_warnings: 0, cancelled_summons: 0 };

    const term = await currentTerm(enrollment.academic_year_id, new Date());
    if (!term || !term.start_date || !term.end_date) {
        return { absence: updated, reverted_warnings: 0, cancelled_summons: 0 };
    }

    const rows = await prisma.studentAbsence.findMany({
        where: {
            enrollment_id: enrollmentId,
            absence_type: 'CLASS_ABSENCE',
            is_excused: false,
            created_at: { gte: term.start_date, lte: term.end_date },
        },
        select: { id: true, created_at: true },
        orderBy: { created_at: 'asc' },
    });
    const days = Array.from(new Set(rows.map(r => r.created_at.toISOString().slice(0, 10))));
    const cumulative = days.length;

    const presentSlots = await prisma.dMRollCallEntry.findMany({
        where: {
            enrollment_id: enrollmentId,
            status: { in: ['PRESENT', 'LATE'] },
            dm_roll_call: {
                academic_year_id: enrollment.academic_year_id,
                date: { gte: term.start_date, lte: term.end_date },
            },
        },
        select: { dm_roll_call: { select: { date: true } } },
    });
    const presentDates = new Set(presentSlots.map(p => p.dm_roll_call.date.toISOString().slice(0, 10)));
    const maxRun = computeConsecutiveRuns(days, presentDates);

    // Auto-resolve warnings whose threshold is no longer met.
    const activeWarnings = await prisma.studentWarning.findMany({
        where: {
            enrollment_id: enrollmentId,
            reason: 'CUMULATIVE_ABSENCES',
            resolved: false,
            created_at: { gte: term.start_date, lte: term.end_date },
        },
    });
    let revertedWarnings = 0;
    for (const w of activeWarnings) {
        const threshold = WARNING_LEVEL_THRESHOLDS[w.warning_level - 1];
        if (threshold !== undefined && cumulative < threshold) {
            await prisma.studentWarning.update({
                where: { id: w.id },
                data: {
                    resolved: true,
                    resolved_at: new Date(),
                    resolved_notes: `Auto-resolved: parent excused prior absence; cumulative unexcused count dropped to ${cumulative} (< ${threshold})`,
                },
            });
            revertedWarnings++;
        }
    }

    let cancelledSummons = 0;

    // Cancel cumulative summons if no longer justified.
    const cumulativeSummons = await prisma.parentSummons.findMany({
        where: {
            enrollment_id: enrollmentId,
            trigger_type: 'CUMULATIVE_ABSENCES',
            status: { in: ['PENDING', 'SCHEDULED'] },
            created_at: { gte: term.start_date, lte: term.end_date },
        },
    });
    if (cumulative < CUMULATIVE_ABSENCE_THRESHOLD) {
        for (const s of cumulativeSummons) {
            await prisma.parentSummons.update({
                where: { id: s.id },
                data: {
                    status: 'CANCELLED',
                    meeting_notes: `${s.meeting_notes ? s.meeting_notes + '\n' : ''}Auto-cancelled: cumulative unexcused absences dropped to ${cumulative} after parent excused prior absence.`,
                },
            });
            cancelledSummons++;
        }
    }

    // Cancel excess consecutive summons.
    const consecPending = await prisma.parentSummons.findMany({
        where: {
            enrollment_id: enrollmentId,
            trigger_type: 'CONSECUTIVE_ABSENCES',
            status: { in: ['PENDING', 'SCHEDULED'] },
            created_at: { gte: term.start_date, lte: term.end_date },
        },
        orderBy: { created_at: 'desc' },
    });
    const expectedConsec = Math.floor(maxRun / CONSECUTIVE_ABSENCE_THRESHOLD);
    // Count ALL consec summons (any status) to know overall count so far; only cancel PENDING/SCHEDULED excess.
    const totalConsec = await prisma.parentSummons.count({
        where: {
            enrollment_id: enrollmentId,
            trigger_type: 'CONSECUTIVE_ABSENCES',
            created_at: { gte: term.start_date, lte: term.end_date },
        },
    });
    const excess = Math.max(0, totalConsec - expectedConsec);
    for (let i = 0; i < Math.min(excess, consecPending.length); i++) {
        const s = consecPending[i];
        await prisma.parentSummons.update({
            where: { id: s.id },
            data: {
                status: 'CANCELLED',
                meeting_notes: `${s.meeting_notes ? s.meeting_notes + '\n' : ''}Auto-cancelled: consecutive-absence run shortened to ${maxRun} after parent excused prior absence.`,
            },
        });
        cancelledSummons++;
    }

    return { absence: updated, reverted_warnings: revertedWarnings, cancelled_summons: cancelledSummons };
}

/**
 * Mark the student-side makeup for an absence. Independent of parent-side excuse
 * and does NOT touch warnings/summons — makeup is about academic recovery.
 */
export async function markAbsenceMakeup(
    absenceId: number,
    data: { status: MakeupStatus; makeup_notes?: string; actor_user_id: number }
): Promise<StudentAbsence> {
    const absence = await prisma.studentAbsence.findUnique({ where: { id: absenceId } });
    if (!absence) throw new Error('ABSENCE_NOT_FOUND');

    if (!Object.values(MakeupStatus).includes(data.status)) {
        throw new Error(`Invalid makeup_status: ${data.status}`);
    }

    return prisma.studentAbsence.update({
        where: { id: absenceId },
        data: {
            makeup_status: data.status,
            makeup_completed_at: data.status === 'COMPLETED' ? new Date() : null,
            makeup_notes: data.makeup_notes?.trim() || null,
            makeup_verified_by_id: data.actor_user_id,
        },
    });
}

// ---------- StudentWarning CRUD ----------

export async function listStudentWarnings(filters: {
    enrollment_id?: number;
    student_id?: number;
    sub_class_id?: number;
    resolved?: boolean;
    academic_year_id?: number;
}) {
    const yearId = filters.academic_year_id ?? (await getAcademicYearId());
    if (!yearId) throw new Error('No academic year found');

    const where: Prisma.StudentWarningWhereInput = {};
    if (filters.enrollment_id) where.enrollment_id = filters.enrollment_id;
    if (filters.resolved !== undefined) where.resolved = filters.resolved;

    if (filters.student_id || filters.sub_class_id) {
        where.enrollment = {
            academic_year_id: yearId,
            ...(filters.student_id ? { student_id: filters.student_id } : {}),
            ...(filters.sub_class_id ? { sub_class_id: filters.sub_class_id } : {}),
        };
    } else if (!filters.enrollment_id) {
        where.enrollment = { academic_year_id: yearId };
    }

    return prisma.studentWarning.findMany({
        where,
        orderBy: { created_at: 'desc' },
        include: {
            enrollment: {
                include: {
                    student: { select: { id: true, matricule: true, name: true } },
                    sub_class: { include: { class: true } },
                },
            },
            issued_by: { select: { id: true, name: true } },
        },
    });
}

export async function createStudentWarning(data: {
    enrollment_id: number;
    warning_level?: number;
    reason: WarningReason;
    description: string;
    issued_by_id: number;
}): Promise<StudentWarning> {
    if (!data.description || !data.description.trim()) throw new Error('description is required');
    const enrollment = await prisma.enrollment.findUnique({ where: { id: data.enrollment_id } });
    if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');

    return prisma.studentWarning.create({
        data: {
            enrollment_id: data.enrollment_id,
            warning_level: data.warning_level ?? 1,
            reason: data.reason,
            description: data.description.trim(),
            issued_by_id: data.issued_by_id,
        },
    });
}

export async function resolveStudentWarning(
    id: number,
    data: { resolved_notes?: string }
): Promise<StudentWarning> {
    const existing = await prisma.studentWarning.findUnique({ where: { id } });
    if (!existing) throw new Error('WARNING_NOT_FOUND');
    return prisma.studentWarning.update({
        where: { id },
        data: {
            resolved: true,
            resolved_at: new Date(),
            resolved_notes: data.resolved_notes?.trim() || null,
        },
    });
}

// ---------- ParentSummons CRUD ----------

export async function listParentSummons(filters: {
    enrollment_id?: number;
    student_id?: number;
    sub_class_id?: number;
    status?: SummonsStatus;
    academic_year_id?: number;
}) {
    const yearId = filters.academic_year_id ?? (await getAcademicYearId());
    if (!yearId) throw new Error('No academic year found');

    const where: Prisma.ParentSummonsWhereInput = {};
    if (filters.enrollment_id) where.enrollment_id = filters.enrollment_id;
    if (filters.status) where.status = filters.status;

    if (filters.student_id || filters.sub_class_id) {
        where.enrollment = {
            academic_year_id: yearId,
            ...(filters.student_id ? { student_id: filters.student_id } : {}),
            ...(filters.sub_class_id ? { sub_class_id: filters.sub_class_id } : {}),
        };
    } else if (!filters.enrollment_id) {
        where.enrollment = { academic_year_id: yearId };
    }

    return prisma.parentSummons.findMany({
        where,
        orderBy: { created_at: 'desc' },
        include: {
            enrollment: {
                include: {
                    student: { select: { id: true, matricule: true, name: true } },
                    sub_class: { include: { class: true } },
                },
            },
            parent: { select: { id: true, name: true, phone: true } },
            created_by: { select: { id: true, name: true } },
        },
    });
}

export async function createParentSummons(data: {
    enrollment_id: number;
    parent_id?: number;
    reason: string;
    scheduled_date?: string;
    created_by_id: number;
}): Promise<ParentSummons> {
    if (!data.reason || !data.reason.trim()) throw new Error('reason is required');
    const enrollment = await prisma.enrollment.findUnique({ where: { id: data.enrollment_id } });
    if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');

    let parentId = data.parent_id ?? null;
    if (!parentId) {
        parentId = await pickPreferredParentId(data.enrollment_id);
    }

    return prisma.parentSummons.create({
        data: {
            enrollment_id: data.enrollment_id,
            parent_id: parentId,
            reason: data.reason.trim(),
            trigger_type: 'MANUAL',
            scheduled_date: data.scheduled_date ? new Date(data.scheduled_date) : null,
            created_by_id: data.created_by_id,
        },
    });
}

export async function updateParentSummons(
    id: number,
    data: {
        status?: SummonsStatus;
        scheduled_date?: string | null;
        meeting_notes?: string;
        attended?: boolean;
        parent_id?: number | null;
    }
): Promise<ParentSummons> {
    const existing = await prisma.parentSummons.findUnique({ where: { id } });
    if (!existing) throw new Error('SUMMONS_NOT_FOUND');
    return prisma.parentSummons.update({
        where: { id },
        data: {
            ...(data.status !== undefined && { status: data.status }),
            ...(data.scheduled_date !== undefined && {
                scheduled_date: data.scheduled_date ? new Date(data.scheduled_date) : null,
            }),
            ...(data.meeting_notes !== undefined && { meeting_notes: data.meeting_notes?.trim() || null }),
            ...(data.attended !== undefined && { attended: data.attended }),
            ...(data.parent_id !== undefined && { parent_id: data.parent_id }),
        },
    });
}

/**
 * Aggregate discipline metrics for a role's overview dashboard.
 *
 * Ranges: pass `from` + `to` (ISO date, inclusive) for arbitrary windows.
 * Backward-compat: if only `date` is given, the range is that single day.
 * With neither, defaults to today. All counts stay scoped to the current
 * academic year unless `academic_year_id` overrides it.
 *
 * Field names still say "today"/"daily" — callers depend on that shape.
 * When the range is wider than a day, the counts are the totals across it.
 */
export async function getDailyOverview(opts: {
    academic_year_id?: number;
    date?: string;
    from?: string;
    to?: string;
    poi_threshold?: number;
    poi_limit?: number;
} = {}) {
    const yearId = opts.academic_year_id ?? await getAcademicYearId();
    if (!yearId) {
        return {
            date: opts.date ?? null,
            from: opts.from ?? null,
            to: opts.to ?? null,
            academic_year_id: null,
            lateTodayCount: 0,
            dailyAbsencesCount: 0,
            disciplinaryActionsTodayCount: 0,
            personsOfInterest: [],
        };
    }

    // Resolve the [dayStart, dayEnd] window from whichever of from/to/date the caller provided.
    const rangeSource: Date = opts.from ? new Date(opts.from) : (opts.date ? new Date(opts.date) : new Date());
    const rangeEnd: Date = opts.to ? new Date(opts.to) : (opts.date ? new Date(opts.date) : new Date());
    const dayStart = new Date(rangeSource); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(rangeEnd); dayEnd.setHours(23, 59, 59, 999);

    const threshold = opts.poi_threshold && opts.poi_threshold > 0 ? opts.poi_threshold : 5;
    const limit = opts.poi_limit && opts.poi_limit > 0 ? opts.poi_limit : 10;

    // Late arrivals today (MORNING_LATENESS)
    const lateTodayCountPromise = prisma.studentAbsence.count({
        where: {
            absence_type: 'MORNING_LATENESS',
            created_at: { gte: dayStart, lte: dayEnd },
            enrollment: { academic_year_id: yearId },
        },
    });

    // Class absences today (CLASS_ABSENCE, unexcused)
    const dailyAbsencesPromise = prisma.studentAbsence.count({
        where: {
            absence_type: 'CLASS_ABSENCE',
            created_at: { gte: dayStart, lte: dayEnd },
            enrollment: { academic_year_id: yearId },
        },
    });

    // Disciplinary actions logged today (regardless of approval state)
    const actionsTodayPromise = prisma.disciplinaryAction.count({
        where: {
            created_at: { gte: dayStart, lte: dayEnd },
            enrollment: { academic_year_id: yearId },
        },
    });

    // Persons of Interest: enrollments with the most unexcused CLASS_ABSENCE this year, above threshold
    const poiRaw = await prisma.studentAbsence.groupBy({
        by: ['enrollment_id'],
        where: {
            absence_type: 'CLASS_ABSENCE',
            is_excused: false,
            enrollment: { academic_year_id: yearId },
        },
        _count: { enrollment_id: true },
        orderBy: { _count: { enrollment_id: 'desc' } },
        take: limit * 3, // over-fetch so we can filter by threshold cleanly
    });

    const poiFiltered = poiRaw.filter((r) => r._count.enrollment_id >= threshold).slice(0, limit);
    let personsOfInterest: any[] = [];
    if (poiFiltered.length > 0) {
        const enrollments = await prisma.enrollment.findMany({
            where: { id: { in: poiFiltered.map((r) => r.enrollment_id) } },
            include: {
                student: { select: { id: true, name: true, matricule: true } },
                sub_class: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
            },
        });
        const byId = new Map(enrollments.map((e) => [e.id, e]));
        personsOfInterest = poiFiltered.map((r) => {
            const e = byId.get(r.enrollment_id);
            return {
                enrollment_id: r.enrollment_id,
                absence_count: r._count.enrollment_id,
                student: e?.student ?? null,
                sub_class: e?.sub_class
                    ? { id: e.sub_class.id, name: e.sub_class.name, class: e.sub_class.class }
                    : null,
            };
        });
    }

    const [lateTodayCount, dailyAbsencesCount, disciplinaryActionsTodayCount] = await Promise.all([
        lateTodayCountPromise,
        dailyAbsencesPromise,
        actionsTodayPromise,
    ]);

    return {
        date: dayStart.toISOString().slice(0, 10),
        from: dayStart.toISOString().slice(0, 10),
        to: dayEnd.toISOString().slice(0, 10),
        academic_year_id: yearId,
        lateTodayCount,
        dailyAbsencesCount,
        disciplinaryActionsTodayCount,
        personsOfInterest,
    };
}
