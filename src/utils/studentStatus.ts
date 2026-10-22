// src/utils/studentStatus.ts
import prisma, { Student, Enrollment, AcademicYear } from '../config/db';

/**
 * Enum to represent student status in the school
 */
export enum StudentStatus {
    NEW = 'NEW',           // First time in the school
    OLD = 'OLD',           // Returning student from previous years
    REPEATER = 'REPEATER'  // Repeating the same class
}

/**
 * Interface for student status information
 */
export interface StudentStatusInfo {
    status: StudentStatus;
    isNewToSchool: boolean;
    isRepeater: boolean;
    firstEnrollmentYear?: AcademicYear;
    yearsInSchool: number;
    previousEnrollments: number;
}

/**
 * Determines if a student is new or old based on their enrollment history
 * @param studentId - The ID of the student
 * @param currentAcademicYearId - The current academic year ID
 * @returns StudentStatusInfo object with detailed status information
 */
export async function getStudentStatus(
    studentId: number, 
    currentAcademicYearId: number
): Promise<StudentStatusInfo> {
    // Get student with all enrollments and first enrollment year
    const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: {
            enrollments: {
                include: {
                    academic_year: true
                },
                orderBy: {
                    academic_year: {
                        start_date: 'asc'
                    }
                }
            },
            first_enrollment_year: true
        }
    });

    if (!student) {
        throw new Error(`Student with ID ${studentId} not found`);
    }

    // Get current enrollment
    const currentEnrollment = student.enrollments.find(
        enrollment => enrollment.academic_year_id === currentAcademicYearId
    );

    // Only enrollments in academic years that started BEFORE this one make a
    // student "returning" (a future-year enrollment must not flip this year's fees).
    const currentYear = currentEnrollment?.academic_year
        ?? await prisma.academicYear.findUnique({ where: { id: currentAcademicYearId } });
    const currentStart = currentYear ? new Date(currentYear.start_date).getTime() : Number.POSITIVE_INFINITY;
    const previousEnrollments = student.enrollments.filter(
        enrollment => enrollment.academic_year_id !== currentAcademicYearId &&
            new Date(enrollment.academic_year.start_date).getTime() < currentStart
    ).length;

    // first_enrollment_year_id is stamped with the CURRENT year when a new student
    // is enrolled, so it only proves "returning" when it points to an earlier year.
    // (Previously any non-null value made the student OLD, so every newly enrolled
    // student was charged the old-student fee.)
    const firstYearStart = student.first_enrollment_year
        ? new Date(student.first_enrollment_year.start_date).getTime()
        : null;
    const firstYearIsEarlier = student.first_enrollment_year_id !== null &&
        student.first_enrollment_year_id !== currentAcademicYearId &&
        firstYearStart !== null && firstYearStart < currentStart;

    // Determine if student is new to school
    const isNewToSchool = previousEnrollments === 0 && !firstYearIsEarlier;

    // Determine if student is repeating (based on enrollment.repeater field)
    const isRepeater = currentEnrollment?.repeater || false;

    // Calculate years in school
    const yearsInSchool = previousEnrollments + (currentEnrollment ? 1 : 0);

    // Determine overall status
    let status: StudentStatus;
    if (isRepeater) {
        status = StudentStatus.REPEATER;
    } else if (isNewToSchool) {
        status = StudentStatus.NEW;
    } else {
        status = StudentStatus.OLD;
    }

    return {
        status,
        isNewToSchool,
        isRepeater,
        firstEnrollmentYear: student.first_enrollment_year || undefined,
        yearsInSchool,
        previousEnrollments
    };
}

/**
 * Determines if a student should pay new student fees or old student fees
 * @param studentId - The ID of the student
 * @param currentAcademicYearId - The current academic year ID
 * @returns boolean - true if should pay new student fees, false for old student fees
 */
