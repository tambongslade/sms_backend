// src/api/v1/services/markEntryService.ts
//
// Whole-class mark entry for one (exam sequence, subclass, subject).
// The teacher "Submit Marks" screen loads the full roster with any marks
// already saved, and saves every changed row in one request.
//
// Marks are keyed by enrollment (not student) and by SubClassSubject, so both
// the read and the write resolve those from the exam sequence's academic year.

import prisma from '../../../config/db';
import { calculateAndSaveStudentAverages } from './studentAverageService';

export const MIN_SCORE = 0;
export const MAX_SCORE = 20;

export class MarkEntryError extends Error {
    constructor(public status: number, message: string, public details?: any) {
        super(message);
    }
}

async function resolveContext(examSequenceId: number, subClassId: number, subjectId: number) {
    const sequence = await prisma.examSequence.findUnique({
        where: { id: examSequenceId },
        include: { term: { select: { id: true, name: true } } },
    });
    if (!sequence) throw new MarkEntryError(404, `Exam sequence ${examSequenceId} not found`);

    const subClassSubject = await prisma.subClassSubject.findUnique({
        where: { sub_class_id_subject_id: { sub_class_id: subClassId, subject_id: subjectId } },
        include: { subject: { select: { id: true, name: true } }, sub_class: { include: { class: { select: { id: true, name: true } } } } },
    });
    if (!subClassSubject) {
        throw new MarkEntryError(404, 'This subject is not taught in the selected class');
    }
    return { sequence, subClassSubject };
}

function windowState(sequence: { status: string; submission_deadline: Date | null }) {
    if (sequence.status !== 'OPEN') {
        return { is_open: false, closed_reason: 'Mark submission is closed for this exam sequence.' };
    }
    if (sequence.submission_deadline && new Date() > new Date(sequence.submission_deadline)) {
        return {
            is_open: false,
            closed_reason: `Mark submission deadline has passed (${new Date(sequence.submission_deadline).toLocaleDateString()}).`,
        };
    }
    return { is_open: true, closed_reason: null as string | null };
}

/**
 * Full roster of a subclass for one exam sequence + subject, with the saved mark
 * (if any) on each row. Withdrawn students are left out. Sorted by name.
 */
