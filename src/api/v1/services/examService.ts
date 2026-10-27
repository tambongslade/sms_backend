// src/api/v1/services/examService.ts

import prisma, { ExamPaper, ExamPaperQuestion, Mark, ExamSequence, ExamSequenceStatus, ReportType, ReportStatus } from '../../../config/db';
import { getAcademicYearId, getStudentSubclassByStudentAndYear } from '../../../utils/academicYear';
import { paginate, PaginationOptions, FilterOptions, PaginatedResult } from '../../../utils/pagination';
import * as puppeteer from 'puppeteer';
import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import * as StudentAverageService from './studentAverageService';
import getPuppeteerConfig from '../../../utils/puppeteer.config';
import * as PuppeteerManager from '../../../utils/puppeteerManager';
import { reportGenerationQueue } from '../../../config/queue';
import * as reportSequelizeService from './reportSequelizeService';
import moment from 'moment';
import * as photoUtils from '../../../utils/photoUtils';
import * as reportCardService from './reportCardService';
import { ResultsError } from './resultsService';

export async function createExamPaper(data: {
    name: string;
    subject_id: number;
    academic_year_id?: number;
    exam_date: string;
    duration: number;
}): Promise<ExamPaper> {
    // Get current academic year if not provided
    if (!data.academic_year_id) {
        data.academic_year_id = await getAcademicYearId() || undefined;
        if (!data.academic_year_id) {
            throw new Error("No academic year found and none provided");
        }
    }

    return prisma.examPaper.create({
        data: {
            name: data.name,
            subject_id: data.subject_id,
            academic_year_id: data.academic_year_id,
            exam_date: new Date(data.exam_date),
            duration: data.duration, // Use regular number since schema is now Int
        },
    });
}

/**
 * Creates an exam sequence (evaluation period)
 * This was previously named createExam but mistakenly created an exam paper
 */
export async function createExam(data: {
    sequence_number: number;
    term_id: number;
    academic_year_id?: number;
    start_date?: string;
    end_date?: string;
}): Promise<ExamSequence> {
    // Get current academic year if not provided
    if (!data.academic_year_id) {
        data.academic_year_id = await getAcademicYearId() || undefined;
        if (!data.academic_year_id) {
            throw new Error("No academic year found and none provided");
        }
    }

    return prisma.examSequence.create({
        data: {
            sequence_number: data.sequence_number,
            term_id: data.term_id,
            academic_year_id: data.academic_year_id,
            // start_date: data.start_date ? new Date(data.start_date) : undefined,
            // end_date: data.end_date ? new Date(data.end_date) : undefined,
        },
    });
}

export async function updateExam(
    id: number,
    data: {
        sequence_number?: number;
        term_id?: number;
        start_date?: string;
        end_date?: string;
    }
): Promise<ExamSequence> {
    return prisma.examSequence.update({
        where: { id },
        data: {
            ...(data.sequence_number !== undefined && { sequence_number: data.sequence_number }),
            ...(data.term_id !== undefined && { term_id: data.term_id }),
        },
    });
}

export async function addQuestionsToExam(exam_paper_id: number, data: { question_id: number; order?: number }[]): Promise<ExamPaperQuestion[]> {
    const questionLinks = [];
    for (const q of data) {
        const questionLink = await prisma.examPaperQuestion.create({
            data: {
                exam_paper_id,
                question_id: q.question_id,
                order: q.order,
            },
        });
        questionLinks.push(questionLink);
    }
    return questionLinks;
}

export async function generateExam(exam_paper_id: number): Promise<any> {
    // Add logic for generating exam papers (randomizing questions, etc.)
    return { message: `Exam ${exam_paper_id} generated` };
}

export async function enterExamMarks(data: {
    enrollment_id?: number;
    student_id?: number;
    sub_class_subject_id: number;
    exam_sequence_id: number;
    score: number;
    teacher_id: number;
    academic_year_id?: number;
}): Promise<Mark> {
    // Handle the case where student_id is provided instead of enrollment_id
    if (data.student_id && !data.enrollment_id) {
        // Fetch current academic year ID if not provided
        const yearId = data.academic_year_id ?? await getAcademicYearId();
        if (!yearId) {
            throw new Error("Academic year ID is required to find enrollment by student ID, but none was provided or found.");
        }

        const enrollment = await getStudentSubclassByStudentAndYear(
            data.student_id,
            yearId // Use the determined yearId
        );

        if (!enrollment) {
            throw new Error(`Student with ID ${data.student_id} is not enrolled in the specified academic year (${yearId})`);
        }

        data.enrollment_id = enrollment.id;
    }

    // Ensure enrollment_id is present before creating the mark
    if (!data.enrollment_id) {
        throw new Error("Enrollment ID is required to enter marks.");
    }


    return prisma.mark.create({
        data: {
            enrollment_id: data.enrollment_id,
            sub_class_subject_id: data.sub_class_subject_id,
            exam_sequence_id: data.exam_sequence_id,
            score: data.score,
            teacher_id: data.teacher_id, // Keep using teacher_id for create operations
        },
    });
}

export async function generateReportCards(academicYearId?: number): Promise<any> {
    // Get current academic year if not provided
    const yearId = await getAcademicYearId(academicYearId);

    // Use yearId in your report card generation logic

    // Implement logic for generating report cards (PDF, Excel)
    return { message: 'Report cards generated', academicYearId: yearId };
}

