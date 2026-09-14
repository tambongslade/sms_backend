// src/api/v1/services/dmRollCallService.ts
//
// Discipline Master roll call at 3 fixed daily slots (SLOT_2, SLOT_5, SLOT_8).
// The slot is a fixed conceptual marker independent of the Period model — DMs
// walk classrooms after the 2nd, 5th, and 8th period bells regardless of what
// subject is being taught at that time.

import prisma, {
    DMRollCall,
    DMRollCallEntry,
    RollCallSlot,
    DMRollCallStatus,
    Prisma,
} from '../../../config/db';
import { getAcademicYearId } from '../../../utils/academicYear';
import { evaluateAbsenceTriggers } from './disciplineService';

/**
 * Normalize any date input to a UTC midnight Date object so the unique
 * (sub_class_id, date, slot) constraint isn't defeated by clock drift.
 */
function normalizeDate(input: Date | string): Date {
    const d = typeof input === 'string' ? new Date(input) : new Date(input.getTime());
    if (Number.isNaN(d.getTime())) {
        throw new Error('Invalid date');
    }
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

/**
 * Fetch a single DM roll call for (subClass, date, slot) along with the full
 * enrolled roster of the sub-class for the given academic year. Enrollments
 * without an entry appear as `status: null` so the caller can render a checklist.
 */
export async function getDMRollCall(
    subClassId: number,
    date: Date | string,
    slot: RollCallSlot,
    academicYearId?: number
) {
    const yearId = academicYearId ?? (await getAcademicYearId());
    if (!yearId) {
        throw new Error('No current academic year is set');
    }
    const dateOnly = normalizeDate(date);

    const rollCall = await prisma.dMRollCall.findUnique({
        where: {
            sub_class_id_date_slot: {
                sub_class_id: subClassId,
                date: dateOnly,
                slot,
            },
        },
        include: {
            entries: {
                include: {
                    enrollment: {
                        include: {
                            student: {
                                select: {
                                    id: true,
                                    matricule: true,
                                    name: true,
                                    nom: true,
                                    prenom: true,
                                },
                            },
                        },
                    },
                },
            },
            sub_class: { include: { class: true } },
            recorded_by: { select: { id: true, name: true } },
        },
    });

    const enrollments = await prisma.enrollment.findMany({
        where: {
            sub_class_id: subClassId,
            academic_year_id: yearId,
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
    });

    const statusByEnrollment = new Map<number, DMRollCallStatus>();
    const entriesByEnrollment = new Map<number, DMRollCallEntry>();
    if (rollCall) {
        for (const e of rollCall.entries) {
            statusByEnrollment.set(e.enrollment_id, e.status);
            entriesByEnrollment.set(e.enrollment_id, e);
        }
    }

    const roster = enrollments.map((enr) => ({
        enrollment_id: enr.id,
        student: enr.student,
        status: statusByEnrollment.get(enr.id) ?? null,
        entry: entriesByEnrollment.get(enr.id) ?? null,
    }));

    return {
        sub_class_id: subClassId,
        academic_year_id: yearId,
        date: dateOnly,
        slot,
        roll_call: rollCall
            ? {
                  id: rollCall.id,
                  recorded_by: rollCall.recorded_by,
                  created_at: rollCall.created_at,
                  updated_at: rollCall.updated_at,
              }
            : null,
        roster,
    };
}

/**
 * Return an at-a-glance map of which of the 3 daily slots have been recorded
 * for a given sub-class on a given date.
 */
export async function getDMRollCallStatus(
    subClassId: number,
    date: Date | string,
    academicYearId?: number
) {
    const yearId = academicYearId ?? (await getAcademicYearId());
    if (!yearId) {
        throw new Error('No current academic year is set');
    }
    const dateOnly = normalizeDate(date);
    const rows = await prisma.dMRollCall.findMany({
        where: {
            sub_class_id: subClassId,
            academic_year_id: yearId,
            date: dateOnly,
        },
        include: {
            recorded_by: { select: { id: true, name: true } },
            _count: { select: { entries: true } },
        },
    });
    const byslot: Record<RollCallSlot, any> = {
        SLOT_2: null as any,
        SLOT_5: null as any,
        SLOT_8: null as any,
    };
    for (const r of rows) {
        byslot[r.slot] = {
            id: r.id,
            recorded_by: r.recorded_by,
            entry_count: (r as any)._count?.entries ?? 0,
            recorded_at: r.created_at,
        };
    }
    return {
        sub_class_id: subClassId,
        academic_year_id: yearId,
        date: dateOnly,
        slots: {
            SLOT_2: { status: byslot.SLOT_2 ? 'recorded' : 'missing', ...(byslot.SLOT_2 || {}) },
            SLOT_5: { status: byslot.SLOT_5 ? 'recorded' : 'missing', ...(byslot.SLOT_5 || {}) },
            SLOT_8: { status: byslot.SLOT_8 ? 'recorded' : 'missing', ...(byslot.SLOT_8 || {}) },
        },
    };
}

// Roles allowed to see every subclass in the roll-call picker, mirroring
// the bypass set in validateDMSubClassAccess so the FE list stays honest.
const DM_SCOPE_BYPASS_ROLES = new Set<string>([
    'SUPER_MANAGER',
    'MANAGER',
    'PRINCIPAL',
    'VICE_PRINCIPAL',
    'SENIOR_DISCIPLINE_MASTER',
    'DEAN_OF_DISCIPLINE',
]);

/**
 * Sub-classes the caller may record DM roll calls for. Bypass roles see the
 * whole school; a plain DM sees only what they're assigned to in the current
 * academic year. Mirrors validateDMSubClassAccess so the picker is honest.
 */
export async function listAccessibleSubClasses(userId: number, roles: string[], academicYearId?: number) {
    const yearId = academicYearId ?? (await getAcademicYearId());
    if (!yearId) {
        throw new Error('No current academic year is set');
    }

    const canSeeAll = roles.some((r) => DM_SCOPE_BYPASS_ROLES.has(r));
    if (canSeeAll) {
        return prisma.subClass.findMany({
            include: { class: { select: { id: true, name: true } } },
            orderBy: [{ class: { name: 'asc' } }, { name: 'asc' }],
        });
    }

    // Plain DM: pull sub-classes from their RoleAssignment rows for the year.
    const assignments = await prisma.roleAssignment.findMany({
        where: {
            user_id: userId,
            role_type: 'DISCIPLINE_MASTER',
            academic_year_id: yearId,
            sub_class_id: { not: null },
        },
        select: { sub_class_id: true },
    });
    const ids = Array.from(new Set(assignments.map((a) => a.sub_class_id!).filter(Boolean)));
    if (ids.length === 0) return [];
    return prisma.subClass.findMany({
        where: { id: { in: ids } },
        include: { class: { select: { id: true, name: true } } },
        orderBy: [{ class: { name: 'asc' } }, { name: 'asc' }],
    });
}

/**
 * Pick the current roll-call slot from wall-clock time in the school's
 * timezone (defaults to Africa/Douala, UTC+1 year-round, no DST):
 *   before 12:00  -> SLOT_2  (morning walk after 2nd period)
 *   12:00-14:59   -> SLOT_5  (after the lunch break, post-5th period)
 *   15:00 onwards -> SLOT_8  (final walk after 8th period)
 * Override with SCHOOL_TZ if the deployment ever moves.
 */
export function pickCurrentSlot(now: Date = new Date()): RollCallSlot {
    const timeZone = process.env.SCHOOL_TZ || 'Africa/Douala';
    const hour = Number(
        new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour: '2-digit',
            hour12: false,
        }).format(now)
    );
    if (hour < 12) return 'SLOT_2';
    if (hour < 15) return 'SLOT_5';
    return 'SLOT_8';
}

