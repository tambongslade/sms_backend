import { Job } from 'bullmq';
import path from 'path';
import fs from 'fs';
import prisma from '../config/db';
import { getWorker, reportGenerationQueueName } from '../config/queue';
import * as reportService from '../api/v1/services/reportService';
import { getSequenceResults } from '../api/v1/services/resultsService';
import { cardOrder } from '../api/v1/services/reportCardService';
import { ReportStatus, ReportType, Enrollment, ExamSequenceStatus } from '@prisma/client';

/**
 * Creates the directory structure for storing reports if it doesn't exist.
 * Example path: src/reports/generated/2024-2025/seq-5/subclass-10/student-123.pdf
 */
const ensureDirectoryExists = (filePath: string) => {
    const dirname = path.dirname(filePath);
    if (!fs.existsSync(dirname)) {
        fs.mkdirSync(dirname, { recursive: true });
        console.log(`Created directory: ${dirname}`);
    }
};

/**
 * Processes a report generation job (now primarily SUBCLASS type).
 */
const processReportJob = async (job: Job) => {
    const { generatedReportId, reportType, studentId, subClassId, academicYearId, examSequenceId } = job.data;
    console.log(`Processing report job ${job.id} (${reportType}) for GeneratedReport ID: ${generatedReportId}`);

    if (reportType !== ReportType.SUBCLASS || !subClassId) {
        console.warn(`Worker received unexpected job type (${reportType}) or missing subClassId for job ${job.id}. Skipping.`);
        // Optionally mark the unexpected job record as failed?
        // await prisma.generatedReport.update({ where: { id: generatedReportId }, data: { status: ReportStatus.FAILED, error_message: "Invalid job type received by worker" }});
        return; // Only process SUBCLASS jobs now
    }

    let generatedFilePath: string | null = null;
    let processedStudentIds: number[] = [];

    try {
        // 1. Mark the SUBCLASS report record as PROCESSING
        await prisma.generatedReport.update({
            where: { id: generatedReportId },
            data: { status: ReportStatus.PROCESSING, error_message: null },
        });

        // Determine the final save path for the combined PDF
        const basePath = path.join(process.cwd(), 'src', 'reports', 'generated');
        const academicYear = await prisma.academicYear.findUnique({ where: { id: academicYearId }, select: { name: true } });
        const yearFolderName = academicYear?.name?.replace(/\//g, '-') || `year-${academicYearId}`;
        const sequenceFolderName = `seq-${examSequenceId}`;
        const subClassInfo = await prisma.subClass.findUnique({ where: { id: subClassId }, select: { name: true, class: { select: { name: true } } } });
        const subClassFolderName = `subclass-${subClassInfo?.class?.name || ''}-${subClassInfo?.name || subClassId}`.replace(/\s+/g, '-');
        const subclassFileName = `Subclass-${subClassId}-Seq-${examSequenceId}-Report.pdf`;
        const finalSavePath = path.join(basePath, yearFolderName, sequenceFolderName, subClassFolderName, subclassFileName);
        ensureDirectoryExists(finalSavePath);

        console.log(`[Job ${job.id}] Generating combined subclass PDF at: ${finalSavePath}`);

        // 2. Generate the combined PDF for the subclass
        // This function now handles fetching all students, generating HTML, and creating the multi-page PDF.
        generatedFilePath = await reportService.generateAndSaveSubclassPdf(
            subClassId,
            academicYearId,
            examSequenceId,
            finalSavePath
        );

        if (!generatedFilePath || !fs.existsSync(generatedFilePath)) {
            throw new Error('Subclass PDF generation failed or file not found after generation.');
        }

        const relativeFilePath = path.relative(process.cwd(), generatedFilePath);

        // 3. Mark the SUBCLASS report record as COMPLETED
        await prisma.generatedReport.update({
            where: { id: generatedReportId },
            data: {
                status: ReportStatus.COMPLETED,
                file_path: relativeFilePath,
                error_message: null,
            },
        });
        console.log(`[Job ${job.id}] Successfully processed SUBCLASS report job. PDF saved at: ${relativeFilePath}`);

        // 4. Update corresponding SINGLE_STUDENT records
        console.log(`[Job ${job.id}] Updating individual student report records...`);
        // Page order MUST match the PDF: reportCardService.cardOrder() is what
        // generateAndSaveSubclassPdf used. Marks are locked once the sequence is
        // finalized, so recomputing gives the same order.
        const sequenceResults = await getSequenceResults(subClassId, examSequenceId);
        const processedEnrollments = cardOrder(sequenceResults).map(s => ({ student_id: s.student_id }));

        const studentUpdatePromises = processedEnrollments.map((enrollment, index) => {
            const studentPageNumber = index + 1; // Assign page number based on sorted order
            processedStudentIds.push(enrollment.student_id);
            return prisma.generatedReport.upsert({
                where: {
                    report_type_exam_sequence_id_academic_year_id_student_id: {
                        report_type: ReportType.SINGLE_STUDENT,
                        exam_sequence_id: examSequenceId,
                        academic_year_id: academicYearId,
                        student_id: enrollment.student_id,
                    }
                },
                update: {
                    status: ReportStatus.COMPLETED,
                    file_path: relativeFilePath, // Link to the combined PDF
                    page_number: studentPageNumber,
                    error_message: null,
                    sub_class_id: subClassId, // Ensure subclass ID is set
                },
                create: {
                    report_type: ReportType.SINGLE_STUDENT,
                    exam_sequence_id: examSequenceId,
                    academic_year_id: academicYearId,
                    student_id: enrollment.student_id,
                    sub_class_id: subClassId,
                    status: ReportStatus.COMPLETED,
                    file_path: relativeFilePath,
                    page_number: studentPageNumber,
                },
            });
        });

        // Also find any students in the subclass *without* marks for this sequence
        // and mark their SINGLE_STUDENT report record as FAILED or N/A.
        const allSubclassEnrollments = sequenceResults.students.map(s => ({ student_id: s.student_id }));
        const studentsWithoutMarks = allSubclassEnrollments.filter(e => !processedStudentIds.includes(e.student_id));

        const failedUpdatePromises = studentsWithoutMarks.map(enrollment => {
            return prisma.generatedReport.upsert({
                where: {
                    report_type_exam_sequence_id_academic_year_id_student_id: {
                        report_type: ReportType.SINGLE_STUDENT,
                        exam_sequence_id: examSequenceId,
                        academic_year_id: academicYearId,
                        student_id: enrollment.student_id,
                    }
                },
                update: {
                    status: ReportStatus.FAILED,
                    error_message: "Student had no marks for this sequence.",
                    file_path: null,
                    page_number: null,
                    sub_class_id: subClassId,
                },
                create: {
                    report_type: ReportType.SINGLE_STUDENT,
                    exam_sequence_id: examSequenceId,
                    academic_year_id: academicYearId,
                    student_id: enrollment.student_id,
                    sub_class_id: subClassId,
                    status: ReportStatus.FAILED,
                    error_message: "Student had no marks for this sequence.",
                },
            });
        });

        await Promise.all([...studentUpdatePromises, ...failedUpdatePromises]);
        console.log(`[Job ${job.id}] Finished updating/creating ${processedEnrollments.length} successful and ${studentsWithoutMarks.length} failed/N/A student report records.`);

    } catch (error: any) {
        console.error(`[Job ${job.id}] Error processing SUBCLASS report job (GeneratedReport ID: ${generatedReportId}):`, error);
        // Mark the main SUBCLASS record as FAILED
        try {
            await prisma.generatedReport.update({
                where: { id: generatedReportId },
                data: {
                    status: ReportStatus.FAILED,
                    error_message: error.message || 'Unknown error during combined report generation',
                },
            });
            // Optionally mark associated student records as failed too?
        } catch (updateError) {
            console.error(`[Job ${job.id}] Failed to update SUBCLASS GeneratedReport ${generatedReportId} status to FAILED:`, updateError);
        }
        // Clean up partially generated file if it exists
        if (generatedFilePath && fs.existsSync(generatedFilePath)) {
            try { fs.unlinkSync(generatedFilePath); } catch (e) { console.error(`Failed to delete partial file ${generatedFilePath}`); }
        }
        // Re-throw the error to let BullMQ handle retries/failure
        throw error;
    }
};

// --- Helper Function to Update ExamSequence Status ---

/**
 * Checks the status of all SUBCLASS report jobs for a given ExamSequence
 * and updates the ExamSequence status accordingly.
 */
async function checkAndUpdateSequenceStatus(examSequenceId: number): Promise<void> {
    console.log(`[Sequence ${examSequenceId}] Checking overall report generation status...`);
    try {
        const sequenceReports = await prisma.generatedReport.findMany({
            where: {
                exam_sequence_id: examSequenceId,
                report_type: ReportType.SUBCLASS, // Check status of the combined subclass jobs
            },
            select: { status: true },
        });

        if (sequenceReports.length === 0) {
            // This case might happen if the sequence finalization failed before jobs were added
            // or if there were no subclasses with marks. The sequence might already be AVAILABLE/FAILED.
            console.log(`[Sequence ${examSequenceId}] No SUBCLASS report records found. Status check inconclusive.`);
            // Optionally, double-check sequence status here if needed.
            return;
        }

        const hasFailed = sequenceReports.some(r => r.status === ReportStatus.FAILED);
        const allCompleted = sequenceReports.every(r => r.status === ReportStatus.COMPLETED);
        const anyProcessing = sequenceReports.some(r => r.status === ReportStatus.PENDING || r.status === ReportStatus.PROCESSING);

        let finalStatus: ExamSequenceStatus | null = null;

        if (hasFailed) {
            finalStatus = ExamSequenceStatus.REPORTS_FAILED;
        } else if (allCompleted) {
            finalStatus = ExamSequenceStatus.REPORTS_AVAILABLE;
        } else if (anyProcessing) {
            finalStatus = ExamSequenceStatus.REPORTS_GENERATING; // Still processing
        } else {
            // Should ideally not happen if all statuses are covered
            console.warn(`[Sequence ${examSequenceId}] Unexpected combination of report statuses. Defaulting to REPORTS_GENERATING.`);
            finalStatus = ExamSequenceStatus.REPORTS_GENERATING;
        }

        // Get current sequence status to avoid redundant updates
        const currentSequence = await prisma.examSequence.findUnique({
            where: { id: examSequenceId },
            select: { status: true },
        });

        if (currentSequence && currentSequence.status !== finalStatus) {
            await prisma.examSequence.update({
                where: { id: examSequenceId },
                data: { status: finalStatus },
            });
            console.log(`[Sequence ${examSequenceId}] Status updated to ${finalStatus}.`);
        } else if (currentSequence) {
            console.log(`[Sequence ${examSequenceId}] Status already ${currentSequence.status}. No update needed.`);
        } else {
            console.error(`[Sequence ${examSequenceId}] Could not find ExamSequence to update status.`);
        }

    } catch (error) {
        console.error(`[Sequence ${examSequenceId}] Error checking/updating sequence status:`, error);
    }
}

// --- Worker Initialization ---
console.log(`Initializing report generation worker...`);
const worker = getWorker(reportGenerationQueueName, processReportJob);

worker.on('completed', async (job: Job) => {
    console.log(`Job ${job.id} (GeneratedReport ID: ${job.data.generatedReportId}) completed successfully.`);
    // When a subclass job completes, check if all jobs for the sequence are done.
    if (job.data.reportType === ReportType.SUBCLASS && job.data.examSequenceId) {
        await checkAndUpdateSequenceStatus(job.data.examSequenceId);
    }
});

worker.on('failed', async (job: Job | undefined, err: Error) => {
    if (job) {
        console.error(`Job ${job.id} (GeneratedReport ID: ${job.data.generatedReportId}) failed after ${job.attemptsMade} attempts with error: ${err.message}`);
        // If a subclass job fails definitively, mark the whole sequence as failed.
        if (job.data.reportType === ReportType.SUBCLASS && job.data.examSequenceId) {
            console.log(`[Sequence ${job.data.examSequenceId}] Marking sequence as REPORTS_FAILED due to job failure.`);
            try {
                await prisma.examSequence.update({
                    where: { id: job.data.examSequenceId },
                    // Only update if it's not already failed (to avoid race conditions)
                    data: { status: ExamSequenceStatus.REPORTS_FAILED },
                });
                // Optionally call checkAndUpdateSequenceStatus here too for consistency, though it should result in FAILED.
                // await checkAndUpdateSequenceStatus(job.data.examSequenceId);
            } catch (updateError) {
                console.error(`[Sequence ${job.data.examSequenceId}] Error updating sequence status to FAILED:`, updateError);
            }
        }
    } else {
        console.error(`A job failed without job data: ${err.message}`, err);
    }
});

console.log(`Report generation worker listening for jobs on queue "${reportGenerationQueueName}".`); 