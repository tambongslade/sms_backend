// Super Manager "Statistics" report — a school-wide snapshot over an
// arbitrary date range (weekly by default, but any range works): discipline
// (lateness/absences/sanctions/persons of interest, each with the actual
// offence rows, not just counts), teaching hours vs pay, per-subclass work
// (syllabus) coverage, and per-subclass fee collection. Rendered both as
// JSON (for the on-screen page) and as a letterhead PDF (see
// statisticsReportPdf.ts).

import prisma, { DayOfWeek } from '../../../config/db';
import { getAcademicYearId, getCurrentAcademicYear } from '../../../utils/academicYear';
import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import * as PuppeteerManager from '../../../utils/puppeteerManager';

// ---------------------------------------------------------------------------
// Shared row shapes
// ---------------------------------------------------------------------------

export interface OffenceRow {
    studentId: number;
    studentName: string;
    matricule: string | null;
    className: string;
    subClassName: string;
    date: string; // ISO date
}

export interface SanctionRow extends OffenceRow {
    actionType: string;
    reason: string | null;
    status: string;
}

// Class Absences is reported per student (one row, total count) rather than
// one row per individual absence -- the raw instance list was unreadable for
// a school-wide range.
export interface StudentAbsenceCountRow {
    studentId: number;
    studentName: string;
    matricule: string | null;
    className: string;
    subClassName: string;
    count: number;
}

export interface DisciplinePoiRow {
    studentId: number;
    studentName: string;
    matricule: string | null;
    className: string;
    subClassName: string;
    classAbsences: number;
    lateness: number;
    sanctions: number;
    totalOffences: number;
}

export interface TeachingRow {
    teacherId: number;
    name: string;
    matricule: string | null;
    // Period COUNTS, not durations -- teaching slots aren't a fixed length
    // (see teacherService.getTeacherTimetable for the same reasoning), so a
    // count is what "how many periods was this teacher scheduled/taught"
    // actually means. Pay (hourRate x total) still runs on real duration-
    // hours internally -- see getTeachingSection -- since SalaryProfile's
    // rate is denominated per hour, not per period.
    expectedPeriods: number;
    periodsTaught: number;
    periodsNotTaught: number;
    hourRate: number;
    socials: number;
    total: number;
}

export interface CoverageRow {
    subClassId: number;
    subClassName: string;
    className: string;
    totalLessons: number;
    completedLessons: number;
    coveragePercent: number;
}

export interface FinancialRow {
    subClassId: number;
    subClassName: string;
    className: string;
    studentsOwing: number;
    collectedThisRange: number;
    totalCollected: number;
    outstandingInstallment1: number;
    percentCollected: number;
}

export interface FinancialPoiRow {
    studentId: number;
    studentName: string;
    matricule: string | null;
    className: string;
    subClassName: string;
    outstandingAmount: number;
}

export interface StatisticsReportData {
    range: { from: string; to: string };
    academicYear: { id: number; name: string } | null;
    discipline: {
        lateness: OffenceRow[];
        absences: StudentAbsenceCountRow[];
        sanctions: SanctionRow[];
        personsOfInterest: DisciplinePoiRow[];
    };
    teaching: TeachingRow[];
    workCoverage: CoverageRow[];
    financial: {
        subClasses: FinancialRow[];
        personsOfInterest: FinancialPoiRow[];
    };
    generatedAt: string;
}

// A flat 2000 social-security-style deduction applied to every teacher row.
// Nothing in the payroll schema models this yet (see session notes) -- it's
// a report-only line item for now, not a persisted payroll deduction.
const FLAT_SOCIALS_DEDUCTION = 2000;

// Same "3-strike" scale the Discipline Overview / Saturday Punishment
// pipeline already uses elsewhere in this codebase.
const POI_OFFENCE_THRESHOLD = 5;
const POI_LIMIT = 15;
const FINANCIAL_POI_LIMIT = 50;

// Accounts that carry a TEACHER role (and have scheduled periods) but should
// never appear in Teaching Statistics, by explicit request -- e.g. a manager
// who also teaches a period but isn't meant to be tracked in this report.
// user 151 = "Enah Marcel" (MANAGER + TEACHER), the only manager/teacher
// overlap in the roster at the time of this request.
const EXCLUDED_TEACHER_USER_IDS: number[] = [151];

// ---------------------------------------------------------------------------
// Small local helpers (deliberately not shared with salaryService.ts's
// versions -- see that file's own comment on why these stay per-service).
// ---------------------------------------------------------------------------

