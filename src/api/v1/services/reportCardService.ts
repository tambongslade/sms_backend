// src/api/v1/services/reportCardService.ts
//
// Builds sequence, term and annual report card PDFs from resultsService, so
// the printed numbers are exactly the ones on the Results screen.

import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import moment from 'moment';
import * as PuppeteerManager from '../../../utils/puppeteerManager';
import {
    ClassResults, StudentResult, ResultsError, PASS_MARK,
    getSequenceResults, getTermResults, getAnnualResults,
    ordinal, grade, appreciation, decisionLabel,
} from './resultsService';
import prisma from '../../../config/db';

const SCHOOL = {
    name: "ST STEPHEN'S INTERNATIONAL COLLEGE",
    tagline: 'Excellence for Higher Heights',
    address: 'Yaounde Essono city Damas',
    phone: '(+237) 680 188 080 / 681 630 435',
};

// Neutral grey silhouette used when a student has no photo on file.
const SILHOUETTE = 'data:image/svg+xml;base64,' + Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 78 92">' +
    '<rect width="78" height="92" fill="#e5e7eb"/>' +
    '<circle cx="39" cy="34" r="16" fill="#9ca3af"/>' +
    '<path d="M8 92c0-20 14-32 31-32s31 12 31 32z" fill="#9ca3af"/>' +
    '</svg>'
).toString('base64');

const STUDENT_PHOTOS_DIR = path.join(process.cwd(), 'uploads', 'students');
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

const cache: { template?: string; logo?: string } = {};
function assets() {
    if (!cache.template) {
        cache.template = fs.readFileSync(path.join(process.cwd(), 'src/view/report-card-template.ejs'), 'utf-8');
    }
    if (cache.logo === undefined) {
        try {
            cache.logo = `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), 'public/school.png')).toString('base64')}`;
        } catch {
            cache.logo = '';
        }
    }
    return { template: cache.template, logo: cache.logo };
}

/** The student's own photo as a data URI, or a neutral silhouette. Never a stock photo. */
export function studentPhoto(filename: string | null): string {
    if (!filename) return SILHOUETTE;
    const base = path.basename(filename); // stored values are file names; strip any path
    for (const dir of [STUDENT_PHOTOS_DIR, UPLOAD_DIR]) {
        const p = path.join(dir, base);
        try {
            if (fs.existsSync(p)) {
                const ext = path.extname(p).toLowerCase();
                const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
                return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
            }
        } catch { /* fall through */ }
    }
    return SILHOUETTE;
}

function titleFor(r: ClassResults) {
    switch (r.scope.kind) {
        case 'SEQUENCE':
            return { title: `Report Card - Sequence ${r.scope.sequence_number}`, subtitle: `${r.scope.term_name ?? ''} ${r.scope.academic_year_name}`.trim(), markLabel: 'Mark /20' };
        case 'TERM':
            return { title: `Report Card - ${r.scope.term_name}`, subtitle: r.scope.academic_year_name, markLabel: 'Term /20' };
        default:
            return { title: 'Annual Report Card', subtitle: r.scope.academic_year_name, markLabel: 'Annual /20' };
    }
}

async function nextClassName(r: ClassResults): Promise<string | null> {
    if (!r.sub_class.next_class_id) return null;
    const c = await prisma.class.findUnique({ where: { id: r.sub_class.next_class_id }, select: { name: true } });
    return c?.name ?? null;
}

function buildCard(r: ClassResults, s: StudentResult, nextClass: string | null) {
    const { title, subtitle, markLabel } = titleFor(r);
    const stats = new Map(r.subject_stats.map(st => [st.sub_class_subject_id, st]));
    const partLabels = s.subjects[0]?.parts.map(p => p.label) ?? [];

    const rows = r.subjects.map((sub, i) => {
        const x = s.subjects[i];
        const st = stats.get(sub.sub_class_subject_id);
        return {
            category: sub.category,
            name: sub.name,
            teacher: sub.teacher_name,
            coefficient: sub.coefficient,
            parts: x.parts.map(p => p.score),
            score: x.score,
            weighted: x.weighted,
            rankLabel: x.rank === null ? 'NC' : ordinal(x.rank),
            grade: grade(x.score),
            min: st?.min ?? null,
            avg: st?.average ?? null,
            max: st?.max ?? null,
        };
    });

    const categories = [...new Set(rows.map(r => r.category))].map(name => {
        const subs = rows.filter(r => r.category === name);
        const marked = subs.filter(x => x.score !== null);
        const coef = marked.reduce((a, x) => a + x.coefficient, 0);
        const weighted = marked.reduce((a, x) => a + (x.weighted ?? 0), 0);
        return {
            name: name.replace(/_/g, ' '),
            subjects: subs,
            coefficient: coef,
            weighted,
            average: coef > 0 ? weighted / coef : null,
        };
    });

    let decision: string | null = null;
    if (r.scope.kind === 'ANNUAL') {
        const label = decisionLabel(s.average, r.sub_class.pass_mark, !!r.sub_class.next_class_id, r.sub_class.class_name);
        decision = label === 'Promoted' && nextClass ? `Promoted to ${nextClass}` : label;
    }

    return {
        title,
        subtitle,
        markLabel,
        partLabels,
        academicYear: r.scope.academic_year_name,
        student: {
            name: s.name,
            matricule: s.matricule,
            gender: s.gender,
            dateOfBirth: s.date_of_birth ? moment(s.date_of_birth).format('DD/MM/YYYY') : '',
            placeOfBirth: s.place_of_birth,
            repeater: s.repeater,
            photo: studentPhoto(s.photo),
        },
        classInfo: {
            name: r.sub_class.name,
            enrolled: r.class_stats.enrolled,
            classMaster: r.sub_class.class_master_name,
        },
        categories,
        totals: {
            coefficient: s.total_coefficient,
            weighted: s.total_weighted,
            average: s.average,
            rank: s.rank,
            rankLabel: s.rank === null ? 'NC' : ordinal(s.rank),
            appreciation: appreciation(s.average),
            subjectsMarked: s.subjects_with_marks,
            subjectsPassed: s.subjects_passed,
        },
        termAverages: s.term_averages?.map(t => ({ name: t.term_name, average: t.average, rankLabel: t.rank === null ? 'NC' : ordinal(t.rank) })) ?? null,
        classStats: {
            classAverage: r.class_stats.class_average,
            highest: r.class_stats.highest,
            lowest: r.class_stats.lowest,
            successRate: r.class_stats.success_rate,
            ranked: r.class_stats.ranked,
            enrolled: r.class_stats.enrolled,
        },
        decision,
        remark: s.average === null ? '' : appreciation(s.average),
    };
}

