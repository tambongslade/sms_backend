import prisma from '../../../config/db';
import { getCurrentAcademicYear } from '../../../utils/academicYear';
import { getTeacherWorkloads } from '../../../utils/teacherWorkload';
import { paginate, PaginationOptions, PaginatedResult } from '../../../utils/pagination';

// Types for HOD operations
export interface DepartmentOverview {
    subjectId: number;
    subjectName: string;
    subjectCategory: string;
    totalTeachers: number;
    totalStudents: number;
    totalClasses: number;
    averagePerformance: number;
    teachersAssigned: {
        id: number;
        name: string;
        email: string;
        matricule: string;
        classesTeaching: number;
        studentsTeaching: number;
        averageMarks: number;
    }[];
}

export interface TeacherInDepartment {
    id: number;
    name: string;
    email: string;
    matricule: string;
    phone: string;
    totalHoursPerWeek: number;
    subjectsTeaching: {
        id: number;
        name: string;
        classCount: number;
        studentCount: number;
        averageMarks: number;
    }[];
    classesTeaching: {
        id: number;
        name: string;
        className: string;
        studentCount: number;
        averageMarks: number;
    }[];
    performanceMetrics: {
        totalStudents: number;
        averageMarks: number;
        passRate: number;
        excellentRate: number;
    };
}

export interface SubjectPerformance {
    subjectId: number;
    subjectName: string;
    totalStudents: number;
    totalClasses: number;
    averageMarks: number;
    passRate: number;
    excellentRate: number;
    classBreakdown: {
        subClassId: number;
        subClassName: string;
        className: string;
        studentCount: number;
        averageMarks: number;
        teacherName: string;
        teacherId: number;
    }[];
    performanceTrends: {
        sequenceNumber: number;
        termName: string;
        averageMarks: number;
        passRate: number;
    }[];
}

export interface DepartmentAnalytics {
    subjectId: number;
    subjectName: string;
    totalTeachers: number;
    totalStudents: number;
    totalClasses: number;
    overallAverage: number;
    overallPassRate: number;
    topPerformingClass: {
        subClassName: string;
        averageMarks: number;
    } | null;
    lowestPerformingClass: {
        subClassName: string;
        averageMarks: number;
    } | null;
    teacherPerformanceRanking: {
        teacherId: number;
        teacherName: string;
        averageMarks: number;
        studentsCount: number;
        classesCount: number;
    }[];
    monthlyTrends: {
        month: string;
        averageMarks: number;
        studentsEvaluated: number;
    }[];
}

/**
 * Get the subjects that the user is HOD of
 */
export async function getHODSubjects(hodId: number): Promise<any[]> {
    const subjects = await prisma.subject.findMany({
        where: {
            hod_id: hodId
        },
        include: {
            sub_class_subjects: {
                include: {
                    sub_class: {
                        include: {
                            class: true,
                            enrollments: {
                                where: {
                                    academic_year_id: (await getCurrentAcademicYear())?.id || 0
                                }
                            }
                        }
                    }
                }
            },
            subject_teachers: {
                include: {
                    teacher: true
                }
            }
        }
    });

    return subjects;
}

/**
 * Get department overview for HOD
 */
