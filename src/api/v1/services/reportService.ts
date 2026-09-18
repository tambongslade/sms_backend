import prisma from '../../../config/db';
import * as puppeteer from 'puppeteer';
import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import * as photoUtils from '../../../utils/photoUtils';
import getPuppeteerConfig from '../../../utils/puppeteer.config';
import * as PuppeteerManager from '../../../utils/puppeteerManager';
import { ExamSequence, Student, Enrollment, SubClass, AcademicYear } from '@prisma/client';

// Re-use interfaces from examService (or define them centrally)
interface SubjectData { /* ... same as in examService ... */ }
interface CategorySummary { /* ... same as in examService ... */ }
interface ReportData { /* ... same as in examService ... */ }

/**
 * Renders the HTML for a report card using the EJS template
 */
async function renderReportCardHtml(reportData: ReportData): Promise<string> {
    const templatePath = path.join(process.cwd(), 'src/view/report-template.ejs');
    // Consider caching the template read for performance
    const template = fs.readFileSync(templatePath, 'utf-8');
    return ejs.render(template, { ...reportData, photoUtils });
}

/**
 * Generates the report data for a single student, optimized for background jobs.
 * Assumes averages/ranks are pre-calculated and fetched.
 */
async function generateStudentReportDataForWorker(
    studentId: number,
    academicYearId: number,
    examSequenceId: number
): Promise<ReportData> {
    // 1. Fetch student enrollment with necessary details
    const enrollment = await prisma.enrollment.findFirst({
        where: { student_id: studentId, academic_year_id: academicYearId },
        include: {
            student: true,
            academic_year: true,
            sub_class: { include: { class: true, class_master: true } },
            marks: {
                where: { exam_sequence_id: examSequenceId },
                include: {
                    sub_class_subject: { include: { subject: true } },
                    teacher: true
                },
                orderBy: { sub_class_subject: { subject: { category: 'asc' } } }
            }
        }
    });

    if (!enrollment) throw new Error(`Enrollment not found for student ${studentId}, year ${academicYearId}`);
    if (!enrollment.sub_class) throw new Error(`Subclass missing for enrollment ${enrollment.id}`);
    if (enrollment.marks.length === 0) throw new Error(`No marks found for student ${studentId}, sequence ${examSequenceId}`);

    const sub_classId = enrollment.sub_class_id;

    // 2. Fetch data for rank/stat calculations (All enrollments and marks in subclass)
    const allEnrollmentsInSubclass = await prisma.enrollment.findMany({
        where: { sub_class_id: sub_classId, academic_year_id: academicYearId, student: { status: { not: 'WITHDRAWN' } } },
        include: {
            marks: {
                where: { exam_sequence_id: examSequenceId },
                include: { sub_class_subject: { include: { subject: true } } }
            },
            student: { select: { id: true } } // Include student ID for ranking
        }
    });
    const validEnrollmentsWithMarks = allEnrollmentsInSubclass.filter(e => e.marks.length > 0);

    // 3. Calculate ALL Overall Averages and Rank the current student
    const studentAverages = validEnrollmentsWithMarks.map(enr => {
        const totalWeighted = enr.marks.reduce((sum, mark) => sum + mark.score * mark.sub_class_subject.coefficient, 0);
        const totalCoefficients = enr.marks.reduce((sum, mark) => sum + mark.sub_class_subject.coefficient, 0);
        return {
            studentId: enr.student.id,
            average: totalCoefficients > 0 ? parseFloat((totalWeighted / totalCoefficients).toFixed(2)) : 0,
        };
    }).sort((a, b) => b.average - a.average); // Sort descending by average

    const rankIndex = studentAverages.findIndex(s => s.studentId === studentId);
    const overallRank = rankIndex !== -1 ? `${rankIndex + 1}${getRankSuffix(rankIndex + 1)}` : 'N/A';
    const currentStudentOverallAverage = studentAverages[rankIndex]?.average ?? 0; // Get the calculated average
    const totalStudentsWithAverages = studentAverages.length;

    // 4. Calculate Subject Stats (Keep as is or optimize)
    const subjectStats = new Map<number, { scores: number[], min: number, max: number, total: number, passed: number, avg?: number, successRate?: number }>();
    const allMarksFlat = validEnrollmentsWithMarks.flatMap(e => e.marks);
    allMarksFlat.forEach(mark => {
        const subClassSubjectId = mark.sub_class_subject_id;
        if (!subjectStats.has(subClassSubjectId)) {
            subjectStats.set(subClassSubjectId, { scores: [], min: Infinity, max: -Infinity, total: 0, passed: 0 });
        }
        const stats = subjectStats.get(subClassSubjectId)!;
        stats.scores.push(mark.score);
        stats.min = Math.min(stats.min, mark.score);
        stats.max = Math.max(stats.max, mark.score);
        stats.total += mark.score;
        if (mark.score >= 10) stats.passed += 1;
    });
    subjectStats.forEach(stats => {
        const count = stats.scores.length;
        stats.avg = count > 0 ? stats.total / count : 0;
        stats.successRate = count > 0 ? (stats.passed / count) * 100 : 0;
    });

    // 5. Calculate Class Stats (using calculated averages)
    const classAverages = studentAverages.map(avg => avg.average);
    const classStats = {
        lowestAverage: classAverages.length > 0 ? Math.min(...classAverages).toFixed(2) : '0.00',
        highestAverage: classAverages.length > 0 ? Math.max(...classAverages).toFixed(2) : '0.00',
        successRate: classAverages.length > 0 ? (classAverages.filter(avg => avg >= 10).length / classAverages.length) * 100 : 0,
        standardDeviation: classAverages.length > 0 ? calculateStandardDeviation(classAverages).toFixed(2) : '0.00',
        classAverage: classAverages.length > 0 ? (classAverages.reduce((sum, avg) => sum + avg, 0) / classAverages.length).toFixed(2) : '0.00',
    };

    // 6. Prepare subjects and category summaries using fetched/calculated data (Keep as is)
    const subjects: SubjectData[] = enrollment.marks.map(mark => {
        const subClassSubjectId = mark.sub_class_subject_id;
        const stats = subjectStats.get(subClassSubjectId) || { min: 0, max: 0, avg: 0, successRate: 0 };
        const subjectScores = allMarksFlat.filter(m => m.sub_class_subject_id === subClassSubjectId).sort((a, b) => b.score - a.score);
        const subjectRankIndex = subjectScores.findIndex(m => m.enrollment_id === enrollment.id);
        const subjectRank = subjectRankIndex !== -1 ? `${subjectRankIndex + 1}th` : 'N/A'; // Use 'th' for simplicity, refine later if needed

        // Fill in the mapping based on SubjectData structure
        return {
            category: mark.sub_class_subject.subject.category,
            name: mark.sub_class_subject.subject.name,
            coefficient: mark.sub_class_subject.coefficient,
            mark: mark.score,
            weightedMark: mark.score * mark.sub_class_subject.coefficient,
            rank: subjectRank,
            teacher: mark.teacher.name,
            min: stats.min === Infinity ? 0 : parseFloat(stats.min.toFixed(2)),
            avg: parseFloat((stats.avg || 0).toFixed(2)),
            max: stats.max === -Infinity ? 0 : parseFloat(stats.max.toFixed(2)),
            successRate: parseFloat((stats.successRate || 0).toFixed(2)),
            grade: getGrade(mark.score), // Assumes getGrade is available globally or defined below
        };
    });

    const categories = Array.from(new Set(subjects.map(s => s.category)));
    const categorySummaries: CategorySummary[] = categories.map(category => {
        const categorySubjects = subjects.filter(s => s.category === category);
        if (categorySubjects.length === 0) {
            return { category, totalMark: 0, totalCoef: 0, totalWeightedMark: 0, categoryAverage: 0, categoryGrade: 'N/A', categoryMin: 0, categoryMax: 0, categoryAvg: 0, categorySuccessRate: 0, categoryRank: 'N/A' };
        }
        const totalMark = categorySubjects.reduce((sum, s) => sum + s.mark, 0);
        const totalCoef = categorySubjects.reduce((sum, s) => sum + s.coefficient, 0);
        const totalWeightedMark = categorySubjects.reduce((sum, s) => sum + s.weightedMark, 0);
        const categoryAverage = totalCoef > 0 ? totalWeightedMark / totalCoef : 0;

        // Calculate category rank for this student (requires fetching/calculating other students' category averages)
        // This remains complex and potentially slow - consider pre-calculation or simplification
        const studentCategoryAverages = validEnrollmentsWithMarks.map(enr => {
            const studentCatMarks = enr.marks.filter(m => m.sub_class_subject.subject.category === category);
            if (studentCatMarks.length === 0) return { studentId: enr.student_id, average: 0 };
            const catTotalWeighted = studentCatMarks.reduce((sum, m) => sum + m.score * m.sub_class_subject.coefficient, 0);
            const catTotalCoef = studentCatMarks.reduce((sum, m) => sum + m.sub_class_subject.coefficient, 0);
            return { studentId: enr.student_id, average: catTotalCoef > 0 ? catTotalWeighted / catTotalCoef : 0 };
        }).sort((a, b) => b.average - a.average);
        const studentCategoryRankIndex = studentCategoryAverages.findIndex(s => s.studentId === studentId);
        const categoryRank = studentCategoryRankIndex >= 0 ? `${studentCategoryRankIndex + 1}th` : 'N/A';

        // Simplified category stats (min/max/avg based on subjects for *this* student)
        // For class-wide category stats, more complex aggregation is needed, potentially pre-calculated.
        const categoryMin = Math.min(...categorySubjects.map(s => s.min));
        const categoryMax = Math.max(...categorySubjects.map(s => s.max));
        const categoryAvg = categorySubjects.reduce((sum, s) => sum + s.avg, 0) / categorySubjects.length;
        const categorySuccessRate = categorySubjects.reduce((sum, s) => sum + s.successRate, 0) / categorySubjects.length;

        return {
            category,
            totalMark,
            totalCoef,
            totalWeightedMark,
            categoryAverage,
            categoryGrade: getGrade(categoryAverage),
            categoryMin: parseFloat(categoryMin.toFixed(2)),
            categoryMax: parseFloat(categoryMax.toFixed(2)),
            categoryAvg: parseFloat(categoryAvg.toFixed(2)),
            categorySuccessRate: parseFloat(categorySuccessRate.toFixed(2)),
            categoryRank
        };
    });

    // Helper to add suffix to rank (1st, 2nd, 3rd, etc.)
    function getRankSuffix(rank: number): string {
        if (rank % 100 >= 11 && rank % 100 <= 13) return 'th';
        switch (rank % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
        }
    }

    // Fetch ExamSequence details for the report header
    const examSequence = await prisma.examSequence.findUnique({ where: { id: examSequenceId }, include: { term: true } });

    // 7. Assemble final ReportData object using calculated values
    const reportData: ReportData = {
        student: {
            name: enrollment.student.name,
            matricule: enrollment.student.matricule,
            dateOfBirth: enrollment.student.date_of_birth.toISOString().split('T')[0],
            placeOfBirth: enrollment.student.place_of_birth,
            gender: enrollment.student.gender,
            repeater: enrollment.repeater,
            photo: enrollment.photo || 'default-student.jpg', // Use local filename for faster access
        },
        classInfo: {
            className: `${enrollment.sub_class.class.name} ${enrollment.sub_class.name}`,
            enrolledStudents: totalStudentsWithAverages, // Use count from calculated averages
            classMaster: enrollment.sub_class.class_master?.name ?? 'Not Assigned',
            academicYear: `${enrollment.academic_year.start_date.getFullYear()}-${enrollment.academic_year.end_date.getFullYear()}`,
        },
        subjects, // Use mapped subjects
        categories, // Use mapped categories
        categorySummaries, // Use mapped summaries
        totals: {
            // Recalculate totals from the student's marks/subjects array
            totalMark: subjects.reduce((sum, s) => sum + s.mark, 0),
            totalCoef: subjects.reduce((sum, s) => sum + s.coefficient, 0),
            totalWeightedMark: subjects.reduce((sum, s) => sum + s.weightedMark, 0),
            overallAverage: currentStudentOverallAverage, // Use calculated average
            overallGrade: getGrade(currentStudentOverallAverage)
        },
        statistics: {
            overallAverage: currentStudentOverallAverage.toFixed(2), // Use calculated average
            rank: overallRank, // Use calculated rank
            subjectsPassed: enrollment.marks.filter(m => m.score >= 10).length,
            classStats: classStats // Use calculated class stats
        },
        examSequence: {
            name: `Evaluation N° ${examSequence?.sequence_number || '?'}`,
            sequenceNumber: examSequence?.sequence_number || 0,
            termName: examSequence?.term?.name || 'Unknown Term'
        }
    };

    return reportData;
}