// Get all marks with pagination and filtering
export async function getAllMarks(
    paginationOptions?: PaginationOptions,
    filterOptions?: FilterOptions,
    academicYearId?: number
): Promise<PaginatedResult<Mark>> {
    const yearId = await getAcademicYearId(academicYearId);

    const where: any = {};
    const processedFilters: any = { ...filterOptions };
    let enrollmentFilter: any = {}; // Separate filter for enrollment relation
    let include: any = { // Define base includes
        // Always include enrollment relation to get student_id
        enrollment: {
            select: { student_id: true }
        }
    };

    // Build where clause based on filters
    for (const key in processedFilters) {
        const value = processedFilters[key];
        if (value === undefined || value === null || value === '') continue;

        if (key === 'student_id') {
            const studentId = parseInt(value as string);
            if (!isNaN(studentId)) {
                enrollmentFilter.student_id = studentId;
            }
        } else if (key === 'class_id') {
            const classId = parseInt(value as string);
            if (!isNaN(classId)) {
                enrollmentFilter.sub_class = { ...(enrollmentFilter.sub_class || {}), class_id: classId };
            }
        } else if (key === 'sub_class_id' || key === 'sub_class_id') {
            // Handle both sub_class_id and sub_class_id (from camelCase subClassId)
            const sub_classId = parseInt(value as string);
            if (!isNaN(sub_classId)) {
                enrollmentFilter.sub_class_id = sub_classId;
            }
        } else if (key === 'subject_id') {
            const subjectId = parseInt(value as string);
            if (!isNaN(subjectId)) {
                where.sub_class_subject = { subject_id: subjectId };
            }
        } else if (key === 'exam_sequence_id') {
            const examSequenceId = parseInt(value as string);
            if (!isNaN(examSequenceId)) {
                where.exam_sequence_id = examSequenceId;
            }
        } else if (key === 'minScore' || key === 'maxScore') {
            const score = parseFloat(value as string);
            if (!isNaN(score)) {
                where.score = {
                    ...(where.score || {}),
                    [key === 'minScore' ? 'gte' : 'lte']: score
                };
            }
        } else if (key.startsWith('include_')) {
            // Handle includes
            if (value === 'true') {
                if (key === 'include_student') {
                    include.enrollment = {
                        ...(include.enrollment || {}),
                        // If selecting student_id, also include full student + sub_class/class
                        select: undefined, // Remove select if we need full include
                        include: {
                            student: true,
                            sub_class: { include: { class: true } }
                        }
                    };
                } else if (key === 'include_subject') {
                    include.sub_class_subject = { include: { subject: true } };
                } else if (key === 'include_teacher') {
                    include.teacher = true;
                } else if (key === 'include_exam_sequence') {
                    include.exam_sequence = { include: { term: true } };
                }
            }
        }
    }

    // Add debugging
    console.log('--- getAllMarks Debug ---');
    console.log('Received filterOptions:', filterOptions);
    console.log('Converted key check - sub_class_id exists:', 'sub_class_id' in processedFilters);
    console.log('Converted key check - sub_class_id exists:', 'sub_class_id' in processedFilters);
    console.log('Received academicYearId:', academicYearId);
    console.log('Determined yearId:', yearId);

    // Apply enrollment filters if any were added
    if (Object.keys(enrollmentFilter).length > 0) {
        if (yearId) {
            enrollmentFilter.academic_year_id = yearId; // Add academic year to enrollment filter
        }
        where.enrollment = enrollmentFilter;
    } else if (yearId) {
        // If no other enrollment filters but year is specified, filter by year
        where.enrollment = { academic_year_id: yearId };
    }

    console.log('Constructed Prisma Where Clause:', JSON.stringify(where, null, 2));
    console.log('Constructed Prisma Include Clause:', JSON.stringify(include, null, 2));

    return paginate<Mark>(
        prisma.mark,
        paginationOptions,
        where,
        include
    );
}

// Get all exam papers with pagination and filtering
export async function getAllExamPapers(
    paginationOptions?: PaginationOptions,
    filterOptions?: FilterOptions,
    academicYearId?: number
): Promise<PaginatedResult<ExamPaper>> {
    // Get current academic year ID if not explicitly provided
    const yearId = await getAcademicYearId(academicYearId);

    // Initialize where clause
    const where: any = {};

    // Add academic year filter if available
    if (yearId) {
        where.academic_year_id = yearId;
    }

    // Process other filters provided in filterOptions
    if (filterOptions) {
        if (filterOptions.subject_id) {
            where.subject_id = parseInt(filterOptions.subject_id as string);
        }
        if (filterOptions.name) {
            where.name = {
                contains: filterOptions.name,
                mode: 'insensitive'
            };
        }
        // Add other potential filters from filterOptions here
    }

    // Setup includes based on filterOptions. The question count is always
    // returned (_count.questions) so lists can show it without loading questions.
    const include: any = { _count: { select: { questions: true } } };
    if (filterOptions?.include_subject === 'true') {
        include.subject = true;
    }
    if (filterOptions?.include_questions === 'true') {
        include.questions = {
            include: {
                question: true
            }
        };
    }

    // Use the processed filters in the paginate function
    return paginate<ExamPaper>(
        prisma.examPaper,
        paginationOptions,
        where, // Use the constructed where clause
        include // Use constructed includes
    );
}

// Get a specific exam paper with its questions
export async function getExamPaperWithQuestions(examPaperId: number): Promise<ExamPaper | null> {
    // Use a dynamically built include object to avoid type checking issues
    const include: any = {
        subject: true,
        academic_year: true
    };

    // Use the correct relation name 'questions' as defined in the Prisma schema
    include['questions'] = {
        include: { question: true },
        orderBy: { order: 'asc' }
    };

    return prisma.examPaper.findUnique({
        where: { id: examPaperId },
        include
    });
}

// Report card interfaces
interface SubjectData {
    category: string;
    name: string;
    coefficient: number;
    mark: number;
    weightedMark: number;
    rank: string;
    teacher: string;
    min: number;
    avg: number;
    max: number;
    successRate: number;
    grade: string;
}

interface CategorySummary {
    category: string;
    totalMark: number;
    totalCoef: number;
    totalWeightedMark: number;
    categoryAverage: number;
    categoryGrade: string;
    categoryMin: number;
    categoryMax: number;
    categoryAvg: number;
    categorySuccessRate: number;
    categoryRank: string;
}

interface ReportData {
    student: {
        name: string;
        matricule: string;
        dateOfBirth: string;
        placeOfBirth: string;
        gender: string;
        repeater: boolean;
        photo: string;
    };
    classInfo: {
        className: string;
        enrolledStudents: number;
        classMaster: string;
        academicYear: string;
    };
    subjects: SubjectData[];
    categorySummaries: CategorySummary[];
    categories: string[];
    totals: {
        totalMark: number;
        totalCoef: number;
        totalWeightedMark: number;
        overallAverage: number;
        overallGrade: string;
    };
    statistics: {
        overallAverage: string;
        rank: string;
        subjectsPassed: number;
        classStats: {
            lowestAverage: string;
            highestAverage: string;
            successRate: number;
            standardDeviation: string;
            classAverage: string;
        };
    };
    examSequence?: {
        name: string;
        sequenceNumber: number;
        termName: string;
    };
}

// Define the parameter type for generateReportCard
interface ReportCardParams {
    academicYearId: number;
    examSequenceId: number;
    sub_classId?: number;
    studentId?: number;
}

/**
 * Generates a report card PDF for a student or all students in a sub_class
 * @param params Configuration parameters for report card generation
 * @returns Path to the generated PDF file
 */