export async function getDepartmentOverview(hodId: number, academicYearId?: number): Promise<DepartmentOverview[]> {
    const currentYear = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) return [];

    const subjects = await getHODSubjects(hodId);

    const overviews: DepartmentOverview[] = [];

    for (const subject of subjects) {
        // Get all teachers assigned to this subject
        const subjectTeachers = await prisma.subjectTeacher.findMany({
            where: {
                subject_id: subject.id
            },
            include: {
                teacher: true
            }
        });

        // Calculate metrics for each teacher
        const teachersAssigned = [];

        for (const st of subjectTeachers) {
            const teacher = st.teacher;

            // Get teacher periods for this subject in current academic year
            const teacherPeriods = await prisma.teacherPeriod.findMany({
                where: {
                    teacher_id: teacher.id,
                    subject_id: subject.id,
                    academic_year_id: currentYear
                },
                include: {
                    sub_class: {
                        include: {
                            enrollments: {
                                where: {
                                    academic_year_id: currentYear
                                }
                            }
                        }
                    }
                }
            });

            const classesTeaching = new Set(teacherPeriods.map(tp => tp.sub_class_id)).size;
            const studentsTeaching = teacherPeriods.reduce((total, tp) => total + tp.sub_class.enrollments.length, 0);

            // Calculate average marks for this teacher in this subject
            const marks = await prisma.mark.findMany({
                where: {
                    teacher_id: teacher.id,
                    sub_class_subject: {
                        subject_id: subject.id
                    },
                    exam_sequence: {
                        academic_year_id: currentYear
                    }
                }
            });

            const averageMarks = marks.length > 0
                ? marks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / marks.length
                : 0;

            teachersAssigned.push({
                id: teacher.id,
                name: teacher.name,
                email: teacher.email,
                matricule: teacher.matricule || '',
                classesTeaching,
                studentsTeaching,
                averageMarks: Math.round(averageMarks * 100) / 100
            });
        }

        // Calculate overall subject metrics
        const totalStudents = subject.sub_class_subjects.reduce((total, scs) =>
            total + scs.sub_class.enrollments.length, 0);

        const totalClasses = subject.sub_class_subjects.length;

        // Get all marks for this subject
        const subjectMarks = await prisma.mark.findMany({
            where: {
                sub_class_subject: {
                    subject_id: subject.id
                },
                exam_sequence: {
                    academic_year_id: currentYear
                }
            }
        });

        const averagePerformance = subjectMarks.length > 0
            ? subjectMarks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / subjectMarks.length
            : 0;

        overviews.push({
            subjectId: subject.id,
            subjectName: subject.name,
            subjectCategory: subject.category,
            totalTeachers: subjectTeachers.length,
            totalStudents,
            totalClasses,
            averagePerformance: Math.round(averagePerformance * 100) / 100,
            teachersAssigned
        });
    }

    return overviews;
}

/**
 * Get teachers in HOD's department with detailed information
 */
