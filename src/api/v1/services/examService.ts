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

    // Setup includes based on filterOptions (example)
    const include: any = {};
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
 * Generates a report card for a single student
 */
async function generateSingleReportCard(
    studentId: number,
    academicYearId: number,
    examSequenceId: number,
    examSequence: any
): Promise<string> {

    console.time('Student data generation');
    // Generate report data for a single student
    const reportData = await generateStudentReportData(studentId, academicYearId, examSequenceId, examSequence);
    console.timeEnd('Student data generation');

    console.time('Student html render generation');
    // Generate PDF for the student
    const html = await renderReportCardHtml(reportData);
    console.timeEnd('Student html render generation');

    console.time('Student report generation');
    // Generate PDF and save it
    const filePath = path.join(process.cwd(), `src/reports/${studentId}-${academicYearId}-${examSequenceId}-report.pdf`);
    await generatePdf(html, filePath);
    console.timeEnd('Student report generation');

    // console.log(`PDF saved at ${filePath}`);
    return filePath;
}

/**
 * Generates report cards for all students in a sub_class
 */
async function generateSubclassReportCards(
    sub_classId: number,
    academicYearId: number,
    examSequenceId: number,
    examSequence: any
): Promise<string> {
    console.log(`Generating report cards for subclass ${sub_classId}, year ${academicYearId}, sequence ${examSequenceId}`);

    // Fetch all subjects for the subclass
    const subjects = await reportSequelizeService.getAllSubjectsForSubclass(sub_classId);
    if (!subjects || subjects.length === 0) {
        throw new Error(`No subjects found for subclass ${sub_classId}. Cannot generate reports.`);
    }
    const subjectMap = new Map(subjects.map(s => [s.sub_class_subject_id, s]));


    const filePath = path.join(__dirname, `../../../../reports/subclass_${sub_classId}_sequence_${examSequenceId}_report_cards.pdf`);

    // Fetch all students in the subclass for the academic year
    const enrollments = await prisma.enrollment.findMany({
        where: {
            sub_class_id: sub_classId,
            academic_year_id: academicYearId,
            student: { status: { not: 'WITHDRAWN' } }
        },
        select: {
            student_id: true
        }
    });

    if (enrollments.length === 0) {
        console.log(`No students found for subclass ${sub_classId} in academic year ${academicYearId}.`);
        return ""; // Or handle as an error
    }

    const studentIds = enrollments.map(e => e.student_id);

    // Update status in GeneratedReport table
    await prisma.generatedReport.updateMany({
        where: {
            sub_class_id: sub_classId,
            academic_year_id: academicYearId,
            exam_sequence_id: examSequenceId,
            report_type: ReportType.SUBCLASS
        },
        data: {
            status: ReportStatus.PROCESSING
        }
    });

    try {
        const reportDataPromises = studentIds.map(studentId =>
            generateStudentReportData(studentId, academicYearId, examSequenceId, examSequence)
        );
        const reportDataArray = await Promise.all(reportDataPromises);

        const htmlPagesPromises = reportDataArray.map(reportData => renderReportCardHtml(reportData));
        const htmlPages = await Promise.all(htmlPagesPromises);

        await generateMultiPagePdf(htmlPages, filePath);

        // Update status to COMPLETED
        await prisma.generatedReport.updateMany({
            where: {
                sub_class_id: sub_classId,
                academic_year_id: academicYearId,
                exam_sequence_id: examSequenceId,
                report_type: ReportType.SUBCLASS
            },
            data: {
                status: ReportStatus.COMPLETED,
                file_path: filePath
            }
        });

        console.log(`Successfully generated multi-page PDF for subclass ${sub_classId} at ${filePath}`);
        return filePath;

    } catch (error: any) {
        console.error('Error generating subclass report cards:', error);

        // Update status to FAILED
        await prisma.generatedReport.updateMany({
            where: {
                sub_class_id: sub_classId,
                academic_year_id: academicYearId,
                exam_sequence_id: examSequenceId,
                report_type: ReportType.SUBCLASS
            },
            data: {
                status: ReportStatus.FAILED,
                error_message: error.message
            }
        });
        throw error; // Re-throw to be caught by the job processor
    }
}

