// src/api/v1/services/subjectService.ts
// import from '@prisma/client';
import prisma, { Subject, SubjectTeacher, SubClassSubject, SubjectCategory } from '../../../config/db';
import { getAcademicYearId } from '../../../utils/academicYear';
import { paginate, PaginationOptions, FilterOptions, PaginatedResult } from '../../../utils/pagination';

export async function getAllSubjects(
    paginationOptions?: PaginationOptions,
    filterOptions?: FilterOptions,
    includeOptions?: any
): Promise<PaginatedResult<Subject>> {
    // Process category filter if needed
    const processedFilters: any = { ...filterOptions };

    return paginate<Subject>(
        prisma.subject,
        paginationOptions,
        processedFilters,
        includeOptions
    );
}

export async function createSubject(data: { name: string; category: string }): Promise<Subject> {
    return prisma.subject.create({
        data: {
            name: data.name,
            category: data.category as SubjectCategory,
        },
    });
}

export async function assignTeacher(subject_id: number, data: { teacher_id: number }): Promise<SubjectTeacher> {
    // Check if the assignment already exists using the composite unique key
    const existingAssignment = await prisma.subjectTeacher.findUnique({
        where: {
            subject_id_teacher_id: {
                subject_id: subject_id,
                teacher_id: data.teacher_id
            }
        }
    });

    // If it exists, return it
    if (existingAssignment) {
        console.log(`Assignment already exists for subject ${subject_id} and teacher ${data.teacher_id}. Returning existing.`);
        return existingAssignment;
    }

    // If not, create the new assignment
    console.log(`Creating new assignment for subject ${subject_id} and teacher ${data.teacher_id}.`);
    return prisma.subjectTeacher.create({
        data: {
            subject_id,
            teacher_id: data.teacher_id,
        },
    });
}

export async function removeTeacher(subject_id: number, teacher_id: number): Promise<void> {
    await prisma.subjectTeacher.delete({
        where: {
            subject_id_teacher_id: {
                subject_id,
                teacher_id,
            }
        }
    });
}

export async function linkSubjectToSubClass(
    subject_id: number,
    data: {
        sub_class_id: number;
        coefficient: number;
    }
): Promise<SubClassSubject> {
    // Upsert: if the link already exists, update its coefficient; else create.
    // Prevents P2002 crashes when the frontend re-links a subject that was
    // seeded/imported directly into SubClassSubject.
    return prisma.subClassSubject.upsert({
        where: {
            sub_class_id_subject_id: {
                sub_class_id: data.sub_class_id,
                subject_id,
            },
        },
        update: {
            coefficient: data.coefficient,
        },
        create: {
            subject_id,
            sub_class_id: data.sub_class_id,
            coefficient: data.coefficient,
        },
    });
}

// Get subjects for a specific sub_class
export async function getSubjectsForSubclass(sub_class_id: number): Promise<SubClassSubject[]> {
    return prisma.subClassSubject.findMany({
        where: { sub_class_id },
        include: {
            subject: true,
        }
    });
}

// Get all subjects taught by a teacher
export async function getSubjectsByTeacher(teacher_id: number): Promise<SubjectTeacher[]> {
    return prisma.subjectTeacher.findMany({
        where: { teacher_id },
        include: {
            subject: true
        }
    });
}

// Get teacher schedule for an academic year
export async function getTeacherSchedule(teacher_id: number, academicYearId?: number): Promise<any[]> {
    // Get the academic year id
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) {
        return [];
    }

    // Find the subject teachers for this teacher
    const subjectTeachers = await prisma.subjectTeacher.findMany({
        where: { teacher_id },
        include: { subject: true }
    });

    // Get all scheduled periods for these subject-teachers in this academic year
    const subjectTeacherIds = subjectTeachers.map(st => st.id);

    return prisma.teacherPeriod.findMany({
        where: {
            teacher_id: teacher_id,
            academic_year_id: yearId
        },
        include: {
            period: true,
            sub_class: {
                include: {
                    class: true
                }
            },
            subject: true,
            teacher: true
        }
    });
}

