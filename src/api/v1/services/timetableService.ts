// src/api/v1/services/timetableService.ts

import prisma, { DayOfWeek } from '../../../config/db';
import { getCurrentAcademicYear } from '../../../utils/academicYear';
import * as academicYearService from './academicYearService';
import * as XLSX from 'xlsx';
import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import * as PuppeteerManager from '../../../utils/puppeteerManager';

// ---------- Types ----------

export interface PeriodSetSummary {
    id: number;
    code: string;
    name: string;
}

export interface PeriodDefinition {
    id: number;
    name: string;
    dayOfWeek: DayOfWeek;
    startTime: string;
    endTime: string;
    sequence: number;
    type: 'TEACHING' | 'BREAK' | 'PREP';
    isBreak: boolean;
    periodSetId: number | null;
}

export interface TimetableSlotOutput {
    id: number;
    subClassId: number;
    subClassName: string;
    classId: number;
    className: string;
    day: DayOfWeek;
    periodId: number;
    periodName: string;
    periodStartTime: string;
    periodEndTime: string;
    periodSequence: number;
    periodType: 'TEACHING' | 'BREAK' | 'PREP';
    isBreak: boolean;
    periodSetId: number | null;
    subjectId: number | null;
    subjectName: string | null;
    subjectCategory: string | null;
    teacherId: number | null;
    teacherName: string | null;
}

export interface SubclassTimetableResult {
    sub_class: {
        id: number;
        name: string;
        class: { id: number; name: string; periodSetId: number | null };
    };
    academicYearId: number;
    periodSet: PeriodSetSummary | null;
    /** All period slots that belong to the class's set — includes empty rows so the grid renders. */
    periods: PeriodDefinition[];
    /** TeacherPeriod assignments only. */
    slots: TimetableSlotOutput[];
}

export interface FullSchoolSubclassBlock {
    subClass: {
        id: number;
        name: string;
        className: string;
        classId: number;
    };
    periodSet: PeriodSetSummary | null;
    periods: PeriodDefinition[];
    slots: TimetableSlotOutput[];
}

export interface FullSchoolTimetable {
    academicYearId: number;
    academicYearName: string;
    periodSets: (PeriodSetSummary & { periods: PeriodDefinition[] })[];
    subclasses: FullSchoolSubclassBlock[];
    /** Legacy flat list kept for callers still reading the old shape. */
    timetableSlots: TimetableSlotOutput[];
}

// ---------- Helpers ----------

const toPeriodDefinition = (p: any): PeriodDefinition => ({
    id: p.id,
    name: p.name,
    dayOfWeek: p.day_of_week,
    startTime: p.start_time,
    endTime: p.end_time,
    sequence: p.sequence ?? 0,
    type: (p.type ?? (p.is_break ? 'BREAK' : 'TEACHING')) as 'TEACHING' | 'BREAK' | 'PREP',
    isBreak: !!p.is_break,
    periodSetId: p.period_set_id ?? null
});

const toSlotOutput = (tp: any): TimetableSlotOutput => ({
    id: tp.id,
    subClassId: tp.sub_class.id,
    subClassName: tp.sub_class.name,
    classId: tp.sub_class.class.id,
    className: tp.sub_class.class.name,
    day: tp.period.day_of_week,
    periodId: tp.period.id,
    periodName: tp.period.name,
    periodStartTime: tp.period.start_time,
    periodEndTime: tp.period.end_time,
    periodSequence: tp.period.sequence ?? 0,
    periodType: (tp.period.type ?? (tp.period.is_break ? 'BREAK' : 'TEACHING')) as 'TEACHING' | 'BREAK' | 'PREP',
    isBreak: !!tp.period.is_break,
    periodSetId: tp.period.period_set_id ?? null,
    subjectId: tp.subject?.id ?? null,
    subjectName: tp.subject?.name ?? null,
    subjectCategory: tp.subject?.category ?? null,
    teacherId: tp.teacher?.id ?? null,
    teacherName: tp.teacher?.name ?? null
});

/**
 * Parse an HH:MM or HH:MM:SS clock string into minutes-since-midnight.
 * Used for time-overlap clash detection across different period sets.
 */
const toMinutes = (t: string): number => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
};

