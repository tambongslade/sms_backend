// src/api/v1/services/classListFormService.ts
//
// Printable class list for the secretary/bursar Forms page: landscape A4 on the school
// letterhead, one subclass per PDF, only the students' names filled in. Everything else
// is empty columns for staff to fill in by hand.

import fs from 'fs';
import path from 'path';
import ejs from 'ejs';
import prisma from '../../../config/db';
import * as PuppeteerManager from '../../../utils/puppeteerManager';
import { getAcademicYearId } from '../../../utils/academicYear';

const DEFAULT_BLANK_COLUMNS = 5;
const MAX_BLANK_COLUMNS = 20;

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

export async function generateClassListPdf(params: { subClassId: number; academicYearId?: number; blankColumns?: number }): Promise<{ buffer: Buffer; filename: string }> {
    const yearId = await getAcademicYearId(params.academicYearId);
    if (!yearId) throw new Error('No academic year found');

    const [subClass, year, enrollments] = await Promise.all([
        prisma.subClass.findUnique({ where: { id: params.subClassId }, include: { class: true } }),
        prisma.academicYear.findUnique({ where: { id: yearId }, select: { name: true } }),
        prisma.enrollment.findMany({
            where: { sub_class_id: params.subClassId, academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' } } },
            select: { student: { select: { name: true } } },
        }),
    ]);
    if (!subClass) throw new Error('Subclass not found');

    // Subclass names usually already carry the class ("FORM 1 N"); don't print it twice.
    const className = subClass.name.toUpperCase().startsWith(subClass.class.name.toUpperCase())
        ? subClass.name : `${subClass.class.name} ${subClass.name}`;
    const names = enrollments.map(e => e.student.name).sort((a, b) => a.localeCompare(b));

    const blankColumns = Number.isFinite(params.blankColumns)
        ? Math.min(Math.max(Math.trunc(params.blankColumns as number), 0), MAX_BLANK_COLUMNS)
        : DEFAULT_BLANK_COLUMNS;
    const { html: template, logo } = assets();
    const html = ejs.render(template, {
        className,
        academicYearName: year?.name ?? '',
        names,
        blankColumns,
        letterhead: logo,
        generatedAt: new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    });

    const page = await PuppeteerManager.newPage();
    try {
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
        const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
        const filename = `class-list_${className}`.replace(/[^\w-]+/g, '_') + '.pdf';
        return { buffer, filename };
    } finally {
        try { await page.close(); } catch { /* noop */ }
    }
}