// Refactored generateStudentReportData to use Sequelize
async function generateStudentReportData(
    studentId: number,
    academicYearId: number,
    examSequenceId: number,
    examSequence: any
): Promise<ReportData> {
    // Fetch marks and context using Sequelize
    let { marks: studentMarks, context } = await reportSequelizeService.getStudentReportCardData(studentId, academicYearId, examSequenceId);

    // If no marks were found for the student, or context is missing from the initial query,
    // we need to get the student's enrollment and subclass info to determine relevant subjects.
    if (!context || studentMarks.length === 0) {
        const studentEnrollment = await prisma.enrollment.findFirst({
            where: {
                student_id: studentId,
                academic_year_id: academicYearId
            },
            include: {
                student: true,
                sub_class: {
                    include: {
                        class: true,
                        class_master: { select: { name: true, id: true } }
                    }
                },
                academic_year: true // Include academic year for start/end dates
            }
        });

        if (!studentEnrollment) {
            throw new Error(`Student with ID ${studentId} is not enrolled in academic year ${academicYearId}. Cannot generate report card.`);
        }

        // Reconstruct context if it was missing or incomplete
        context = {
            sub_class_id: studentEnrollment.sub_class_id,
            sub_class_name: studentEnrollment.sub_class?.name || 'N/A',
            class_id: studentEnrollment.sub_class?.class_id,
            class_name: studentEnrollment.sub_class?.class?.name || 'N/A',
            class_master_id: studentEnrollment.sub_class?.class_master_id,
            class_master_name: studentEnrollment.sub_class?.class_master?.name || 'Not Assigned',
            academic_year_id: academicYearId,
            start_date: studentEnrollment.academic_year?.start_date,
            end_date: studentEnrollment.academic_year?.end_date
        };

        // If no marks were fetched by the initial query, populate with zero-score marks for all subjects in their subclass
        if (studentMarks.length === 0) {
            const allSubjectsForSubclass = await reportSequelizeService.getAllSubjectsForSubclass(studentEnrollment.sub_class_id!);

            studentMarks = allSubjectsForSubclass.map(subject => ({
                student_id: studentId,
                student_name: studentEnrollment.student.name,
                matricule: studentEnrollment.student.matricule,
                gender: studentEnrollment.student.gender,
                date_of_birth: studentEnrollment.student.date_of_birth.toISOString().split('T')[0],
                place_of_birth: studentEnrollment.student.place_of_birth,
                enrollment_id: studentEnrollment.id,
                sub_class_id: studentEnrollment.sub_class_id!,
                academic_year_id: academicYearId,
                repeater: studentEnrollment.repeater,
                photo: studentEnrollment.photo || 'default-student.jpg',
                mark_id: -1, // Unique identifier for a virtual mark
                score: 0,
                sub_class_subject_id: subject.sub_class_subject_id,
                exam_sequence_id: examSequenceId,
                subject_name: subject.subject_name,
                category: subject.category,
                coefficient: subject.coefficient,
                teacher_name: subject.teacher_name || 'Not Assigned',
            }));
        }
    }

    // Now, studentMarks should contain either actual marks or zero-score virtual marks.
    // Ensure that this student's data is correctly represented in `s` for later calculations.
    const s = {
        student: {
            name: studentMarks[0].student_name,
            matricule: studentMarks[0].matricule,
            dateOfBirth: studentMarks[0].date_of_birth,
            placeOfBirth: studentMarks[0].place_of_birth,
            gender: studentMarks[0].gender,
            repeater: studentMarks[0].repeater,
            photo: studentMarks[0].photo || 'default-photo.jpg',
        },
        marks: studentMarks,
    };

    // For single student, fetch all students in the same subclass for stats
    // This call will now also include zero-mark students if they exist in the subclass overall
    const { marks: allMarksInSubclass } = await reportSequelizeService.getSubclassReportCardData(context.sub_class_id, academicYearId, examSequenceId);

    // Combine studentMarks with allMarksInSubclass for comprehensive calculations
    // This ensures that class statistics are accurate even if this particular student had no actual marks
    const combinedMarks = [...allMarksInSubclass]; // Start with all marks in subclass (which may include this student's actual marks)

    // If the current student's marks were virtual (mark_id = -1), ensure they are included for class stats
    if (s.marks.some(mark => mark.mark_id === -1)) {
        // Remove any actual marks for this student from combinedMarks (if they were also fetched in allMarksInSubclass)
        // and then add the virtual marks to ensure consistency.
        const filteredCombinedMarks = combinedMarks.filter(m => !(m.student_id === studentId && m.exam_sequence_id === examSequenceId));
        combinedMarks.length = 0; // Clear array
        combinedMarks.push(...filteredCombinedMarks, ...s.marks); // Add filtered actual marks and this student's virtual marks
    }

    // Group allMarks by student (now using combinedMarks for a more accurate overall view)
    const studentsMap = new Map<number, any>();
    for (const mark of combinedMarks) {
        if (!studentsMap.has(mark.student_id)) {
            studentsMap.set(mark.student_id, {
                student: {
                    name: mark.student_name,
                    matricule: mark.matricule,
                    dateOfBirth: mark.date_of_birth,
                    placeOfBirth: mark.place_of_birth,
                    gender: mark.gender,
                    repeater: mark.repeater,
                    photo: mark.photo || 'default-photo.jpg',
                },
                marks: [],
            });
        }
        studentsMap.get(mark.student_id).marks.push(mark);
    }

    const students = Array.from(studentsMap.values());
    // Calculate stats as in subclass method
    const studentsWithAverages = students.map(stuEntry => {
        const totalWeighted = stuEntry.marks.reduce((sum: number, m: any) => sum + (m.score ?? 0) * m.coefficient, 0);
        const totalCoef = stuEntry.marks.reduce((sum: number, m: any) => sum + m.coefficient, 0);
        const overallAverage = totalCoef > 0 ? totalWeighted / totalCoef : 0;
        return { studentId: stuEntry.student.matricule, overallAverage };
    }).sort((a, b) => b.overallAverage - a.overallAverage);
    const classAverages = studentsWithAverages.map(stuEntry => stuEntry.overallAverage);
    const classStats = {
        lowestAverage: classAverages.length > 0 ? Math.min(...classAverages).toFixed(2) : '0.00',
        highestAverage: classAverages.length > 0 ? Math.max(...classAverages).toFixed(2) : '0.00',
        successRate: classAverages.length > 0 ? (classAverages.filter(avg => avg >= 10).length / classAverages.length) * 100 : 0,
        standardDeviation: classAverages.length > 0 ? calculateStandardDeviation(classAverages).toFixed(2) : '0.00',
        classAverage: classAverages.length > 0 ? (classAverages.reduce((sum, avg) => sum + avg, 0) / classAverages.length).toFixed(2) : '0.00',
    };
    // Find this student's data (s) from the new `students` array to ensure it reflects combined marks
    const updatedStudentEntry = students.find(stuEntry => stuEntry.student.matricule === s.student.matricule);
    if (!updatedStudentEntry) {
        throw new Error('Internal error: Could not find student in processed student list.');
    }

    const totalWeightedStudentSingle = updatedStudentEntry.marks.reduce((sum: number, m: any) => sum + (m.score ?? 0) * m.coefficient, 0);
    const totalCoefStudentSingle = updatedStudentEntry.marks.reduce((sum: number, m: any) => sum + m.coefficient, 0);
    const overallAverage = totalCoefStudentSingle > 0 ? totalWeightedStudentSingle / totalCoefStudentSingle : 0;
    const rankIndex = studentsWithAverages.findIndex(st => st.studentId === updatedStudentEntry.student.matricule);
    const rank = rankIndex !== -1 ? `${rankIndex + 1}th` : 'N/A';
    // Subject stats
    const subjectStats = new Map<number, { scores: number[], min: number, max: number, total: number, passed: number, avg?: number, successRate?: number }>();
    for (const stu of students) { // Iterate through all students in the class (including virtual ones)
        for (const m of stu.marks) {
            const subClassSubjectId = m.sub_class_subject_id;
            if (!subjectStats.has(subClassSubjectId)) {
                subjectStats.set(subClassSubjectId, { scores: [], min: Infinity, max: -Infinity, total: 0, passed: 0 });
            }
            const stats = subjectStats.get(subClassSubjectId)!;
            stats.scores.push(m.score ?? 0);
            stats.min = Math.min(stats.min, m.score ?? 0);
            stats.max = Math.max(stats.max, m.score ?? 0);
            stats.total += m.score ?? 0;
            if (m.score ?? 0 >= 10) stats.passed += 1;
        }
    }
    subjectStats.forEach(stats => {
        const count = stats.scores.length;
        stats.avg = count > 0 ? stats.total / count : 0;
        stats.successRate = count > 0 ? (stats.passed / count) * 100 : 0;
    });
    // Prepare subjects data
    const subjects: SubjectData[] = updatedStudentEntry.marks.map((m: any) => {
        const stats = subjectStats.get(m.sub_class_subject_id) || { min: 0, max: 0, avg: 0, successRate: 0 };
        // Calculate subject rank for this student
        const subjectScores = combinedMarks.filter(mm => mm.sub_class_subject_id === m.sub_class_subject_id).sort((a, b) => b.score - a.score);
        const subjectRankIndex = subjectScores.findIndex(mm => mm.enrollment_id === m.enrollment_id);
        const subjectRank = subjectRankIndex !== -1 ? `${subjectRankIndex + 1}th` : 'N/A';
        return {
            category: m.category,
            name: m.subject_name,
            coefficient: m.coefficient,
            mark: m.score ?? 0,
            weightedMark: m.score ?? 0 * m.coefficient,
            rank: subjectRank,
            teacher: m.teacher_name,
            min: stats.min === Infinity ? 0 : stats.min,
            avg: parseFloat((stats.avg || 0).toFixed(2)),
            max: stats.max === -Infinity ? 0 : stats.max,
            successRate: parseFloat((stats.successRate || 0).toFixed(2)),
            grade: getGrade(m.score ?? 0),
        };
    });
    // Prepare category summaries
    const categorySet = new Set<string>(subjects.map(sub => sub.category));
    const categories = Array.from(categorySet);
    const categorySummaries: CategorySummary[] = categories.map(category => {
        const categorySubjects = subjects.filter(sub => sub.category === category);
        if (categorySubjects.length === 0) {
            return { category, totalMark: 0, totalCoef: 0, totalWeightedMark: 0, categoryAverage: 0, categoryGrade: 'N/A', categoryMin: 0, categoryMax: 0, categoryAvg: 0, categorySuccessRate: 0, categoryRank: 'N/A' };
        }
        const totalMarkCategory = categorySubjects.reduce((sum, sub) => sum + sub.mark, 0);
        const totalCoefCategory = categorySubjects.reduce((sum, sub) => sum + sub.coefficient, 0);
        const totalWeightedMarkCategory = categorySubjects.reduce((sum, sub) => sum + sub.weightedMark, 0);
        const categoryAverage = totalCoefCategory > 0 ? totalWeightedMarkCategory / totalCoefCategory : 0;
        // Category stats (min, max, avg, success) are class-wide for subjects in this category
        const categorySubjectStats = Array.from(subjectStats.entries())
            .filter(([subClassSubjectId, _]) => {
                // Find the subject category for this subClassSubjectId from the combined marks
                return combinedMarks.find(m => m.sub_class_subject_id === subClassSubjectId)?.category === category;
            })
            .map(([_, stats]) => stats);
        const categoryMin = categorySubjectStats.length > 0 ? Math.min(...categorySubjectStats.map(s => s.min === Infinity ? 0 : s.min)) : 0;
        const categoryMax = categorySubjectStats.length > 0 ? Math.max(...categorySubjectStats.map(s => s.max === -Infinity ? 0 : s.max)) : 0;
        const categoryAvg = categorySubjectStats.length > 0 ? categorySubjectStats.reduce((sum, s) => sum + (s.avg || 0), 0) / categorySubjectStats.length : 0;
        const categorySuccessRate = categorySubjectStats.length > 0 ? categorySubjectStats.reduce((sum, s) => sum + (s.successRate || 0), 0) / categorySubjectStats.length : 0;
        // Calculate student's rank within this category
        const studentCategoryAverages = students.map(stuEntry => {
            const studentCatMarks = stuEntry.marks.filter((m: any) => m.category === category);
            if (studentCatMarks.length === 0) return { studentId: stuEntry.student.matricule, average: 0 };
            const catTotalWeighted = studentCatMarks.reduce((sum: number, m: any) => sum + (m.score ?? 0) * m.coefficient, 0);
            const catTotalCoef = studentCatMarks.reduce((sum: number, m: any) => sum + m.coefficient, 0);
            return { studentId: stuEntry.student.matricule, average: catTotalCoef > 0 ? catTotalWeighted / catTotalCoef : 0 };
        }).sort((a, b) => b.average - a.average);
        const studentCategoryRankIndex = studentCategoryAverages.findIndex(sca => sca.studentId === updatedStudentEntry.student.matricule);
        const categoryRank = studentCategoryRankIndex >= 0 ? `${studentCategoryRankIndex + 1}th` : 'N/A';
        return {
            category,
            totalMark: totalMarkCategory,
            totalCoef: totalCoefCategory,
            totalWeightedMark: totalWeightedMarkCategory,
            categoryAverage,
            categoryGrade: getGrade(categoryAverage),
            categoryMin: parseFloat(categoryMin.toFixed(2)),
            categoryMax: parseFloat(categoryMax.toFixed(2)),
            categoryAvg: parseFloat(categoryAvg.toFixed(2)),
            categorySuccessRate: parseFloat(categorySuccessRate.toFixed(2)),
            categoryRank
        };
    });

    const academicYearName = context ? `${new Date(context.start_date).getFullYear()}-${new Date(context.end_date).getFullYear()}` : '';
    const reportData: ReportData = {
        student: {
            ...updatedStudentEntry.student,
            dateOfBirth: moment(updatedStudentEntry.student.dateOfBirth).format('DD/MM/YY'),
        },
        classInfo: {
            className: `${context.sub_class_name}`, // Only show subclass name
            enrolledStudents: students.length, // Total students considered for class stats
            classMaster: context.class_master_name || 'Not Assigned',
            academicYear: academicYearName,
        },
        subjects,
        categories,
        categorySummaries,
        totals: {
            totalMark: totalWeightedStudentSingle, // Sum of actual marks
            totalCoef: totalCoefStudentSingle,
            totalWeightedMark: totalWeightedStudentSingle,
            overallAverage,
            overallGrade: getGrade(overallAverage)
        },
        statistics: {
            overallAverage: overallAverage.toFixed(2),
            rank,
            subjectsPassed: updatedStudentEntry.marks.filter((m: any) => m.score ?? 0 >= 10).length,
            classStats: classStats
        },
        examSequence: {
            name: `Evaluation N° ${examSequence.sequence_number}`,
            sequenceNumber: examSequence.sequence_number,
            termName: examSequence.term.name
        }
    };
    return reportData;
}

