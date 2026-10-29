// src/api/v1/services/resultsService.ts
//
// ONE place that turns marks into averages, ranks and class statistics.
// The Results screen, the CSV export, sequence/term/annual report cards, the
// stored StudentSequenceAverage rows and the promotion preview all call this,
// so they can never disagree.
//
// Rules (Cameroon secondary, marks out of 20):
//  - A subject with no mark for a student is "NC" (non classé). It is left out
//    of that student's average entirely — it is NOT counted as 0.
//  - Weighted average = sum(score * coefficient) / sum(coefficient) over the
//    subjects that have a mark.
//  - Term subject score = mean of that term's sequence scores that exist.
//  - Annual average = mean of the term averages that exist; annual subject
//    score = mean of the term subject scores that exist.
//  - Only students with an average are ranked. Ties share a rank (1, 2, 2, 4).
//  - Withdrawn students are left out of everything.
//  - Moral Instructions is not graded in FORM 1 and FORM 2: it is left out of results,
//    mark sheets and report cards.
//  - A student needs marks in a minimum number of subjects to get an average and a rank:
//    10 in FORM 1 to FORM 5, 4 in LOWER SIXTH and UPPER SIXTH. Below that the average and
//    rank are NC (the marks themselves are still shown).

import prisma from '../../../config/db';

export const PASS_MARK = 10;

export type ResultsScopeKind = 'SEQUENCE' | 'TERM' | 'ANNUAL';

export interface ResultsSubject {
    sub_class_subject_id: number;
    subject_id: number;
    name: string;
    category: string;
    coefficient: number;
    teacher_name: string | null;
}

export interface StudentSubjectResult {
    sub_class_subject_id: number;
    score: number | null; // null = NC
    weighted: number | null;
    rank: number | null;
    // Breakdown for term/annual cards: sequence scores (term) or term scores (annual)
    parts: { label: string; score: number | null }[];
}

export interface StudentResult {
    enrollment_id: number;
    student_id: number;
    name: string;
    matricule: string;
    gender: string;
    date_of_birth: Date;
    place_of_birth: string;
    repeater: boolean;
    photo: string | null;
    subjects: StudentSubjectResult[];
    total_coefficient: number;
    total_weighted: number;
    average: number | null;
    subjects_with_marks: number;
    subjects_passed: number;
    rank: number | null;
    // Annual only: each term's average and rank
    term_averages?: { term_id: number; term_name: string; average: number | null; rank: number | null }[];
}

export interface SubjectStats {
    sub_class_subject_id: number;
    marked_count: number;
    min: number | null;
    max: number | null;
    average: number | null;
    success_rate: number | null; // % of marked students with >= PASS_MARK
}

export interface ClassStats {
    enrolled: number;
    ranked: number; // students with an average
    class_average: number | null;
    highest: number | null;
    lowest: number | null;
    success_rate: number | null;
    standard_deviation: number | null;
    passed: number;
}

export interface ClassResults {
    scope: {
        kind: ResultsScopeKind;
        label: string;
        academic_year_id: number;
        academic_year_name: string;
        term_id: number | null;
        term_name: string | null;
        exam_sequence_id: number | null;
        sequence_number: number | null;
        exam_sequence_ids: number[];
    };
    sub_class: {
        id: number;
        name: string;
        class_id: number;
        class_name: string;
        class_master_name: string | null;
        pass_mark: number;
        next_class_id: number | null;
    };
    subjects: ResultsSubject[];
    students: StudentResult[]; // sorted by rank, unranked last (alphabetical)
    subject_stats: SubjectStats[];
    class_stats: ClassStats;
    total_marks: number; // number of marks found in scope; 0 means "no marks entered"
}

export class ResultsError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

const isForm1or2 = (className: string) => /^FORM\s*[12]\b/i.test(className.trim());