export async function getEntrySheet(examSequenceId: number, subClassId: number, subjectId: number) {
    const { sequence, subClassSubject } = await resolveContext(examSequenceId, subClassId, subjectId);

    const enrollments = await prisma.enrollment.findMany({
        where: {
            sub_class_id: subClassId,
            academic_year_id: sequence.academic_year_id,
            student: { status: { not: 'WITHDRAWN' } },
        },
        select: {
            id: true,
            student: { select: { id: true, name: true, matricule: true } },
        },
    });

    const marks = enrollments.length
        ? await prisma.mark.findMany({
            where: {
                exam_sequence_id: examSequenceId,
                sub_class_subject_id: subClassSubject.id,
                enrollment_id: { in: enrollments.map(e => e.id) },
            },
            select: { id: true, enrollment_id: true, score: true, updated_at: true },
        })
        : [];
    const markByEnrollment = new Map(marks.map(m => [m.enrollment_id, m]));

    const students = enrollments
        .map(e => {
            const m = markByEnrollment.get(e.id);
            return {
                student_id: e.student.id,
                enrollment_id: e.id,
                name: e.student.name,
                matricule: e.student.matricule,
                mark_id: m?.id ?? null,
                score: m?.score ?? null,
                updated_at: m?.updated_at ?? null,
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    const { is_open, closed_reason } = windowState(sequence);

    return {
        exam_sequence: {
            id: sequence.id,
            sequence_number: sequence.sequence_number,
            term_name: sequence.term?.name ?? null,
            academic_year_id: sequence.academic_year_id,
            status: sequence.status,
            submission_deadline: sequence.submission_deadline,
            is_open,
            closed_reason,
        },
        sub_class: {
            id: subClassSubject.sub_class.id,
            name: subClassSubject.sub_class.name,
            class_name: subClassSubject.sub_class.class.name,
        },
        subject: subClassSubject.subject,
        coefficient: subClassSubject.coefficient,
        min_score: MIN_SCORE,
        max_score: MAX_SCORE,
        total_students: students.length,
        marked_count: students.filter(s => s.score !== null).length,
        students,
    };
}

/**
 * Save several marks for one (sequence, subclass, subject) in a single transaction.
 * `score: null` clears (deletes) a saved mark. All rows are validated before
 * anything is written: one invalid score rejects the whole request.
 */
export async function saveEntrySheet(params: {
    exam_sequence_id: number;
    sub_class_id: number;
    subject_id: number;
    teacher_id: number;
    marks: { student_id: number; score: number | null }[];
}) {
    const { sequence, subClassSubject } = await resolveContext(params.exam_sequence_id, params.sub_class_id, params.subject_id);

    const { is_open, closed_reason } = windowState(sequence);
    if (!is_open) throw new MarkEntryError(403, closed_reason!);

    if (!Array.isArray(params.marks) || params.marks.length === 0) {
        throw new MarkEntryError(400, 'marks must be a non-empty array');
    }

    const invalid: { student_id: any; score: any; reason: string }[] = [];
    const seen = new Set<number>();
    for (const row of params.marks) {
        const sid = Number(row?.student_id);
        if (!Number.isInteger(sid)) {
            invalid.push({ student_id: row?.student_id, score: row?.score, reason: 'Invalid studentId' });
            continue;
        }
        if (seen.has(sid)) {
            invalid.push({ student_id: sid, score: row.score, reason: 'Duplicate studentId' });
            continue;
        }
        seen.add(sid);
        if (row.score === null || row.score === undefined) continue;
        const score = Number(row.score);
        if (typeof row.score === 'boolean' || !Number.isFinite(score) || score < MIN_SCORE || score > MAX_SCORE) {
            invalid.push({ student_id: sid, score: row.score, reason: `Mark must be between ${MIN_SCORE} and ${MAX_SCORE}` });
        }
    }
    if (invalid.length) {
        throw new MarkEntryError(400, `${invalid.length} mark(s) are invalid. Marks must be between ${MIN_SCORE} and ${MAX_SCORE}.`, invalid);
    }

    const enrollments = await prisma.enrollment.findMany({
        where: {
            student_id: { in: [...seen] },
            sub_class_id: params.sub_class_id,
            academic_year_id: sequence.academic_year_id,
        },
        select: { id: true, student_id: true },
    });
    const enrollmentByStudent = new Map(enrollments.map(e => [e.student_id, e.id]));
    const notInClass = [...seen].filter(sid => !enrollmentByStudent.has(sid));
    if (notInClass.length) {
        throw new MarkEntryError(
            400,
            `${notInClass.length} student(s) are not enrolled in this class for the exam's academic year`,
            notInClass.map(sid => ({ student_id: sid, reason: 'Not enrolled in this class' })),
        );
    }

    const ops: any[] = [];
    let saved = 0;
    let cleared = 0;
    for (const row of params.marks) {
        const enrollment_id = enrollmentByStudent.get(Number(row.student_id))!;
        const key = {
            exam_sequence_id: params.exam_sequence_id,
            enrollment_id,
            sub_class_subject_id: subClassSubject.id,
        };
        if (row.score === null || row.score === undefined) {
            ops.push(prisma.mark.deleteMany({ where: key }));
            cleared++;
        } else {
            const score = Number(row.score);
            ops.push(prisma.mark.upsert({
                where: { exam_sequence_id_enrollment_id_sub_class_subject_id: key },
                update: { score, teacher_id: params.teacher_id },
                create: { ...key, score, teacher_id: params.teacher_id },
            }));
            saved++;
        }
    }
    await prisma.$transaction(ops);

    // Keep the stored sequence averages/ranks (parent portal, dashboards) in step
    // with the marks. Non-fatal: the marks are saved either way.
    try {
        await calculateAndSaveStudentAverages(params.exam_sequence_id, params.sub_class_id);
    } catch (e: any) {
        console.warn(`[markEntry] averages refresh failed for sequence ${params.exam_sequence_id}, subclass ${params.sub_class_id}: ${e?.message}`);
    }

    const sheet = await getEntrySheet(params.exam_sequence_id, params.sub_class_id, params.subject_id);
    return { saved_count: saved, cleared_count: cleared, sheet };
}