export async function generateReportCard(params: ReportCardParams): Promise<string> {
    const { academicYearId, examSequenceId, sub_classId, studentId } = params;

    // Validate that either sub_classId or studentId is provided
    if (!sub_classId && !studentId) {
        throw new Error('Either sub_classId or studentId must be provided');
    }

    // Get the exam sequence information
    const examSequence = await prisma.examSequence.findUnique({
        where: { id: examSequenceId },
        include: { term: true }
    });

    if (!examSequence) {
        throw new Error('Exam sequence not found');
    }

    let filePath: string;
    if (studentId) {
        filePath = await generateSingleReportCard(studentId, academicYearId, examSequenceId, examSequence);
        // Update or create GeneratedReport for student
        const existing = await prisma.generatedReport.findFirst({
            where: {
                report_type: ReportType.SINGLE_STUDENT,
                exam_sequence_id: examSequenceId,
                academic_year_id: academicYearId,
                student_id: studentId
            }
        });
        if (existing) {
            await prisma.generatedReport.update({
                where: { id: existing.id },
                data: {
                    status: ReportStatus.COMPLETED,
                    file_path: filePath,
                    error_message: null
                }
            });
        } else {
            await prisma.generatedReport.create({
                data: {
                    report_type: ReportType.SINGLE_STUDENT,
                    exam_sequence_id: examSequenceId,
                    academic_year_id: academicYearId,
                    student_id: studentId,
                    status: ReportStatus.COMPLETED,
                    file_path: filePath
                }
            });
        }
        return filePath;
    }

    if (sub_classId) {
        filePath = await generateSubclassReportCards(sub_classId, academicYearId, examSequenceId, examSequence);
        // Update or create GeneratedReport for subclass
        const existing = await prisma.generatedReport.findFirst({
            where: {
                report_type: ReportType.SUBCLASS,
                exam_sequence_id: examSequenceId,
                academic_year_id: academicYearId,
                sub_class_id: sub_classId
            }
        });
        if (existing) {
            await prisma.generatedReport.update({
                where: { id: existing.id },
                data: {
                    status: ReportStatus.COMPLETED,
                    file_path: filePath,
                    error_message: null
                }
            });
        } else {
            await prisma.generatedReport.create({
                data: {
                    report_type: ReportType.SUBCLASS,
                    exam_sequence_id: examSequenceId,
                    academic_year_id: academicYearId,
                    sub_class_id: sub_classId,
                    status: ReportStatus.COMPLETED,
                    file_path: filePath
                }
            });
        }
        return filePath;
    }

    throw new Error('Failed to generate report card');
}

/**
 * Generates a report card for a single student (shared resultsService numbers).
 */
async function generateSingleReportCard(
    studentId: number,
    academicYearId: number,
    examSequenceId: number,
    examSequence: any
): Promise<string> {
    const subClassId = await reportCardService.studentSubClass(studentId, academicYearId);
    const { buffer } = await reportCardService.generateCards(
        subClassId,
        { kind: 'SEQUENCE', exam_sequence_id: examSequenceId },
        studentId
    );
    const filePath = path.join(process.cwd(), `src/reports/${studentId}-${academicYearId}-${examSequenceId}-report.pdf`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
    return filePath;
}

/**
 * Generates report cards for all students with marks in a sub_class.
 * Throws a 409 ResultsError when no marks have been entered for the sequence.
 */
async function generateSubclassReportCards(
    sub_classId: number,
    academicYearId: number,
    examSequenceId: number,
    examSequence: any
): Promise<string> {
    const filePath = path.join(__dirname, `../../../../reports/subclass_${sub_classId}_sequence_${examSequenceId}_report_cards.pdf`);
    const reportWhere = {
        sub_class_id: sub_classId,
        academic_year_id: academicYearId,
        exam_sequence_id: examSequenceId,
        report_type: ReportType.SUBCLASS
    };
    await prisma.generatedReport.updateMany({ where: reportWhere, data: { status: ReportStatus.PROCESSING } });
    try {
        const { buffer } = await reportCardService.generateCards(
            sub_classId,
            { kind: 'SEQUENCE', exam_sequence_id: examSequenceId }
        );
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, buffer);
        await prisma.generatedReport.updateMany({
            where: reportWhere,
            data: { status: ReportStatus.COMPLETED, file_path: filePath }
        });
        return filePath;
    } catch (error: any) {
        await prisma.generatedReport.updateMany({
            where: reportWhere,
            data: { status: ReportStatus.FAILED, error_message: error.message }
        });
        throw error;
    }
}

// Report card data/rendering lives in resultsService + reportCardService.

/**
 * Calculates the standard deviation of a set of numbers
 */
function calculateStandardDeviation(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const avg = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
    return Math.sqrt(numbers.map(n => Math.pow(n - avg, 2)).reduce((a, b) => a + b) / numbers.length);
}

/**
 * Determines the grade based on a mark
 */
function getGrade(mark: number): string {
    if (mark >= 18) return 'A+';
    if (mark >= 16) return 'A';
    if (mark >= 15) return 'B+';
    if (mark >= 14) return 'B';
    if (mark >= 12) return 'C+';
    if (mark >= 10) return 'C';
    return 'D';
}

/**
 * Get all exams with optional pagination and filtering
 */
export async function getAllExams(
    paginationOptions?: PaginationOptions,
    filterOptions?: FilterOptions
): Promise<PaginatedResult<ExamSequence>> {

    // Get current academic year ID if academic_year_id filter is not explicitly set
    let yearId = filterOptions?.academic_year_id ? parseInt(filterOptions.academic_year_id as string) : undefined;
    if (!yearId) {
        yearId = await getAcademicYearId() ?? undefined;
    }

    // Initialize where clause
    const where: any = {};

    // Add academic year filter if available
    if (yearId) {
        where.academic_year_id = yearId;
    }

    // Process other filters from filterOptions
    if (filterOptions) {
        if (filterOptions.term_id) {
            where.term_id = parseInt(filterOptions.term_id as string);
        }
        if (filterOptions.sequence_number) {
            where.sequence_number = parseInt(filterOptions.sequence_number as string);
        }
        // Remove academic_year_id from filterOptions as it's handled separately
        delete filterOptions.academic_year_id;
    }

    // Always include the term and year names: every screen that lists sequences
    // needs them to label and group the options.
    const include: any = {
        term: { select: { id: true, name: true, start_date: true } },
        academic_year: { select: { id: true, name: true } },
    };

    // Sequences are listed in teaching order (1..6) unless the caller asks otherwise.
    const options: PaginationOptions = { ...(paginationOptions || {}) };
    if (!options.sortBy) {
        options.sortBy = 'sequence_number';
        options.sortOrder = 'asc';
    }

    const result = await paginate<ExamSequence>(
        prisma.examSequence,
        options,
        where,
        include
    );
    result.data = (result.data as any[]).map(seq => ({
        ...seq,
        name: seq.name ?? `Sequence ${seq.sequence_number}`,
    })) as any;
    return result;
}

/**
 * Get a specific exam by its ID
 */
export async function getExamById(id: number): Promise<ExamSequence | null> {
    return prisma.examSequence.findUnique({
        where: { id },
        include: {
            term: true,
            academic_year: true,
            marks: {
                include: {
                    enrollment: {
                        include: {
                            student: true,
                            sub_class: true
                        }
                    },
                    sub_class_subject: {
                        include: {
                            subject: true
                        }
                    }
                }
            }
        }
    });
}

/**
 * Delete an exam by its ID
 */
export async function deleteExam(id: number): Promise<ExamSequence> {
    // First delete related marks
    await prisma.mark.deleteMany({
        where: { exam_sequence_id: id }
    });

    // Then delete the exam sequence
    return prisma.examSequence.delete({
        where: { id }
    });
}

/**
 * Create or update a mark (Upsert)
 */
