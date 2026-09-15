import prisma from '../../../config/db';
import { getAcademicYearId, getCurrentAcademicYear } from '../../../utils/academicYear';
import { paginate, PaginationOptions, FilterOptions, PaginatedResult } from '../../../utils/pagination';

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
        coefficient: number;
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
        coefficient: number;
        periodsPerWeek: number;
    }[];
    studentCount: number;
}

export interface TeacherDashboard {
    assignedSubjects: number;
    totalStudents: number;
    totalClasses: number;
    weeklyPeriods: number;
    weeklyHours: number;
    marksToEnter?: number;
    upcomingPeriods?: number;
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
                        where: { academic_year_id: currentYear }
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
                        where: { academic_year_id: currentYear }
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
            periodsPerWeek: 1, // Default since we don't have period data in fallback
            studentCount: scs.sub_class.enrollments.length
        });

        subject.totalStudents += scs.sub_class.enrollments.length;
        subject.totalPeriods += 1; // Default periods for fallback
    });

    return Array.from(subjectMap.values());
}

/**
 * Get students that a teacher teaches (across all subjects/subclasses)
 */
export async function getTeacherStudents(
    teacherId: number,
    filters: {
        subClassId?: number;
        subjectId?: number;
        academicYearId?: number;
    } = {},
    paginationOptions?: PaginationOptions
): Promise<PaginatedResult<TeacherStudent>> {
    const currentYear = filters.academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) {
        return {
            data: [],
            meta: { total: 0, page: paginationOptions?.page || 1, limit: paginationOptions?.limit || 10, totalPages: 0 }
        };
    }

    // Get teacher periods for this teacher
    const whereClause: any = {
        teacher_id: teacherId,
        academic_year_id: currentYear
    };

    if (filters.subClassId) whereClause.sub_class_id = filters.subClassId;
    if (filters.subjectId) whereClause.subject_id = filters.subjectId;

    const teacherPeriods = await prisma.teacherPeriod.findMany({
        where: whereClause,
        include: {
            subject: true,
            sub_class: {
                include: {
                    class: true,
                    enrollments: {
                        where: { academic_year_id: currentYear },
                        include: {
                            student: true
                        }
                    }
                }
            }
        }
    });

    // Collect unique students
    const studentMap = new Map<number, TeacherStudent>();

    teacherPeriods.forEach(period => {
        period.sub_class.enrollments.forEach(enrollment => {
            const studentId = enrollment.student.id;

            if (!studentMap.has(studentId)) {
                studentMap.set(studentId, {
                    id: enrollment.student.id,
                    name: enrollment.student.name,
                    matricule: enrollment.student.matricule,
                    subClass: {
                        id: period.sub_class.id,
                        name: period.sub_class.name,
                        class: {
                            id: period.sub_class.class.id,
                            name: period.sub_class.class.name
                        }
                    },
                    teacherSubjects: []
                });
            }

            const student = studentMap.get(studentId)!;

            // Add subject if not already added
            if (!student.teacherSubjects.find(ts => ts.subjectId === period.subject.id)) {
                student.teacherSubjects.push({
                    subjectId: period.subject.id,
                    subjectName: period.subject.name,
                    coefficient: 1 // Default - should fetch from SubClassSubject if needed
                });
            }
        });
    });

    const students = Array.from(studentMap.values());

    // Apply pagination manually since we're working with a complex aggregation
    const startIndex = ((paginationOptions?.page || 1) - 1) * (paginationOptions?.limit || 10);
    const endIndex = startIndex + (paginationOptions?.limit || 10);
    const paginatedStudents = students.slice(startIndex, endIndex);

    return {
        data: paginatedStudents,
        meta: {
            total: students.length,
            page: paginationOptions?.page || 1,
            limit: paginationOptions?.limit || 10,
            totalPages: Math.ceil(students.length / (paginationOptions?.limit || 10))
        }
    };
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
        include: {
            subject: true,
            sub_class: {
                include: {
                    class: true,
                    enrollments: {
                        where: { academic_year_id: currentYear }
                    }
                }
            }
        }
    });

    // Group by subclass
    const subClassMap = new Map<number, TeacherSubClass>();

    teacherPeriods.forEach(period => {
        const subClassId = period.sub_class.id;

        if (!subClassMap.has(subClassId)) {
            subClassMap.set(subClassId, {
                id: period.sub_class.id,
                name: period.sub_class.name,
                class: {
                    id: period.sub_class.class.id,
                    name: period.sub_class.class.name
                },
                subjects: [],
                studentCount: period.sub_class.enrollments.length
            });
        }

        const subClass = subClassMap.get(subClassId)!;

        // Add subject if not already added
        if (!subClass.subjects.find(s => s.id === period.subject.id)) {
            subClass.subjects.push({
                id: period.subject.id,
                name: period.subject.name,
                coefficient: 1, // Default coefficient - should be fetched from SubClassSubject if needed
                periodsPerWeek: 1 // Count periods per week dynamically if needed
            });
        }
    });

    return Array.from(subClassMap.values());
}

