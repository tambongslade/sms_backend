import prisma, { AverageStatus } from '../../../config/db';
import { getSequenceResults } from './resultsService';

/**
 * Calculate and save student averages for a specific exam sequence.
 * Uses resultsService (same numbers as the Results screen and report cards):
 * weighted by coefficient, subjects without a mark excluded, ranked within
 * the subclass, students without any mark not stored/ranked.
 * @param examSequenceId The ID of the exam sequence
 * @param sub_classId Optional sub_class ID; all subclasses of the year otherwise
 */
export const calculateAndSaveStudentAverages = async (
    examSequenceId: number,
    sub_classId?: number
) => {
    try {
        const examSequence = await prisma.examSequence.findUnique({
            where: { id: examSequenceId },
            select: { id: true, academic_year_id: true },
        });
        if (!examSequence) {
            throw new Error(`Exam sequence with ID ${examSequenceId} not found`);
        }

        const subClassIds = sub_classId
            ? [sub_classId]
            : (await prisma.enrollment.findMany({
                where: {
                    academic_year_id: examSequence.academic_year_id,
                    sub_class_id: { not: null },
                    student: { status: { not: 'WITHDRAWN' } },
                },
                distinct: ['sub_class_id'],
                select: { sub_class_id: true },
            })).map(e => e.sub_class_id!) ;

        if (subClassIds.length === 0) {
            throw new Error('No enrollments found for the given criteria');
        }

        const saved: any[] = [];
        for (const scId of subClassIds) {
            const results = await getSequenceResults(scId, examSequenceId);
            const ranked = results.students.filter(st => st.average !== null);
            const unranked = results.students.filter(st => st.average === null).map(st => st.enrollment_id);

            // A student whose marks were all removed must not keep a stale average.
            if (unranked.length) {
                await prisma.studentSequenceAverage.deleteMany({
                    where: { exam_sequence_id: examSequenceId, enrollment_id: { in: unranked } },
                });
            }
            for (const st of ranked) {
                saved.push(await prisma.studentSequenceAverage.upsert({
                    where: {
                        enrollment_id_exam_sequence_id: {
                            enrollment_id: st.enrollment_id,
                            exam_sequence_id: examSequenceId,
                        },
                    },
                    update: {
                        average: st.average!,
                        rank: st.rank,
                        total_students: ranked.length,
                        status: AverageStatus.VERIFIED,
                    },
                    create: {
                        enrollment_id: st.enrollment_id,
                        exam_sequence_id: examSequenceId,
                        average: st.average!,
                        rank: st.rank,
                        total_students: ranked.length,
                        status: AverageStatus.VERIFIED,
                    },
                }));
            }
        }
        return saved;
    } catch (error) {
        console.error('Error calculating student averages:', error);
        throw error;
    }
};

/**
 * Re-rank stored averages for a sequence. Ranks are always within a subclass
 * (ties share a rank). Kept for callers of the old API.
 */
export const updateRankings = async (examSequenceId: number, sub_classId?: number) => {
    try {
        const averages = await prisma.studentSequenceAverage.findMany({
            where: {
                exam_sequence_id: examSequenceId,
                enrollment: {
                    student: { status: { not: 'WITHDRAWN' } },
                    ...(sub_classId ? { sub_class_id: sub_classId } : {}),
                },
            },
            include: { enrollment: { select: { sub_class_id: true } } },
        });
        const bySubClass = new Map<number | null, typeof averages>();
        for (const a of averages) {
            const k = a.enrollment.sub_class_id;
            if (!bySubClass.has(k)) bySubClass.set(k, []);
            bySubClass.get(k)!.push(a);
        }
        const updates: Promise<any>[] = [];
        for (const group of bySubClass.values()) {
            group.sort((x, y) => y.average - x.average);
            let prevAvg: number | null = null;
            let prevRank = 0;
            group.forEach((avg, i) => {
                const rank = prevAvg !== null && Math.abs(avg.average - prevAvg) < 1e-9 ? prevRank : i + 1;
                prevAvg = avg.average;
                prevRank = rank;
                updates.push(prisma.studentSequenceAverage.update({
                    where: { id: avg.id },
                    data: { rank, total_students: group.length, status: AverageStatus.VERIFIED },
                }));
            });
        }
        return Promise.all(updates);
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