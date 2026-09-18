import prisma from '../../../config/db';
import { getAcademicYearId } from '../../../utils/academicYear';
import { StudentStatus, Gender } from '@prisma/client';
import { updateNewStudentStatus } from '../../../utils/studentStatus';

// Types for the enrollment workflow
export interface BursarRegistrationData {
    name?: string; // Legacy single name (derived from nom + prenom if those are provided)
    nom?: string; // Family name
    prenom?: string; // Given name
    date_of_birth: string;
    place_of_birth: string;
    gender: Gender;
    residence: string;
    former_school?: string;
    class_id: number;
    academic_year_id?: number;
    is_new_student?: boolean;
    ream_of_paper_collected?: boolean;
}

export interface InterviewData {
    student_id: number;
    interviewer_id: number;
    score: number;
    comments?: string;
    academic_year_id?: number;
}

export interface SubclassAssignmentData {
    student_id: number;
    sub_class_id: number;
    academic_year_id?: number;
    assigned_by_id: number;
}

/**
 * STEP 1: Bursar registers student into a class (no subclass assignment yet)
 * Student status: NOT_ENROLLED -> ENROLLED
 */
export async function registerStudentToClass(data: BursarRegistrationData) {
    const yearId = data.academic_year_id ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error('Academic Year ID is required but could not be determined.');
    }

    // Verify class exists
    const classExists = await prisma.class.findUnique({
        where: { id: data.class_id }
    });
    if (!classExists) {
        throw new Error(`Class with ID ${data.class_id} not found.`);
    }

    // Derive full name from nom + prenom (or accept legacy single name)
    const nom = data.nom?.trim();
    const prenom = data.prenom?.trim();
    const fullName = (nom && prenom) ? `${nom} ${prenom}` : (data.name?.trim() || '');
    if (!fullName) {
        throw new Error('Provide nom (family name) and prenom (given name).');
    }

    const isNewStudent = data.is_new_student ?? true;
    const reamCollected = isNewStudent ? !!data.ream_of_paper_collected : false;

    // Generate matricule (will be done automatically by the student creation hook)
    const studentData = {
        name: fullName,
        nom: nom || null,
        prenom: prenom || null,
        date_of_birth: new Date(data.date_of_birth),
        place_of_birth: data.place_of_birth,
        gender: data.gender,
        residence: data.residence,
        former_school: data.former_school,
        is_new_student: isNewStudent,
        status: StudentStatus.ASSIGNED_TO_CLASS,
        first_enrollment_year_id: yearId,
        matricule: `TEMP_${Date.now()}` // Will be updated by matricule generator
    };

    // Create student and enrollment in a transaction
    const result = await prisma.$transaction(async (prisma) => {
        // Create student
        const student = await prisma.student.create({
            data: studentData
        });

        // Create enrollment (class assigned, no subclass yet)
        const enrollment = await prisma.enrollment.create({
            data: {
                student_id: student.id,
                academic_year_id: yearId,
                class_id: data.class_id,
                sub_class_id: null, // Will be assigned after interview
                repeater: false,
                ream_of_paper_collected: reamCollected,
                enrollment_date: new Date()
            }
        });

        // Update is_new_student field based on enrollment history
        await updateNewStudentStatus(student.id);

        return { student, enrollment };
    });

    return result;
}

/**
 * STEP 2: VP records interview marks for a student
 */
export async function recordInterviewMark(data: InterviewData) {
    const yearId = data.academic_year_id ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error('Academic Year ID is required but could not be determined.');
    }

    // Verify student exists and is enrolled but not yet assigned to subclass
    const enrollment = await prisma.enrollment.findFirst({
        where: {
            student_id: data.student_id,
            academic_year_id: yearId,
            sub_class_id: null // Should not have subclass assignment yet
        },
        include: {
            student: true,
            class: true
        }
    });

    if (!enrollment) {
        throw new Error(`Student with ID ${data.student_id} not found or already assigned to subclass.`);
    }

    // Verify interviewer has VP role (check for any academic year or global role)
    const interviewer = await prisma.user.findFirst({
        where: {
            id: data.interviewer_id,
            user_roles: {
                some: {
                    role: 'VICE_PRINCIPAL'
                    // Allow any academic year or global role
                }
            }
        }
    });

    if (!interviewer) {
        throw new Error(`User with ID ${data.interviewer_id} not found or does not have VP role.`);
    }

    // Create interview mark record
    const interviewMark = await prisma.interviewMark.create({
        data: {
            student_id: data.student_id,
            vp_id: data.interviewer_id,
            marks: data.score,
            notes: data.comments
        }
    });

    return {
        interviewMark,
        student: enrollment.student,
        class: enrollment.class
    };
}