/**
 * Get teacher dashboard statistics
 */
export async function getTeacherDashboard(
    teacherId: number,
    academicYearId?: number
): Promise<TeacherDashboard> {
    const currentYear = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) {
        return {
            assignedSubjects: 0,
            totalStudents: 0,
            totalClasses: 0,
            weeklyPeriods: 0,
            weeklyHours: 0
        };
    }

    // Get basic stats from teacher periods
    const [
        subjectCount,
        subClassCount,
        weeklyPeriods,
        periodDurations,
        studentCountResult
    ] = await Promise.all([
        // Count unique subjects
        prisma.teacherPeriod.groupBy({
            by: ['subject_id'],
            where: {
                teacher_id: teacherId,
                academic_year_id: currentYear
            }
        }).then(result => result.length),

        // Count unique subclasses
        prisma.teacherPeriod.groupBy({
            by: ['sub_class_id'],
            where: {
                teacher_id: teacherId,
                academic_year_id: currentYear
            }
        }).then(result => result.length),

        // Sum weekly periods
        prisma.teacherPeriod.count({
            where: {
                teacher_id: teacherId,
                academic_year_id: currentYear
            }
        }),

        // Fetch each teacher-period's slot start/end so we can total the hours
        prisma.teacherPeriod.findMany({
            where: {
                teacher_id: teacherId,
                academic_year_id: currentYear
            },
            select: {
                period: { select: { start_time: true, end_time: true } }
            }
        }),

        // Get unique students across all subclasses
        prisma.teacherPeriod.findMany({
            where: {
                teacher_id: teacherId,
                academic_year_id: currentYear
            },
            include: {
                sub_class: {
                    include: {
                        enrollments: {
                            where: { academic_year_id: currentYear }
                        }
                    }
                }
            }
        }).then(periods => {
            const uniqueStudents = new Set<number>();
            periods.forEach(period => {
                period.sub_class.enrollments.forEach(enrollment => {
                    uniqueStudents.add(enrollment.student_id);
                });
            });
            return uniqueStudents.size;
        })
    ]);

    const weeklyHours = periodDurations.reduce((acc, tp) => {
        const start = new Date(`1970-01-01T${tp.period.start_time}Z`);
        const end = new Date(`1970-01-01T${tp.period.end_time}Z`);
        const duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        return acc + (Number.isFinite(duration) && duration > 0 ? duration : 0);
    }, 0);

    return {
        assignedSubjects: subjectCount,
        totalStudents: studentCountResult,
        totalClasses: subClassCount,
        weeklyPeriods: weeklyPeriods,
        weeklyHours: Math.round(weeklyHours * 10) / 10,
        marksToEnter: 10, // Placeholder
        upcomingPeriods: 5 // Placeholder
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
            academic_year_id: currentYear
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

    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-GB', { hour12: false }); // HH:MM:SS format
    const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const currentDay = dayNames[now.getDay()];

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
    const year = await getCurrentAcademicYear();
    const yearId = year?.id;

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

    if (!teacherPeriods) {
        return {
            summary: {
                totalClasses: 0,
                totalSubjects: 0,
                weeklyHours: 0,
                todayClasses: 0,
            },
            schedule: [],
        };
    }

    const totalClasses = new Set(teacherPeriods.map(tp => tp.sub_class_id)).size;
    const totalSubjects = new Set(teacherPeriods.map(tp => tp.subject_id)).size;

    const weeklyHours = teacherPeriods.reduce((acc, tp) => {
        const start = new Date(`1970-01-01T${tp.period.start_time}Z`);
        const end = new Date(`1970-01-01T${tp.period.end_time}Z`);
        const duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        return acc + duration;
    }, 0);

    const today = new Date().toLocaleString('en-US', { weekday: 'long' }).toUpperCase();
    const todayClasses = teacherPeriods.filter(tp => tp.period.day_of_week === today).length;

    return {
        summary: {
            totalClasses,
            totalSubjects,
            weeklyHours,
            todayClasses,
        },
        schedule: teacherPeriods.map(tp => ({ ...tp, teacher_period_id: tp.id })),
    };
}