/** Half-open interval intersection: [aStart, aEnd) ∩ [bStart, bEnd) != empty. */
const intervalsOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean => {
    return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
};

// ---------- Public API ----------

/**
 * Full-school timetable, grouped by subclass so each subclass can render its
 * own period columns even when different bell schedules coexist.
 */
export async function getFullSchoolTimetable(academicYearId?: number): Promise<FullSchoolTimetable> {
    const currentYear = academicYearId
        ? await prisma.academicYear.findUnique({ where: { id: academicYearId } })
        : await getCurrentAcademicYear();

    if (!currentYear) throw new Error('No active academic year found to generate school timetable.');

    const [periodSets, subclasses, teacherPeriods] = await Promise.all([
        prisma.periodSet.findMany({
            where: { academic_year_id: currentYear.id },
            include: { periods: { orderBy: [{ day_of_week: 'asc' }, { sequence: 'asc' }] } },
            orderBy: [{ code: 'asc' }]
        }),
        prisma.subClass.findMany({
            include: { class: true },
            orderBy: [{ class: { name: 'asc' } }, { name: 'asc' }]
        }),
        prisma.teacherPeriod.findMany({
            where: { academic_year_id: currentYear.id },
            include: {
                period: true,
                teacher: true,
                subject: true,
                sub_class: { include: { class: true } }
            }
        })
    ]);

    const periodsBySet = new Map<number, PeriodDefinition[]>();
    for (const set of periodSets) {
        periodsBySet.set(set.id, set.periods.map(toPeriodDefinition));
    }

    const slotsBySubclass = new Map<number, TimetableSlotOutput[]>();
    for (const tp of teacherPeriods) {
        const arr = slotsBySubclass.get(tp.sub_class_id) ?? [];
        arr.push(toSlotOutput(tp));
        slotsBySubclass.set(tp.sub_class_id, arr);
    }

    const blocks: FullSchoolSubclassBlock[] = subclasses.map(sc => {
        const setId = sc.class.period_set_id ?? null;
        const set = setId ? periodSets.find(s => s.id === setId) ?? null : null;
        return {
            subClass: { id: sc.id, name: sc.name, className: sc.class.name, classId: sc.class.id },
            periodSet: set ? { id: set.id, code: set.code, name: set.name } : null,
            periods: setId ? periodsBySet.get(setId) ?? [] : [],
            slots: slotsBySubclass.get(sc.id) ?? []
        };
    });

    return {
        academicYearId: currentYear.id,
        academicYearName: currentYear.name || 'Unknown Academic Year',
        periodSets: periodSets.map(s => ({
            id: s.id,
            code: s.code,
            name: s.name,
            periods: periodsBySet.get(s.id) ?? []
        })),
        subclasses: blocks,
        timetableSlots: blocks.flatMap(b => b.slots)
    };
}

/**
 * Subclass timetable — returns the class's own period grid (every slot, even
 * empty ones) plus the teacher assignments filled in.
 */
export async function getSubclassTimetable(subclassId: number, academicYearId?: number): Promise<SubclassTimetableResult> {
    const sub_class = await prisma.subClass.findUnique({
        where: { id: subclassId },
        include: { class: { include: { period_set: true } } }
    });
    if (!sub_class) throw new Error('Subclass not found');

    let yearId = academicYearId;
    if (!yearId) {
        const currentYear = await academicYearService.getCurrentYear();
        if (!currentYear) throw new Error('No active academic year found');
        yearId = currentYear.id;
    }

    const setId = sub_class.class.period_set_id ?? null;

    const [periods, teacherPeriods] = await Promise.all([
        setId
            ? prisma.period.findMany({
                where: { period_set_id: setId },
                orderBy: [{ day_of_week: 'asc' }, { sequence: 'asc' }]
            })
            : Promise.resolve([]),
        prisma.teacherPeriod.findMany({
            where: { sub_class_id: subclassId, academic_year_id: yearId },
            include: {
                period: true,
                teacher: true,
                subject: true,
                sub_class: { include: { class: true } }
            },
            orderBy: [{ period: { day_of_week: 'asc' } }, { period: { start_time: 'asc' } }]
        })
    ]);

    return {
        sub_class: {
            id: sub_class.id,
            name: sub_class.name,
            class: {
                id: sub_class.class.id,
                name: sub_class.class.name,
                periodSetId: setId
            }
        },
        academicYearId: yearId,
        periodSet: sub_class.class.period_set
            ? { id: sub_class.class.period_set.id, code: sub_class.class.period_set.code, name: sub_class.class.period_set.name }
            : null,
        periods: periods.map(toPeriodDefinition),
        slots: teacherPeriods.map(toSlotOutput)
    };
}