export async function createMark(data: {
    exam_id: number;
    student_id: number;
    subject_id: number;
    mark: number;
    teacher_id: number;
}): Promise<Mark> {
    // Validate the mark score
    if (data.mark < 0 || data.mark > 20) {
        throw new Error('Mark must be between 0 and 20');
    }

    // 1. Find the ExamSequence to get the correct academic year and check submission status
    const examSequence = await prisma.examSequence.findUnique({
        where: { id: data.exam_id },
        select: { academic_year_id: true, status: true, submission_deadline: true }
    });

    if (!examSequence || !examSequence.academic_year_id) {
        throw new Error(`Exam sequence with ID ${data.exam_id} not found or has no associated academic year.`);
    }

    // Check if mark submission is allowed (status and deadline)
    if (examSequence.status !== 'OPEN') {
        throw new Error('Mark submission is closed for this exam sequence.');
    }
    if (examSequence.submission_deadline && new Date() > new Date(examSequence.submission_deadline)) {
        throw new Error(`Mark submission deadline has passed (${new Date(examSequence.submission_deadline).toLocaleDateString()}).`);
    }

    const academicYearId = examSequence.academic_year_id;

    // 2. Find the enrollment for this student IN THE CORRECT ACADEMIC YEAR
    const enrollment = await prisma.enrollment.findFirst({
        where: {
            student_id: data.student_id,
            academic_year_id: academicYearId
        },
        select: { id: true, sub_class_id: true } // Select only needed fields
    });

    if (!enrollment) {
        throw new Error(`Student enrollment not found for student ID ${data.student_id} in academic year ${academicYearId}`);
    }

    // 3. Find the sub_class_subject for this subject within the student's sub_class
    const sub_classSubject = await prisma.subClassSubject.findFirst({
        where: {
            subject_id: data.subject_id,
            sub_class_id: enrollment.sub_class_id
        },
        select: { id: true } // Select only the ID
    });

    if (!sub_classSubject) {
        throw new Error(`Subject ID ${data.subject_id} is not assigned to student's sub_class ID ${enrollment.sub_class_id}`);
    }

    // 4. Prepare data for create and update
    const markData = {
        exam_sequence_id: data.exam_id,
        enrollment_id: enrollment.id,
        sub_class_subject_id: sub_classSubject.id,
        teacher_id: data.teacher_id,
        score: data.mark
    };

    // 5. Use upsert to create or update the mark
    return prisma.mark.upsert({
        where: {
            exam_sequence_id_enrollment_id_sub_class_subject_id: {
                exam_sequence_id: data.exam_id,
                enrollment_id: enrollment.id,
                sub_class_subject_id: sub_classSubject.id
            }
        },
        update: { // Only update score and teacher_id on conflict
            score: data.mark,
            teacher_id: data.teacher_id
        },
        create: markData,
        include: { // Include relations in the response
            exam_sequence: true,
            enrollment: {
                include: {
                    student: true
                }
            },
            sub_class_subject: {
                include: {
                    subject: true
                }
            },
            teacher: true
        }
    });
}

/**
 * Update an existing mark
 */
export async function updateMark(
    id: number,
    data: { mark?: number; comment?: string; teacher_id?: number; }
): Promise<Mark> {
    // Validate the mark score if it's being updated
    if (data.mark !== undefined && (data.mark < 0 || data.mark > 20)) {
        throw new Error('Mark must be between 0 and 20');
    }

    // Check if mark submission is still allowed
    const existingMark = await prisma.mark.findUnique({
        where: { id },
        select: { exam_sequence: { select: { status: true, submission_deadline: true } } }
    });

    if (existingMark?.exam_sequence) {
        if (existingMark.exam_sequence.status !== 'OPEN') {
            throw new Error('Mark submission is closed for this exam sequence.');
        }
        if (existingMark.exam_sequence.submission_deadline && new Date() > new Date(existingMark.exam_sequence.submission_deadline)) {
            throw new Error(`Mark submission deadline has passed (${new Date(existingMark.exam_sequence.submission_deadline).toLocaleDateString()}).`);
        }
    }

    // Build the update data object
    const updateData: any = {};

    // Add score if provided
    if (data.mark !== undefined) {
        updateData.score = data.mark;
    }

    // Add teacher_id if provided
    if (data.teacher_id !== undefined) {
        updateData.teacher_id = data.teacher_id;
    }

    return prisma.mark.update({
        where: { id },
        data: updateData,
        include: {
            exam_sequence: true,
            enrollment: {
                include: {
                    student: true
                }
            },
            sub_class_subject: {
                include: {
                    subject: true
                }
            }
        }
    });
}

/**
 * Delete a mark
 */
export async function deleteMark(id: number): Promise<Mark> {
    return prisma.mark.delete({
        where: { id }
    });
}

/**
 * Updates the status of an ExamSequence and triggers report generation if finalized.
 */
