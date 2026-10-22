// src/utils/schoolCounts.ts
//
// One definition of the headline counts shown on dashboards, so every page
// shows the same number. QA saw 1,005 / 1,006 / 1,012 / 1,013 students on
// different pages because each page counted differently: raw Enrollment rows
// (including WITHDRAWN students), Student rows by status (ignoring the year),
// enrolments with a sub-class only, etc.
//
// Definitions:
// - Active student  = a student with an Enrollment in the academic year whose
//                     Student.status is not WITHDRAWN (soft delete, commit
//                     72cd8dd) or TRANSFERRED (left the school). Students still
//                     awaiting their VP interview (sub_class_id null) count:
//                     they are enrolled in a class.
// - Stream          = a SubClass ("Form 1 A"). "Classes" on overviews means
//                     streams; Class rows are levels (Form 1, Form 2, ...).
// - Staff           = a user holding at least one non-PARENT role for the year
//                     (or a global role). Parent-only accounts are excluded.
// - Teacher         = a staff user holding the TEACHER role for the year (or
//                     globally), or anyone with a timetable slot that year.

import { Prisma, Role, StudentStatus } from '@prisma/client';
import prisma from '../config/db';

export const INACTIVE_STUDENT_STATUSES: StudentStatus[] = [
    StudentStatus.WITHDRAWN,
    StudentStatus.TRANSFERRED,
];

/** Enrollment filter for "active student enrolled in this year". */
export function activeEnrollmentWhere(academicYearId?: number | null): Prisma.EnrollmentWhereInput {
    return {
        ...(academicYearId ? { academic_year_id: academicYearId } : {}),
        student: { status: { notIn: INACTIVE_STUDENT_STATUSES } },
    };
}

/** Number of active students enrolled in the year (one per student). */
export async function countActiveStudents(academicYearId?: number | null): Promise<number> {
    // A student has at most one enrollment per year (unique student+year), so
    // counting enrollments == counting students when scoped to a year. Without
    // a year, count distinct students instead.
    if (academicYearId) {
        return prisma.enrollment.count({ where: activeEnrollmentWhere(academicYearId) });
    }
    return prisma.student.count({
        where: {
            status: { notIn: INACTIVE_STUDENT_STATUSES },
            enrollments: { some: {} },
        },
    });
}

/** Number of streams (SubClasses). */
export async function countStreams(): Promise<number> {
    return prisma.subClass.count();
}

function yearRoleScope(academicYearId?: number | null): Prisma.UserRoleWhereInput {
    return academicYearId
        ? { OR: [{ academic_year_id: academicYearId }, { academic_year_id: null }] }
        : {};
}

/** Prisma filter for staff users (any non-PARENT role in the year / global). */
export function staffUserWhere(academicYearId?: number | null): Prisma.UserWhereInput {
    return {
        user_roles: { some: { role: { not: Role.PARENT }, ...yearRoleScope(academicYearId) } },
    };
}

export async function countStaff(academicYearId?: number | null): Promise<number> {
    return prisma.user.count({ where: staffUserWhere(academicYearId) });
}

/** Prisma filter for teachers (TEACHER role in the year / global, or a timetable slot that year). */
export function teacherUserWhere(academicYearId?: number | null): Prisma.UserWhereInput {
    return {
        OR: [
            { user_roles: { some: { role: Role.TEACHER, ...yearRoleScope(academicYearId) } } },
            {
                teacher_periods: {
                    some: academicYearId ? { academic_year_id: academicYearId } : {},
                },
            },
        ],
    };
}

export async function countTeachers(academicYearId?: number | null): Promise<number> {
    return prisma.user.count({ where: teacherUserWhere(academicYearId) });
}