// ---------- Bulk update ----------

export interface BulkUpdateTimetableSlotInput {
    period_id: number;
    subject_id: number | null;
    teacher_id: number | null;
}

export interface BulkUpdateTimetableResult {
    updated: number;
    created: number;
    deleted: number;
    errors: { periodId: number; error: string }[];
    warnings: {
        periodId: number;
        type: 'TEACHER_CLASH';
        message: string;
        clashWith: {
            subClassId: number;
            subClassName: string;
            day: string;
            periodName: string;
            periodStartTime: string;
            periodEndTime: string;
            periodSetCode: string | null;
        };
    }[];
}

/**
 * Update timetable slots for a subclass.
 *
 * Enforcement:
 *   - Rejects a period whose period_set doesn't match the subclass's set.
 *   - Rejects BREAK / PREP periods.
 *   - Detects teacher clashes by time-overlap across all sets (not periodId
 *     equality) so cross-cycle double-bookings are caught.
 *   - Emits clashes as warnings, still writes the slot.
 */
export async function bulkUpdateTimetable(
    subclassId: number,
    slots: BulkUpdateTimetableSlotInput[],
    academicYearId: number,
    assignedById: number
): Promise<BulkUpdateTimetableResult> {
    const sub_class = await prisma.subClass.findUnique({
        where: { id: subclassId },
        include: { class: { select: { period_set_id: true } } }
    });
    if (!sub_class) throw new Error('Subclass not found');

    const classSetId = sub_class.class.period_set_id ?? null;

    const result: BulkUpdateTimetableResult = { updated: 0, created: 0, deleted: 0, errors: [], warnings: [] };

    for (const slot of slots) {
        const { period_id, subject_id, teacher_id } = slot;

        if (period_id === undefined || period_id === null) {
            result.errors.push({ periodId: period_id || 0, error: 'Missing required field: period_id' });
            continue;
        }
        const parsedPeriodId = parseInt(period_id as any);
        if (isNaN(parsedPeriodId)) {
            result.errors.push({ periodId: period_id, error: 'Invalid period_id format' });
            continue;
        }

        try {
            const period = await prisma.period.findUnique({
                where: { id: parsedPeriodId },
                include: { period_set: true }
            });
            if (!period) {
                result.errors.push({ periodId: parsedPeriodId, error: `Period with ID ${parsedPeriodId} not found` });
                continue;
            }

            // Cross-set guard: period must belong to the subclass's set.
            if (classSetId !== null && period.period_set_id !== classSetId) {
                result.errors.push({
                    periodId: parsedPeriodId,
                    error: `Period ${parsedPeriodId} belongs to a different bell schedule than this subclass`
                });
                continue;
            }
            if (classSetId === null && period.period_set_id !== null) {
                result.errors.push({
                    periodId: parsedPeriodId,
                    error: 'This subclass has no bell schedule assigned; assign a period_set to the class first'
                });
                continue;
            }

            // ---- Clear assignment ----
            if ((subject_id === null || subject_id === undefined) && (teacher_id === null || teacher_id === undefined)) {
                const existing = await prisma.teacherPeriod.findMany({
                    where: { sub_class_id: subclassId, period_id: period.id, academic_year_id: academicYearId }
                });
                for (const a of existing) {
                    await prisma.teacherPeriod.delete({ where: { id: a.id } });
                    result.deleted++;
                }
                continue;
            }

            // subject_id is still required — a slot without a subject has nothing
            // to teach. Teacher is optional so a slot can be reserved for a
            // subject before its teacher is decided.
            if (subject_id === undefined || subject_id === null) {
                result.errors.push({ periodId: parsedPeriodId, error: 'subject_id is required (pass both null to clear the slot)' });
                continue;
            }

            const parsedSubjectId = parseInt(subject_id as any);
            if (isNaN(parsedSubjectId)) {
                result.errors.push({ periodId: parsedPeriodId, error: 'Invalid subject_id format' });
                continue;
            }

            let parsedTeacherId: number | null = null;
            if (teacher_id !== null && teacher_id !== undefined) {
                parsedTeacherId = parseInt(teacher_id as any);
                if (isNaN(parsedTeacherId)) {
                    result.errors.push({ periodId: parsedPeriodId, error: 'Invalid teacher_id format' });
                    continue;
                }
            }

            // Only BREAK slots are unbookable. Every other slot (including
            // former PREP times, now reclassified as TEACHING) can hold a
            // teaching assignment — practicals often live in those windows.
            const periodType = (period as any).type ?? (period.is_break ? 'BREAK' : 'TEACHING');
            if (periodType === 'BREAK') {
                result.errors.push({
                    periodId: parsedPeriodId,
                    error: 'Cannot assign teachers to a BREAK period'
                });
                continue;
            }

            if (parsedTeacherId !== null) {
                const canTeachSubject = await prisma.subjectTeacher.findFirst({
                    where: { subject_id: parsedSubjectId, teacher_id: parsedTeacherId }
                });
                if (!canTeachSubject) {
                    result.errors.push({
                        periodId: parsedPeriodId,
                        error: `Teacher ${parsedTeacherId} is not authorized to teach subject ${parsedSubjectId}`
                    });
                    continue;
                }

                // ---- Time-overlap clash detection ----
                // Look at every TeacherPeriod the teacher already has this day in
                // this academic year (any subclass, any period set), and flag any
                // whose [start,end) intersects the incoming slot.
                const teacherSameDay = await prisma.teacherPeriod.findMany({
                    where: {
                        teacher_id: parsedTeacherId,
                        academic_year_id: academicYearId,
                        period: { day_of_week: period.day_of_week },
                        NOT: {
                            AND: [
                                { sub_class_id: subclassId },
                                { period_id: period.id }
                            ]
                        }
                    },
                    include: { period: { include: { period_set: true } }, sub_class: true }
                });

                const clash = teacherSameDay.find(tp =>
                    intervalsOverlap(period.start_time, period.end_time, tp.period.start_time, tp.period.end_time)
                );

                if (clash) {
                    result.warnings.push({
                        periodId: parsedPeriodId,
                        type: 'TEACHER_CLASH',
                        message: `Teacher is also booked in ${clash.sub_class.name} on ${clash.period.day_of_week} ${clash.period.start_time}–${clash.period.end_time} (${clash.period.name})`,
                        clashWith: {
                            subClassId: clash.sub_class.id,
                            subClassName: clash.sub_class.name,
                            day: clash.period.day_of_week,
                            periodName: clash.period.name,
                            periodStartTime: clash.period.start_time,
                            periodEndTime: clash.period.end_time,
                            periodSetCode: clash.period.period_set?.code ?? null
                        }
                    });
                    // Fall through — still persist so the caller keeps their edit.
                }
            }

            const existingAssignment = await prisma.teacherPeriod.findFirst({
                where: {
                    sub_class_id: subclassId,
                    period_id: period.id,
                    subject_id: parsedSubjectId,
                    academic_year_id: academicYearId
                }
            });

            if (existingAssignment) {
                await prisma.teacherPeriod.update({
                    where: { id: existingAssignment.id },
                    data: { teacher_id: parsedTeacherId, subject_id: parsedSubjectId, assigned_by_id: assignedById }
                });
                result.updated++;
            } else {
                await prisma.teacherPeriod.create({
                    data: {
                        teacher_id: parsedTeacherId,
                        subject_id: parsedSubjectId,
                        sub_class_id: subclassId,
                        period_id: period.id,
                        academic_year_id: academicYearId,
                        assigned_by_id: assignedById
                    }
                });
                result.created++;
            }
        } catch (error: any) {
            console.error(`Error processing slot for period ${parsedPeriodId}:`, error);
            result.errors.push({ periodId: parsedPeriodId, error: error.message });
        }
    }
    return result;
}