export async function updateExamSequenceStatus(
    examSequenceId: number,
    newStatus: ExamSequenceStatus
): Promise<ExamSequence> {
    const examSequence = await prisma.examSequence.findUnique({
        where: { id: examSequenceId },
        include: { academic_year: true } // Needed for academic year context
    });

    if (!examSequence) {
        throw new Error(`Exam sequence with ID ${examSequenceId} not found`);
    }
    if (!examSequence.academic_year_id) {
        throw new Error(`Exam sequence ${examSequenceId} does not have an associated academic year.`);
    }

    // Report cards cannot be produced from an empty sequence: refuse to finalize
    // instead of flagging "reports available" with nothing behind it.
    if (newStatus === ExamSequenceStatus.FINALIZED || newStatus === ExamSequenceStatus.REPORTS_GENERATING) {
        const markCount = await prisma.mark.count({ where: { exam_sequence_id: examSequenceId, score: { not: null } } });
        if (markCount === 0) {
            throw new ResultsError(409, `No marks have been entered for Sequence ${examSequence.sequence_number}. Report cards cannot be generated yet.`);
        }
    }

    const updatedSequence = await prisma.examSequence.update({
        where: { id: examSequenceId },
        data: { status: newStatus },
    });

    // If the status is set to FINALIZED, trigger background report generation
    if (newStatus === ExamSequenceStatus.FINALIZED || newStatus === ExamSequenceStatus.REPORTS_GENERATING) {
        console.log(`Exam sequence ${examSequenceId} finalized. Triggering report generation...`);

        // Update status to REPORTS_GENERATING immediately
        await prisma.examSequence.update({
            where: { id: examSequenceId },
            data: { status: ExamSequenceStatus.REPORTS_GENERATING },
        });

        try {
            // Find all distinct sub_classes associated with marks in this sequence
            const marksInSequence = await prisma.mark.findMany({
                where: { exam_sequence_id: examSequenceId },
                distinct: ['enrollment_id'], // Get distinct enrollments first
                select: {
                    enrollment: {
                        select: {
                            id: true,
                            student_id: true,
                            sub_class_id: true,
                        }
                    }
                }
            });

            if (marksInSequence.length === 0) {
                console.warn(`No marks found for exam sequence ${examSequenceId}. Skipping report generation.`);
                // Optionally set status back or to FAILED/AVAILABLE immediately
                await prisma.examSequence.update({
                    where: { id: examSequenceId },
                    data: { status: ExamSequenceStatus.REPORTS_AVAILABLE }, // Or FAILED if appropriate
                });
                return updatedSequence; // Return the sequence updated to REPORTS_GENERATING
            }

            const enrollments = marksInSequence.map(m => m.enrollment).filter(e => e !== null) as {
                id: number;
                student_id: number;
                sub_class_id: number;
            }[];

            // --- REMOVE Queueing jobs for INDIVIDUAL student reports ---
            /*
            const individualJobPromises = enrollments.map(async (enrollment) => {
                // ... removed individual job queuing logic ...
            });
            */

            // --- Queue jobs ONLY for combined SUBCLASS reports ---
            const distinctSubClassIds = [...new Set(enrollments.map(e => e.sub_class_id))];
            console.log(`[${examSequenceId}] Found distinct subclasses for combined reports: ${distinctSubClassIds.join(', ')}`);

            const subclassJobPromises = distinctSubClassIds.map(async (subClassId) => {
                // Create or find existing GeneratedReport record for the subclass manually
                let reportRecord = await prisma.generatedReport.findFirst({
                    where: {
                        report_type: ReportType.SUBCLASS,
                        exam_sequence_id: examSequenceId,
                        academic_year_id: examSequence.academic_year_id!,
                        sub_class_id: subClassId,
                    }
                });

                if (reportRecord) {
                    // Update existing record if found (reset status)
                    reportRecord = await prisma.generatedReport.update({
                        where: { id: reportRecord.id },
                        data: { status: ReportStatus.PENDING, error_message: null, page_number: null, file_path: null } // Reset fields on retry
                    });
                } else {
                    // Create new record if not found
                    reportRecord = await prisma.generatedReport.create({
                        data: {
                            report_type: ReportType.SUBCLASS,
                            exam_sequence_id: examSequenceId,
                            academic_year_id: examSequence.academic_year_id!,
                            sub_class_id: subClassId,
                            status: ReportStatus.PENDING,
                        }
                    });
                }

                // Add job to the queue for the subclass
                const subclassJobName = `generate-subclass-report-subclass-${subClassId}-seq-${examSequenceId}`;
                const subclassJobId = `subclass-report-${reportRecord.id}`; // Unique job ID
                await reportGenerationQueue.add(subclassJobName, { // Used imported queue
                    generatedReportId: reportRecord.id, // ID of the SUBCLASS record
                    reportType: ReportType.SUBCLASS,
                    subClassId: subClassId,
                    academicYearId: examSequence.academic_year_id!,
                    examSequenceId: examSequenceId,
                }, { jobId: subclassJobId }); // Prevent duplicate jobs
                console.log(`[${examSequenceId}] Added combined report job (${subclassJobId}) for subclass ${subClassId}`);
            });

            // Wait for all subclass job additions to complete
            await Promise.all(subclassJobPromises);
            console.log(`[${examSequenceId}] All combined subclass report generation jobs added.`);

        } catch (error) {
            console.error(`Error triggering report generation jobs for sequence ${examSequenceId}:`, error);
            // Attempt to mark sequence as FAILED if job creation failed
            try {
                await prisma.examSequence.update({
                    where: { id: examSequenceId },
                    data: { status: ExamSequenceStatus.REPORTS_FAILED },
                });
            } catch (statusUpdateError) {
                console.error(`Failed to update sequence ${examSequenceId} status to REPORTS_FAILED:`, statusUpdateError);
            }
            // Re-throw the original error if needed
            // throw error;
        }
    }

    return updatedSequence;
}

export async function deleteExamPaper(id: number): Promise<ExamPaper> {
    // Check if exam paper exists
    const examPaper = await prisma.examPaper.findUnique({
        where: { id }
    });

    if (!examPaper) {
        throw new Error(`Exam paper with ID ${id} not found`);
    }

    // Unlink its questions first (the questions stay in the question bank),
    // otherwise the foreign key blocks deleting a paper that has questions.
    const [, deleted] = await prisma.$transaction([
        prisma.examPaperQuestion.deleteMany({ where: { exam_paper_id: id } }),
        prisma.examPaper.delete({ where: { id } }),
    ]);
    return deleted;
}

/**
 * Check report card availability for a student
 */
export async function checkStudentReportCardAvailability(
    studentId: number,
    academicYearId: number,
    examSequenceId: number
): Promise<{
    available: boolean;
    status: string;
    message: string;
    reportData?: any;
}> {
    try {
        // Check if the student exists and is enrolled for the academic year
        const enrollment = await prisma.enrollment.findFirst({
            where: {
                student_id: studentId,
                academic_year_id: academicYearId
            },
            include: {
                student: { select: { name: true, matricule: true } },
                sub_class: {
                    include: {
                        class: { select: { name: true } }
                    }
                }
            }
        });

        if (!enrollment) {
            return {
                available: false,
                status: 'NOT_ENROLLED',
                message: 'Student is not enrolled for the specified academic year'
            };
        }

        // Check if exam sequence exists
        const examSequence = await prisma.examSequence.findUnique({
            where: { id: examSequenceId },
            include: { term: true }
        });

        if (!examSequence) {
            return {
                available: false,
                status: 'SEQUENCE_NOT_FOUND',
                message: 'Exam sequence not found'
            };
        }

        // Check for generated report record
        const reportRecord = await prisma.generatedReport.findFirst({
            where: {
                report_type: ReportType.SINGLE_STUDENT,
                exam_sequence_id: examSequenceId,
                academic_year_id: academicYearId,
                student_id: studentId
            }
        });

        if (reportRecord) {
            return {
                available: reportRecord.status === ReportStatus.COMPLETED,
                status: reportRecord.status,
                message: getStatusMessage(reportRecord.status),
                reportData: {
                    studentName: enrollment.student.name,
                    matricule: enrollment.student.matricule,
                    className: `${enrollment.sub_class.name}`, // Only show subclass name
                    examSequence: examSequence.sequence_number,
                    termName: examSequence.term?.name,
                    filePath: reportRecord.file_path,
                    generatedAt: reportRecord.updated_at,
                    errorMessage: reportRecord.error_message
                }
            };
        }

        // Check if marks exist for this student and sequence
        const marksCount = await prisma.mark.count({
            where: {
                enrollment_id: enrollment.id,
                exam_sequence_id: examSequenceId
            }
        });

        if (marksCount === 0) {
            return {
                available: false,
                status: 'NO_MARKS',
                message: 'No marks available for this student and exam sequence'
            };
        }

        return {
            available: false,
            status: 'NOT_GENERATED',
            message: 'Report card can be generated but has not been created yet',
            reportData: {
                studentName: enrollment.student.name,
                matricule: enrollment.student.matricule,
                className: `${enrollment.sub_class.name}`, // Only show subclass name
                examSequence: examSequence.sequence_number,
                termName: examSequence.term?.name,
                marksCount: marksCount
            }
        };
    } catch (error: any) {
        throw new Error(`Error checking report card availability: ${error.message}`);
    }
}

/**
 * Check report card availability for a subclass
 */