export async function shouldPayNewStudentFees(
    studentId: number, 
    currentAcademicYearId: number
): Promise<boolean> {
    // First, get the student's is_new_student field from the database
    const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: { is_new_student: true }
    });

    if (!student) {
        throw new Error(`Student with ID ${studentId} not found`);
    }

    // If user explicitly marked the student as not new, respect that choice
    // This handles cases where existing students are being added to the system
    if (student.is_new_student === false) {
        return false; // Pay old student fees
    }

    // If user marked as new student (or default true), check enrollment history
    const statusInfo = await getStudentStatus(studentId, currentAcademicYearId);
    
    // New students pay new student fees
    // Repeaters pay old student fees (they're not new to the school)
    // Old students (returning) pay old student fees
    return statusInfo.status === StudentStatus.NEW;
}

/**
 * Sets the first enrollment year for a student if not already set
 * @param studentId - The ID of the student
 * @param academicYearId - The academic year ID of their first enrollment
 */
export async function setFirstEnrollmentYear(
    studentId: number, 
    academicYearId: number
): Promise<void> {
    // Only set if not already set
    const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: { first_enrollment_year_id: true }
    });

    if (!student) {
        throw new Error(`Student with ID ${studentId} not found`);
    }

    if (!student.first_enrollment_year_id) {
        await prisma.student.update({
            where: { id: studentId },
            data: { first_enrollment_year_id: academicYearId }
        });
    }
}

/**
 * Updates the is_new_student field based on enrollment history across different academic years
 * If student has enrollments in 2+ different academic years, sets is_new_student to false
 * @param studentId - The ID of the student
 */
export async function updateNewStudentStatus(studentId: number): Promise<void> {
    // Get all enrollments for the student with their academic years
    const enrollments = await prisma.enrollment.findMany({
        where: { student_id: studentId },
        select: { academic_year_id: true },
        distinct: ['academic_year_id'] // Get unique academic years
    });

    // If student has enrollments in 2 or more different academic years, they're not new
    if (enrollments.length >= 2) {
        await prisma.student.update({
            where: { id: studentId },
            data: { is_new_student: false }
        });
    }
    // If only 1 academic year (or 0), leave is_new_student as is
}

/**
 * Gets all students with their status for a given academic year
 * @param academicYearId - The academic year ID
 * @param subClassId - Optional sub-class filter
 * @returns Array of students with their status information
 */
export async function getStudentsWithStatus(
    academicYearId: number,
    subClassId?: number
): Promise<Array<Student & { statusInfo: StudentStatusInfo }>> {
    // Get enrollments for the academic year
    const enrollments = await prisma.enrollment.findMany({
        where: {
            academic_year_id: academicYearId,
            ...(subClassId && { sub_class_id: subClassId })
        },
        include: {
            student: {
                include: {
                    enrollments: {
                        include: {
                            academic_year: true
                        }
                    },
                    first_enrollment_year: true
                }
            }
        }
    });

    // Get status for each student
    const studentsWithStatus = await Promise.all(
        enrollments.map(async (enrollment) => {
            const statusInfo = await getStudentStatus(enrollment.student_id, academicYearId);
            return {
                ...enrollment.student,
                statusInfo
            };
        })
    );

    return studentsWithStatus;
}

/**
 * Updates first enrollment year for existing students based on their earliest enrollment
 * This is a utility function to migrate existing data
 */
export async function migrateExistingStudentsFirstEnrollmentYear(): Promise<void> {
    console.log('Starting migration of existing students first enrollment year...');
    
    // Get all students without first_enrollment_year_id set
    const studentsToMigrate = await prisma.student.findMany({
        where: {
            first_enrollment_year_id: null
        },
        include: {
            enrollments: {
                include: {
                    academic_year: true
                },
                orderBy: {
                    academic_year: {
                        start_date: 'asc'
                    }
                }
            }
        }
    });

    console.log(`Found ${studentsToMigrate.length} students to migrate`);

    for (const student of studentsToMigrate) {
        if (student.enrollments.length > 0) {
            // Set first enrollment year to the earliest enrollment
            const firstEnrollment = student.enrollments[0];
            await prisma.student.update({
                where: { id: student.id },
                data: { first_enrollment_year_id: firstEnrollment.academic_year_id }
            });
            
            console.log(`Updated student ${student.name} (ID: ${student.id}) with first enrollment year: ${firstEnrollment.academic_year.name}`);
        }
    }

    console.log('Migration completed');
}