// ---------- Excel export ----------

const DAY_ORDER: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

export async function exportSubclassTimetableExcel(subclassId: number, academicYearId?: number): Promise<{ buffer: Buffer; filename: string }> {
    const data = await getSubclassTimetable(subclassId, academicYearId);
    const workbook = XLSX.utils.book_new();

    // Use the class's own period set for rows so BREAK/PREP show up even when
    // no assignments exist.
    const periods = [...data.periods].sort((a, b) => (a.sequence - b.sequence) || a.startTime.localeCompare(b.startTime));
    const uniquePeriodsByTime = new Map<string, PeriodDefinition>();
    for (const p of periods) {
        const key = `${p.startTime}-${p.endTime}-${p.sequence}`;
        if (!uniquePeriodsByTime.has(key)) uniquePeriodsByTime.set(key, p);
    }
    const uniquePeriods = Array.from(uniquePeriodsByTime.values());

    const slotMap = new Map<string, TimetableSlotOutput[]>();
    for (const slot of data.slots) {
        const key = `${slot.day}_${slot.periodId}`;
        if (!slotMap.has(key)) slotMap.set(key, []);
        slotMap.get(key)!.push(slot);
    }

    const days = DAY_ORDER;
    const header = ['Period', 'Time', ...days.map(d => d.charAt(0) + d.slice(1).toLowerCase())];
    const rows: string[][] = [header];

    for (const period of uniquePeriods) {
        const row: string[] = [period.name, `${period.startTime} - ${period.endTime}`];
        for (const day of days) {
            // Find the period for THIS day matching same time
            const dayPeriod = periods.find(p => p.dayOfWeek === day && p.startTime === period.startTime && p.endTime === period.endTime);
            if (!dayPeriod) { row.push('-'); continue; }

            if (dayPeriod.type === 'BREAK') { row.push('BREAK'); continue; }

            const cellSlots = slotMap.get(`${day}_${dayPeriod.id}`) || [];
            const cellLines = cellSlots.map(s => (s.teacherName ? `${s.subjectName ?? ''} (${s.teacherName})` : (s.subjectName ?? '')));
            row.push(cellLines.join(' / ') || '-');
        }
        rows.push(row);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = header.map((_, i) => ({ wch: i < 2 ? 18 : 30 }));
    XLSX.utils.book_append_sheet(workbook, worksheet, data.sub_class.name.substring(0, 31));

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const filename = `timetable_${data.sub_class.name.replace(/\s+/g, '_')}.xlsx`;
    return { buffer, filename };
}

export async function exportFullTimetableExcel(academicYearId?: number): Promise<{ buffer: Buffer; filename: string }> {
    const data = await getFullSchoolTimetable(academicYearId);
    const workbook = XLSX.utils.book_new();

    for (const block of data.subclasses) {
        const periods = [...block.periods].sort((a, b) => (a.sequence - b.sequence) || a.startTime.localeCompare(b.startTime));
        const slotMap = new Map<string, TimetableSlotOutput[]>();
        for (const slot of block.slots) {
            const key = `${slot.day}_${slot.periodId}`;
            if (!slotMap.has(key)) slotMap.set(key, []);
            slotMap.get(key)!.push(slot);
        }

        const uniquePeriodsByTime = new Map<string, PeriodDefinition>();
        for (const p of periods) {
            const key = `${p.startTime}-${p.endTime}-${p.sequence}`;
            if (!uniquePeriodsByTime.has(key)) uniquePeriodsByTime.set(key, p);
        }
        const uniquePeriods = Array.from(uniquePeriodsByTime.values());

        const days = DAY_ORDER;
        const header = ['Period', 'Time', ...days.map(d => d.charAt(0) + d.slice(1).toLowerCase())];
        const rows: string[][] = [header];

        for (const period of uniquePeriods) {
            const row: string[] = [period.name, `${period.startTime} - ${period.endTime}`];
            for (const day of days) {
                const dayPeriod = periods.find(p => p.dayOfWeek === day && p.startTime === period.startTime && p.endTime === period.endTime);
                if (!dayPeriod) { row.push('-'); continue; }
                if (dayPeriod.type === 'BREAK') { row.push('BREAK'); continue; }

                const cellSlots = slotMap.get(`${day}_${dayPeriod.id}`) || [];
                const cellLines = cellSlots.map(s => (s.teacherName ? `${s.subjectName ?? ''} (${s.teacherName})` : (s.subjectName ?? '')));
                row.push(cellLines.join(' / ') || '-');
            }
            rows.push(row);
        }

        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        worksheet['!cols'] = header.map((_, i) => ({ wch: i < 2 ? 18 : 30 }));
        const sheetName = `${block.subClass.className} - ${block.subClass.name}`.substring(0, 31);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    }

    // If the school has no subclasses at all, drop a placeholder sheet so the
    // xlsx writer doesn't crash on an empty workbook.
    if (data.subclasses.length === 0) {
        const ws = XLSX.utils.aoa_to_sheet([['No subclasses configured']]);
        XLSX.utils.book_append_sheet(workbook, ws, 'Empty');
    }

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const filename = `timetable_full_school_${data.academicYearName.replace(/\s+/g, '_')}.xlsx`;
    return { buffer, filename };
}

// ---------- PDF export ----------

const DAY_LABEL: Record<string, string> = {
    MONDAY: 'Monday',
    TUESDAY: 'Tuesday',
    WEDNESDAY: 'Wednesday',
    THURSDAY: 'Thursday',
    FRIDAY: 'Friday',
    SATURDAY: 'Saturday',
    SUNDAY: 'Sunday',
};

interface PdfCellEntry { primary: string; secondary?: string; }
interface PdfCell { type: 'TEACHING' | 'BREAK' | 'PREP' | 'EMPTY'; entries: PdfCellEntry[]; }
interface PdfRow { periodName: string; timeLabel: string; cells: PdfCell[]; }
interface PdfPage {
    title: string;
    subtitle?: string;
    details?: Array<{ label: string; value: string }>;
    chips?: string[];
    days: Array<{ key: DayOfWeek; label: string }>;
    rows: PdfRow[];
    footerLeft?: string;
    footerRight?: string;
}

const templateCache: { html?: string } = {};
function loadTimetableTemplate(): string {
    if (!templateCache.html) {
        const templatePath = path.join(process.cwd(), 'src/view/timetable-template.ejs');
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

async function renderPdf(pages: PdfPage[], academicYearName: string): Promise<Buffer> {
    const template = loadTimetableTemplate();
    const html = ejs.render(template, {
        pages,
        brand: 'School Management System',
        academicYearName,
        generatedAt: new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
        documentTitle: pages[0]?.title || 'Timetable',
        schoolLogo: loadSchoolLogoDataUri(),
        schoolName: "ST STEPHEN'S INTERNATIONAL COLLEGE",
        schoolTagline: 'Excellence for Higher Heights',
        schoolAddress: 'Yaounde Essono city Damas',
        schoolPhone: '(+237) 680 188 080 / 681 630 435',
    });

    const page = await PuppeteerManager.newPage();
    try {
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
            preferCSSPageSize: true,
        });
        return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    } finally {
        try { await page.close(); } catch { /* noop */ }
    }
}

/**
 * Build a PDF page for one subclass — rows are the class's own period set (so
 * BREAK/PREP rows show up), cells contain "Subject (Teacher)".
 */
function buildSubclassPage(data: SubclassTimetableResult): PdfPage {
    const periods = [...data.periods].sort(
        (a, b) => (a.sequence - b.sequence) || a.startTime.localeCompare(b.startTime),
    );

    const uniquePeriodsByTime = new Map<string, PeriodDefinition>();
    for (const p of periods) {
        const key = `${p.startTime}-${p.endTime}-${p.sequence}`;
        if (!uniquePeriodsByTime.has(key)) uniquePeriodsByTime.set(key, p);
    }
    const uniquePeriods = Array.from(uniquePeriodsByTime.values());

    const slotMap = new Map<string, TimetableSlotOutput[]>();
    for (const slot of data.slots) {
        const key = `${slot.day}_${slot.periodId}`;
        if (!slotMap.has(key)) slotMap.set(key, []);
        slotMap.get(key)!.push(slot);
    }

    const days = DAY_ORDER.map(d => ({ key: d, label: DAY_LABEL[d] || d }));

    const rows: PdfRow[] = uniquePeriods.map(period => {
        const cells: PdfCell[] = days.map(({ key: day }) => {
            const dayPeriod = periods.find(
                p => p.dayOfWeek === day && p.startTime === period.startTime && p.endTime === period.endTime,
            );
            if (!dayPeriod) return { type: 'EMPTY', entries: [] };
            if (dayPeriod.type === 'BREAK') return { type: 'BREAK', entries: [] };

            const cellSlots = slotMap.get(`${day}_${dayPeriod.id}`) || [];
            const entries: PdfCellEntry[] = cellSlots.map(s => ({
                primary: s.subjectName ?? '—',
                secondary: s.teacherName ?? undefined,
            }));
            return { type: 'TEACHING', entries };
        });

        return {
            periodName: period.name,
            timeLabel: `${period.startTime.slice(0, 5)} – ${period.endTime.slice(0, 5)}`,
            cells,
        };
    });

    return {
        title: `${data.sub_class.class.name} — ${data.sub_class.name}`,
        subtitle: 'Class Timetable',
        chips: [
            `Class: ${data.sub_class.class.name}`,
            `Sub-class: ${data.sub_class.name}`,
        ],
        days,
        rows,
        footerLeft: 'Class Timetable',
        footerRight: '',
    };
}

export async function exportSubclassTimetablePdf(
    subclassId: number,
    academicYearId?: number,
): Promise<{ buffer: Buffer; filename: string }> {
    const data = await getSubclassTimetable(subclassId, academicYearId);
    const year = await (academicYearId
        ? prisma.academicYear.findUnique({ where: { id: academicYearId } })
        : getCurrentAcademicYear());

    const buffer = await renderPdf([buildSubclassPage(data)], year?.name || 'Unknown');
    const filename = `timetable_${data.sub_class.name.replace(/\s+/g, '_')}.pdf`;
    return { buffer, filename };
}

export async function exportFullTimetablePdf(
    academicYearId?: number,
): Promise<{ buffer: Buffer; filename: string }> {
    const data = await getFullSchoolTimetable(academicYearId);

    const pages: PdfPage[] = data.subclasses.map(block => {
        // Reshape FullSchoolSubclassBlock into a SubclassTimetableResult-compatible object
        // so we can reuse buildSubclassPage.
        const shaped: SubclassTimetableResult = {
            sub_class: {
                id: block.subClass.id,
                name: block.subClass.name,
                class: { id: block.subClass.classId, name: block.subClass.className, periodSetId: block.periodSet?.id ?? null },
            },
            academicYearId: data.academicYearId,
            periodSet: block.periodSet,
            periods: block.periods,
            slots: block.slots,
        };
        return buildSubclassPage(shaped);
    });

    if (pages.length === 0) {
        pages.push({
            title: 'No sub-classes configured',
            days: DAY_ORDER.map(d => ({ key: d, label: DAY_LABEL[d] || d })),
            rows: [],
        });
    }

    const buffer = await renderPdf(pages, data.academicYearName);
    const filename = `timetable_full_school_${data.academicYearName.replace(/\s+/g, '_')}.pdf`;
    return { buffer, filename };
}

/**
 * Build a PDF page for a teacher — rows are unique (start_time, end_time) tuples
 * across the teacher's assignments (teachers can span multiple period sets),
 * cells contain "Subject (Class / Sub-class)".
 */
export async function exportTeacherTimetablePdf(
    teacherId: number,
    academicYearId?: number,
): Promise<{ buffer: Buffer; filename: string }> {
    const year = academicYearId
        ? await prisma.academicYear.findUnique({ where: { id: academicYearId } })
        : await getCurrentAcademicYear();
    if (!year) throw new Error('No active academic year found.');

    const [teacher, teacherPeriods] = await Promise.all([
        prisma.user.findUnique({ where: { id: teacherId }, select: { id: true, name: true, matricule: true } }),
        prisma.teacherPeriod.findMany({
            where: { teacher_id: teacherId, academic_year_id: year.id },
            include: {
                period: true,
                subject: true,
                sub_class: { include: { class: true } },
            },
        }),
    ]);

    if (!teacher) throw new Error(`Teacher ${teacherId} not found.`);

    // Teacher timetable: teaching slots only — BREAK periods are intentionally
    // excluded (per school preference; the teacher's schedule shouldn't be
    // padded with recess rows).
    const timeKey = (p: { start_time: string; end_time: string }) => `${p.start_time}-${p.end_time}`;
    const timeSlots = new Map<string, { startTime: string; endTime: string; label: string }>();
    for (const tp of teacherPeriods) {
        const k = timeKey(tp.period);
        if (!timeSlots.has(k)) {
            timeSlots.set(k, {
                startTime: tp.period.start_time,
                endTime: tp.period.end_time,
                label: `${tp.period.start_time.slice(0, 5)} – ${tp.period.end_time.slice(0, 5)}`,
            });
        }
    }

    const orderedSlots = Array.from(timeSlots.values()).sort(
        (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime),
    );

    // Only include days the teacher actually teaches on.
    const teachingDays = new Set<DayOfWeek>(teacherPeriods.map(tp => tp.period.day_of_week));
    const days = DAY_ORDER
        .filter(d => teachingDays.has(d))
        .map(d => ({ key: d, label: DAY_LABEL[d] || d }));

    // Bucket the teacher's assignments by (day, startTime, endTime)
    const bucket = new Map<string, typeof teacherPeriods>();
    for (const tp of teacherPeriods) {
        const key = `${tp.period.day_of_week}|${timeKey(tp.period)}`;
        if (!bucket.has(key)) bucket.set(key, []);
        bucket.get(key)!.push(tp);
    }

    const rows: PdfRow[] = orderedSlots.map(slot => {
        const cells: PdfCell[] = days.map(({ key: day }) => {
            const cellKey = `${day}|${slot.startTime}-${slot.endTime}`;
            const entries = (bucket.get(cellKey) || []).map(tp => ({
                primary: tp.subject?.name ?? 'Subject',
                secondary: `${tp.sub_class.class.name} / ${tp.sub_class.name}`,
            }));
            if (entries.length) return { type: 'TEACHING', entries };
            return { type: 'EMPTY', entries: [] };
        });
        return { periodName: '', timeLabel: slot.label, cells };
    });

    // Department (derived from subject categories) and subject list.
    const CATEGORY_LABEL: Record<string, string> = {
        SCIENCE_AND_TECHNOLOGY: 'Science & Technology',
        LANGUAGES_AND_LITERATURE: 'Languages & Literature',
        HUMAN_AND_SOCIAL_SCIENCE: 'Human & Social Sciences',
        OTHERS: 'Others',
    };
    const departments = Array.from(new Set(
        teacherPeriods.map(tp => tp.subject?.category as string | undefined).filter((c): c is string => !!c),
    )).map(c => CATEGORY_LABEL[c] || c);
    const subjectNames = Array.from(new Set(
        teacherPeriods.map(tp => tp.subject?.name).filter((n): n is string => !!n),
    )).sort();

    // Summary chips
    const uniqueClasses = new Set(teacherPeriods.map(tp => tp.sub_class_id)).size;
    const uniqueSubjects = subjectNames.length;
    const weeklyHours = teacherPeriods.reduce((acc, tp) => {
        return acc + (toMinutes(tp.period.end_time) - toMinutes(tp.period.start_time)) / 60;
    }, 0);

    const details: Array<{ label: string; value: string }> = [];
    if (departments.length) {
        details.push({ label: departments.length > 1 ? 'Departments' : 'Department', value: departments.join(', ') });
    }
    if (subjectNames.length) {
        details.push({ label: subjectNames.length > 1 ? 'Subjects' : 'Subject', value: subjectNames.join(', ') });
    }

    const page: PdfPage = {
        title: teacher.name,
        subtitle: 'Teacher Timetable',
        details,
        chips: [
            `Matricule: ${teacher.matricule || '—'}`,
            `Classes: ${uniqueClasses}`,
            `Subjects: ${uniqueSubjects}`,
            `Weekly Hours: ${weeklyHours.toFixed(1)}`,
        ],
        days,
        rows,
        footerLeft: 'Teacher Timetable',
        footerRight: '',
    };

    const buffer = await renderPdf([page], year.name);
    const safeName = teacher.name.replace(/\s+/g, '_').replace(/[^\w\-]/g, '');
    const filename = `timetable_teacher_${safeName || teacher.id}.pdf`;
    return { buffer, filename };
}