/**
 * Students who get a card, in page order: those with at least one mark in
 * scope, alphabetically. The report worker relies on this order to map each
 * student to their page in the combined PDF.
 */
export function cardOrder(r: ClassResults): StudentResult[] {
    return r.students
        .filter(s => s.subjects_with_marks > 0)
        .sort((a, b) => a.name.localeCompare(b.name) || a.student_id - b.student_id);
}

export function assertHasMarks(r: ClassResults, studentId?: number) {
    if (r.total_marks === 0) {
        throw new ResultsError(409, `No marks have been entered for ${r.sub_class.name} (${r.scope.label}). Report cards cannot be generated yet.`);
    }
    if (studentId !== undefined) {
        const s = r.students.find(x => x.student_id === studentId);
        if (!s) throw new ResultsError(404, `Student ${studentId} is not enrolled in ${r.sub_class.name} for ${r.scope.academic_year_name}`);
        if (s.subjects_with_marks === 0) {
            throw new ResultsError(409, `${s.name} has no marks for ${r.scope.label}. A report card cannot be generated.`);
        }
    }
}

export async function renderCardsHtml(r: ClassResults, students: StudentResult[]): Promise<string> {
    const { template, logo } = assets();
    const nextClass = r.scope.kind === 'ANNUAL' ? await nextClassName(r) : null;
    return ejs.render(template, {
        documentTitle: `${titleFor(r).title} - ${r.sub_class.name}`,
        school: { ...SCHOOL, logo },
        passMark: PASS_MARK,
        cards: students.map(s => buildCard(r, s, nextClass)),
        generatedAt: new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    });
}

export async function renderCardsPdf(r: ClassResults, students: StudentResult[]): Promise<Buffer> {
    const html = await renderCardsHtml(r, students);
    const page = await PuppeteerManager.newPage();
    try {
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
        return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    } finally {
        try { await page.close(); } catch { /* noop */ }
    }
}

export type CardScope =
    | { kind: 'SEQUENCE'; exam_sequence_id: number }
    | { kind: 'TERM'; term_id: number }
    | { kind: 'ANNUAL'; academic_year_id: number };

export async function resultsFor(subClassId: number, scope: CardScope): Promise<ClassResults> {
    if (scope.kind === 'SEQUENCE') return getSequenceResults(subClassId, scope.exam_sequence_id);
    if (scope.kind === 'TERM') return getTermResults(subClassId, scope.term_id);
    return getAnnualResults(subClassId, scope.academic_year_id);
}

/** PDF for a whole subclass (one page per student with marks) or for one student. */
export async function generateCards(
    subClassId: number,
    scope: CardScope,
    studentId?: number
): Promise<{ buffer: Buffer; filename: string; results: ClassResults; students: StudentResult[] }> {
    const results = await resultsFor(subClassId, scope);
    assertHasMarks(results, studentId);
    const students = studentId !== undefined
        ? results.students.filter(s => s.student_id === studentId)
        : cardOrder(results);
    const buffer = await renderCardsPdf(results, students);
    const who = studentId !== undefined ? students[0]?.matricule ?? String(studentId) : results.sub_class.name;
    const filename = `report-card_${results.scope.label}_${who}`.replace(/[^\w-]+/g, '_') + '.pdf';
    return { buffer, filename, results, students };
}

/** Subclass of a student's enrollment in a year (for student-level downloads). */
export async function studentSubClass(studentId: number, academicYearId: number): Promise<number> {
    const en = await prisma.enrollment.findUnique({
        where: { student_id_academic_year_id: { student_id: studentId, academic_year_id: academicYearId } },
        select: { sub_class_id: true },
    });
    if (!en) throw new ResultsError(404, `Student ${studentId} is not enrolled in academic year ${academicYearId}`);
    if (!en.sub_class_id) throw new ResultsError(409, `Student ${studentId} has not been assigned to a class yet`);
    return en.sub_class_id;
}