/**
 * Renders the HTML for a report card using the EJS template
 */
async function renderReportCardHtml(reportData: ReportData): Promise<string> {
    const template = fs.readFileSync(path.join(process.cwd(), 'src/view/report-template.ejs'), 'utf-8');
    return ejs.render(template, { ...reportData, photoUtils });
}

/**
 * Generates a PDF from HTML content using the shared browser instance
 */
async function generatePdf(html: string, filePath: string): Promise<void> {
    let page: puppeteer.Page | null = null;
    try {
        page = await PuppeteerManager.newPage(); // Get a page from the manager
        await page.setContent(html, { waitUntil: 'networkidle0' }); // Reverted to networkidle0

        const pdf = await page.pdf({
            format: 'A3',
            printBackground: true,
            margin: { top: '4mm', right: '4mm', bottom: '4mm', left: '4mm' },
            preferCSSPageSize: true,
            scale: 0.9, // Keep previous scale
            pageRanges: '1' // Generate only the first page (for single report)
        });

        // Ensure the reports directory exists
        const reportsDir = path.dirname(filePath);
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        // Save the PDF file
        fs.writeFileSync(filePath, pdf);

    } catch (error) {
        console.error(`Error generating single PDF at ${filePath}:`, error);
        // Decide how to handle the error, e.g., re-throw or return an error indicator
        throw error; // Re-throw for the caller to handle
    } finally {
        if (page) {
            try {
                await page.close(); // Close the page, not the browser
            } catch (closeError) {
                console.error(`Error closing Puppeteer page for ${filePath}:`, closeError);
            }
        }
    }
}