export async function checkSubclassReportCardAvailability(
    subClassId: number,
    academicYearId: number,
    examSequenceId: number
): Promise<{
    available: boolean;
    status: string;
    message: string;
    reportData?: any;
}> {
    try {
        // Check if subclass exists
        const subClass = await prisma.subClass.findUnique({
            where: { id: subClassId },
            include: { class: true }
        });

        if (!subClass) {
            return {
                available: false,
                status: 'SUBCLASS_NOT_FOUND',
                message: 'Subclass not found'
            };
        }

        // Check if exam sequence exists
        const examSequence = await prisma.examSequence.findUnique({
            where: { id: examSequenceId },
            include: { term: true }
        });

        if (!examSequence) {
            return {
                available: false,
                status: 'SEQUENCE_NOT_FOUND',
                message: 'Exam sequence not found'
            };
        }

        // Get enrolled students count
        const enrolledStudentsCount = await prisma.enrollment.count({
            where: {
                sub_class_id: subClassId,
                academic_year_id: academicYearId
            }
        });

        if (enrolledStudentsCount === 0) {
            return {
                available: false,
                status: 'NO_STUDENTS',
                message: 'No students enrolled in this subclass for the academic year'
            };
        }

        // Check for generated subclass report record
        const reportRecord = await prisma.generatedReport.findFirst({
            where: {
                report_type: ReportType.SUBCLASS,
                exam_sequence_id: examSequenceId,
                academic_year_id: academicYearId,
                sub_class_id: subClassId
            }
        });

        if (reportRecord) {
            return {
                available: reportRecord.status === ReportStatus.COMPLETED,
                status: reportRecord.status,
                message: getStatusMessage(reportRecord.status),
                reportData: {
                    subClassName: `${subClass.name}`, // Only show subclass name
                    enrolledStudents: enrolledStudentsCount,
                    examSequence: examSequence.sequence_number,
                    termName: examSequence.term?.name,
                    filePath: reportRecord.file_path,
                    generatedAt: reportRecord.updated_at,
                    errorMessage: reportRecord.error_message
                }
            };
        }

        // Check if marks exist for students in this subclass and sequence
        const marksCount = await prisma.mark.count({
            where: {
                enrollment: {
                    sub_class_id: subClassId,
                    academic_year_id: academicYearId
                },
                exam_sequence_id: examSequenceId
            }
        });

        if (marksCount === 0) {
            return {
                available: false,
                status: 'NO_MARKS',
                message: 'No marks available for students in this subclass and exam sequence'
            };
        }

        return {
            available: false,
            status: 'NOT_GENERATED',
            message: 'Subclass report card can be generated but has not been created yet',
            reportData: {
                subClassName: `${subClass.name}`, // Only show subclass name
                enrolledStudents: enrolledStudentsCount,
                examSequence: examSequence.sequence_number,
                termName: examSequence.term?.name,
                marksCount: marksCount
            }
        };
    } catch (error: any) {
        throw new Error(`Error checking subclass report card availability: ${error.message}`);
    }
}

/**
 * Helper function to get user-friendly status messages
 */
function getStatusMessage(status: string): string {
    switch (status) {
        case ReportStatus.PENDING:
            return 'Report card generation is queued and will start soon';
        case ReportStatus.PROCESSING:
            return 'Report card is currently being generated';
        case ReportStatus.COMPLETED:
            return 'Report card is available for download';
        case ReportStatus.FAILED:
            return 'Report card generation failed';
        default:
            return 'Unknown status';
    }
}

/**
 * Get mark submission tracking overview for an exam sequence.
 * Shows per-subclass, per-subject: how many students, how many marks submitted, which teacher, status.
 */
export async function getMarkSubmissionTracking(examSequenceId: number) {
    const sequence = await prisma.examSequence.findUnique({
        where: { id: examSequenceId },
        include: { term: true }
    });

    if (!sequence) {
        throw new Error('Exam sequence not found.');
    }

    // Get all subclasses with enrolled students for this academic year. Withdrawn
    // students are excluded: markEntryService's entry sheet (what teachers actually
    // fill in) leaves them off the roster, so counting them here would show
    // subjects as "missing"/"partial" marks that no teacher is ever asked to enter.
    const activeEnrollment = {
        academic_year_id: sequence.academic_year_id,
        student: { status: { not: 'WITHDRAWN' as const } },
    };
    const subClasses = await prisma.subClass.findMany({
        where: {
            enrollments: {
                some: activeEnrollment
            }
        },
        include: {
            class: true,
            sub_class_subjects: {
                include: {
                    subject: true,
                }
            },
            enrollments: {
                where: activeEnrollment,
                select: { id: true }
            }
        },
        orderBy: [
            { class: { name: 'asc' } },
            { name: 'asc' }
        ]
    });

    // Get all marks for this exam sequence
    // A mark row with a null score is a placeholder, not a submission.
    const marks = await prisma.mark.findMany({
        where: { exam_sequence_id: examSequenceId, score: { not: null } },
        select: {
            enrollment_id: true,
            sub_class_subject_id: true,
            teacher_id: true,
            score: true,
            teacher: { select: { id: true, name: true } }
        }
    });

    // Index marks by sub_class_subject_id
    const marksBySubjectMap = new Map<number, typeof marks>();
    for (const mark of marks) {
        if (!marksBySubjectMap.has(mark.sub_class_subject_id)) {
            marksBySubjectMap.set(mark.sub_class_subject_id, []);
        }
        marksBySubjectMap.get(mark.sub_class_subject_id)!.push(mark);
    }

    // Teachers per (subclass, subject): whoever the timetable gives that subclass for that
    // subject this year. SubjectTeacher is school-wide, so it would list every teacher of the
    // subject in every class.
    const periods = await prisma.teacherPeriod.findMany({
        where: { academic_year_id: sequence.academic_year_id },
        select: { sub_class_id: true, subject_id: true, teacher: { select: { id: true, name: true } } },
    });

    // A subject that is not on a subclass's timetable is not counted for that subclass.
    const timetabled = new Set<string>();
    const teacherMap = new Map<string, Map<number, { id: number; name: string }>>();
    for (const p of periods) {
        const key = `${p.sub_class_id}:${p.subject_id}`;
        timetabled.add(key);
        if (!p.teacher) continue;
        if (!teacherMap.has(key)) teacherMap.set(key, new Map());
        teacherMap.get(key)!.set(p.teacher.id, p.teacher);
    }

    // Build tracking data
    let totalExpected = 0;
    let totalSubmitted = 0;

    const classesData = subClasses.map(sc => {
        const studentCount = sc.enrollments.length;
        const enrollmentIds = new Set(sc.enrollments.map(e => e.id));

        const subjects = sc.sub_class_subjects.filter(scs => timetabled.has(`${sc.id}:${scs.subject_id}`)).map(scs => {
            const subjectMarks = marksBySubjectMap.get(scs.id) || [];
            const submittedCount = subjectMarks.filter(m => enrollmentIds.has(m.enrollment_id)).length;
            const assignedTeachers = Array.from(teacherMap.get(`${sc.id}:${scs.subject_id}`)?.values() ?? []);

            // Find who actually submitted marks
            const submittedByTeachers = new Map<number, { id: number; name: string; count: number }>();
            for (const m of subjectMarks) {
                if (m.teacher && enrollmentIds.has(m.enrollment_id)) {
                    if (!submittedByTeachers.has(m.teacher.id)) {
                        submittedByTeachers.set(m.teacher.id, { id: m.teacher.id, name: m.teacher.name, count: 0 });
                    }
                    submittedByTeachers.get(m.teacher.id)!.count++;
                }
            }

            totalExpected += studentCount;
            totalSubmitted += submittedCount;

            const percentage = studentCount > 0 ? Math.round((submittedCount / studentCount) * 100) : 0;

            let status: 'complete' | 'partial' | 'missing';
            if (percentage === 100) status = 'complete';
            else if (percentage > 0) status = 'partial';
            else status = 'missing';

            return {
                subject_id: scs.subject_id,
                subject_name: scs.subject.name,
                total_students: studentCount,
                marks_submitted: submittedCount,
                marks_missing: studentCount - submittedCount,
                percentage,
                status,
                assigned_teachers: assignedTeachers,
                submitted_by: Array.from(submittedByTeachers.values()),
            };
        });

        const classSubmitted = subjects.reduce((s, sub) => s + sub.marks_submitted, 0);
        const classExpected = subjects.reduce((s, sub) => s + sub.total_students, 0);
        const classPercentage = classExpected > 0 ? Math.round((classSubmitted / classExpected) * 100) : 0;

        return {
            sub_class_id: sc.id,
            sub_class_name: sc.name,
            class_name: sc.class.name,
            total_students: studentCount,
            overall_percentage: classPercentage,
            subjects,
        };
    });

    const overallPercentage = totalExpected > 0 ? Math.round((totalSubmitted / totalExpected) * 100) : 0;

    return {
        exam_sequence: {
            id: sequence.id,
            sequence_number: sequence.sequence_number,
            term_name: sequence.term?.name,
            status: sequence.status,
            submission_deadline: sequence.submission_deadline,
        },
        summary: {
            total_marks_expected: totalExpected,
            total_marks_submitted: totalSubmitted,
            total_marks_missing: totalExpected - totalSubmitted,
            overall_percentage: overallPercentage,
        },
        classes: classesData,
    };
}