function toISODate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function parseDateOnly(s: string): Date {
    const d = new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${s}`);
    return d;
}

function endOfDay(s: string): Date {
    const d = new Date(`${s}T23:59:59.999Z`);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${s}`);
    return d;
}

/** Every calendar date from `from` to `to` inclusive, as UTC-midnight Dates. */
function datesInRange(from: string, to: string): Date[] {
    const start = parseDateOnly(from);
    const end = parseDateOnly(to);
    const dates: Date[] = [];
    for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
        dates.push(new Date(d));
    }
    return dates;
}

const DAY_INDEX_TO_ENUM: DayOfWeek[] = [
    'SUNDAY' as DayOfWeek,
    'MONDAY' as DayOfWeek,
    'TUESDAY' as DayOfWeek,
    'WEDNESDAY' as DayOfWeek,
    'THURSDAY' as DayOfWeek,
    'FRIDAY' as DayOfWeek,
    'SATURDAY' as DayOfWeek,
];

function dayOfWeekFromDate(d: Date): DayOfWeek {
    return DAY_INDEX_TO_ENUM[d.getUTCDay()];
}

function parseHHMMToMinutes(t: string): number {
    const [hStr, mStr] = t.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr || '0', 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
}

function periodDurationHours(startTime: string, endTime: string): number {
    const mins = Math.max(0, parseHHMMToMinutes(endTime) - parseHHMMToMinutes(startTime));
    return mins / 60;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

function toPct(numerator: number, denominator: number): number {
    if (!denominator) return 0;
    return Math.round((numerator / denominator) * 10000) / 100;
}

// ---------------------------------------------------------------------------
// 1. Discipline — lateness / absences / sanctions / persons of interest
// ---------------------------------------------------------------------------

const enrollmentNameInclude = {
    student: { select: { id: true, name: true, matricule: true } },
    sub_class: { include: { class: { select: { id: true, name: true } } } },
} as const;

function offenceRow(row: {
    created_at: Date;
    enrollment: {
        student: { id: number; name: string; matricule: string | null } | null;
        sub_class: { name: string; class: { name: string } | null } | null;
    } | null;
}): OffenceRow | null {
    const student = row.enrollment?.student;
    if (!student) return null;
    return {
        studentId: student.id,
        studentName: student.name,
        matricule: student.matricule,
        className: row.enrollment?.sub_class?.class?.name ?? '—',
        subClassName: row.enrollment?.sub_class?.name ?? '—',
        date: toISODate(row.created_at),
    };
}

async function getDisciplineSection(
    yearId: number | null,
    fromDate: Date,
    toDate: Date
): Promise<StatisticsReportData['discipline']> {
    const dateFilter = { created_at: { gte: fromDate, lte: toDate } };
    const enrollmentFilter = yearId
        ? { academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' as const } } }
        : { student: { status: { not: 'WITHDRAWN' as const } } };

    const [latenessRaw, absencesRaw, sanctionsRaw] = await Promise.all([
        prisma.studentAbsence.findMany({
            where: {
                absence_type: 'MORNING_LATENESS',
                is_excused: false,
                ...dateFilter,
                enrollment: enrollmentFilter,
            },
            include: { enrollment: { include: enrollmentNameInclude } },
            orderBy: { created_at: 'asc' },
        }),
        prisma.studentAbsence.findMany({
            where: {
                absence_type: 'CLASS_ABSENCE',
                is_excused: false,
                ...dateFilter,
                enrollment: enrollmentFilter,
            },
            include: { enrollment: { include: enrollmentNameInclude } },
            orderBy: { created_at: 'asc' },
        }),
        prisma.disciplinaryAction.findMany({
            where: { ...dateFilter, enrollment: enrollmentFilter },
            include: { enrollment: { include: enrollmentNameInclude } },
            orderBy: { created_at: 'asc' },
        }),
    ]);

    const lateness = latenessRaw.map(offenceRow).filter((r): r is OffenceRow => r !== null);
    const absenceInstances = absencesRaw.map(offenceRow).filter((r): r is OffenceRow => r !== null);
    // One row per student with their total count, not one row per absence --
    // the raw instance list is unreadable for a school-wide range.
    const absencesByStudent = new Map<number, StudentAbsenceCountRow>();
    for (const a of absenceInstances) {
        const existing = absencesByStudent.get(a.studentId);
        if (existing) existing.count += 1;
        else {
            absencesByStudent.set(a.studentId, {
                studentId: a.studentId,
                studentName: a.studentName,
                matricule: a.matricule,
                className: a.className,
                subClassName: a.subClassName,
                count: 1,
            });
        }
    }
    const absences = Array.from(absencesByStudent.values()).sort((a, b) => b.count - a.count);
    const sanctions = sanctionsRaw
        .map((r) => {
            const base = offenceRow(r);
            if (!base) return null;
            return { ...base, actionType: r.action_type, reason: r.reason, status: r.status } as SanctionRow;
        })
        .filter((r): r is SanctionRow => r !== null);

    // Persons of interest: tally per-enrollment offence counts across all
    // three categories over the same range, flag anyone at/above the
    // 3-strike-style threshold, or with any sanction at all.
    const byEnrollment = new Map<
        number,
        { classAbsences: number; lateness: number; sanctions: number }
    >();
    const bump = (id: number, key: 'classAbsences' | 'lateness' | 'sanctions') => {
        const entry = byEnrollment.get(id) ?? { classAbsences: 0, lateness: 0, sanctions: 0 };
        entry[key] += 1;
        byEnrollment.set(id, entry);
    };
    for (const r of absencesRaw) bump(r.enrollment_id, 'classAbsences');
    for (const r of latenessRaw) bump(r.enrollment_id, 'lateness');
    for (const r of sanctionsRaw) bump(r.enrollment_id, 'sanctions');

    const flagged = Array.from(byEnrollment.entries())
        .map(([enrollmentId, counts]) => ({
            enrollmentId,
            ...counts,
            totalOffences: counts.classAbsences + counts.lateness + counts.sanctions,
        }))
        .filter((e) => e.totalOffences >= POI_OFFENCE_THRESHOLD || e.sanctions > 0)
        .sort((a, b) => b.totalOffences - a.totalOffences)
        .slice(0, POI_LIMIT);

    let personsOfInterest: DisciplinePoiRow[] = [];
    if (flagged.length > 0) {
        const enrollments = await prisma.enrollment.findMany({
            where: { id: { in: flagged.map((f) => f.enrollmentId) } },
            include: enrollmentNameInclude,
        });
        const byId = new Map(enrollments.map((e) => [e.id, e]));
        personsOfInterest = flagged
            .map((f) => {
                const enrollment = byId.get(f.enrollmentId);
                const student = enrollment?.student;
                if (!student) return null;
                return {
                    studentId: student.id,
                    studentName: student.name,
                    matricule: student.matricule,
                    className: enrollment?.sub_class?.class?.name ?? '—',
                    subClassName: enrollment?.sub_class?.name ?? '—',
                    classAbsences: f.classAbsences,
                    lateness: f.lateness,
                    sanctions: f.sanctions,
                    totalOffences: f.totalOffences,
                } as DisciplinePoiRow;
            })
            .filter((r): r is DisciplinePoiRow => r !== null);
    }

    return { lateness, absences, sanctions, personsOfInterest };
}

// ---------------------------------------------------------------------------
// 2. Teaching statistics — expected/taught/not-taught hours, rate, socials
// ---------------------------------------------------------------------------

async function getTeachingSection(yearId: number | null, from: string, to: string): Promise<TeachingRow[]> {
    if (!yearId) return [];
    const dates = datesInRange(from, to);
    const dateToDow = new Map(dates.map((d) => [toISODate(d), dayOfWeekFromDate(d)]));

    // Roster: teachers who actually have periods scheduled this year (not
    // just anyone holding the TEACHER role) -- matches this report's intent
    // of "who was supposed to be teaching". Excludes anyone who also holds
    // SUPER_MANAGER (admin/dev accounts occasionally carry a TEACHER role
    // too and shouldn't appear in a payroll-adjacent report), plus specific
    // named exclusions requested for accounts that legitimately teach but
    // aren't meant to be tracked here.
    const teachers = await prisma.user.findMany({
        where: {
            user_roles: { some: { role: 'TEACHER' } },
            teacher_periods: { some: { academic_year_id: yearId } },
            NOT: {
                OR: [
                    { user_roles: { some: { role: 'SUPER_MANAGER' } } },
                    { id: { in: EXCLUDED_TEACHER_USER_IDS } },
                ],
            },
        },
        select: { id: true, name: true, matricule: true },
        orderBy: { name: 'asc' },
    });
    if (teachers.length === 0) return [];
    const teacherIds = teachers.map((t) => t.id);

    const [teacherPeriods, salaryProfiles] = await Promise.all([
        prisma.teacherPeriod.findMany({
            where: { teacher_id: { in: teacherIds }, academic_year_id: yearId },
            include: { period: true },
        }),
        prisma.salaryProfile.findMany({
            where: { user_id: { in: teacherIds }, academic_year_id: yearId },
            select: { user_id: true, hourly_rate: true },
        }),
    ]);
    const rateByTeacher = new Map(salaryProfiles.map((p) => [p.user_id, p.hourly_rate ?? 0]));

    const periodsByTeacher = new Map<number, typeof teacherPeriods>();
    for (const tp of teacherPeriods) {
        if (!tp.teacher_id || tp.period.type !== 'TEACHING') continue; // billable slots only
        const list = periodsByTeacher.get(tp.teacher_id) ?? [];
        list.push(tp);
        periodsByTeacher.set(tp.teacher_id, list);
    }

    const teacherPeriodIds = teacherPeriods.map((tp) => tp.id);
    const attendances = teacherPeriodIds.length
        ? await prisma.teacherPeriodAttendance.findMany({
              where: { teacher_period_id: { in: teacherPeriodIds }, date: { in: dates } },
          })
        : [];
    const attByKey = new Map(
        attendances.map((a) => [`${a.teacher_period_id}|${toISODate(a.date)}`, a.status])
    );

    return teachers.map((t) => {
        const periods = periodsByTeacher.get(t.id) ?? [];
        const byDow = new Map<DayOfWeek, typeof periods>();
        for (const tp of periods) {
            const list = byDow.get(tp.period.day_of_week) ?? [];
            list.push(tp);
            byDow.set(tp.period.day_of_week, list);
        }

        let expectedPeriods = 0;
        let taughtPeriods = 0;
        // Duration-weighted, for pay only -- SalaryProfile.hourly_rate is
        // FCFA per hour, and periods run non-uniform lengths (50/55/110 min
        // etc.), so paying periodsTaught x rate directly would be wrong.
        let taughtHoursForPay = 0;
        for (const date of dates) {
            const key = toISODate(date);
            const dow = dateToDow.get(key)!;
            const scheduled = byDow.get(dow) ?? [];
            for (const tp of scheduled) {
                expectedPeriods += 1;
                const status = attByKey.get(`${tp.id}|${key}`);
                if (status === 'PRESENT' || status === 'LATE') {
                    taughtPeriods += 1;
                    taughtHoursForPay += periodDurationHours(tp.period.start_time, tp.period.end_time);
                }
            }
        }

        // "Not taught" folds in both explicit ABSENT marks and periods the DM
        // never evaluated -- from the school's perspective, if it wasn't
        // confirmed delivered, it doesn't count as taught.
        const notTaughtPeriods = Math.max(expectedPeriods - taughtPeriods, 0);
        const rate = rateByTeacher.get(t.id) ?? 0;
        const total = round2(taughtHoursForPay * rate - FLAT_SOCIALS_DEDUCTION);

        return {
            teacherId: t.id,
            name: t.name,
            matricule: t.matricule,
            expectedPeriods,
            periodsTaught: taughtPeriods,
            periodsNotTaught: notTaughtPeriods,
            hourRate: rate,
            socials: FLAT_SOCIALS_DEDUCTION,
            total,
        };
    });
}

// ---------------------------------------------------------------------------
// 3. Work coverage — % of the syllabus actually logged as taught, per subclass
// ---------------------------------------------------------------------------

async function getWorkCoverageSection(yearId: number | null, to: string): Promise<CoverageRow[]> {
    if (!yearId) return [];
    const toDate = endOfDay(to);

    const [subClasses, schemeLessons, completedEntries] = await Promise.all([
        prisma.subClass.findMany({
            select: { id: true, name: true, class: { select: { id: true, name: true } } },
        }),
        prisma.schemeLesson.findMany({
            where: { chapter: { module: { subject_scheme: { academic_year_id: yearId } } } },
            select: {
                id: true,
                chapter: { select: { module: { select: { subject_scheme: { select: { class_id: true } } } } } },
            },
        }),
        prisma.logbookEntry.findMany({
            where: {
                status: 'COMPLETED',
                date_taught: { lte: toDate },
                lesson: { chapter: { module: { subject_scheme: { academic_year_id: yearId } } } },
            },
            select: { lesson_id: true, teacher_period: { select: { sub_class_id: true } } },
        }),
    ]);

    // Total planned lessons per Class (the syllabus is authored at the Class
    // level and shared by every subclass under it).
    const lessonIdsByClass = new Map<number, Set<number>>();
    for (const lesson of schemeLessons) {
        const classId = lesson.chapter.module.subject_scheme.class_id;
        const set = lessonIdsByClass.get(classId) ?? new Set<number>();
        set.add(lesson.id);
        lessonIdsByClass.set(classId, set);
    }

    // Distinct completed lesson ids per SubClass (a lesson only counts once
    // per subclass even if logged more than once).
    const completedLessonIdsBySubClass = new Map<number, Set<number>>();
    for (const entry of completedEntries) {
        const subClassId = entry.teacher_period?.sub_class_id;
        if (subClassId == null) continue;
        const set = completedLessonIdsBySubClass.get(subClassId) ?? new Set<number>();
        set.add(entry.lesson_id);
        completedLessonIdsBySubClass.set(subClassId, set);
    }

    return subClasses
        .map((sc) => {
            const totalLessons = lessonIdsByClass.get(sc.class.id)?.size ?? 0;
            const completedLessons = completedLessonIdsBySubClass.get(sc.id)?.size ?? 0;
            return {
                subClassId: sc.id,
                subClassName: sc.name,
                className: sc.class.name,
                totalLessons,
                completedLessons,
                coveragePercent: toPct(completedLessons, totalLessons),
            };
        })
        .filter((r) => r.totalLessons > 0) // no scheme authored yet -- nothing to report
        .sort((a, b) => a.className.localeCompare(b.className) || a.subClassName.localeCompare(b.subClassName));
}

// ---------------------------------------------------------------------------
// 4. Financial — per-subclass collection for the range + fee defaulters
// ---------------------------------------------------------------------------

async function getFinancialSection(
    yearId: number | null,
    fromDate: Date,
    toDate: Date
): Promise<StatisticsReportData['financial']> {
    if (!yearId) return { subClasses: [], personsOfInterest: [] };

    const [classesMeta, feesRaw, paymentsInRange] = await Promise.all([
        prisma.class.findMany({
            select: {
                id: true,
                name: true,
                first_term_fee: true,
                sub_classes: { select: { id: true, name: true } },
            },
        }),
        prisma.schoolFees.findMany({
            where: { academic_year_id: yearId },
            select: {
                amount_expected: true,
                amount_paid: true,
                enrollment: {
                    select: {
                        class_id: true,
                        sub_class_id: true,
                        student: { select: { id: true, name: true, matricule: true, status: true } },
                    },
                },
            },
        }),
        prisma.paymentTransaction.findMany({
            where: { academic_year_id: yearId, payment_date: { gte: fromDate, lte: toDate } },
            select: { amount: true, enrollment: { select: { sub_class_id: true } } },
        }),
    ]);

    const firstInstallmentByClass = new Map(classesMeta.map((c) => [c.id, c.first_term_fee || 0]));

    interface Acc {
        subClassId: number;
        subClassName: string;
        className: string;
        expected: number;
        collected: number;
        collectedThisRange: number;
        studentsOwing: number;
        firstInstallmentExpected: number;
        firstInstallmentCollected: number;
    }
    const accBySubClass = new Map<number, Acc>();
    for (const cls of classesMeta) {
        for (const sc of cls.sub_classes) {
            accBySubClass.set(sc.id, {
                subClassId: sc.id,
                subClassName: sc.name,
                className: cls.name,
                expected: 0,
                collected: 0,
                collectedThisRange: 0,
                studentsOwing: 0,
                firstInstallmentExpected: 0,
                firstInstallmentCollected: 0,
            });
        }
    }

    const poiCandidates: FinancialPoiRow[] = [];
    for (const fee of feesRaw) {
        const subClassId = fee.enrollment?.sub_class_id;
        const classId = fee.enrollment?.class_id;
        const student = fee.enrollment?.student;
        if (subClassId == null || classId == null || !student || student.status === 'WITHDRAWN') continue;
        const acc = accBySubClass.get(subClassId);
        if (!acc) continue;

        const expected = fee.amount_expected || 0;
        const paid = fee.amount_paid || 0;
        const outstanding = Math.max(expected - paid, 0);
        acc.expected += expected;
        acc.collected += paid;
        if (outstanding > 0) acc.studentsOwing += 1;

        const firstInstallment = firstInstallmentByClass.get(classId) || 0;
        acc.firstInstallmentExpected += firstInstallment;
        acc.firstInstallmentCollected += Math.min(paid, firstInstallment);

        if (outstanding > 0) {
            poiCandidates.push({
                studentId: student.id,
                studentName: student.name,
                matricule: student.matricule,
                className: acc.className,
                subClassName: acc.subClassName,
                outstandingAmount: outstanding,
            });
        }
    }

    for (const p of paymentsInRange) {
        const subClassId = p.enrollment?.sub_class_id;
        if (subClassId == null) continue;
        const acc = accBySubClass.get(subClassId);
        if (!acc) continue;
        acc.collectedThisRange += p.amount || 0;
    }

    const subClasses: FinancialRow[] = Array.from(accBySubClass.values())
        .map((acc) => ({
            subClassId: acc.subClassId,
            subClassName: acc.subClassName,
            className: acc.className,
            studentsOwing: acc.studentsOwing,
            collectedThisRange: round2(acc.collectedThisRange),
            totalCollected: round2(acc.collected),
            outstandingInstallment1: round2(
                Math.max(acc.firstInstallmentExpected - acc.firstInstallmentCollected, 0)
            ),
            percentCollected: toPct(acc.collected, acc.expected),
        }))
        .sort((a, b) => a.className.localeCompare(b.className) || a.subClassName.localeCompare(b.subClassName));

    const personsOfInterest = poiCandidates
        .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
        .slice(0, FINANCIAL_POI_LIMIT);

    return { subClasses, personsOfInterest };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function getStatisticsReport(params: {
    academicYearId?: number;
    from: string;
    to: string;
}): Promise<StatisticsReportData> {
    if (!params.from || !params.to) throw new Error('from and to are required (YYYY-MM-DD)');

    const yearId = await getAcademicYearId(params.academicYearId);
    const academicYear = params.academicYearId
        ? await prisma.academicYear.findUnique({ where: { id: params.academicYearId }, select: { id: true, name: true } })
        : await getCurrentAcademicYear();

    const fromDate = parseDateOnly(params.from);
    const toDate = endOfDay(params.to);

    const [discipline, teaching, workCoverage, financial] = await Promise.all([
        getDisciplineSection(yearId, fromDate, toDate),
        getTeachingSection(yearId, params.from, params.to),
        getWorkCoverageSection(yearId, params.to),
        getFinancialSection(yearId, fromDate, toDate),
    ]);

    return {
        range: { from: params.from, to: params.to },
        academicYear: academicYear ? { id: academicYear.id, name: academicYear.name } : null,
        discipline,
        teaching,
        workCoverage,
        financial,
        generatedAt: new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------------
// PDF export — same letterhead pattern as timetable-template.ejs
// ---------------------------------------------------------------------------

const templateCache: { html?: string } = {};
function loadStatisticsTemplate(): string {
    if (!templateCache.html) {
        const templatePath = path.join(process.cwd(), 'src/view/statistics-report-template.ejs');
        templateCache.html = fs.readFileSync(templatePath, 'utf-8');
    }
    return templateCache.html;
}

const logoCache: { dataUri?: string } = {};
function loadSchoolLogoDataUri(): string {
    if (!logoCache.dataUri) {
        try {
            const logoPath = path.join(process.cwd(), 'public/school.png');
            const buf = fs.readFileSync(logoPath);
            logoCache.dataUri = `data:image/png;base64,${buf.toString('base64')}`;
        } catch {
            logoCache.dataUri = '';
        }
    }
    return logoCache.dataUri;
}

export async function generateStatisticsReportPdf(params: {
    academicYearId?: number;
    from: string;
    to: string;
}): Promise<{ buffer: Buffer; filename: string }> {
    const data = await getStatisticsReport(params);

    const template = loadStatisticsTemplate();
    const html = ejs.render(template, {
        ...data,
        academicYearName: data.academicYear?.name ?? 'Current Academic Year',
        documentTitle: `Statistics Report ${data.range.from} to ${data.range.to}`,
        brand: 'School Management System',
        schoolLogo: loadSchoolLogoDataUri(),
        schoolName: "ST STEPHEN'S INTERNATIONAL COLLEGE",
        schoolTagline: 'Excellence for Higher Heights',
        schoolAddress: 'Yaounde Essono city Damas',
        schoolPhone: '(+237) 680 188 080 / 681 630 435',
        generatedAt: new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    });

    const page = await PuppeteerManager.newPage();
    try {
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({
            format: 'A4',
            landscape: false,
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
            preferCSSPageSize: true,
        });
        const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
        return { buffer, filename: `statistics-report-${data.range.from}-to-${data.range.to}.pdf` };
    } finally {
        try { await page.close(); } catch { /* noop */ }
    }
}