/**
 * Generates a multi-page PDF from multiple HTML pages using the shared browser instance
 */
async function generateMultiPagePdf(htmlPages: string[], filePath: string): Promise<void> {
    let page: puppeteer.Page | null = null;
    try {
        // Combine the HTML with page breaks and generate a single PDF
        const combinedHtml = htmlPages.map(html => {
            const bodyContent = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
            return `<div class=\"report-page\">${bodyContent}</div>`;
        }).join('\n');

        // Create a wrapper HTML with CSS for page breaks and scaling (keep existing styles)
        const wrapperHtml = `
    <!DOCTYPE html>
    <html>
    <head>
            <meta charset=\"UTF-8\">
        <title>Combined Report Cards</title>
            <script src=\"https://cdn.tailwindcss.com\"></script>
        <style>
                /* Keep existing styles from previous version */
            html, body {
                margin: 0;
                padding: 0;
                width: 100%;
                height: 100%;
            }
            @media print {
                .report-page {
                    page-break-after: always;
                    box-sizing: border-box;
                    transform-origin: center;
                    margin-top: 20px;
                    margin-bottom: 20px;
                        transform: scale(0.85);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 90vh;
                }
                table, tr, td, th {
                    page-break-inside: avoid;
                }
                @page {
                    size: A3 portrait;
                    margin: 0;
                }
                .text-xs {
                    font-size: 0.7rem !important;
                }
                .text-sm {
                    font-size: 0.8rem !important;
                }
                .p-4 {
                    padding: 0.75rem !important;
                }
                .p-1 {
                    padding: 0.15rem !important;
                }
                .mb-4, .my-4 {
                    margin-bottom: 0.5rem !important;
                }
                table {
                    font-size: 0.7rem !important;
                }
                .container {
                    max-width: 95% !important;
                    padding: 0.5rem !important;
                    margin: 0 auto !important;
                }
            }
            .report-page {
                position: relative;
                box-sizing: border-box;
                width: 100%;
                max-width: 100%;
                padding: 10px;
                margin: 20px auto;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 90vh;
            }
            .container {
                margin: 0 auto !important;
                width: 95% !important;
            }
        </style>
    </head>
    <body>
        ${combinedHtml}
    </body>
    </html>`;

        // Ensure the reports directory exists
        const reportsDir = path.dirname(filePath);
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        // Generate a single PDF with all pages using the manager
        page = await PuppeteerManager.newPage();
        await page.setContent(wrapperHtml, { waitUntil: 'networkidle0' }); // Reverted to networkidle0

        const pdf = await page.pdf({
            format: 'A3',
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }, // Keep existing margins
            preferCSSPageSize: true,
            scale: 0.95, // Keep existing scale
            // No pageRanges needed here, print all pages
        });

        // Save the combined PDF
        fs.writeFileSync(filePath, pdf);

    } catch (error) {
        console.error(`Error generating multi-page PDF at ${filePath}:`, error);
        // Decide how to handle the error
        throw error; // Re-throw for the caller to handle
    } finally {
        if (page) {
            try {
                await page.close(); // Close the page, not the browser
            } catch (closeError) {
                console.error(`Error closing Puppeteer page for ${filePath}:`, closeError);
            }
        }
    }
}

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

    // Setup includes
    const include: any = {};
    if (filterOptions?.includeTerm === 'true') {
        include.term = true;
        delete filterOptions.includeTerm; // Remove from filters after handling
    }
    if (filterOptions?.includeAcademicYear === 'true') {
        include.academic_year = true;
        delete filterOptions.includeAcademicYear; // Remove from filters after handling
    }

    // Use paginate utility
    return paginate<ExamSequence>(
        prisma.examSequence,
        paginationOptions,
        where, // Pass the constructed where clause
        include // Pass the constructed include object
    );
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

    // Delete the exam paper by ID
    return prisma.examPaper.delete({
        where: { id }
    });
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

    // Get all subclasses with enrolled students for this academic year
    const subClasses = await prisma.subClass.findMany({
        where: {
            enrollments: {
                some: { academic_year_id: sequence.academic_year_id }
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
                where: { academic_year_id: sequence.academic_year_id },
                select: { id: true }
            }
        },
        orderBy: [
            { class: { name: 'asc' } },
            { name: 'asc' }
        ]
    });

    // Get all marks for this exam sequence
    const marks = await prisma.mark.findMany({
        where: { exam_sequence_id: examSequenceId },
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

    // Get teacher assignments for subjects
    const subjectTeachers = await prisma.subjectTeacher.findMany({
        include: { teacher: { select: { id: true, name: true } }, subject: true }
    });

    const teacherMap = new Map<number, { id: number; name: string }[]>();
    for (const st of subjectTeachers) {
        if (!teacherMap.has(st.subject_id)) teacherMap.set(st.subject_id, []);
        teacherMap.get(st.subject_id)!.push(st.teacher);
    }

    // Build tracking data
    let totalExpected = 0;
    let totalSubmitted = 0;

    const classesData = subClasses.map(sc => {
        const studentCount = sc.enrollments.length;
        const enrollmentIds = new Set(sc.enrollments.map(e => e.id));

        const subjects = sc.sub_class_subjects.map(scs => {
            const subjectMarks = marksBySubjectMap.get(scs.id) || [];
            const submittedCount = subjectMarks.filter(m => enrollmentIds.has(m.enrollment_id)).length;
            const assignedTeachers = teacherMap.get(scs.subject_id) || [];

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
 * Get teachers who haven't completed mark submission for an exam sequence.
 */
export async function getPendingTeachers(examSequenceId: number) {
    const sequence = await prisma.examSequence.findUnique({
        where: { id: examSequenceId },
    });

    if (!sequence) {
        throw new Error('Exam sequence not found.');
    }

    // Get all subject-teacher assignments
    const subjectTeachers = await prisma.subjectTeacher.findMany({
        include: {
            teacher: { select: { id: true, name: true, email: true, phone: true } },
            subject: { select: { id: true, name: true } },
        }
    });

    // Get all subclass-subjects with their student counts
    const subClassSubjects = await prisma.subClassSubject.findMany({
        where: {
            sub_class: {
                enrollments: { some: { academic_year_id: sequence.academic_year_id } }
            }
        },
        include: {
            subject: { select: { id: true, name: true } },
            sub_class: {
                include: {
                    class: { select: { name: true } },
                    enrollments: {
                        where: { academic_year_id: sequence.academic_year_id },
                        select: { id: true }
                    }
                }
            }
        }
    });

    // Get all marks for this exam sequence
    const marks = await prisma.mark.findMany({
        where: { exam_sequence_id: examSequenceId },
        select: { sub_class_subject_id: true, enrollment_id: true, teacher_id: true }
    });

    const markCountMap = new Map<string, number>();
    for (const m of marks) {
        const key = `${m.teacher_id}_${m.sub_class_subject_id}`;
        markCountMap.set(key, (markCountMap.get(key) || 0) + 1);
    }

    // Build pending list per teacher
    const teacherPendingMap = new Map<number, {
        teacher: { id: number; name: string; email: string; phone: string };
        pending_subjects: {
            subject_name: string;
            sub_class_name: string;
            class_name: string;
            total_students: number;
            marks_submitted: number;
            marks_missing: number;
        }[];
        total_missing: number;
    }>();

    for (const st of subjectTeachers) {
        // Find subclass-subjects for this teacher's subject
        const relevantSCS = subClassSubjects.filter(scs => scs.subject_id === st.subject_id);

        for (const scs of relevantSCS) {
            const studentCount = scs.sub_class.enrollments.length;
            if (studentCount === 0) continue;

            const key = `${st.teacher_id}_${scs.id}`;
            const submitted = markCountMap.get(key) || 0;
            const missing = studentCount - submitted;

            if (missing <= 0) continue;

            if (!teacherPendingMap.has(st.teacher_id)) {
                teacherPendingMap.set(st.teacher_id, {
                    teacher: st.teacher,
                    pending_subjects: [],
                    total_missing: 0,
                });
            }

            const entry = teacherPendingMap.get(st.teacher_id)!;
            entry.pending_subjects.push({
                subject_name: scs.subject.name,
                sub_class_name: scs.sub_class.name,
                class_name: scs.sub_class.class.name,
                total_students: studentCount,
                marks_submitted: submitted,
                marks_missing: missing,
            });
            entry.total_missing += missing;
        }
    }

    // Sort by most missing first
    const pendingTeachers = Array.from(teacherPendingMap.values())
        .sort((a, b) => b.total_missing - a.total_missing);

    return {
        exam_sequence_id: examSequenceId,
        total_teachers_pending: pendingTeachers.length,
        teachers: pendingTeachers,
    };
}
