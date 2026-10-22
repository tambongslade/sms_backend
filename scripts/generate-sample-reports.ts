/**
 * Sample report card generator — renders both v1 (preprod) and v2 (preprod1)
 * templates with representative mock data for FORM 3, FORM 5,
 * LOWER SIXTH SCIENCE, and LOWER SIXTH ARTS.
 *
 * Output: uploads/samples/preprod-<level>.pdf and preprod1-<level>.pdf
 * Reachable at: https://api.ssiccmr.com/uploads/samples/<file>.pdf
 */

import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import * as puppeteer from 'puppeteer';
import * as photoUtils from '../src/utils/photoUtils';

// ---------- Types matching the templates' expected shape ----------

type SubjectSpec = {
    name: string;
    category: string;
    coefficient: number;
    teacher: string;
    mark: number;
};

type Level = {
    key: string;
    className: string;
    classMaster: string;
    levelBucket: 'F1_F2' | 'F3_F5' | 'LSS_USS';
    passMark: number;
    student: {
        name: string;
        matricule: string;
        dateOfBirth: string;
        gender: string;
        repeater: boolean;
    };
    enrolledStudents: number;
    subjects: SubjectSpec[];
};

// ---------- Helpers matching reportService.ts ----------

function getGrade(mark: number, bucket: 'F1_F2' | 'F3_F5' | 'LSS_USS'): string {
    if (bucket === 'LSS_USS') {
        // GCE A-Level 6-tier
        if (mark >= 16) return 'A';
        if (mark >= 14) return 'B';
        if (mark >= 12) return 'C';
        if (mark >= 10) return 'D';
        if (mark >= 8) return 'E';
        return 'F';
    }
    // 7-tier (F1-F5)
    if (mark >= 18) return 'A+';
    if (mark >= 16) return 'A';
    if (mark >= 15) return 'B+';
    if (mark >= 14) return 'B';
    if (mark >= 12) return 'C+';
    if (mark >= 10) return 'C';
    return 'D';
}

