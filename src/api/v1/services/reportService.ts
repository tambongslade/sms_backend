import prisma from '../../../config/db';
import * as puppeteer from 'puppeteer';
import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import * as photoUtils from '../../../utils/photoUtils';
import getPuppeteerConfig from '../../../utils/puppeteer.config';
import * as PuppeteerManager from '../../../utils/puppeteerManager';
import { ExamSequence, Student, Enrollment, SubClass, AcademicYear } from '@prisma/client';
import * as reportCardService from './reportCardService';

// Re-use interfaces from examService (or define them centrally)
interface SubjectData { /* ... same as in examService ... */ }
interface CategorySummary { /* ... same as in examService ... */ }
interface ReportData { /* ... same as in examService ... */ }

// Report card data and rendering now live in resultsService + reportCardService
// (one calculation for Results, PDFs and stored averages).

/**
 * Generates a single student sequence report card PDF and saves it to the specified path.
 * Numbers come from resultsService (same as the Results screen).
 * @returns The final path where the PDF was saved.
 */
export async function generateAndSaveSingleStudentPdf(
    studentId: number,
    academicYearId: number,
    examSequenceId: number,
    savePath: string
): Promise<string> {
    const subClassId = await reportCardService.studentSubClass(studentId, academicYearId);
    const { buffer } = await reportCardService.generateCards(
        subClassId,
        { kind: 'SEQUENCE', exam_sequence_id: examSequenceId },
        studentId
    );
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, buffer);
    return savePath;
}

/**
 * Generates the combined sequence report card PDF for a subclass: one page per
 * student with at least one mark, in reportCardService.cardOrder() order (the
 * worker maps students to pages with the same function). Refuses (409) when
 * the class has no marks for the sequence.
 */
export async function generateAndSaveSubclassPdf(
    subClassId: number,
    academicYearId: number,
    examSequenceId: number,
    savePath: string // This path is for the final multi-page PDF
): Promise<string> {
    console.log(`[generateAndSaveSubclassPdf] Starting generation for subclass ${subClassId}, sequence ${examSequenceId}`);
    try {
        const { buffer, students } = await reportCardService.generateCards(
            subClassId,
            { kind: 'SEQUENCE', exam_sequence_id: examSequenceId }
        );
        fs.mkdirSync(path.dirname(savePath), { recursive: true });
        fs.writeFileSync(savePath, buffer);
        console.log(`[generateAndSaveSubclassPdf] Saved ${students.length} report cards for subclass ${subClassId} at: ${savePath}`);
        return savePath;
    } catch (error) {
        console.error(`[generateAndSaveSubclassPdf] Error generating PDF for subclass ${subClassId}:`, error);
        if (fs.existsSync(savePath)) {
            try { fs.unlinkSync(savePath); } catch { /* noop */ }
        }
        throw error;
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