/**
 * STEP 3: VP assigns student to subclass after interview
 * Student status: ENROLLED -> ASSIGNED_TO_CLASS
 */
export async function assignStudentToSubclass(data: SubclassAssignmentData) {
    const yearId = data.academic_year_id ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error('Academic Year ID is required but could not be determined.');
    }

    // Verify subclass exists and get its capacity info
    const subclass = await prisma.subClass.findUnique({
        where: { id: data.sub_class_id },
        include: {
            class: true,
            enrollments: {
                where: { academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' } } }
            }
        }
    });

    if (!subclass) {
        throw new Error(`Subclass with ID ${data.sub_class_id} not found.`);
    }

    // Check if subclass is at capacity (max 80 students per class)
    const currentEnrollmentCount = subclass.enrollments.length;
    if (currentEnrollmentCount >= subclass.class.max_students) {
        throw new Error(`Subclass ${subclass.name} is at capacity (${currentEnrollmentCount}/${subclass.class.max_students} students).`);
    }

    // Find the student's enrollment
    const enrollment = await prisma.enrollment.findFirst({
        where: {
            student_id: data.student_id,
            academic_year_id: yearId,
            class_id: subclass.class_id, // Must be in the same class as the subclass
            sub_class_id: null // Should not be assigned yet
        },
        include: {
            student: true
        }
    });

    if (!enrollment) {
        throw new Error(`Student with ID ${data.student_id} not found or already assigned to a subclass.`);
    }

    // Verify interview mark exists for this student
    const interviewMark = await prisma.interviewMark.findFirst({
        where: {
            student_id: data.student_id
        }
    });

    if (!interviewMark) {
        throw new Error(`No interview mark found for student ${data.student_id}. Interview must be completed before assignment.`);
    }

    // Update enrollment and student status in transaction
    const result = await prisma.$transaction(async (prisma) => {
        // Update enrollment with subclass assignment
        const updatedEnrollment = await prisma.enrollment.update({
            where: { id: enrollment.id },
            data: {
                sub_class_id: data.sub_class_id
            }
        });

        // Update student status
        const updatedStudent = await prisma.student.update({
            where: { id: data.student_id },
            data: {
                status: StudentStatus.ASSIGNED_TO_CLASS
            }
        });

        // Update subclass current student count
        await prisma.subClass.update({
            where: { id: data.sub_class_id },
            data: {
                current_students: currentEnrollmentCount + 1
            }
        });

        return {
            enrollment: updatedEnrollment,
            student: updatedStudent,
            subclass: subclass
        };
    });

    return result;
}

/**
 * VP Dashboard: Get all students awaiting subclass assignment
 */
export async function getUnassignedStudents(academicYearId?: number) {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error('Academic Year ID is required but could not be determined.');
    }

    const unassignedStudents = await prisma.enrollment.findMany({
        where: {
            academic_year_id: yearId,
            sub_class_id: null, // Not yet assigned to subclass
            student: { status: { not: 'WITHDRAWN' } }
        },
        include: {
            student: {
                include: {
                    interview_marks: true
                }
            },
            class: true
        },
        orderBy: [
            { enrollment_date: 'asc' } // Oldest enrollments first
        ]
    });

    // Group by class and add interview status
    const result = unassignedStudents.map(enrollment => ({
        enrollment_id: enrollment.id,
        student_id: enrollment.student.id,
        student_name: enrollment.student.name,
        matricule: enrollment.student.matricule,
        gender: enrollment.student.gender,
        class_name: enrollment.class.name,
        class_id: enrollment.class.id,
        enrollment_date: enrollment.enrollment_date,
        has_interview: enrollment.student.interview_marks.length > 0,
        interview_score: enrollment.student.interview_marks[0]?.marks || null,
        interview_comments: enrollment.student.interview_marks[0]?.notes || null,
        interviewer_name: null, // TODO: Get interviewer name from vp_id
        days_since_enrollment: Math.floor((Date.now() - enrollment.enrollment_date.getTime()) / (1000 * 60 * 60 * 24))
    }));

    return result;
}

