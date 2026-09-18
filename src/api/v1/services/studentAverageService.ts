import prisma, { AverageStatus } from '../../../config/db';

/**
 * Calculate and save student averages for a specific exam sequence
 * @param examSequenceId The ID of the exam sequence
 * @param sub_classId Optional sub_class ID to filter students
 */
export const calculateAndSaveStudentAverages = async (
    examSequenceId: number,
    sub_classId?: number
) => {
    try {
        // Get the exam sequence to verify it exists
        const examSequence = await prisma.examSequence.findUnique({
            where: { id: examSequenceId },
            include: {
                academic_year: true,
                term: true,
            },
        });

        if (!examSequence) {
            throw new Error(`Exam sequence with ID ${examSequenceId} not found`);
        }

        // Get all enrollments for the academic year, optionally filtered by sub_class
        const enrollmentQuery: any = {
            academic_year_id: examSequence.academic_year_id,
            student: { status: { not: 'WITHDRAWN' } },
        };

        if (sub_classId) {
            enrollmentQuery.sub_class_id = sub_classId;
        }

        const enrollments = await prisma.enrollment.findMany({
            where: enrollmentQuery,
            include: {
                student: true,
                sub_class: true,
            },
        });

        if (enrollments.length === 0) {
            throw new Error('No enrollments found for the given criteria');
        }

        // For each enrollment, calculate average and save
        const averagePromises = enrollments.map(async (enrollment) => {
            // Get all marks for this enrollment and exam sequence
            const marks = await prisma.mark.findMany({
                where: {
                    enrollment_id: enrollment.id,
                    exam_sequence_id: examSequenceId,
                },
                include: {
                    sub_class_subject: true,
                },
            });

            if (marks.length === 0) {
                return null; // Skip if no marks
            }

            // Calculate weighted average
            let totalWeightedScore = 0;
            let totalCoefficient = 0;

            marks.forEach((mark) => {
                totalWeightedScore += mark.score ?? 0 * mark.sub_class_subject.coefficient;
                totalCoefficient += mark.sub_class_subject.coefficient;
            });

            // If no coefficients, skip
            if (totalCoefficient === 0) {
                return null;
            }

            const average = parseFloat((totalWeightedScore / totalCoefficient).toFixed(2));

            // Check if an average entry already exists
            const existingAverage = await prisma.studentSequenceAverage.findUnique({
                where: {
                    enrollment_id_exam_sequence_id: {
                        enrollment_id: enrollment.id,
                        exam_sequence_id: examSequenceId,
                    },
                },
            });

            if (existingAverage) {
                // Update existing record
                return prisma.studentSequenceAverage.update({
                    where: { id: existingAverage.id },
                    data: {
                        average,
                        status: AverageStatus.CALCULATED,
                    },
                });
            } else {
                // Create new record
                return prisma.studentSequenceAverage.create({
                    data: {
                        enrollment_id: enrollment.id,
                        exam_sequence_id: examSequenceId,
                        average,
                        status: AverageStatus.CALCULATED,
                    },
                });
            }
        });

        // Filter out null results (students with no marks)
        const averageResults = (await Promise.all(averagePromises)).filter(Boolean);

        // Calculate and update rankings
        if (averageResults.length > 0) {
            await updateRankings(examSequenceId, sub_classId);
        }

        return averageResults;
    } catch (error) {
        console.error('Error calculating student averages:', error);
        throw error;
    }
};

/**
 * Update rankings for all students in a sequence (optionally filtered by sub_class)
 * @param examSequenceId The ID of the exam sequence
 * @param sub_classId Optional sub_class ID to filter students
 */
export const updateRankings = async (examSequenceId: number, sub_classId?: number) => {
    try {
        // Get all enrollments for the sub_class (if specified)
        let enrollmentFilter: any = {};

        if (sub_classId) {
            // Get all averages for students in this sub_class
            const enrollments = await prisma.enrollment.findMany({
                where: { sub_class_id: sub_classId, student: { status: { not: 'WITHDRAWN' } } },
                select: { id: true },
            });

            enrollmentFilter = {
                enrollment_id: { in: enrollments.map(e => e.id) },
            };
        }

        // Get all averages for this exam sequence
        const averages = await prisma.studentSequenceAverage.findMany({
            where: {
                exam_sequence_id: examSequenceId,
                ...enrollmentFilter,
            },
            orderBy: {
                average: 'desc',
            },
            include: {
                enrollment: true,
            },
        });

        // Update rankings
        const totalStudents = averages.length;
        const updatePromises = averages.map((avg, index) => {
            return prisma.studentSequenceAverage.update({
                where: { id: avg.id },
                data: {
                    rank: index + 1, // Ranking starts from 1
                    total_students: totalStudents,
                    status: AverageStatus.VERIFIED,
                },
            });
        });

        return Promise.all(updatePromises);
    } catch (error) {
        console.error('Error updating rankings:', error);
        throw error;
    }
};

/**
 * Get student average by enrollment ID and exam sequence ID
 */
export const getStudentAverage = async (enrollmentId: number, examSequenceId: number) => {
    return prisma.studentSequenceAverage.findUnique({
        where: {
            enrollment_id_exam_sequence_id: {
                enrollment_id: enrollmentId,
                exam_sequence_id: examSequenceId,
            },
        },
        include: {
            enrollment: {
                include: {
                    student: true,
                    sub_class: {
                        include: {
                            class: true,
                        },
                    },
                },
            },
            exam_sequence: {
                include: {
                    term: true,
                    academic_year: true,
                },
            },
        },
    });
};

/**
 * Get all student averages for a specific exam sequence
 * @param examSequenceId The ID of the exam sequence
 * @param sub_classId Optional sub_class ID to filter students
 */
export const getStudentAverages = async (examSequenceId: number, sub_classId?: number) => {
    let whereClause: any = {
        exam_sequence_id: examSequenceId,
    };

    if (sub_classId) {
        // Get enrollments for this sub_class
        const enrollments = await prisma.enrollment.findMany({
            where: { sub_class_id: sub_classId, student: { status: { not: 'WITHDRAWN' } } },
            select: { id: true },
        });

        whereClause.enrollment_id = {
            in: enrollments.map(e => e.id),
        };
    }

    return prisma.studentSequenceAverage.findMany({
        where: whereClause,
        orderBy: {
            rank: 'asc',
        },
        include: {
            enrollment: {
                include: {
                    student: true,
                    sub_class: {
                        include: {
                            class: true,
                        },
                    },
                },
            },
            exam_sequence: {
                include: {
                    term: true,
                    academic_year: true,
                },
            },
        },
    });
};

/**
 * Update decision for a student average
 */
export const updateDecision = async (id: number, decision: string) => {
    return prisma.studentSequenceAverage.update({
        where: { id },
        data: { decision },
    });
}; 