/**
 * Slot-specific timestamp used when creating auto-linked StudentAbsence rows so
 * that per-slot audit still shows a distinct time even though the underlying
 * StudentAbsence unique constraint collapses per-day (teacher_period_id=null).
 */
function slotTimestamp(dateOnly: Date, slot: RollCallSlot): Date {
    const d = new Date(dateOnly.getTime());
    const hoursBySlot: Record<RollCallSlot, number> = {
        SLOT_2: 10,
        SLOT_5: 13,
        SLOT_8: 16,
    };
    d.setUTCHours(hoursBySlot[slot], 0, 0, 0);
    return d;
}

/**
 * Record (or replace) the DM roll call for a slot. On ABSENT: create or reuse
 * a full-day StudentAbsence (teacher_period_id=null), linked via
 * DMRollCallEntry.linked_absence_id. On LATE at SLOT_2: create a
 * MORNING_LATENESS StudentAbsence. On LATE at SLOT_5/SLOT_8: create a
 * DisciplineIssue(MISCONDUCT, "Late return after break").
 *
 * Fires disciplineService.evaluateAbsenceTriggers for every affected enrollment
 * once the writes settle.
 */
export async function recordDMRollCall(input: {
    sub_class_id: number;
    date: Date | string;
    slot: RollCallSlot;
    entries: Array<{ enrollment_id: number; status: DMRollCallStatus }>;
    assigned_by_id: number;
    academic_year_id?: number;
}) {
    const yearId = input.academic_year_id ?? (await getAcademicYearId());
    if (!yearId) {
        throw new Error('No current academic year is set');
    }
    const dateOnly = normalizeDate(input.date);
    const slotTime = slotTimestamp(dateOnly, input.slot);

    // Validate all enrollments belong to this sub-class + year.
    const enrollmentIds = input.entries.map((e) => e.enrollment_id);
    const enrollments = await prisma.enrollment.findMany({
        where: {
            id: { in: enrollmentIds },
            sub_class_id: input.sub_class_id,
            academic_year_id: yearId,
        },
        select: { id: true },
    });
    const validIds = new Set(enrollments.map((e) => e.id));
    const invalid = enrollmentIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
        throw new Error(
            `Enrollments do not belong to sub-class ${input.sub_class_id} for the current year: ${invalid.join(',')}`
        );
    }

    // Upsert the DMRollCall row + replace entries.
    const affectedEnrollmentIds = new Set<number>();
    const rollCall = await prisma.$transaction(async (tx) => {
        const rc = await tx.dMRollCall.upsert({
            where: {
                sub_class_id_date_slot: {
                    sub_class_id: input.sub_class_id,
                    date: dateOnly,
                    slot: input.slot,
                },
            },
            create: {
                sub_class_id: input.sub_class_id,
                academic_year_id: yearId,
                date: dateOnly,
                slot: input.slot,
                recorded_by_id: input.assigned_by_id,
            },
            update: {
                recorded_by_id: input.assigned_by_id,
            },
        });

        // Replace prior entries.
        await tx.dMRollCallEntry.deleteMany({ where: { dm_roll_call_id: rc.id } });

        for (const entry of input.entries) {
            let linkedAbsenceId: number | null = null;

            if (entry.status === 'ABSENT') {
                // Try to create a full-day CLASS_ABSENCE; on P2002 reuse the existing row.
                try {
                    const absence = await tx.studentAbsence.create({
                        data: {
                            enrollment_id: entry.enrollment_id,
                            assigned_by_id: input.assigned_by_id,
                            teacher_period_id: null,
                            absence_type: 'CLASS_ABSENCE',
                            created_at: slotTime,
                        },
                    });
                    linkedAbsenceId = absence.id;
                } catch (err: any) {
                    if (err.code === 'P2002') {
                        const existing = await tx.studentAbsence.findFirst({
                            where: {
                                enrollment_id: entry.enrollment_id,
                                teacher_period_id: null,
                                created_at: {
                                    gte: dateOnly,
                                    lt: new Date(dateOnly.getTime() + 24 * 60 * 60 * 1000),
                                },
                            },
                            orderBy: { created_at: 'asc' },
                        });
                        linkedAbsenceId = existing?.id ?? null;
                    } else {
                        throw err;
                    }
                }
                affectedEnrollmentIds.add(entry.enrollment_id);
            } else if (entry.status === 'LATE') {
                if (input.slot === 'SLOT_2') {
                    try {
                        const absence = await tx.studentAbsence.create({
                            data: {
                                enrollment_id: entry.enrollment_id,
                                assigned_by_id: input.assigned_by_id,
                                teacher_period_id: null,
                                absence_type: 'MORNING_LATENESS',
                                created_at: slotTime,
                            },
                        });
                        linkedAbsenceId = absence.id;
                    } catch (err: any) {
                        if (err.code === 'P2002') {
                            const existing = await tx.studentAbsence.findFirst({
                                where: {
                                    enrollment_id: entry.enrollment_id,
                                    teacher_period_id: null,
                                    created_at: {
                                        gte: dateOnly,
                                        lt: new Date(dateOnly.getTime() + 24 * 60 * 60 * 1000),
                                    },
                                },
                                orderBy: { created_at: 'asc' },
                            });
                            linkedAbsenceId = existing?.id ?? null;
                        } else {
                            throw err;
                        }
                    }
                } else {
                    // SLOT_5 / SLOT_8: returning late from break -> log misconduct.
                    await tx.disciplineIssue.create({
                        data: {
                            enrollment_id: entry.enrollment_id,
                            issue_type: 'MISCONDUCT',
                            description: `Late return after break (${input.slot})`,
                            assigned_by_id: input.assigned_by_id,
                            reviewed_by_id: input.assigned_by_id,
                        },
                    });
                }
            }

            await tx.dMRollCallEntry.create({
                data: {
                    dm_roll_call_id: rc.id,
                    enrollment_id: entry.enrollment_id,
                    status: entry.status,
                    linked_absence_id: linkedAbsenceId,
                },
            });
        }
        return rc;
    });

    // Fire triggers per affected enrollment (dedupe by set above; new CLASS_ABSENCE only).
    const triggerResults: Array<{ enrollment_id: number; warnings: any[]; summons: any[] }> = [];
    for (const enrollmentId of affectedEnrollmentIds) {
        const result = await evaluateAbsenceTriggers(enrollmentId, input.assigned_by_id);
        triggerResults.push({ enrollment_id: enrollmentId, ...result });
    }

    return {
        roll_call: rollCall,
        triggers: triggerResults,
    };
}