/**
 * Get available subclasses for a specific class (with capacity info)
 */
export async function getAvailableSubclasses(classId: number, academicYearId?: number) {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error('Academic Year ID is required but could not be determined.');
    }

    const subclasses = await prisma.subClass.findMany({
        where: {
            class_id: classId
        },
        include: {
            class: true,
            enrollments: {
                where: { academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' } } }
            },
            class_master: {
                select: { id: true, name: true }
            }
        }
    });

    return subclasses.map(subclass => ({
        id: subclass.id,
        name: subclass.name,
        class_name: subclass.class.name,
        current_students: subclass.enrollments.length,
        max_students: subclass.class.max_students,
        available_spots: subclass.class.max_students - subclass.enrollments.length,
        class_master: subclass.class_master,
        is_full: subclass.enrollments.length >= subclass.class.max_students
    }));
}

/**
 * Get enrollment workflow statistics for dashboard
 */
export async function getEnrollmentStats(academicYearId?: number) {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error('Academic Year ID is required but could not be determined.');
    }

    const [
        totalEnrollments,
        awaitingInterview,
        awaitingAssignment,
        fullyAssigned,
        totalSubclasses,
        fullSubclasses
    ] = await Promise.all([
        // Total enrollments this year
        prisma.enrollment.count({
            where: { academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' } } }
        }),

        // Students enrolled but no interview yet
        prisma.enrollment.count({
            where: {
                academic_year_id: yearId,
                sub_class_id: null,
                student: {
                    status: { not: 'WITHDRAWN' },
                    interview_marks: {
                        none: {}
                    }
                }
            }
        }),

        // Students with interview but no subclass assignment
        prisma.enrollment.count({
            where: {
                academic_year_id: yearId,
                sub_class_id: null,
                student: {
                    status: { not: 'WITHDRAWN' },
                    interview_marks: {
                        some: {}
                    }
                }
            }
        }),

        // Students fully assigned
        prisma.enrollment.count({
            where: {
                academic_year_id: yearId,
                NOT: { sub_class_id: null },
                student: { status: { not: 'WITHDRAWN' } }
            }
        }),

        // Total subclasses
        prisma.subClass.count(),

        // Full subclasses (at max capacity) - simplified approach
        0 // TODO: Implement proper full subclass counting
    ]);

    return {
        totalEnrollments,
        awaitingInterview,
        awaitingAssignment,
        fullyAssigned,
        totalSubclasses,
        fullSubclasses,
        completionRate: totalEnrollments > 0 ? (fullyAssigned / totalEnrollments * 100).toFixed(1) : 0
    };
}

/**
 * Get enrollment workflow status for a specific student
 */
export async function getStudentEnrollmentStatus(studentId: number, academicYearId?: number) {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error('Academic Year ID is required but could not be determined.');
    }

    const enrollment = await prisma.enrollment.findFirst({
        where: {
            student_id: studentId,
            academic_year_id: yearId
        },
        include: {
            student: {
                include: {
                    interview_marks: true
                }
            },
            class: true,
            sub_class: true
        }
    });

    if (!enrollment) {
        return null;
    }

    const hasInterview = enrollment.student.interview_marks.length > 0;
    const hasSubclassAssignment = enrollment.sub_class_id !== null;

    let workflowStep = 'registered';
    if (hasInterview && hasSubclassAssignment) {
        workflowStep = 'completed';
    } else if (hasInterview) {
        workflowStep = 'interviewed';
    }

    return {
        student_id: enrollment.student.id,
        student_name: enrollment.student.name,
        matricule: enrollment.student.matricule,
        status: enrollment.student.status,
        workflow_step: workflowStep,
        enrollment_date: enrollment.enrollment_date,
        class: enrollment.class,
        sub_class: enrollment.sub_class,
        interview_info: hasInterview ? {
            score: enrollment.student.interview_marks[0].marks,
            comments: enrollment.student.interview_marks[0].notes,
            interview_date: enrollment.student.interview_marks[0].created_at,
            interviewer_id: enrollment.student.interview_marks[0].vp_id
        } : null,
        next_step: hasSubclassAssignment ? 'Enrollment Complete' : hasInterview ? 'Awaiting Subclass Assignment' : 'Awaiting Interview'
    };
} 