/**
 * Generates a single student PDF report and saves it to the specified path.
 * @returns The final path where the PDF was saved.
 */
export async function generateAndSaveSingleStudentPdf(
    studentId: number,
    academicYearId: number,
    examSequenceId: number,
    savePath: string
): Promise<string> {
    let page: puppeteer.Page | null = null;
    try {
        console.log(`[generateAndSaveSingleStudentPdf] Generating data for student ${studentId}...`);
        const reportData = await generateStudentReportDataForWorker(studentId, academicYearId, examSequenceId);

        console.log(`[generateAndSaveSingleStudentPdf] Rendering HTML for student ${studentId}...`);
        const html = await renderReportCardHtml(reportData);

        console.log(`[generateAndSaveSingleStudentPdf] Generating PDF for student ${studentId} at ${savePath}...`);
        page = await PuppeteerManager.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdf = await page.pdf({
            format: 'A3',
            printBackground: true,
            margin: { top: '4mm', right: '4mm', bottom: '4mm', left: '4mm' },
            preferCSSPageSize: true,
            scale: 0.9,
            pageRanges: '1'
        });

        fs.writeFileSync(savePath, pdf);
        console.log(`[generateAndSaveSingleStudentPdf] PDF saved successfully for student ${studentId}.`);

        return savePath;

    } catch (error) {
        console.error(`[generateAndSaveSingleStudentPdf] Error for student ${studentId}:`, error);
        // Optionally delete the file if creation failed partially
        if (fs.existsSync(savePath)) {
            fs.unlinkSync(savePath);
        }
        throw error; // Re-throw for the worker to catch
    } finally {
        if (page) {
            try {
                await page.close();
            } catch (closeError) {
                console.error(`[generateAndSaveSingleStudentPdf] Error closing Puppeteer page for student ${studentId}:`, closeError);
            }
        }
    }
}