/**
 * Shared loader for submission tracking: subclasses with active (non-withdrawn)
 * enrollments in the year, the sequence's marks, and who teaches each
 * (subclass, subject) pair this year according to the timetable (TeacherPeriod).
 */
async function loadSubmissionContext(academicYearId: number, examSequenceId: number) {
    const activeEnrollment = {
        academic_year_id: academicYearId,
        student: { status: { not: 'WITHDRAWN' as const } },
    };
    const [subClasses, marks, periods] = await Promise.all([
        prisma.subClass.findMany({
            where: { enrollments: { some: activeEnrollment } },
            include: {
                class: true,
                sub_class_subjects: { include: { subject: true } },
                enrollments: { where: activeEnrollment, select: { id: true } },
            },
            orderBy: [{ class: { name: 'asc' } }, { name: 'asc' }],
        }),
        prisma.mark.findMany({
            where: { exam_sequence_id: examSequenceId },
            select: {
                enrollment_id: true,
                sub_class_subject_id: true,
                teacher_id: true,
                score: true,
                teacher: { select: { id: true, name: true } },
            },
        }),
        prisma.teacherPeriod.findMany({
            where: { academic_year_id: academicYearId, teacher_id: { not: null } },
            distinct: ['teacher_id', 'sub_class_id', 'subject_id'],
            select: {
                sub_class_id: true,
                subject_id: true,
                teacher: { select: { id: true, name: true, email: true, phone: true } },
            },
        }),
    ]);

    const teachersByPair = new Map<string, { id: number; name: string; email: string | null; phone: string | null }[]>();
    for (const p of periods) {
        if (!p.teacher) continue;
        const key = `${p.sub_class_id}_${p.subject_id}`;
        if (!teachersByPair.has(key)) teachersByPair.set(key, []);
        teachersByPair.get(key)!.push(p.teacher as any);
    }
    return { subClasses, marks, teachersByPair };
}

/**
 * Get teachers who haven't completed mark submission for an exam sequence.
 * A teacher is pending for a (subclass, subject) they teach (per the timetable)
 * when fewer marks exist for that pair than active students in the subclass —
 * regardless of who typed the marks in.
 */
export async function getPendingTeachers(examSequenceId: number) {
    const sequence = await prisma.examSequence.findUnique({
        where: { id: examSequenceId },
    });

    if (!sequence) {
        throw new Error('Exam sequence not found.');
    }

    const { subClasses, marks, teachersByPair } = await loadSubmissionContext(sequence.academic_year_id, examSequenceId);

    const teacherPendingMap = new Map<number, {
        teacher: { id: number; name: string; email: string | null; phone: string | null };
        pending_subjects: {
            subject_id: number;
            subject_name: string;
            sub_class_id: number;
            sub_class_name: string;
            class_name: string;
            total_students: number;
            marks_submitted: number;
            marks_missing: number;
        }[];
        total_missing: number;
        total_submitted: number;
    }>();

    for (const sc of subClasses) {
        const studentCount = sc.enrollments.length;
        if (studentCount === 0) continue;
        const enrollmentIds = new Set(sc.enrollments.map(e => e.id));

        for (const scs of sc.sub_class_subjects) {
            const teachers = teachersByPair.get(`${sc.id}_${scs.subject_id}`) || [];
            if (teachers.length === 0) continue;

            const submitted = marks.filter(m => m.sub_class_subject_id === scs.id && enrollmentIds.has(m.enrollment_id)).length;
            const missing = studentCount - submitted;
            if (missing <= 0) continue;

            for (const teacher of teachers) {
                if (!teacherPendingMap.has(teacher.id)) {
                    teacherPendingMap.set(teacher.id, { teacher, pending_subjects: [], total_missing: 0, total_submitted: 0 });
                }
                const entry = teacherPendingMap.get(teacher.id)!;
                entry.pending_subjects.push({
                    subject_id: scs.subject_id,
                    subject_name: scs.subject.name,
                    sub_class_id: sc.id,
                    sub_class_name: sc.name,
                    class_name: sc.class.name,
                    total_students: studentCount,
                    marks_submitted: submitted,
                    marks_missing: missing,
                });
                entry.total_missing += missing;
                entry.total_submitted += submitted;
            }
        }
    }

    const pendingTeachers = Array.from(teacherPendingMap.values())
        .sort((a, b) => b.total_missing - a.total_missing);

    return {
        exam_sequence_id: examSequenceId,
        total_teachers_pending: pendingTeachers.length,
        teachers: pendingTeachers,
    };
}

// ---------------------------------------------------------------------------
// Mark sheet PDF — one subject in one subclass, sequences 1–6 as columns
// ---------------------------------------------------------------------------

const marksheetTemplateCache: { html?: string; logo?: string } = {};
function loadMarksheetAssets(): { html: string; logo: string } {
    if (!marksheetTemplateCache.html) {
        marksheetTemplateCache.html = fs.readFileSync(
            path.join(process.cwd(), 'src/view/marksheet-template.ejs'), 'utf-8'
        );
    }
    if (marksheetTemplateCache.logo === undefined) {
        try {
            const buf = fs.readFileSync(path.join(process.cwd(), 'public/school.png'));
            marksheetTemplateCache.logo = `data:image/png;base64,${buf.toString('base64')}`;
        } catch {
            marksheetTemplateCache.logo = '';
        }
    }
    return { html: marksheetTemplateCache.html, logo: marksheetTemplateCache.logo };
}

