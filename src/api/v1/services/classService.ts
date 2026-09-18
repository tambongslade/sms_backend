// src/api/v1/services/classService.ts
import prisma, { Class, SubClass, User } from '../../../config/db';
import { paginate, PaginationOptions, FilterOptions, PaginatedResult } from '../../../utils/pagination';
import { getCurrentAcademicYear, getAcademicYearId } from '../../../utils/academicYear';

// Interface for create/update data to ensure type safety
interface ClassData {
    name: string;
    base_fee?: number;
    new_student_fee?: number;
    old_student_fee?: number;
    miscellaneous_fee?: number;
    first_term_fee?: number;
    second_term_fee?: number;
    third_term_fee?: number;
    period_set_id?: number | null;
}

export async function getAllClasses(
    paginationOptions?: PaginationOptions,
    filterOptions?: FilterOptions
): Promise<PaginatedResult<Class>> {
    const result = await paginate<Class>(
        prisma.class,
        paginationOptions,
        filterOptions,
        { sub_classes: true, period_set: true }
    );

    // Get current academic year
    const currentYear = await getCurrentAcademicYear();
    const academicYearId = currentYear?.id;

    // Enhance classes with student counts
    const classesWithCounts = await Promise.all(
        result.data.map(async (classItem: any) => {
            // Get all sub_class IDs for this class
            const sub_classIds = classItem.sub_classes.map((sub_class: any) => sub_class.id);

            // Count students enrolled in any sub_class of this class in the current academic year
            const studentCount = await prisma.enrollment.count({
                where: {
                    sub_class_id: {
                        in: sub_classIds
                    },
                    ...(academicYearId && { academic_year_id: academicYearId }),
                    student: { status: { not: 'WITHDRAWN' } }
                }
            });

            // Add the count to the class object
            return {
                ...classItem,
                studentCount,
                academicYearId  // Include the academic year ID for reference
            };
        })
    );

    return {
        ...result,
        data: classesWithCounts
    };
}

export async function getAllSubclasses(
    paginationOptions?: PaginationOptions,
    filterOptions?: FilterOptions
): Promise<PaginatedResult<SubClass>> {
    const processedFilters: any = { ...filterOptions };
    const include: any = { class: true, class_master: true }; // Start with default includes

    // Special handling for class_id filter
    if (filterOptions?.classId) {
        processedFilters.class_id = parseInt(filterOptions.classId as string);
        delete processedFilters.classId;
    }

    // Check if subjects should be included and prepare include object
    if (filterOptions?.includeSubjects === 'true') {
        include.sub_class_subjects = {
            include: {
                subject: true // Include the subject details
            }
        };
    }
    // Always remove the flag from filters passed to paginate
    if (filterOptions?.includeSubjects !== undefined) {
        delete processedFilters.includeSubjects;
    }

    const result = await paginate<SubClass>(
        prisma.subClass,
        paginationOptions,
        processedFilters, // Filters excluding the include flag
        include // Pass the dynamically built include object
    );

    // Get current academic year
    const currentYear = await getCurrentAcademicYear();
    const academicYearId = currentYear?.id;

    // Enhance sub_classes with student counts
    const sub_classesWithCounts = await Promise.all(
        result.data.map(async (sub_class: any) => {
            // Count students enrolled in this sub_class in the current academic year
            const studentCount = await prisma.enrollment.count({
                where: {
                    sub_class_id: sub_class.id,
                    ...(academicYearId && { academic_year_id: academicYearId }),
                    student: { status: { not: 'WITHDRAWN' } }
                }
            });

            // Add the count to the sub_class object
            return {
                ...sub_class,
                studentCount,
                academicYearId  // Include the academic year ID for reference
            };
        })
    );

    return {
        ...result,
        data: sub_classesWithCounts
    };
}

// Original function for backwards compatibility - now with student counts
export async function getAllClassesWithSubclasses(): Promise<any[]> {
    const classes = await prisma.class.findMany({
        include: {
            period_set: true,
            sub_classes: {
                include: {
                    sub_class_subjects: {
                        select: {
                            subject_id: true
                        }
                    }
                }
            },
        },
    });

    // Get current academic year
    const currentYear = await getCurrentAcademicYear();
    const academicYearId = currentYear?.id;

    // Enhance classes and sub_classes with student counts
    return Promise.all(
        classes.map(async (classItem: any) => {
            // Add student counts to each sub_class
            const sub_classesWithCounts = await Promise.all(
                classItem.sub_classes.map(async (sub_class: any) => {
                    const studentCount = await prisma.enrollment.count({
                        where: {
                            sub_class_id: sub_class.id,
                            ...(academicYearId && { academic_year_id: academicYearId }),
                            student: { status: { not: 'WITHDRAWN' } }
                        }
                    });
                    return {
                        ...sub_class,
                        studentCount
                    };
                })
            );

            // Calculate total student count for class
            const totalStudentCount = sub_classesWithCounts.reduce(
                (total, sub_class) => total + sub_class.studentCount, 0
            );

            return {
                ...classItem,
                sub_classes: sub_classesWithCounts,
                studentCount: totalStudentCount,
                academicYearId // Include the academic year ID for reference
            };
        })
    );
}