/**
 * Generates a summary PDF for an entire subclass.
 * Fetches data for all students, renders HTML, and combines into a single multi-page PDF.
 */
export async function generateAndSaveSubclassPdf(
    subClassId: number,
    academicYearId: number,
    examSequenceId: number,
    savePath: string // This path is for the final multi-page PDF
): Promise<string> {
    console.log(`[generateAndSaveSubclassPdf] Starting generation for subclass ${subClassId}, sequence ${examSequenceId}`);
    let browserPage: puppeteer.Page | null = null;
    try {
        // 1. Fetch all relevant enrollments for the subclass and academic year
        const enrollments = await prisma.enrollment.findMany({
            where: {
                sub_class_id: subClassId,
                academic_year_id: academicYearId,
                student: { status: { not: 'WITHDRAWN' } }
            },
            select: { student_id: true }, // Only need student IDs to iterate
            orderBy: { student: { name: 'asc' } } // Sort for consistent PDF page order
        });

        if (enrollments.length === 0) {
            console.warn(`[generateAndSaveSubclassPdf] No students found in subclass ${subClassId} for year ${academicYearId}. Creating empty report.`);
            // Create an empty or message file as placeholder
            fs.writeFileSync(savePath, "No students found in this subclass for the selected academic year.");
            return savePath;
            // Or throw new Error('No students found in subclass for PDF generation.');
        }

        console.log(`[generateAndSaveSubclassPdf] Found ${enrollments.length} students. Generating report data...`);

        // 2. Generate report data and HTML for each student
        const htmlPages: string[] = [];
        let generatedCount = 0;
        for (const enrollment of enrollments) {
            try {
                const reportData = await generateStudentReportDataForWorker(enrollment.student_id, academicYearId, examSequenceId);
                const html = await renderReportCardHtml(reportData);
                // Extract only the body content to avoid nested HTML/Body tags
                const bodyContent = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
                // Wrap each report card in a div for page breaking
                htmlPages.push(`<div class="report-page">${bodyContent}</div>`);
                generatedCount++;
            } catch (studentError: any) {
                // Log error but continue with other students
                console.error(`[generateAndSaveSubclassPdf] Error generating report data/HTML for student ${enrollment.student_id} in subclass ${subClassId}:`, studentError.message);
                // Optionally add a placeholder page indicating failure for this student
                // htmlPages.push(`<div class="report-page error-page">Failed to generate report for Student ID: ${enrollment.student_id} - ${studentError.message}</div>`);
            }
        }

        if (htmlPages.length === 0) {
            throw new Error(`No valid report HTML could be generated for any student in subclass ${subClassId}.`);
        }

        console.log(`[generateAndSaveSubclassPdf] Generated HTML for ${generatedCount}/${enrollments.length} students. Combining HTML...`);

        // 3. Combine HTML pages with wrapper and page break styles
        const combinedHtml = htmlPages.join('\n');
        const wrapperHtml = `
    <!DOCTYPE html>
    <html>
    <head>
            <meta charset="UTF-8">
        <title>Subclass Report Cards</title>
            <script src="https://cdn.tailwindcss.com"></script>
        <style>
            /* Styles for printing */
            html, body { margin: 0; padding: 0; width: 100%; height: 100%; box-sizing: border-box; }
             @media print {
                html, body {
                     width: 297mm; /* A3 width */
                     box-sizing: border-box;
                }
                .report-page {
                    page-break-after: always; /* Ensure each report is on a new page */
                    box-sizing: border-box;
                    width: 297mm; /* Match A3 width */
                    /* height: 419mm; Remove fixed height - Let content flow */
                    overflow: hidden; /* Prevent content spill - Might need removal if content is clipped */
                     display: block; /* Use block for simpler page breaks */
                    padding: 5mm; /* Padding inside the page */
                    position: relative; /* Needed for potential absolute positioning inside */
                }
                 .report-page:last-child {
                     page-break-after: avoid;
                 }
                table, tr, td, th { page-break-inside: avoid !important; }
                 @page {
                    size: A3 portrait;
                    margin: 0mm;
                 }
                 .text-xs { font-size: 0.7rem !important; line-height: 1 !important; }
                 .text-sm { font-size: 0.8rem !important; line-height: 1.1 !important; }
                 .text-lg { font-size: 1rem !important; }
                 .text-4xl { font-size: 2rem !important; }
                 h1, h2, p { margin-top: 0.1rem; margin-bottom: 0.1rem; }
                 .p-4 { padding: 0.5rem !important; }
                 .p-1 { padding: 0.1rem !important; }
                 .py-2 { padding-top: 0.25rem !important; padding-bottom: 0.25rem !important; }
                 .pb-2 { padding-bottom: 0.25rem !important; }
                 .mb-2 { margin-bottom: 0.25rem !important; }
                 .mb-4 { margin-bottom: 0.5rem !important; }
                 .mb-5 { margin-bottom: 0.6rem !important; }
                 .mb-6 { margin-bottom: 0.7rem !important; }
                 .mb-8 { margin-bottom: 1rem !important; }
                 .mt-2 { margin-top: 0.25rem !important; }
                 .mt-20 { margin-top: 2rem !important; }
                 table { font-size: 0.65rem !important; line-height: 1 !important; margin-bottom: 0.5rem !important; }
                 thead th { padding: 0.1rem !important;}
                 tbody td { padding: 0.1rem !important; }
                 .container {
                     max-width: 100% !important;
                     padding: 0 !important;
                     margin: 0 auto !important;
                     width: 100% !important;
                 }
                 img.w-24 { width: 5rem !important; height: 5rem !important; }
                 img.w-32 { width: 6rem !important; }
                 .flex { display: flex; }
                 footer > .flex { display: flex; justify-content: space-between; }
                 .statistics-section > .flex { display: flex; align-items: flex-start; }
             }
             .report-page {
                box-sizing: border-box;
                width: 297mm;
                padding: 5mm;
                margin: 10mm auto;
                border: 1px solid #ccc;
                overflow: hidden;
                 position: relative;
            }
             .error-page { background-color: #ffeeee; color: red; padding: 20px; height: 410mm; }
        </style>
    </head>
    <body>
        ${combinedHtml}
    </body>
    </html>`;

        console.log(`[generateAndSaveSubclassPdf] Combined HTML generated. Starting PDF generation via Puppeteer...`);

        // 4. Generate the multi-page PDF using Puppeteer
        browserPage = await PuppeteerManager.newPage();
        await browserPage.emulateMediaType('print');
        await browserPage.setContent(wrapperHtml, { waitUntil: 'networkidle0', timeout: 180000 }); // 3 minutes timeout

        const pdf = await browserPage.pdf({
            path: savePath, // Save directly to the path
            format: 'A3',
            printBackground: true,
            margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
            preferCSSPageSize: true,
            timeout: 180000 // 3 minutes timeout for PDF generation itself
        });

        console.log(`[generateAndSaveSubclassPdf] PDF saved successfully for subclass ${subClassId} at: ${savePath}`);
        return savePath; // Return the path where the PDF was saved

    } catch (error) {
        console.error(`[generateAndSaveSubclassPdf] Error generating multi-page PDF for subclass ${subClassId}:`, error);
        // Clean up potentially created file on error
        if (fs.existsSync(savePath)) {
            try {
                fs.unlinkSync(savePath);
            } catch (unlinkErr) {
                console.error(`Error deleting partial PDF file ${savePath}:`, unlinkErr);
            }
        }
        throw error; // Re-throw for the worker to catch
    } finally {
        // Ensure the Puppeteer page is closed
        if (browserPage) {
            try {
                await browserPage.close();
                console.log(`[generateAndSaveSubclassPdf] Closed Puppeteer page for subclass ${subClassId}.`);
            } catch (e) {
                console.error('[generateAndSaveSubclassPdf] Error closing Puppeteer page:', e);
            }
        }
    }
}


// --- Helper Functions (Copied/Adapted from examService - needs refactoring) ---

// Copy the implementations of calculateStandardDeviation and getGrade here
// Copy the interface definitions for SubjectData, CategorySummary, ReportData here
// NOTE: This duplication is not ideal. These should be moved to a shared utility/types location.

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

function calculateStandardDeviation(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const avg = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
    return Math.sqrt(numbers.map(n => Math.pow(n - avg, 2)).reduce((a, b) => a + b) / numbers.length);
}

function getGrade(mark: number): string {
    if (mark >= 18) return 'A+';
    if (mark >= 16) return 'A';
    if (mark >= 15) return 'B+';
    if (mark >= 14) return 'B';
    if (mark >= 12) return 'C+';
    if (mark >= 10) return 'C';
    return 'D';
} 