export async function generateMarksheetPdf(params: {
    subClassId: number;
    subjectId: number;
    academicYearId?: number;
    blank?: boolean;
}): Promise<{ buffer: Buffer; filename: string }> {
    const yearId = await getAcademicYearId(params.academicYearId);
    if (!yearId) throw new Error('No academic year found');

    const subClassSubject = await prisma.subClassSubject.findUnique({
        where: { sub_class_id_subject_id: { sub_class_id: params.subClassId, subject_id: params.subjectId } },
        include: { subject: true, sub_class: { include: { class: true } } },
    });
    if (!subClassSubject) throw new Error('Subject is not assigned to this subclass (not found)');

    const [year, enrollments, teacherPeriod] = await Promise.all([
        prisma.academicYear.findUnique({ where: { id: yearId }, select: { name: true } }),
        prisma.enrollment.findMany({
            where: {
                sub_class_id: params.subClassId,
                academic_year_id: yearId,
                student: { status: { not: 'WITHDRAWN' } },
            },
            include: { student: { select: { name: true, gender: true } } },
        }),
        prisma.teacherPeriod.findFirst({
            where: {
                sub_class_id: params.subClassId,
                subject_id: params.subjectId,
                academic_year_id: yearId,
                teacher_id: { not: null },
            },
            include: { teacher: { select: { name: true } } },
        }),
    ]);

    // score lookup: enrollment_id -> sequence_number -> score
    const scoreMap = new Map<number, Map<number, number | null>>();
    if (!params.blank && enrollments.length > 0) {
        const marks = await prisma.mark.findMany({
            where: {
                sub_class_subject_id: subClassSubject.id,
                enrollment_id: { in: enrollments.map(e => e.id) },
                exam_sequence: { academic_year_id: yearId },
            },
            select: { enrollment_id: true, score: true, exam_sequence: { select: { sequence_number: true } } },
        });
        for (const m of marks) {
            if (!scoreMap.has(m.enrollment_id)) scoreMap.set(m.enrollment_id, new Map());
            scoreMap.get(m.enrollment_id)!.set(m.exam_sequence.sequence_number, m.score);
        }
    }

    const rows = enrollments
        .map(e => ({
            name: e.student.name,
            sex: e.student.gender === 'Male' ? 'M' : 'F',
            scores: [1, 2, 3, 4, 5, 6].map(seq => scoreMap.get(e.id)?.get(seq) ?? null),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    // Subclass names usually already carry the class ("FORM 1 N"); don't print it twice.
    const { name: subName, class: { name: parentName } } = subClassSubject.sub_class;
    const className = subName.toUpperCase().startsWith(parentName.toUpperCase())
        ? subName : `${parentName} ${subName}`;
    const { html: template, logo } = loadMarksheetAssets();
    const html = ejs.render(template, {
        documentTitle: `Mark Sheet - ${subClassSubject.subject.name} - ${className}`,
        academicYearName: year?.name ?? '',
        subjectName: subClassSubject.subject.name,
        className,
        teacherName: teacherPeriod?.teacher?.name ?? '',
        rows,
        // spare rows for late arrivals; a full empty grid when nobody is enrolled yet
        extraBlankRows: rows.length === 0 ? 30 : 3,
        boys: rows.filter(r => r.sex === 'M').length,
        girls: rows.filter(r => r.sex === 'F').length,
        schoolLogo: logo,
        schoolName: "ST STEPHEN'S INTERNATIONAL COLLEGE",
        schoolTagline: 'Excellence for Higher Heights',
        schoolAddress: 'Yaounde Essono city Damas',
        schoolPhone: '(+237) 680 188 080 / 681 630 435',
        generatedAt: new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    });

    const page = await PuppeteerManager.newPage();
    try {
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
        const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
        const filename = `marksheet_${subClassSubject.subject.name}_${className}`.replace(/[^\w-]+/g, '_') + '.pdf';
        return { buffer, filename };
    } finally {
        try { await page.close(); } catch { /* noop */ }
    }
}

/**
 * Students who have no mark yet in some subject of an exam sequence, with the subjects
 * they are missing. Same rules as getMarkSubmissionTracking: withdrawn students are left out,
 * only subjects on the subclass's timetable count, and a null score is not a mark.
 */
export async function getStudentsMissingMarks(examSequenceId: number) {
    const sequence = await prisma.examSequence.findUnique({ where: { id: examSequenceId } });
    if (!sequence) throw new Error('Exam sequence not found.');

    const activeEnrollment = {
        academic_year_id: sequence.academic_year_id,
        student: { status: { not: 'WITHDRAWN' as const } },
    };
    const [subClasses, marks, periods] = await Promise.all([
        prisma.subClass.findMany({
            where: { enrollments: { some: activeEnrollment } },
            include: {
                class: true,
                sub_class_subjects: { include: { subject: true } },
                enrollments: { where: activeEnrollment, select: { id: true, student: { select: { id: true, name: true, matricule: true } } } },
            },
            orderBy: [{ class: { name: 'asc' } }, { name: 'asc' }],
        }),
        prisma.mark.findMany({
            where: { exam_sequence_id: examSequenceId, score: { not: null } },
            select: { enrollment_id: true, sub_class_subject_id: true },
        }),
        prisma.teacherPeriod.findMany({
            where: { academic_year_id: sequence.academic_year_id },
            select: { sub_class_id: true, subject_id: true },
        }),
    ]);
    const timetabled = new Set(periods.map(p => `${p.sub_class_id}:${p.subject_id}`));
    const marked = new Set(marks.map(m => `${m.enrollment_id}:${m.sub_class_subject_id}`));

    const classes = subClasses.map(sc => {
        const subjects = sc.sub_class_subjects.filter(scs => timetabled.has(`${sc.id}:${scs.subject_id}`));
        const students = sc.enrollments
            .map(e => ({
                student_id: e.student.id,
                name: e.student.name,
                matricule: e.student.matricule,
                missing_subjects: subjects
                    .filter(scs => !marked.has(`${e.id}:${scs.id}`))
                    .map(scs => ({ subject_id: scs.subject_id, subject_name: scs.subject.name.trim() }))
                    .sort((a, b) => a.subject_name.localeCompare(b.subject_name)),
            }))
            .filter(st => st.missing_subjects.length > 0)
            .sort((a, b) => a.name.localeCompare(b.name));
        return {
            sub_class_id: sc.id,
            sub_class_name: sc.name,
            class_name: sc.class.name,
            total_students: sc.enrollments.length,
            subject_count: subjects.length,
            students,
        };
    }).filter(c => c.students.length > 0);

    return {
        exam_sequence: { id: sequence.id, sequence_number: sequence.sequence_number, status: sequence.status },
        total_students_missing: classes.reduce((n, c) => n + c.students.length, 0),
        classes,
    };
}