export async function createClass(data: ClassData): Promise<Class> {
    return prisma.class.create({
        data: {
            name: data.name,
            base_fee: data.base_fee,
            new_student_fee: data.new_student_fee,
            old_student_fee: data.old_student_fee,
            miscellaneous_fee: data.miscellaneous_fee,
            first_term_fee: data.first_term_fee,
            second_term_fee: data.second_term_fee,
            third_term_fee: data.third_term_fee,
            period_set_id: data.period_set_id ?? null,
        },
    });
}

export async function getClassById(id: number): Promise<any> {
    const classData = await prisma.class.findUnique({
        where: { id },
        include: {
            period_set: true,
            sub_classes: {
                include: {
                    class_master: true // Include class master information
                }
            }
        },
    });

    if (!classData) return null;

    // Get current academic year
    const currentYear = await getCurrentAcademicYear();
    const academicYearId = currentYear?.id;

    // Add student counts to each sub_class
    const sub_classesWithCounts = await Promise.all(
        classData.sub_classes.map(async (sub_class: any) => {
            const studentCount = await prisma.enrollment.count({
                where: {
                    sub_class_id: sub_class.id,
                    ...(academicYearId && { academic_year_id: academicYearId }),
                    student: { status: { not: 'WITHDRAWN' } }
                }
            });
            return {
                ...sub_class,
                studentCount
            };
        })
    );

    // Calculate total student count for class
    const totalStudentCount = sub_classesWithCounts.reduce(
        (total, sub_class) => total + sub_class.studentCount, 0
    );

    return {
        ...classData,
        sub_classes: sub_classesWithCounts,
        studentCount: totalStudentCount,
        academicYearId // Include the academic year ID for reference
    };
}

export async function updateClass(id: number, data: Partial<ClassData>): Promise<Class> {
    return prisma.class.update({
        where: { id },
        data: {
            name: data.name,
            base_fee: data.base_fee,
            new_student_fee: data.new_student_fee,
            old_student_fee: data.old_student_fee,
            miscellaneous_fee: data.miscellaneous_fee,
            first_term_fee: data.first_term_fee,
            second_term_fee: data.second_term_fee,
            third_term_fee: data.third_term_fee,
            ...(data.period_set_id !== undefined && { period_set_id: data.period_set_id }),
        },
    });
}

export async function deleteClass(id: number): Promise<Class> {
    // Check if there are any subclasses associated with this class
    const subClassCount = await prisma.subClass.count({
        where: { class_id: id },
    });

    if (subClassCount > 0) {
        throw new Error('CLASS_HAS_SUBCLASSES');
    }

    // Check if there are any enrollments directly associated with this class (should be via subclass usually, but good to check)
    const enrollmentCount = await prisma.enrollment.count({
        where: { class_id: id },
    });

    if (enrollmentCount > 0) {
        throw new Error('CLASS_HAS_ENROLLMENTS');
    }

    // If no associated records, proceed with deletion
    return prisma.class.delete({
        where: { id },
    });
}

/**
 * Bind a class to a bell schedule. Pass null to detach.
 * Rejects if the period set belongs to a different academic year than the
 * caller's current context.
 */
export async function assignPeriodSet(classId: number, periodSetId: number | null): Promise<Class> {
    if (periodSetId !== null) {
        const set = await prisma.periodSet.findUnique({ where: { id: periodSetId } });
        if (!set) throw new Error('PERIOD_SET_NOT_FOUND');
    }
    return prisma.class.update({
        where: { id: classId },
        data: { period_set_id: periodSetId },
        include: { period_set: true }
    });
}

export async function addSubClass(class_id: number, data: { name: string }): Promise<SubClass> {
    return prisma.subClass.create({
        data: {
            name: data.name,
            class_id,
        },
    });
}

export async function checkSubClassExists(sub_classId: number, classId: number): Promise<SubClass | null> {
    return prisma.subClass.findFirst({
        where: {
            id: sub_classId,
            class_id: classId
        }
    });
}