export async function getSubjectById(id: number): Promise<Subject | null> {
    return prisma.subject.findUnique({
        where: { id },
        include: {
            subject_teachers: {
                include: {
                    teacher: true
                }
            },
            sub_class_subjects: {
                include: {
                    sub_class: {
                        include: {
                            class: true
                        }
                    }
                }
            }
        }
    });
}

export async function updateSubject(
    id: number,
    data: { name?: string; category?: SubjectCategory }
): Promise<Subject> {
    return prisma.subject.update({
        where: { id },
        data: {
            name: data.name,
            category: data.category
        }
    });
}

export async function deleteSubject(id: number): Promise<Subject> {
    // First delete related subject_teachers and sub_class_subjects
    await prisma.subjectTeacher.deleteMany({
        where: { subject_id: id }
    });

    await prisma.subClassSubject.deleteMany({
        where: { subject_id: id }
    });

    // Then delete the subject
    return prisma.subject.delete({
        where: { id }
    });
}

/**
 * Unlinks a subject from a specific subclass.
 * @param subjectId The ID of the subject.
 * @param subClassId The ID of the subclass.
 * @returns The deleted SubClassSubject record.
 * @throws Error if the link does not exist.
 */
export async function unlinkSubjectFromSubClass(subjectId: number, subClassId: number): Promise<SubClassSubject> {
    // Check if the link exists
    const existingLink = await prisma.subClassSubject.findUnique({
        where: {
            sub_class_id_subject_id: {
                subject_id: subjectId,
                sub_class_id: subClassId,
            },
        },
    });

    if (!existingLink) {
        throw new Error(`Subject with ID ${subjectId} is not linked to subclass with ID ${subClassId}`);
    }

    return prisma.subClassSubject.delete({
        where: {
            sub_class_id_subject_id: {
                subject_id: subjectId,
                sub_class_id: subClassId,
            },
        },
    });
}

/**
 * Assigns a subject to all sub_classes of a class
 * @param class_id The ID of the class
 * @param subject_id The ID of the subject to assign
 * @param data Additional data for the assignment (coefficient)
 * @returns Array of created SubclassSubject relationships
 */
export async function assignSubjectToClass(
    class_id: number,
    subject_id: number,
    data: {
        coefficient: number;
    }
): Promise<SubClassSubject[]> {
    // First get all sub_classes for the given class
    const sub_classes = await prisma.subClass.findMany({
        where: { class_id }
    });

    if (sub_classes.length === 0) {
        throw new Error(`No sub_classes found for class with ID ${class_id}`);
    }

    // Check if subject exists
    const subject = await prisma.subject.findUnique({
        where: { id: subject_id }
    });

    if (!subject) {
        throw new Error(`Subject with ID ${subject_id} not found`);
    }

    const results = await Promise.all(
        sub_classes.map(sub_class =>
            prisma.subClassSubject.create({
                data: {
                    subject_id,
                    sub_class_id: sub_class.id,
                    coefficient: data.coefficient
                },
                // No include needed here, we just need the created/found relation
            }).catch(async (error: any) => {
                if (error.code === 'P2002') {
                    console.warn(`Subject ${subject_id} already assigned to sub_class ${sub_class.id}. Fetching existing.`);
                    // Fetch and return the existing record
                    const existingRelation = await prisma.subClassSubject.findFirst({
                        where: {
                            subject_id,
                            sub_class_id: sub_class.id
                        }
                        // No include needed here unless the return type strictly requires it
                    });
                    return existingRelation;
                }
                console.error(`Error creating SubclassSubject for sub_class ${sub_class.id}:`, error);
                throw error;
            })
        )
    );

    // Filter out any nulls (in case findFirst didn't find anything, though unlikely after P2002) 
    // and assert the type based on the Promise return
    return results.filter(result => result !== null) as SubClassSubject[];
}