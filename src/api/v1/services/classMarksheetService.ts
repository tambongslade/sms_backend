// src/api/v1/services/classMarksheetService.ts
//
// The class mark sheet: one landscape page set per subclass and period (sequence, term or
// year) with every student's mark in every subject, the average of each subject category,
// the general average and rank, plus the class statistics. All numbers come from
// resultsService, so the sheet always agrees with the Results screen and the report cards.

import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import * as PuppeteerManager from '../../../utils/puppeteerManager';
import { ClassResults, StudentResult, getResults } from './resultsService';

const CATEGORY_LABELS: Record<string, string> = {
    LANGUAGES_AND_LITERATURE: 'Languages',
    HUMAN_AND_SOCIAL_SCIENCE: 'Humanities',
    SCIENCE_AND_TECHNOLOGY: 'Sciences',
    OTHERS: 'Others',
};
const CATEGORY_ORDER = ['LANGUAGES_AND_LITERATURE', 'HUMAN_AND_SOCIAL_SCIENCE', 'SCIENCE_AND_TECHNOLOGY', 'OTHERS'];

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ClassMarksheet {
    title: string;            // "CLASS MARKSHEET"
    period: string;           // "2025 - 2026 / Second Term"
    class_name: string;
    class_master: string | null;
    pass_mark: number;
    subjects: { id: number; name: string; coefficient: number; category: string }[];
    categories: { key: string; label: string }[];
    students: {
        rank: number | null;
        name: string;
        matricule: string;
        gender: string;
        repeater: boolean;
        scores: (number | null)[];                 // same order as subjects
        category_averages: (number | null)[];      // same order as categories
        average: number | null;
    }[];
    stats: {
        enrolled: number;
        ranked: number;
        ranked_females: number;
        ranked_males: number;
        succeeded: number;
        succeeded_females: number;
        succeeded_males: number;
        success_rate: number | null;
        females_success_rate: number | null;
        males_success_rate: number | null;
        ranked_repeaters: number;
        succeeded_repeaters: number;
        repeaters_success_rate: number | null;
        class_average: number | null;
        standard_deviation: number | null;
        best_average: number | null;
        last_average: number | null;
    };
    subject_averages: (number | null)[];           // class average per subject
}

const pct = (a: number, b: number) => (b > 0 ? round2((a / b) * 100) : null);

export function buildClassMarksheet(r: ClassResults): ClassMarksheet {
    const subjects = [...r.subjects].sort((a, b) => {
        const ca = CATEGORY_ORDER.indexOf(a.category), cb = CATEGORY_ORDER.indexOf(b.category);
        return (ca - cb) || a.name.localeCompare(b.name);
    });
    const categories = CATEGORY_ORDER
        .filter(k => subjects.some(s => s.category === k))
        .map(k => ({ key: k, label: CATEGORY_LABELS[k] ?? k }));

    const subjectIndex = new Map(subjects.map((s, i) => [s.sub_class_subject_id, i]));
    const statBySubject = new Map(r.subject_stats.map(s => [s.sub_class_subject_id, s]));

    const students = r.students.map((st: StudentResult) => {
        const scores: (number | null)[] = subjects.map(() => null);
        for (const sr of st.subjects) {
            const i = subjectIndex.get(sr.sub_class_subject_id);
            if (i !== undefined) scores[i] = sr.score;
        }
        const category_averages = categories.map(cat => {
            let weighted = 0, coef = 0;
            subjects.forEach((s, i) => {
                const v = scores[i];
                if (s.category === cat.key && v !== null) { weighted += v * s.coefficient; coef += s.coefficient; }
            });
            return coef > 0 ? round2(weighted / coef) : null;
        });
        return {
            rank: st.rank,
            name: st.name,
            matricule: st.matricule,
            gender: st.gender,
            repeater: st.repeater,
            scores,
            category_averages,
            average: st.average,
        };
    });

    const ranked = students.filter(s => s.average !== null);
    const passed = (s: { average: number | null }) => s.average !== null && s.average >= r.sub_class.pass_mark;
    const isFemale = (s: { gender: string }) => String(s.gender).toLowerCase().startsWith('f');
    const females = ranked.filter(isFemale), males = ranked.filter(s => !isFemale(s));
    const repeaters = ranked.filter(s => s.repeater);
    const averages = ranked.map(s => s.average as number);

    return {
        title: 'CLASS MARKSHEET',
        period: `${r.scope.academic_year_name} / ${r.scope.label}`,
        class_name: r.sub_class.name,
        class_master: r.sub_class.class_master_name,
        pass_mark: r.sub_class.pass_mark,
        subjects: subjects.map(s => ({ id: s.sub_class_subject_id, name: s.name.trim(), coefficient: s.coefficient, category: s.category })),
        categories,
        students,
        stats: {
            enrolled: r.class_stats.enrolled,
            ranked: ranked.length,
            ranked_females: females.length,
            ranked_males: males.length,
            succeeded: ranked.filter(passed).length,
            succeeded_females: females.filter(passed).length,
            succeeded_males: males.filter(passed).length,
            success_rate: pct(ranked.filter(passed).length, ranked.length),
            females_success_rate: pct(females.filter(passed).length, females.length),
            males_success_rate: pct(males.filter(passed).length, males.length),
            ranked_repeaters: repeaters.length,
            succeeded_repeaters: repeaters.filter(passed).length,
            repeaters_success_rate: pct(repeaters.filter(passed).length, repeaters.length),
            class_average: r.class_stats.class_average,
            standard_deviation: r.class_stats.standard_deviation,
            best_average: averages.length ? Math.max(...averages) : null,
            last_average: averages.length ? Math.min(...averages) : null,
        },
        subject_averages: subjects.map(s => statBySubject.get(s.sub_class_subject_id)?.average ?? null),
    };
}

export async function getClassMarksheet(params: Parameters<typeof getResults>[0]): Promise<ClassMarksheet> {
    return buildClassMarksheet(await getResults(params));
}

const cache: { html?: string; logo?: string } = {};
function assets() {
    if (!cache.html) cache.html = fs.readFileSync(path.join(process.cwd(), 'src/view/class-marksheet-template.ejs'), 'utf-8');
    if (cache.logo === undefined) {
        try {
            cache.logo = `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), 'public/school.png')).toString('base64')}`;
        } catch {
            cache.logo = '';
        }
    }
    return { html: cache.html, logo: cache.logo };
}

export async function renderClassMarksheetPdf(sheet: ClassMarksheet): Promise<{ buffer: Buffer; filename: string }> {
    const { html: template, logo } = assets();
    const html = ejs.render(template, {
        sheet,
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
        const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
        const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
        const filename = `class-marksheet_${sheet.class_name}_${sheet.period}`.replace(/[^\w-]+/g, '_') + '.pdf';
        return { buffer, filename };
    } finally {
        try { await page.close(); } catch { /* noop */ }
    }
}