export async function deleteSubClass(subClassId: number): Promise<SubClass> {
    // Check if there are any enrollments associated with this sub_class
    const enrollmentCount = await prisma.enrollment.count({
        where: { sub_class_id: subClassId },
    });

    if (enrollmentCount > 0) {
        // Throw a specific error if enrollments exist
        throw new Error('SUBCLASS_HAS_ENROLLMENTS');
    }

    // If no enrollments, proceed with deletion
    return prisma.subClass.delete({
        where: { id: subClassId },
    });
}

export async function updateSubClass(subClassId: number, data: { name?: string }): Promise<SubClass> {
    return prisma.subClass.update({
        where: { id: subClassId },
        data: {
            name: data.name,
        },
    });
}

/**
 * Assign a class master to a sub_class
 * @param sub_classId The ID of the sub_class
 * @param userId The ID of the user to be assigned as class master
 * @returns The updated sub_class with class master information
 */
export async function assignClassMaster(sub_classId: number, userId: number): Promise<SubClass> {
    // Check if the user exists
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            user_roles: true
        }
    });

    if (!user) {
        throw new Error(`User with ID ${userId} not found`);
    }

    // Get current academic year ID before using it in the some() callback
    const currentAcademicYearId = await getAcademicYearId();

    // Check if the user has a teacher role
    const hasTeacherRole = user.user_roles.some(role =>
        role.role === 'TEACHER' &&
        (role.academic_year_id === null || // Global role
            role.academic_year_id === currentAcademicYearId) // Current year role
    );

    if (!hasTeacherRole) {
        throw new Error(`User with ID ${userId} does not have a teacher role in the current academic year`);
    }

    // Check if the sub_class exists
    const sub_class = await prisma.subClass.findUnique({
        where: { id: sub_classId }
    });

    if (!sub_class) {
        throw new Error(`Subclass with ID ${sub_classId} not found`);
    }

    // Assign the user as class master
    return prisma.subClass.update({
        where: { id: sub_classId },
        data: {
            class_master_id: userId
        },
        include: {
            class_master: true,
            class: true
        }
    });
}

/**
 * Get the class master of a sub_class
 * @param sub_classId The ID of the sub_class
 * @returns The class master of the sub_class or null if none
 */
export async function getSubclassClassMaster(sub_classId: number): Promise<User | null> {
    const sub_class = await prisma.subClass.findUnique({
        where: { id: sub_classId },
        include: {
            class_master: true
        }
    });

    if (!sub_class) {
        throw new Error(`Subclass with ID ${sub_classId} not found`);
    }

    return sub_class.class_master;
}

/**
 * Remove the class master from a sub_class
 * @param sub_classId The ID of the sub_class
 * @returns The updated sub_class
 */
export async function removeClassMaster(sub_classId: number): Promise<SubClass> {
    const sub_class = await prisma.subClass.findUnique({
        where: { id: sub_classId }
    });

    if (!sub_class) {
        throw new Error(`Subclass with ID ${sub_classId} not found`);
    }

    return prisma.subClass.update({
        where: { id: sub_classId },
        data: {
            class_master_id: null
        },
        include: {
            class: true
        }
    });
}

/**
 * Get all subjects associated with a specific sub_class, including their coefficients.
 * @param sub_classId The ID of the sub_class
 * @returns Array of subject objects, each augmented with the coefficient for that sub_class.
 */
export async function getSubjectsForSubclass(sub_classId: number): Promise<any[]> {
    // Optional: Check if sub_class exists first
    const sub_classExists = await prisma.subClass.findUnique({ where: { id: sub_classId } });
    if (!sub_classExists) {
        throw new Error(`Subclass with ID ${sub_classId} not found`);
    }

    // Fetch the SubclassSubject join records including the related Subject
    const sub_classSubjects = await prisma.subClassSubject.findMany({
        where: { sub_class_id: sub_classId },
        include: {
            subject: true, // Include the full subject details
        },
        orderBy: {
            subject: { name: 'asc' } // Optional: Order by subject name
        }
    });

    // Transform the result to return an array of subjects, each with its coefficient
    return sub_classSubjects.map(ss => {
        if (!ss.subject) return null; // Handle potential edge case where subject might be missing
        return {
            ...ss.subject, // Spread all subject fields (id, name, category, etc.)
            coefficient: ss.coefficient, // Add the coefficient specific to this sub_class-subject link
        };
    }).filter(Boolean); // Filter out any null results
}