export async function getTeachersInDepartment(
    hodId: number,
    academicYearId?: number,
    options?: PaginationOptions & { search?: string }
): Promise<PaginatedResult<TeacherInDepartment>> {
    const currentYear = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) return { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } };

    const subjects = await getHODSubjects(hodId);
    const subjectIds = subjects.map(s => s.id);

    if (subjectIds.length === 0) {
        return { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } };
    }

    // Get all teachers in this department
    const whereClause: any = {
        subject_teachers: {
            some: {
                subject_id: { in: subjectIds }
            }
        }
    };

    if (options?.search) {
        whereClause.OR = [
            { name: { contains: options.search, mode: 'insensitive' } },
            { email: { contains: options.search, mode: 'insensitive' } },
            { matricule: { contains: options.search, mode: 'insensitive' } }
        ];
    }

    // Replace paginate with direct Prisma query
    const page = options?.page || 1;
    const limit = options?.limit || 10;
    const skip = (page - 1) * limit;

    const [teachers, total] = await Promise.all([
        prisma.user.findMany({
            where: whereClause,
            include: {
                subject_teachers: {
                    where: {
                        subject_id: { in: subjectIds }
                    },
                    include: {
                        subject: true
                    }
                }
            },
            skip,
            take: limit
        }),
        prisma.user.count({ where: whereClause })
    ]);

    const meta = {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
    };

    const teachersInDepartment: TeacherInDepartment[] = [];

    for (const teacher of teachers) {
        // Get subjects this teacher teaches in this department
        const subjectsTeaching = [];

        for (const st of teacher.subject_teachers) {
            const subject = st.subject;

            // Get classes for this subject
            const teacherPeriods = await prisma.teacherPeriod.findMany({
                where: {
                    teacher_id: teacher.id,
                    subject_id: subject.id,
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
            });

            const classCount = new Set(teacherPeriods.map(tp => tp.sub_class_id)).size;
            const studentCount = teacherPeriods.reduce((total, tp) => total + tp.sub_class.enrollments.length, 0);

            // Get average marks for this subject
            const marks = await prisma.mark.findMany({
                where: {
                    teacher_id: teacher.id,
                    sub_class_subject: {
                        subject_id: subject.id
                    },
                    exam_sequence: {
                        academic_year_id: currentYear
                    }
                }
            });

            const averageMarks = marks.length > 0
                ? marks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / marks.length
                : 0;

            subjectsTeaching.push({
                id: subject.id,
                name: subject.name,
                classCount,
                studentCount,
                averageMarks: Math.round(averageMarks * 100) / 100
            });
        }

        // Get classes teaching details
        const allTeacherPeriods = await prisma.teacherPeriod.findMany({
            where: {
                teacher_id: teacher.id,
                subject_id: { in: subjectIds },
                academic_year_id: currentYear
            },
            include: {
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
        const subClassMap = new Map();
        allTeacherPeriods.forEach(tp => {
            if (!subClassMap.has(tp.sub_class_id)) {
                subClassMap.set(tp.sub_class_id, tp.sub_class);
            }
        });

        const classesTeaching = [];
        for (const subClass of subClassMap.values()) {
            // Get average marks for this teacher in this class
            const classMarks = await prisma.mark.findMany({
                where: {
                    teacher_id: teacher.id,
                    enrollment: {
                        sub_class_id: subClass.id,
                        academic_year_id: currentYear
                    },
                    exam_sequence: {
                        academic_year_id: currentYear
                    }
                }
            });

            const averageMarks = classMarks.length > 0
                ? classMarks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / classMarks.length
                : 0;

            classesTeaching.push({
                id: subClass.id,
                name: subClass.name,
                className: subClass.class.name,
                studentCount: subClass.enrollments.length,
                averageMarks: Math.round(averageMarks * 100) / 100
            });
        }

        // Calculate overall performance metrics
        const allMarks = await prisma.mark.findMany({
            where: {
                teacher_id: teacher.id,
                sub_class_subject: {
                    subject_id: { in: subjectIds }
                },
                exam_sequence: {
                    academic_year_id: currentYear
                }
            }
        });

        const totalStudents = subjectsTeaching.reduce((total, subject) => total + subject.studentCount, 0);
        const overallAverage = allMarks.length > 0
            ? allMarks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / allMarks.length
            : 0;
        const passRate = allMarks.length > 0
            ? (allMarks.filter(mark => ((mark.score ?? 0) || 0) >= 10).length / allMarks.length) * 100
            : 0;
        const excellentRate = allMarks.length > 0
            ? (allMarks.filter(mark => ((mark.score ?? 0) || 0) >= 16).length / allMarks.length) * 100
            : 0;

        teachersInDepartment.push({
            id: teacher.id,
            name: teacher.name,
            email: teacher.email,
            matricule: teacher.matricule || '',
            phone: teacher.phone,
            // Derived from the timetable (User.total_hours_per_week is never populated).
            totalHoursPerWeek: (await getTeacherWorkloads([teacher.id], currentYear)).get(teacher.id)?.total_hours_per_week ?? 0,
            subjectsTeaching,
            classesTeaching,
            performanceMetrics: {
                totalStudents,
                averageMarks: Math.round(overallAverage * 100) / 100,
                passRate: Math.round(passRate * 100) / 100,
                excellentRate: Math.round(excellentRate * 100) / 100
            }
        });
    }

    return {
        data: teachersInDepartment,
        meta
    };
}

/**
 * Get subject performance analytics for HOD's subjects
 */
export async function getSubjectPerformance(
    hodId: number,
    subjectId?: number,
    academicYearId?: number
): Promise<SubjectPerformance[]> {
    const currentYear = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) return [];

    let subjects = await getHODSubjects(hodId);

    if (subjectId) {
        subjects = subjects.filter(s => s.id === subjectId);
    }

    const performances: SubjectPerformance[] = [];

    for (const subject of subjects) {
        // Get all subclasses teaching this subject
        const subClassSubjects = await prisma.subClassSubject.findMany({
            where: {
                subject_id: subject.id
            },
            include: {
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

        // Get marks for this subject
        const subjectMarks = await prisma.mark.findMany({
            where: {
                sub_class_subject: {
                    subject_id: subject.id
                },
                exam_sequence: {
                    academic_year_id: currentYear
                }
            },
            include: {
                sub_class_subject: {
                    include: {
                        sub_class: {
                            include: {
                                class: true
                            }
                        }
                    }
                },
                teacher: true,
                exam_sequence: {
                    include: {
                        term: true
                    }
                }
            }
        });

        const totalStudents = subClassSubjects.reduce((total, scs) =>
            total + scs.sub_class.enrollments.length, 0);

        const averageMarks = subjectMarks.length > 0
            ? subjectMarks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / subjectMarks.length
            : 0;

        const passRate = subjectMarks.length > 0
            ? (subjectMarks.filter(mark => ((mark.score ?? 0) || 0) >= 10).length / subjectMarks.length) * 100
            : 0;

        const excellentRate = subjectMarks.length > 0
            ? (subjectMarks.filter(mark => ((mark.score ?? 0) || 0) >= 16).length / subjectMarks.length) * 100
            : 0;

        // Class breakdown
        const classBreakdown = [];
        for (const scs of subClassSubjects) {
            const classMarks = subjectMarks.filter(mark =>
                mark.sub_class_subject.sub_class_id === scs.sub_class_id
            );

            const classAverage = classMarks.length > 0
                ? classMarks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / classMarks.length
                : 0;

            // Get primary teacher for this class-subject combination
            const teacherPeriod = await prisma.teacherPeriod.findFirst({
                where: {
                    subject_id: subject.id,
                    sub_class_id: scs.sub_class_id,
                    academic_year_id: currentYear
                },
                include: {
                    teacher: true
                }
            });

            classBreakdown.push({
                subClassId: scs.sub_class_id,
                subClassName: scs.sub_class.name,
                className: scs.sub_class.class.name,
                studentCount: scs.sub_class.enrollments.length,
                averageMarks: Math.round(classAverage * 100) / 100,
                teacherName: teacherPeriod?.teacher.name || 'Not Assigned',
                teacherId: teacherPeriod?.teacher.id || 0
            });
        }

        // Performance trends by sequence
        const sequenceMap = new Map();
        subjectMarks.forEach(mark => {
            const key = `${mark.exam_sequence.sequence_number}-${mark.exam_sequence.term?.name || 'Term'}`;
            if (!sequenceMap.has(key)) {
                sequenceMap.set(key, {
                    sequenceNumber: mark.exam_sequence.sequence_number,
                    termName: mark.exam_sequence.term?.name || 'Term',
                    marks: []
                });
            }
            sequenceMap.get(key).marks.push((mark.score ?? 0) || 0);
        });

        const performanceTrends = Array.from(sequenceMap.values()).map(trend => ({
            sequenceNumber: trend.sequenceNumber,
            termName: trend.termName,
            averageMarks: trend.marks.length > 0
                ? Math.round((trend.marks.reduce((sum, mark) => sum + mark, 0) / trend.marks.length) * 100) / 100
                : 0,
            passRate: trend.marks.length > 0
                ? Math.round((trend.marks.filter(mark => mark >= 10).length / trend.marks.length) * 100 * 100) / 100
                : 0
        }));

        performances.push({
            subjectId: subject.id,
            subjectName: subject.name,
            totalStudents,
            totalClasses: subClassSubjects.length,
            averageMarks: Math.round(averageMarks * 100) / 100,
            passRate: Math.round(passRate * 100) / 100,
            excellentRate: Math.round(excellentRate * 100) / 100,
            classBreakdown,
            performanceTrends
        });
    }

    return performances;
}

/**
 * Assign teacher to HOD's subject
 */
export async function assignTeacherToSubject(
    hodId: number,
    subjectId: number,
    teacherId: number
): Promise<any> {
    // Verify that the HOD manages this subject
    const subject = await prisma.subject.findFirst({
        where: {
            id: subjectId,
            hod_id: hodId
        }
    });

    if (!subject) {
        throw new Error('Subject not found or not managed by this HOD');
    }

    // Check if teacher exists and has TEACHER role
    const teacher = await prisma.user.findFirst({
        where: {
            id: teacherId,
            user_roles: {
                some: {
                    role: 'TEACHER'
                }
            }
        }
    });

    if (!teacher) {
        throw new Error('Teacher not found or user does not have TEACHER role');
    }

    // Check if assignment already exists
    const existingAssignment = await prisma.subjectTeacher.findFirst({
        where: {
            subject_id: subjectId,
            teacher_id: teacherId
        }
    });

    if (existingAssignment) {
        return {
            message: 'Teacher already assigned to this subject',
            assignment: existingAssignment
        };
    }

    // Create the assignment
    const assignment = await prisma.subjectTeacher.create({
        data: {
            subject_id: subjectId,
            teacher_id: teacherId
        },
        include: {
            teacher: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    matricule: true
                }
            },
            subject: {
                select: {
                    id: true,
                    name: true,
                    category: true
                }
            }
        }
    });

    return {
        message: 'Teacher successfully assigned to subject',
        assignment
    };
}

/**
 * Get department analytics for HOD
 */
export async function getDepartmentAnalytics(
    hodId: number,
    academicYearId?: number
): Promise<DepartmentAnalytics[]> {
    const currentYear = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) return [];

    const subjects = await getHODSubjects(hodId);
    const analytics: DepartmentAnalytics[] = [];

    for (const subject of subjects) {
        // Get all teachers in this department
        const subjectTeachers = await prisma.subjectTeacher.findMany({
            where: { subject_id: subject.id },
            include: { teacher: true }
        });

        // Get all students studying this subject
        const subClassSubjects = await prisma.subClassSubject.findMany({
            where: { subject_id: subject.id },
            include: {
                sub_class: {
                    include: {
                        enrollments: {
                            where: { academic_year_id: currentYear }
                        }
                    }
                }
            }
        });

        const totalStudents = subClassSubjects.reduce((total, scs) =>
            total + scs.sub_class.enrollments.length, 0);

        // Get all marks for this subject
        const allMarks = await prisma.mark.findMany({
            where: {
                sub_class_subject: {
                    subject_id: subject.id
                },
                exam_sequence: {
                    academic_year_id: currentYear
                }
            },
            include: {
                sub_class_subject: {
                    include: {
                        sub_class: true
                    }
                },
                teacher: true,
                exam_sequence: true
            }
        });

        const overallAverage = allMarks.length > 0
            ? allMarks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / allMarks.length
            : 0;

        const overallPassRate = allMarks.length > 0
            ? (allMarks.filter(mark => ((mark.score ?? 0) || 0) >= 10).length / allMarks.length) * 100
            : 0;

        // Find top and lowest performing classes
        const classPerformanceMap = new Map();
        allMarks.forEach(mark => {
            const classId = mark.sub_class_subject.sub_class_id;
            const className = mark.sub_class_subject.sub_class.name;

            if (!classPerformanceMap.has(classId)) {
                classPerformanceMap.set(classId, {
                    className,
                    marks: []
                });
            }
            classPerformanceMap.get(classId).marks.push((mark.score ?? 0) || 0);
        });

        const classAverages = Array.from(classPerformanceMap.entries()).map(([classId, data]) => ({
            className: data.className,
            averageMarks: data.marks.reduce((sum, mark) => sum + mark, 0) / data.marks.length
        }));

        const topPerformingClass = classAverages.length > 0
            ? classAverages.reduce((prev, current) =>
                (prev.averageMarks > current.averageMarks) ? prev : current)
            : null;

        const lowestPerformingClass = classAverages.length > 0
            ? classAverages.reduce((prev, current) =>
                (prev.averageMarks < current.averageMarks) ? prev : current)
            : null;

        // Teacher performance ranking
        const teacherPerformanceMap = new Map();
        allMarks.forEach(mark => {
            const teacherId = mark.teacher_id;
            const teacherName = mark.teacher.name;

            if (!teacherPerformanceMap.has(teacherId)) {
                teacherPerformanceMap.set(teacherId, {
                    teacherName,
                    marks: [],
                    classes: new Set(),
                    students: new Set()
                });
            }
            const teacherData = teacherPerformanceMap.get(teacherId);
            teacherData.marks.push((mark.score ?? 0) || 0);
            teacherData.classes.add(mark.sub_class_subject.sub_class_id);
            teacherData.students.add(mark.enrollment_id);
        });

        const teacherPerformanceRanking = Array.from(teacherPerformanceMap.entries())
            .map(([teacherId, data]) => ({
                teacherId: parseInt(teacherId.toString()),
                teacherName: data.teacherName,
                averageMarks: data.marks.reduce((sum, mark) => sum + mark, 0) / data.marks.length,
                studentsCount: data.students.size,
                classesCount: data.classes.size
            }))
            .sort((a, b) => b.averageMarks - a.averageMarks);

        // Monthly trends (simplified to sequence trends)
        const monthlyTrends = Array.from(
            allMarks.reduce((map, mark) => {
                const month = mark.exam_sequence.created_at.toISOString().slice(0, 7); // YYYY-MM
                if (!map.has(month)) {
                    map.set(month, { marks: [], students: new Set() });
                }
                map.get(month).marks.push((mark.score ?? 0) || 0);
                map.get(month).students.add(mark.enrollment_id);
                return map;
            }, new Map()).entries()
        ).map(([month, data]) => ({
            month,
            averageMarks: data.marks.reduce((sum, mark) => sum + mark, 0) / data.marks.length,
            studentsEvaluated: data.students.size
        }));

        analytics.push({
            subjectId: subject.id,
            subjectName: subject.name,
            totalTeachers: subjectTeachers.length,
            totalStudents,
            totalClasses: subClassSubjects.length,
            overallAverage: Math.round(overallAverage * 100) / 100,
            overallPassRate: Math.round(overallPassRate * 100) / 100,
            topPerformingClass: topPerformingClass ? {
                subClassName: topPerformingClass.className,
                averageMarks: Math.round(topPerformingClass.averageMarks * 100) / 100
            } : null,
            lowestPerformingClass: lowestPerformingClass ? {
                subClassName: lowestPerformingClass.className,
                averageMarks: Math.round(lowestPerformingClass.averageMarks * 100) / 100
            } : null,
            teacherPerformanceRanking: teacherPerformanceRanking.map(tp => ({
                ...tp,
                averageMarks: Math.round(tp.averageMarks * 100) / 100
            })),
            monthlyTrends: monthlyTrends.map(mt => ({
                ...mt,
                averageMarks: Math.round(mt.averageMarks * 100) / 100
            }))
        });
    }

    return analytics;
}

/**
 * Get teacher performance details in HOD's department
 */
export async function getTeacherPerformance(
    hodId: number,
    teacherId: number,
    academicYearId?: number
): Promise<any> {
    const currentYear = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) return null;

    const subjects = await getHODSubjects(hodId);
    const subjectIds = subjects.map(s => s.id);

    // Verify teacher teaches in this department
    const teacherInDepartment = await prisma.subjectTeacher.findFirst({
        where: {
            teacher_id: teacherId,
            subject_id: { in: subjectIds }
        },
        include: {
            teacher: true
        }
    });

    if (!teacherInDepartment) {
        throw new Error('Teacher not found in this department');
    }

    // Get detailed performance data
    const marks = await prisma.mark.findMany({
        where: {
            teacher_id: teacherId,
            sub_class_subject: {
                subject_id: { in: subjectIds }
            },
            exam_sequence: {
                academic_year_id: currentYear
            }
        },
        include: {
            sub_class_subject: {
                include: {
                    sub_class: {
                        include: {
                            class: true
                        }
                    },
                    subject: true
                }
            },
            exam_sequence: {
                include: {
                    term: true
                }
            },
            enrollment: {
                include: {
                    student: true
                }
            }
        }
    });

    // Calculate performance metrics
    const totalMarks = marks.length;
    const averageScore = totalMarks > 0
        ? marks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / totalMarks
        : 0;

    const passRate = totalMarks > 0
        ? (marks.filter(mark => ((mark.score ?? 0) || 0) >= 10).length / totalMarks) * 100
        : 0;

    const excellentRate = totalMarks > 0
        ? (marks.filter(mark => ((mark.score ?? 0) || 0) >= 16).length / totalMarks) * 100
        : 0;

    // Group by subject
    const subjectPerformance = marks.reduce((acc, mark) => {
        const subjectId = mark.sub_class_subject.subject_id;
        const subjectName = mark.sub_class_subject.subject.name;

        if (!acc[subjectId]) {
            acc[subjectId] = {
                subjectName,
                marks: []
            };
        }
        acc[subjectId].marks.push((mark.score ?? 0) || 0);
        return acc;
    }, {} as Record<number, { subjectName: string; marks: number[] }>);

    const subjectStats = Object.entries(subjectPerformance).map(([subjectId, data]) => ({
        subjectId: parseInt(subjectId),
        subjectName: data.subjectName,
        totalMarks: data.marks.length,
        averageScore: data.marks.reduce((sum, mark) => sum + mark, 0) / data.marks.length,
        passRate: (data.marks.filter(mark => mark >= 10).length / data.marks.length) * 100
    }));

    // Group by class
    const classPerformance = marks.reduce((acc, mark) => {
        const subClassId = mark.sub_class_subject.sub_class_id;
        const subClassName = mark.sub_class_subject.sub_class.name;
        const className = mark.sub_class_subject.sub_class.class.name;

        if (!acc[subClassId]) {
            acc[subClassId] = {
                subClassName,
                className,
                marks: []
            };
        }
        acc[subClassId].marks.push((mark.score ?? 0) || 0);
        return acc;
    }, {} as Record<number, { subClassName: string; className: string; marks: number[] }>);

    const classStats = Object.entries(classPerformance).map(([subClassId, data]) => ({
        subClassId: parseInt(subClassId),
        subClassName: data.subClassName,
        className: data.className,
        totalMarks: data.marks.length,
        averageScore: data.marks.reduce((sum, mark) => sum + mark, 0) / data.marks.length,
        passRate: (data.marks.filter(mark => mark >= 10).length / data.marks.length) * 100
    }));

    return {
        teacher: {
            id: teacherInDepartment.teacher.id,
            name: teacherInDepartment.teacher.name,
            email: teacherInDepartment.teacher.email,
            matricule: teacherInDepartment.teacher.matricule
        },
        overallPerformance: {
            totalMarks,
            averageScore: Math.round(averageScore * 100) / 100,
            passRate: Math.round(passRate * 100) / 100,
            excellentRate: Math.round(excellentRate * 100) / 100
        },
        subjectPerformance: subjectStats.map(stat => ({
            ...stat,
            averageScore: Math.round(stat.averageScore * 100) / 100,
            passRate: Math.round(stat.passRate * 100) / 100
        })),
        classPerformance: classStats.map(stat => ({
            ...stat,
            averageScore: Math.round(stat.averageScore * 100) / 100,
            passRate: Math.round(stat.passRate * 100) / 100
        }))
    };
}

/**
 * Get HOD dashboard data
 */
export async function getHODDashboard(hodId: number, academicYearId?: number): Promise<any> {
    const currentYear = academicYearId || (await getCurrentAcademicYear())?.id;
    if (!currentYear) return null;

    const subjects = await getHODSubjects(hodId);
    const subjectIds = subjects.map(s => s.id);

    if (subjectIds.length === 0) {
        return {
            totalSubjects: 0,
            totalTeachers: 0,
            totalStudents: 0,
            totalClasses: 0,
            departmentAverage: 0,
            overallPassRate: 0,
            recentPerformance: [],
            topPerformers: [],
            needsAttention: []
        };
    }

    // Get overall statistics
    const subjectTeachers = await prisma.subjectTeacher.findMany({
        where: {
            subject_id: { in: subjectIds }
        }
    });

    const subClassSubjects = await prisma.subClassSubject.findMany({
        where: {
            subject_id: { in: subjectIds }
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
    });

    // Distinct students / sub-classes / teachers: a sub-class taking two of
    // the department's subjects (e.g. Maths + Add. Maths) used to be counted
    // twice, as did a teacher assigned to two department subjects.
    const totalStudents = new Set(
        subClassSubjects.flatMap(scs => scs.sub_class.enrollments.map(e => e.id))
    ).size;
    const distinctSubClasses = new Set(subClassSubjects.map(scs => scs.sub_class_id)).size;
    const distinctTeachers = new Set(subjectTeachers.map(st => st.teacher_id)).size;

    // Get all marks for department
    const allMarks = await prisma.mark.findMany({
        where: {
            sub_class_subject: {
                subject_id: { in: subjectIds }
            },
            exam_sequence: {
                academic_year_id: currentYear
            }
        }
    });

    const departmentAverage = allMarks.length > 0
        ? allMarks.reduce((sum, mark) => sum + ((mark.score ?? 0) || 0), 0) / allMarks.length
        : 0;

    const overallPassRate = allMarks.length > 0
        ? (allMarks.filter(mark => ((mark.score ?? 0) || 0) >= 10).length / allMarks.length) * 100
        : 0;

    return {
        totalSubjects: subjects.length,
        totalTeachers: distinctTeachers,
        totalStudents,
        totalClasses: distinctSubClasses,
        departmentAverage: Math.round(departmentAverage * 100) / 100,
        overallPassRate: Math.round(overallPassRate * 100) / 100,
        subjectsManaged: subjects.map(subject => ({
            id: subject.id,
            name: subject.name,
            category: subject.category
        }))
    };
} 