function rankSuffix(n: number): string {
    if (n % 100 >= 11 && n % 100 <= 13) return 'th';
    switch (n % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

// ---------- Mock data ----------

const F3_SUBJECTS = (): SubjectSpec[] => [
    { name: 'Mathematics',        category: 'SCIENCE_AND_TECHNOLOGY',   coefficient: 4, teacher: 'Mr. TCHOUA JEAN',        mark: 14.5 },
    { name: 'Physics',            category: 'SCIENCE_AND_TECHNOLOGY',   coefficient: 3, teacher: 'Mrs. NGONO CLAIRE',      mark: 13.0 },
    { name: 'Chemistry',          category: 'SCIENCE_AND_TECHNOLOGY',   coefficient: 3, teacher: 'Mr. FOTSO PAUL',         mark: 15.5 },
    { name: 'Biology',            category: 'SCIENCE_AND_TECHNOLOGY',   coefficient: 2, teacher: 'Mrs. MBALLA ROSE',       mark: 12.5 },
    { name: 'English Language',   category: 'LANGUAGES_AND_LITERATURE', coefficient: 3, teacher: 'Mr. TABE COLLINS',       mark: 16.0 },
    { name: 'French',             category: 'LANGUAGES_AND_LITERATURE', coefficient: 3, teacher: 'Mme. KAMDEM SOPHIE',     mark: 11.5 },
    { name: 'History',            category: 'HUMAN_AND_SOCIAL_SCIENCE', coefficient: 2, teacher: 'Mr. NKENG DAVID',        mark: 13.5 },
    { name: 'Geography',          category: 'HUMAN_AND_SOCIAL_SCIENCE', coefficient: 2, teacher: 'Mrs. AWA GRACE',         mark: 14.0 },
    { name: 'Physical Education', category: 'OTHERS',                   coefficient: 1, teacher: 'Mr. MOUSSA OUMAR',       mark: 17.0 },
];

const F5_SUBJECTS = (): SubjectSpec[] => [
    { name: 'Mathematics',        category: 'SCIENCE_AND_TECHNOLOGY',   coefficient: 4, teacher: 'Mr. TCHOUA JEAN',        mark: 12.0 },
    { name: 'Physics',            category: 'SCIENCE_AND_TECHNOLOGY',   coefficient: 3, teacher: 'Mrs. NGONO CLAIRE',      mark: 11.5 },
    { name: 'Chemistry',          category: 'SCIENCE_AND_TECHNOLOGY',   coefficient: 3, teacher: 'Mr. FOTSO PAUL',         mark: 13.5 },
    { name: 'Biology',            category: 'SCIENCE_AND_TECHNOLOGY',   coefficient: 2, teacher: 'Mrs. MBALLA ROSE',       mark: 14.0 },
    { name: 'English Language',   category: 'LANGUAGES_AND_LITERATURE', coefficient: 3, teacher: 'Mr. TABE COLLINS',       mark: 15.0 },
    { name: 'French',             category: 'LANGUAGES_AND_LITERATURE', coefficient: 3, teacher: 'Mme. KAMDEM SOPHIE',     mark: 10.5 },
    { name: 'History',            category: 'HUMAN_AND_SOCIAL_SCIENCE', coefficient: 2, teacher: 'Mr. NKENG DAVID',        mark: 12.5 },
    { name: 'Geography',          category: 'HUMAN_AND_SOCIAL_SCIENCE', coefficient: 2, teacher: 'Mrs. AWA GRACE',         mark: 11.0 },
    { name: 'Physical Education', category: 'OTHERS',                   coefficient: 1, teacher: 'Mr. MOUSSA OUMAR',       mark: 16.0 },
];

// Sixth-form students choose 5 subjects (not the full set offered by the class)
const LSS_SCIENCE_SUBJECTS = (): SubjectSpec[] => [
    { name: 'Mathematics',      category: 'SCIENCE_AND_TECHNOLOGY',   coefficient: 4, teacher: 'Mr. TCHOUA JEAN',    mark: 15.0 },
    { name: 'Physics',          category: 'SCIENCE_AND_TECHNOLOGY',   coefficient: 4, teacher: 'Mrs. NGONO CLAIRE',  mark: 12.5 },
    { name: 'Chemistry',        category: 'SCIENCE_AND_TECHNOLOGY',   coefficient: 4, teacher: 'Mr. FOTSO PAUL',     mark: 14.0 },
    { name: 'Biology',          category: 'SCIENCE_AND_TECHNOLOGY',   coefficient: 3, teacher: 'Mrs. MBALLA ROSE',   mark: 11.0 },
    { name: 'English Language', category: 'LANGUAGES_AND_LITERATURE', coefficient: 3, teacher: 'Mr. TABE COLLINS',   mark: 13.0 },
];

const LSS_ARTS_SUBJECTS = (): SubjectSpec[] => [
    { name: 'English Language',      category: 'LANGUAGES_AND_LITERATURE', coefficient: 4, teacher: 'Mr. TABE COLLINS',   mark: 14.0 },
    { name: 'Literature in English', category: 'LANGUAGES_AND_LITERATURE', coefficient: 4, teacher: 'Mrs. NGWA ESTHER',   mark: 15.5 },
    { name: 'History',               category: 'HUMAN_AND_SOCIAL_SCIENCE', coefficient: 3, teacher: 'Mr. NKENG DAVID',    mark: 13.5 },
    { name: 'Geography',             category: 'HUMAN_AND_SOCIAL_SCIENCE', coefficient: 3, teacher: 'Mrs. AWA GRACE',     mark: 11.5 },
    { name: 'Economics',             category: 'HUMAN_AND_SOCIAL_SCIENCE', coefficient: 3, teacher: 'Mrs. NDIP CHARITY',  mark: 10.5 },
];

const LEVELS: Level[] = [
    {
        key: 'form3',
        className: 'FORM 3 South',
        classMaster: 'Mrs. NGO BILE MARIE',
        levelBucket: 'F3_F5',
        passMark: 12,
        student: { name: 'FONYUY TRACY FOMONYUY', matricule: 'SS26CL0230', dateOfBirth: '2011-06-14', gender: 'Female', repeater: false },
        enrolledStudents: 58,
        subjects: F3_SUBJECTS(),
    },
    {
        key: 'form5',
        className: 'FORM 5 Middle North',
        classMaster: 'Mr. EYOMBWAN PHILIPPE',
        levelBucket: 'F3_F5',
        passMark: 11,
        student: { name: 'KOUEMOU CEDRIC ARMEL', matricule: 'SS25CL0512', dateOfBirth: '2009-11-02', gender: 'Male', repeater: false },
        enrolledStudents: 51,
        subjects: F5_SUBJECTS(),
    },
    {
        key: 'lower-sixth-science',
        className: 'LOWER SIXTH S1',
        classMaster: 'Mr. TCHOUA JEAN',
        levelBucket: 'LSS_USS',
        passMark: 11,
        student: { name: 'MENGUE MARIE CLAIRE', matricule: 'SS26LS0018', dateOfBirth: '2008-03-27', gender: 'Female', repeater: false },
        enrolledStudents: 24,
        subjects: LSS_SCIENCE_SUBJECTS(),
    },
    {
        key: 'lower-sixth-arts',
        className: 'LOWER SIXTH A1',
        classMaster: 'Mr. TABE COLLINS',
        levelBucket: 'LSS_USS',
        passMark: 11,
        student: { name: 'ATANGANA BILONG YVAN', matricule: 'SS26LS0031', dateOfBirth: '2008-08-11', gender: 'Male', repeater: false },
        enrolledStudents: 28,
        subjects: LSS_ARTS_SUBJECTS(),
    },
];

// ---------- Build ReportData ----------

function buildReportData(level: Level) {
    const subjects = level.subjects.map((s, i) => {
        const grade = getGrade(s.mark, level.levelBucket);
        // Mock a random rank between 3 and 20 for demo purposes
        const r = ((i * 7) % 18) + 3;
        return {
            category: s.category,
            name: s.name,
            coefficient: s.coefficient,
            mark: s.mark,
            weightedMark: s.mark * s.coefficient,
            rank: `${r}${rankSuffix(r)}`,
            teacher: s.teacher,
            // v1 template still reads these — supply harmless values
            min: 3.5,
            avg: 11.2,
            max: 19.0,
            successRate: 72,
            grade,
        };
    });

    const categoriesSet = Array.from(new Set(subjects.map(s => s.category)));
    const categorySummaries = categoriesSet.map(category => {
        const catSubjects = subjects.filter(s => s.category === category);
        const totalMark = catSubjects.reduce((sum, s) => sum + s.mark, 0);
        const totalCoef = catSubjects.reduce((sum, s) => sum + s.coefficient, 0);
        const totalWeightedMark = catSubjects.reduce((sum, s) => sum + s.weightedMark, 0);
        const categoryAverage = totalCoef > 0 ? totalWeightedMark / totalCoef : 0;
        return {
            category,
            totalMark,
            totalCoef,
            totalWeightedMark,
            categoryAverage,
            categoryGrade: getGrade(categoryAverage, level.levelBucket),
            categoryMin: Math.min(...catSubjects.map(s => s.min)),
            categoryMax: Math.max(...catSubjects.map(s => s.max)),
            categoryAvg: catSubjects.reduce((sum, s) => sum + s.avg, 0) / catSubjects.length,
            categorySuccessRate: catSubjects.reduce((sum, s) => sum + s.successRate, 0) / catSubjects.length,
            categoryRank: '5th',
        };
    });

    const totalMark = subjects.reduce((sum, s) => sum + s.mark, 0);
    const totalCoef = subjects.reduce((sum, s) => sum + s.coefficient, 0);
    const totalWeightedMark = subjects.reduce((sum, s) => sum + s.weightedMark, 0);
    const overallAverage = totalCoef > 0 ? totalWeightedMark / totalCoef : 0;

    return {
        student: {
            name: level.student.name,
            matricule: level.student.matricule,
            dateOfBirth: level.student.dateOfBirth,
            placeOfBirth: 'Yaoundé',
            gender: level.student.gender,
            repeater: level.student.repeater,
            photo: 'default-student.jpg',
        },
        classInfo: {
            className: level.className,
            enrolledStudents: level.enrolledStudents,
            classMaster: level.classMaster,
            academicYear: '2026-2027',
            reportDate: 'Yaoundé, ' + new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
            // v2-only extras — ignored by v1
            levelBucket: level.levelBucket,
            passMark: level.passMark,
        },
        subjects,
        categories: categoriesSet,
        categorySummaries,
        totals: {
            totalMark,
            totalCoef,
            totalWeightedMark,
            overallAverage,
            overallGrade: getGrade(overallAverage, level.levelBucket),
        },
        statistics: {
            overallAverage: overallAverage.toFixed(2),
            rank: '4th',
            subjectsPassed: subjects.filter(s => s.mark >= level.passMark).length,
            classStats: {
                lowestAverage: '6.20',
                highestAverage: '17.80',
                successRate: 68,
                standardDeviation: '3.45',
                classAverage: '11.90',
            },
        },
        examSequence: {
            name: 'Evaluation N° 2',
            sequenceNumber: 2,
            termName: 'Second Term',
        },
    };
}

// ---------- Render + PDF ----------

async function renderPdf(browser: puppeteer.Browser, templatePath: string, reportData: any, outputPath: string) {
    const template = fs.readFileSync(templatePath, 'utf-8');
    const html = ejs.render(template, { ...reportData, photoUtils });
    const page = await browser.newPage();
    try {
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({
            format: 'A3',
            printBackground: true,
            margin: { top: '4mm', right: '4mm', bottom: '4mm', left: '4mm' },
            preferCSSPageSize: true,
            scale: 0.9,
        });
        fs.writeFileSync(outputPath, pdf);
    } finally {
        await page.close();
    }
}

async function main() {
    const projectRoot = process.cwd();
    const outputDir = path.join(projectRoot, 'uploads', 'samples');
    fs.mkdirSync(outputDir, { recursive: true });

    const v1Template = path.join(projectRoot, 'src/view/report-template.ejs');
    const v2Template = path.join(projectRoot, 'src/view/report-template-v2.ejs');

    console.log('Launching Puppeteer...');
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        for (const level of LEVELS) {
            const reportData = buildReportData(level);

            const v1Path = path.join(outputDir, `preprod-${level.key}.pdf`);
            const v2Path = path.join(outputDir, `preprod1-${level.key}.pdf`);

            console.log(`[${level.key}] Rendering v1 -> ${path.relative(projectRoot, v1Path)}`);
            await renderPdf(browser, v1Template, reportData, v1Path);

            console.log(`[${level.key}] Rendering v2 -> ${path.relative(projectRoot, v2Path)}`);
            await renderPdf(browser, v2Template, reportData, v2Path);
        }
        console.log('\nDone. Files written to uploads/samples/');
    } finally {
        await browser.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