/** Fewest subjects with marks a student needs to be given an average and a rank. */
export function minSubjectsForAverage(className: string): number {
    const name = className.trim();
    if (/^FORM\s*[1-5]\b/i.test(name)) return 10;
    if (/\b(LOWER|UPPER)\s+SIXTH\b/i.test(name)) return 4;
    return 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Competition ranking: equal values share a rank, the next rank skips (1,2,2,4). */
function rankValues<T>(items: T[], value: (t: T) => number | null): Map<T, number> {
    const ranked = items
        .map(item => ({ item, v: value(item) }))
        .filter((x): x is { item: T; v: number } => x.v !== null)
        .sort((a, b) => b.v - a.v);
    const out = new Map<T, number>();
    let prev: number | null = null;
    let prevRank = 0;
    ranked.forEach((x, i) => {
        const r = prev !== null && Math.abs(x.v - prev) < 1e-9 ? prevRank : i + 1;
        out.set(x.item, r);
        prev = x.v;
        prevRank = r;
    });
    return out;
}

export function ordinal(n: number | null | undefined): string {
    if (n === null || n === undefined) return 'NC';
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    switch (n % 10) {
        case 1: return `${n}st`;
        case 2: return `${n}nd`;
        case 3: return `${n}rd`;
        default: return `${n}th`;
    }
}

export function appreciation(avg: number | null | undefined): string {
    if (avg === null || avg === undefined) return 'NC';
    if (avg >= 18) return 'Excellent';
    if (avg >= 16) return 'Very Good';
    if (avg >= 14) return 'Good';
    if (avg >= 12) return 'Fairly Good';
    if (avg >= 10) return 'Average';
    if (avg >= 8) return 'Weak';
    return 'Poor';
}

export function grade(avg: number | null | undefined): string {
    if (avg === null || avg === undefined) return 'NC';
    if (avg >= 18) return 'A+';
    if (avg >= 16) return 'A';
    if (avg >= 15) return 'B+';
    if (avg >= 14) return 'B';
    if (avg >= 12) return 'C+';
    if (avg >= 10) return 'C';
    return 'D';
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadBase(subClassId: number, academicYearId: number) {
    const [subClass, year] = await Promise.all([
        prisma.subClass.findUnique({
            where: { id: subClassId },
            include: {
                class: { select: { id: true, name: true, pass_mark: true, next_class_id: true } },
                class_master: { select: { name: true } },
                sub_class_subjects: { include: { subject: { select: { id: true, name: true, category: true } } } },
            },
        }),
        prisma.academicYear.findUnique({ where: { id: academicYearId }, select: { id: true, name: true } }),
    ]);
    if (!subClass) throw new ResultsError(404, `Subclass ${subClassId} not found`);
    if (!year) throw new ResultsError(404, `Academic year ${academicYearId} not found`);

    const [enrollments, periods] = await Promise.all([
        prisma.enrollment.findMany({
            where: {
                sub_class_id: subClassId,
                academic_year_id: academicYearId,
                student: { status: { not: 'WITHDRAWN' } },
            },
            select: {
                id: true,
                repeater: true,
                photo: true,
                student: {
                    select: { id: true, name: true, matricule: true, gender: true, date_of_birth: true, place_of_birth: true },
                },
            },
        }),
        // The subject teacher printed on cards is whoever the timetable assigns
        // to this subject in this subclass this year (full name).
        prisma.teacherPeriod.findMany({
            where: { sub_class_id: subClassId, academic_year_id: academicYearId, teacher_id: { not: null } },
            distinct: ['subject_id', 'teacher_id'],
            select: { subject_id: true, teacher: { select: { name: true } } },
        }),
    ]);

    const teacherNames = new Map<number, string[]>();
    for (const p of periods) {
        if (!p.teacher?.name) continue;
        if (!teacherNames.has(p.subject_id)) teacherNames.set(p.subject_id, []);
        const list = teacherNames.get(p.subject_id)!;
        if (!list.includes(p.teacher.name)) list.push(p.teacher.name);
    }

    const subjects: ResultsSubject[] = subClass.sub_class_subjects
        .filter(scs => !(isForm1or2(subClass.class.name) && /moral/i.test(scs.subject.name)))
        .map(scs => ({
            sub_class_subject_id: scs.id,
            subject_id: scs.subject_id,
            name: scs.subject.name,
            category: String(scs.subject.category ?? 'GENERAL'),
            coefficient: scs.coefficient,
            teacher_name: teacherNames.get(scs.subject_id)?.join(', ') || null,
        }))
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    return { subClass, year, enrollments, subjects };
}

/** enrollment_id -> sub_class_subject_id -> exam_sequence_id -> score */
async function loadScores(enrollmentIds: number[], scsIds: number[], sequenceIds: number[]) {
    const map = new Map<number, Map<number, Map<number, number>>>();
    let count = 0;
    if (!enrollmentIds.length || !scsIds.length || !sequenceIds.length) return { map, count };
    const marks = await prisma.mark.findMany({
        where: {
            enrollment_id: { in: enrollmentIds },
            sub_class_subject_id: { in: scsIds },
            exam_sequence_id: { in: sequenceIds },
            score: { not: null },
        },
        select: { enrollment_id: true, sub_class_subject_id: true, exam_sequence_id: true, score: true },
    });
    for (const m of marks) {
        if (m.score === null) continue;
        count++;
        if (!map.has(m.enrollment_id)) map.set(m.enrollment_id, new Map());
        const bySubject = map.get(m.enrollment_id)!;
        if (!bySubject.has(m.sub_class_subject_id)) bySubject.set(m.sub_class_subject_id, new Map());
        bySubject.get(m.sub_class_subject_id)!.set(m.exam_sequence_id, m.score);
    }
    return { map, count };
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

type Base = Awaited<ReturnType<typeof loadBase>>;

function compute(
    base: Base,
    scoreOf: (enrollmentId: number, scsId: number) => { score: number | null; parts: { label: string; score: number | null }[] },
    averageOverride?: (enrollmentId: number, computed: number | null) => number | null
): { students: StudentResult[]; subject_stats: SubjectStats[]; class_stats: ClassStats } {
    const minSubjects = minSubjectsForAverage(base.subClass.class.name);
    const students: StudentResult[] = base.enrollments.map(e => {
        let totalCoef = 0;
        let totalWeighted = 0;
        let withMarks = 0;
        let passed = 0;
        const subjects: StudentSubjectResult[] = base.subjects.map(sub => {
            const { score, parts } = scoreOf(e.id, sub.sub_class_subject_id);
            const s = score === null ? null : round2(score);
            if (s !== null) {
                totalCoef += sub.coefficient;
                totalWeighted += s * sub.coefficient;
                withMarks++;
                if (s >= PASS_MARK) passed++;
            }
            return {
                sub_class_subject_id: sub.sub_class_subject_id,
                score: s,
                weighted: s === null ? null : round2(s * sub.coefficient),
                rank: null,
                parts,
            };
        });
        let average: number | null = totalCoef > 0 ? round2(totalWeighted / totalCoef) : null;
        if (averageOverride) average = averageOverride(e.id, average);
        if (withMarks < minSubjects) average = null;
        return {
            enrollment_id: e.id,
            student_id: e.student.id,
            name: e.student.name,
            matricule: e.student.matricule,
            gender: String(e.student.gender),
            date_of_birth: e.student.date_of_birth,
            place_of_birth: e.student.place_of_birth,
            repeater: e.repeater,
            photo: e.photo,
            subjects,
            total_coefficient: totalCoef,
            total_weighted: round2(totalWeighted),
            average,
            subjects_with_marks: withMarks,
            subjects_passed: passed,
            rank: null,
        };
    });

    // Overall rank (only students with an average)
    const ranks = rankValues(students, s => s.average);
    for (const s of students) s.rank = ranks.get(s) ?? null;

    // Per-subject rank and stats
    const subject_stats: SubjectStats[] = base.subjects.map((sub, idx) => {
        const entries = students.map(s => s.subjects[idx]);
        const subRanks = rankValues(entries, x => x.score);
        for (const x of entries) x.rank = subRanks.get(x) ?? null;
        const scores = entries.map(x => x.score).filter((x): x is number => x !== null);
        return {
            sub_class_subject_id: sub.sub_class_subject_id,
            marked_count: scores.length,
            min: scores.length ? Math.min(...scores) : null,
            max: scores.length ? Math.max(...scores) : null,
            average: scores.length ? round2(mean(scores)!) : null,
            success_rate: scores.length ? round2((scores.filter(x => x >= PASS_MARK).length / scores.length) * 100) : null,
        };
    });

    const avgs = students.map(s => s.average).filter((x): x is number => x !== null);
    const classMean = mean(avgs);
    const passedCount = avgs.filter(a => a >= PASS_MARK).length;
    const class_stats: ClassStats = {
        enrolled: students.length,
        ranked: avgs.length,
        class_average: classMean === null ? null : round2(classMean),
        highest: avgs.length ? Math.max(...avgs) : null,
        lowest: avgs.length ? Math.min(...avgs) : null,
        success_rate: avgs.length ? round2((passedCount / avgs.length) * 100) : null,
        standard_deviation: avgs.length
            ? round2(Math.sqrt(avgs.reduce((s, a) => s + (a - classMean!) ** 2, 0) / avgs.length))
            : null,
        passed: passedCount,
    };

    // Rank order; unranked students last, alphabetically
    students.sort((a, b) => {
        if (a.rank !== null && b.rank !== null) return a.rank - b.rank || a.name.localeCompare(b.name);
        if (a.rank !== null) return -1;
        if (b.rank !== null) return 1;
        return a.name.localeCompare(b.name);
    });

    return { students, subject_stats, class_stats };
}

function baseInfo(base: Base) {
    return {
        id: base.subClass.id,
        name: base.subClass.name,
        class_id: base.subClass.class.id,
        class_name: base.subClass.class.name,
        class_master_name: base.subClass.class_master?.name ?? null,
        pass_mark: base.subClass.class.pass_mark ?? PASS_MARK,
        next_class_id: base.subClass.class.next_class_id ?? null,
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getSequenceResults(subClassId: number, examSequenceId: number): Promise<ClassResults> {
    const seq = await prisma.examSequence.findUnique({
        where: { id: examSequenceId },
        include: { term: { select: { id: true, name: true } }, academic_year: { select: { id: true, name: true } } },
    });
    if (!seq) throw new ResultsError(404, `Exam sequence ${examSequenceId} not found`);
    const base = await loadBase(subClassId, seq.academic_year_id);
    const { map, count } = await loadScores(
        base.enrollments.map(e => e.id),
        base.subjects.map(s => s.sub_class_subject_id),
        [seq.id]
    );
    const computed = compute(base, (eid, scsId) => {
        const v = map.get(eid)?.get(scsId)?.get(seq.id);
        return { score: v ?? null, parts: [] };
    });
    return {
        scope: {
            kind: 'SEQUENCE',
            label: `Sequence ${seq.sequence_number}`,
            academic_year_id: seq.academic_year_id,
            academic_year_name: seq.academic_year?.name ?? base.year.name,
            term_id: seq.term_id,
            term_name: seq.term?.name ?? null,
            exam_sequence_id: seq.id,
            sequence_number: seq.sequence_number,
            exam_sequence_ids: [seq.id],
        },
        sub_class: baseInfo(base),
        subjects: base.subjects,
        ...computed,
        total_marks: count,
    };
}

async function termSequences(termId: number) {
    const term = await prisma.term.findUnique({
        where: { id: termId },
        include: { academic_year: { select: { id: true, name: true } } },
    });
    if (!term || !term.academic_year_id) throw new ResultsError(404, `Term ${termId} not found`);
    const sequences = await prisma.examSequence.findMany({
        where: { term_id: termId, academic_year_id: term.academic_year_id },
        orderBy: { sequence_number: 'asc' },
        select: { id: true, sequence_number: true },
    });
    return { term, sequences };
}

export async function getTermResults(subClassId: number, termId: number): Promise<ClassResults> {
    const { term, sequences } = await termSequences(termId);
    const base = await loadBase(subClassId, term.academic_year_id!);
    const { map, count } = await loadScores(
        base.enrollments.map(e => e.id),
        base.subjects.map(s => s.sub_class_subject_id),
        sequences.map(s => s.id)
    );
    const computed = compute(base, (eid, scsId) => {
        const bySeq = map.get(eid)?.get(scsId);
        const parts = sequences.map(s => ({ label: `Seq ${s.sequence_number}`, score: bySeq?.get(s.id) ?? null }));
        const present = parts.map(p => p.score).filter((x): x is number => x !== null);
        return { score: mean(present), parts };
    });
    return {
        scope: {
            kind: 'TERM',
            label: term.name,
            academic_year_id: term.academic_year_id!,
            academic_year_name: term.academic_year?.name ?? base.year.name,
            term_id: term.id,
            term_name: term.name,
            exam_sequence_id: null,
            sequence_number: null,
            exam_sequence_ids: sequences.map(s => s.id),
        },
        sub_class: baseInfo(base),
        subjects: base.subjects,
        ...computed,
        total_marks: count,
    };
}

/** Terms of a year in teaching order (start date, then id); holiday terms excluded. */
export async function orderedTerms(academicYearId: number) {
    const terms = await prisma.term.findMany({
        where: { academic_year_id: academicYearId, is_holiday: false },
        select: { id: true, name: true, start_date: true },
    });
    return terms.sort((a, b) => {
        const da = a.start_date ? new Date(a.start_date).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b.start_date ? new Date(b.start_date).getTime() : Number.MAX_SAFE_INTEGER;
        return da - db || a.id - b.id;
    });
}

export async function getAnnualResults(subClassId: number, academicYearId: number): Promise<ClassResults> {
    const base = await loadBase(subClassId, academicYearId);
    const terms = await orderedTerms(academicYearId);
    const termResults = await Promise.all(terms.map(t => getTermResults(subClassId, t.id)));

    // enrollment -> term index -> StudentResult
    const byEnrollment = new Map<number, (StudentResult | undefined)[]>();
    termResults.forEach((tr, i) => {
        for (const s of tr.students) {
            if (!byEnrollment.has(s.enrollment_id)) byEnrollment.set(s.enrollment_id, []);
            byEnrollment.get(s.enrollment_id)![i] = s;
        }
    });

    const computed = compute(
        base,
        (eid, scsId) => {
            const perTerm = byEnrollment.get(eid) ?? [];
            const parts = terms.map((t, i) => ({
                label: t.name,
                score: perTerm[i]?.subjects.find(x => x.sub_class_subject_id === scsId)?.score ?? null,
            }));
            const present = parts.map(p => p.score).filter((x): x is number => x !== null);
            return { score: mean(present), parts };
        },
        // Annual general average = mean of the term averages that exist
        (eid) => {
            const avgs = (byEnrollment.get(eid) ?? []).map(s => s?.average ?? null).filter((x): x is number => x !== null);
            const m = mean(avgs);
            return m === null ? null : round2(m);
        }
    );

    for (const s of computed.students) {
        const perTerm = byEnrollment.get(s.enrollment_id) ?? [];
        s.term_averages = terms.map((t, i) => ({
            term_id: t.id,
            term_name: t.name,
            average: perTerm[i]?.average ?? null,
            rank: perTerm[i]?.rank ?? null,
        }));
    }

    return {
        scope: {
            kind: 'ANNUAL',
            label: 'Annual',
            academic_year_id: academicYearId,
            academic_year_name: base.year.name,
            term_id: null,
            term_name: null,
            exam_sequence_id: null,
            sequence_number: null,
            exam_sequence_ids: termResults.flatMap(t => t.scope.exam_sequence_ids),
        },
        sub_class: baseInfo(base),
        subjects: base.subjects,
        ...computed,
        total_marks: termResults.reduce((s, t) => s + t.total_marks, 0),
    };
}

export async function getResults(params: {
    sub_class_id: number;
    exam_sequence_id?: number;
    term_id?: number;
    academic_year_id?: number;
    scope?: string;
}): Promise<ClassResults> {
    if (params.exam_sequence_id) return getSequenceResults(params.sub_class_id, params.exam_sequence_id);
    if (params.term_id) return getTermResults(params.sub_class_id, params.term_id);
    if (params.academic_year_id && (params.scope ?? 'annual').toLowerCase() === 'annual') {
        return getAnnualResults(params.sub_class_id, params.academic_year_id);
    }
    throw new ResultsError(400, 'Provide examSequenceId, termId, or academicYearId (annual)');
}

/** Promotion decision suggested from an annual average. */
export function suggestDecision(average: number | null, passMark: number, hasNextClass: boolean, className: string) {
    if (average === null) return 'NO_AVERAGE' as const;
    if (average < passMark) return 'REPEAT' as const;
    if (!hasNextClass) return className.toUpperCase().includes('UPPER SIXTH') ? 'GRADUATE' as const : 'NEEDS_DECISION' as const;
    return 'PROMOTE' as const;
}

export function decisionLabel(average: number | null, passMark: number, hasNextClass: boolean, className: string): string {
    switch (suggestDecision(average, passMark, hasNextClass, className)) {
        case 'PROMOTE': return 'Promoted';
        case 'REPEAT': return 'Repeat';
        case 'GRADUATE': return 'Graduated';
        case 'NEEDS_DECISION': return 'Passed';
        default: return 'NC';
    }
}

/** CSV of class results (rank order). Opens directly in Excel. */
export function resultsToCsv(r: ClassResults): string {
    const esc = (v: unknown) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const fmt = (n: number | null) => (n === null ? 'NC' : n.toFixed(2));
    const header = [
        'Rank', 'Matricule', 'Name',
        ...r.subjects.map(s => `${s.name} (coef ${s.coefficient})`),
        ...(r.scope.kind === 'ANNUAL' && r.students[0]?.term_averages ? r.students[0].term_averages.map(t => `${t.term_name} avg`) : []),
        'Total coef', 'Average', 'Remark',
    ];
    const rows = r.students.map(s => [
        s.rank === null ? 'NC' : ordinal(s.rank),
        s.matricule,
        s.name,
        ...s.subjects.map(x => fmt(x.score)),
        ...(s.term_averages ? s.term_averages.map(t => fmt(t.average)) : []),
        s.total_coefficient,
        fmt(s.average),
        appreciation(s.average),
    ]);
    const statRow = (label: string, pick: (st: SubjectStats) => number | null) => [
        '', '', label,
        ...r.subject_stats.map(st => fmt(pick(st))),
        ...(r.scope.kind === 'ANNUAL' && r.students[0]?.term_averages ? r.students[0].term_averages.map(() => '') : []),
        '', '', '',
    ];
    const lines = [
        [`${r.sub_class.name} - ${r.scope.label} - ${r.scope.academic_year_name}`],
        header,
        ...rows,
        [],
        statRow('Subject average', st => st.average),
        statRow('Highest', st => st.max),
        statRow('Lowest', st => st.min),
        statRow('Success rate %', st => st.success_rate),
        [],
        ['', '', 'Class average', fmt(r.class_stats.class_average)],
        ['', '', 'Success rate %', fmt(r.class_stats.success_rate)],
        ['', '', 'Ranked students', `${r.class_stats.ranked} / ${r.class_stats.enrolled}`],
    ];
    // BOM so Excel opens UTF-8 names (accents) correctly
    return '﻿' + lines.map(l => l.map(esc).join(',')).join('\r\n');
}
