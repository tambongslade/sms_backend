// src/api/v1/services/classListFormService.ts
//
// Printable class list for the secretary/bursar Forms page: A4 (landscape or portrait) on the
// school letterhead, one subclass per PDF. The student's name is always printed; every extra
// column is either left empty (to fill in by hand) or shows a chosen detail of the student.

import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import prisma from '../../../config/db';
import * as PuppeteerManager from '../../../utils/puppeteerManager';
import { getAcademicYearId } from '../../../utils/academicYear';

const DEFAULT_BLANK_COLUMNS = 5;
const MAX_COLUMNS = 20;

// Details a column can show. Deliberately a short list of roster-type facts: nothing about
// health, fees or discipline.
export const CLASS_LIST_FIELDS = {
    matricule: 'Matricule',
    sex: 'Sex',
    date_of_birth: 'Date of birth',
    place_of_birth: 'Place of birth',
    residence: 'Residence',
    repeater: 'Repeater',
    student_type: 'New / Old',
    parent_name: 'Parent / guardian',
    parent_phone: 'Parent phone',
} as const;
export type ClassListField = keyof typeof CLASS_LIST_FIELDS;
const isField = (v: string): v is ClassListField => Object.prototype.hasOwnProperty.call(CLASS_LIST_FIELDS, v);

const cache: { html?: string; logo?: string } = {};
function assets() {
    if (!cache.html) cache.html = fs.readFileSync(path.join(process.cwd(), 'src/view/class-list-template.ejs'), 'utf-8');
    if (cache.logo === undefined) {
        try {
            cache.logo = `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), 'public/letterhead.png')).toString('base64')}`;
        } catch {
            cache.logo = '';
        }
    }
    return { html: cache.html, logo: cache.logo };
}

const fmtDate = (d: Date | null | undefined) => (d ? new Date(d).toLocaleDateString('en-GB') : '');

export async function generateClassListPdf(params: {
    subClassId: number;
    academicYearId?: number;
    /** One entry per extra column: 'empty' or a ClassListField. Takes precedence over blankColumns. */
    columns?: string[];
    /** Number of empty columns when columns is not given. */
    blankColumns?: number;
    orientation?: 'portrait' | 'landscape';
    namesOnly?: boolean;
}): Promise<{ buffer: Buffer; filename: string }> {
    const yearId = await getAcademicYearId(params.academicYearId);
    if (!yearId) throw new Error('No academic year found');

    const [subClass, year, enrollments] = await Promise.all([
        prisma.subClass.findUnique({ where: { id: params.subClassId }, include: { class: true } }),
        prisma.academicYear.findUnique({ where: { id: yearId }, select: { name: true } }),
        prisma.enrollment.findMany({
            where: { sub_class_id: params.subClassId, academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' } } },
            select: {
                repeater: true,
                student: {
                    select: {
                        name: true, matricule: true, gender: true, date_of_birth: true, place_of_birth: true,
                        residence: true, is_new_student: true,
                        parents: { select: { parent: { select: { name: true, phone: true } } }, orderBy: { id: 'asc' }, take: 1 },
                    },
                },
            },
        }),
    ]);
    if (!subClass) throw new Error('Subclass not found');

    // Subclass names usually already carry the class ("FORM 1 N"); don't print it twice.
    const className = subClass.name.toUpperCase().startsWith(subClass.class.name.toUpperCase())
        ? subClass.name : `${subClass.class.name} ${subClass.name}`;

    // Names only = no extra columns at all
    let kinds: (ClassListField | 'empty')[];
    if (params.namesOnly) kinds = [];
    else if (params.columns) kinds = params.columns.slice(0, MAX_COLUMNS).map(c => (isField(c) ? c : 'empty'));
    else {
        const n = Number.isFinite(params.blankColumns)
            ? Math.min(Math.max(Math.trunc(params.blankColumns as number), 0), MAX_COLUMNS)
            : DEFAULT_BLANK_COLUMNS;
        kinds = Array(n).fill('empty');
    }

    const cell = (e: (typeof enrollments)[number], k: ClassListField | 'empty'): string => {
        const s = e.student;
        const parent = s.parents[0]?.parent;
        switch (k) {
            case 'matricule': return s.matricule;
            case 'sex': return String(s.gender).toLowerCase().startsWith('f') ? 'F' : 'M';
            case 'date_of_birth': return fmtDate(s.date_of_birth);
            case 'place_of_birth': return s.place_of_birth ?? '';
            case 'residence': return s.residence ?? '';
            case 'repeater': return e.repeater ? 'Yes' : 'No';
            case 'student_type': return s.is_new_student ? 'New' : 'Old';
            case 'parent_name': return parent?.name ?? '';
            case 'parent_phone': return parent?.phone ?? '';
            default: return '';
        }
    };

    const rows = enrollments
        .map(e => ({ name: e.student.name, cells: kinds.map(k => cell(e, k)) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const headers = kinds.map(k => (k === 'empty' ? '' : CLASS_LIST_FIELDS[k]));
    const orientation = params.orientation === 'portrait' ? 'portrait' : 'landscape';

    const { html: template, logo } = assets();
    const html = ejs.render(template, {
        className,
        academicYearName: year?.name ?? '',
        rows,
        headers,
        orientation,
        letterhead: logo,
        generatedAt: new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    });

    const page = await PuppeteerManager.newPage();
    try {
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({ format: 'A4', landscape: orientation === 'landscape', printBackground: true, preferCSSPageSize: true });
        const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
        const filename = `class-list_${className}`.replace(/[^\w-]+/g, '_') + '.pdf';
        return { buffer, filename };
    } finally {
        try { await page.close(); } catch { /* noop */ }
    }
}
