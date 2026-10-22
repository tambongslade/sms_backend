// src/api/v1/services/studentTransferService.ts
//
// U13 - Transfer-out flow. A student who leaves for another school keeps every
// enrollment, mark, fee and discipline row (unenrol is refused once marks exist,
// and deleting history is never acceptable). Instead we:
//   1. write a StudentTransfer row (date, reason, destination school, certificate no.)
//   2. set Student.status = TRANSFERRED (an ordinary field update, so it syncs like
//      the WITHDRAWN soft-delete from 72cd8dd)
//   3. produce a leaving certificate PDF on demand from that row.
//
// NOTE: StudentTransfer comes from migration 20261020400000_add_student_transfer,
// which must be applied manually. Until it is (and `prisma generate` has run) the
// delegate is accessed loosely and a missing table surfaces as
// TRANSFER_TABLE_MISSING (-> 503) instead of a raw Prisma error.

import prisma from '../../../config/db';
import { StudentStatus } from '@prisma/client';
import { PDFDocument, StandardFonts, rgb, PageSizes, PDFFont, PDFPage } from 'pdf-lib';
import { getAcademicYearId } from '../../../utils/academicYear';
import { schoolNow } from '../../../utils/schoolClock';
import { createAuditLog } from './auditTrailService';

// Loose accessor so this compiles before `prisma generate` picks up the new model.
const transferDelegate = (client: any = prisma): any => {
    const d = client.studentTransfer;
    if (!d) throw new Error('TRANSFER_TABLE_MISSING');
    return d;
};

const isMissingTableError = (e: any) =>
    e?.code === 'P2021' || /StudentTransfer.*does not exist/i.test(String(e?.message || ''));

const rethrow = (e: any): never => {
    if (isMissingTableError(e)) throw new Error('TRANSFER_TABLE_MISSING');
    throw e;
};

export interface TransferOutInput {
    transfer_date?: string; // YYYY-MM-DD; defaults to today (Africa/Douala)
    reason: string;
    destination_school?: string;
    remarks?: string;
    academic_year_id?: number;
}

function parseDateOnly(value: string | undefined): Date {
    const str = (value || '').trim() || schoolNow().dateStr;
    if (!/^\d{4}-\d{2}-\d{2}/.test(str)) throw new Error('INVALID_TRANSFER_DATE');
    const d = new Date(`${str.slice(0, 10)}T00:00:00.000Z`);
    if (isNaN(d.getTime())) throw new Error('INVALID_TRANSFER_DATE');
    return d;
}

export async function transferOutStudent(studentId: number, input: TransferOutInput, actorUserId?: number) {
    const reason = (input.reason || '').trim();
    if (!reason) throw new Error('REASON_REQUIRED');
    const transferDate = parseDateOnly(input.transfer_date);

    const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: { id: true, matricule: true, name: true, status: true },
    });
    if (!student) throw new Error('STUDENT_NOT_FOUND');
    if (student.status === StudentStatus.TRANSFERRED) throw new Error('ALREADY_TRANSFERRED');
    if (student.status === StudentStatus.WITHDRAWN) throw new Error('STUDENT_WITHDRAWN');

    const academicYearId = input.academic_year_id ?? (await getAcademicYearId()) ?? null;

    // Snapshot the class at departure (target year, else latest enrollment).
    const enrollment = await prisma.enrollment.findFirst({
        where: academicYearId
            ? { student_id: studentId, academic_year_id: academicYearId }
            : { student_id: studentId },
        orderBy: { academic_year_id: 'desc' },
        include: { class: { select: { name: true } }, sub_class: { select: { name: true } } },
    }) ?? await prisma.enrollment.findFirst({
        where: { student_id: studentId },
        orderBy: { academic_year_id: 'desc' },
        include: { class: { select: { name: true } }, sub_class: { select: { name: true } } },
    });
    const lastClassName = enrollment
        ? (enrollment.sub_class?.name ?? enrollment.class?.name ?? null)
        : null;

    const ymd = transferDate.toISOString().slice(0, 10).replace(/-/g, '');
    const certificateNumber = `LC-${ymd}-${student.matricule || studentId}`;

    try {
        const transfer = await prisma.$transaction(async (tx) => {
            const created = await transferDelegate(tx).create({
                data: {
                    student_id: studentId,
                    academic_year_id: academicYearId,
                    transfer_date: transferDate,
                    reason,
                    destination_school: input.destination_school?.trim() || null,
                    remarks: input.remarks?.trim() || null,
                    last_class_name: lastClassName,
                    certificate_number: certificateNumber,
                    recorded_by_id: actorUserId ?? null,
                },
            });
            await tx.student.update({
                where: { id: studentId },
                data: { status: StudentStatus.TRANSFERRED },
            });
            return created;
        });

        if (actorUserId) {
            await createAuditLog({
                userId: actorUserId,
                action: 'TRANSFER_OUT',
                entityType: 'Student',
                entityId: studentId,
                changes: {
                    oldValues: { status: student.status },
                    newValues: {
                        status: StudentStatus.TRANSFERRED,
                        transfer_id: transfer.id,
                        destination_school: transfer.destination_school,
                        transfer_date: transfer.transfer_date,
                    },
                },
                description: `Student ${student.matricule ?? studentId} transferred out (certificate ${certificateNumber})`,
                severity: 'MEDIUM',
            } as any);
        }
        return transfer;
    } catch (e: any) {
        if (e?.code === 'P2002') throw new Error('DUPLICATE_TRANSFER');
        return rethrow(e);
    }
}

export async function getStudentTransfers(studentId: number) {
    try {
        return await transferDelegate().findMany({
            where: { student_id: studentId },
            orderBy: { transfer_date: 'desc' },
        });
    } catch (e) {
        return rethrow(e);
    }
}

export async function listTransfers(opts: { academic_year_id?: number; page?: number; limit?: number }) {
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(100, Math.max(1, opts.limit || 20));
    const where: any = opts.academic_year_id ? { academic_year_id: opts.academic_year_id } : {};
    try {
        const [total, rows] = await Promise.all([
            transferDelegate().count({ where }),
            transferDelegate().findMany({
                where,
                orderBy: { transfer_date: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: { student: { select: { id: true, name: true, matricule: true, gender: true } } },
            }),
        ]);
        return { data: rows, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    } catch (e) {
        return rethrow(e);
    }
}

// ---------------------------------------------------------------- certificate

function pdfSafe(text: string): string {
    return (text || '')
        .replace(/[\x00-\x1F]/g, ' ')
        .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function fmtDate(d: Date | string | null | undefined): string {
    if (!d) return '-';
    const date = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const words = pdfSafe(text).split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
        const candidate = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
            lines.push(line);
            line = w;
        } else {
            line = candidate;
        }
    }
    if (line) lines.push(line);
    return lines;
}

function centered(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color = rgb(0, 0, 0)) {
    const t = pdfSafe(text);
    const w = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: (page.getWidth() - w) / 2, y, size, font, color });
}

/**
 * Leaving certificate PDF for a student's transfer (latest one if transferId omitted).
 */
export async function buildLeavingCertificatePdf(studentId: number, transferId?: number): Promise<{ buffer: Buffer; filename: string }> {
    let transfer: any;
    try {
        transfer = await transferDelegate().findFirst({
            where: transferId ? { id: transferId, student_id: studentId } : { student_id: studentId },
            orderBy: { transfer_date: 'desc' },
        });
    } catch (e) {
        rethrow(e);
    }
    if (!transfer) throw new Error('TRANSFER_NOT_FOUND');

    const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: {
            enrollments: {
                orderBy: { academic_year_id: 'asc' },
                include: { academic_year: { select: { name: true } } },
            },
        },
    });
    if (!student) throw new Error('STUDENT_NOT_FOUND');

    const firstYear = student.enrollments[0]?.academic_year?.name;
    const schoolName = process.env.SCHOOL_NAME || 'School';
    const schoolAddress = process.env.SCHOOL_ADDRESS || '';
    const schoolPhone = process.env.SCHOOL_PHONE || '';

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const bold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const page = pdfDoc.addPage(PageSizes.A4);
    const { width, height } = page.getSize();
    const margin = 60;
    const blue = rgb(0, 0.25, 0.5);

    page.drawRectangle({ x: 30, y: 30, width: width - 60, height: height - 60, borderColor: blue, borderWidth: 1.5 });

    let y = height - 80;
    centered(page, 'REPUBLIC OF CAMEROON  -  REPUBLIQUE DU CAMEROUN', y, font, 10); y -= 14;
    centered(page, 'Peace - Work - Fatherland  /  Paix - Travail - Patrie', y, font, 9, rgb(0.3, 0.3, 0.3)); y -= 28;
    centered(page, schoolName.toUpperCase(), y, bold, 16, blue); y -= 16;
    if (schoolAddress) { centered(page, schoolAddress, y, font, 10); y -= 13; }
    if (schoolPhone) { centered(page, `Tel: ${schoolPhone}`, y, font, 10); y -= 13; }
    y -= 22;
    centered(page, 'LEAVING CERTIFICATE', y, bold, 20); y -= 18;
    centered(page, 'CERTIFICAT DE DEPART', y, font, 12, rgb(0.3, 0.3, 0.3)); y -= 16;
    centered(page, `No. ${transfer.certificate_number}`, y, font, 10); y -= 36;

    const bodySize = 12;
    const maxW = width - margin * 2;
    const paragraph =
        `The undersigned, Principal of ${schoolName}, certifies that ${student.name}, ` +
        `${student.gender === 'Female' ? 'daughter' : 'son'} of the parents/guardians on record, ` +
        `born on ${fmtDate(student.date_of_birth)} at ${student.place_of_birth || '-'}, ` +
        `registration number ${student.matricule}, was a student of this school` +
        `${firstYear ? ` from the ${firstYear} academic year` : ''} until ${fmtDate(transfer.transfer_date)}` +
        `${transfer.last_class_name ? `, last attending ${transfer.last_class_name}` : ''}.`;
    for (const line of wrap(paragraph, font, bodySize, maxW)) {
        page.drawText(line, { x: margin, y, size: bodySize, font });
        y -= bodySize + 6;
    }
    y -= 12;

    const rows: Array<[string, string]> = [
        ['Date of leaving', fmtDate(transfer.transfer_date)],
        ['Reason for leaving', transfer.reason || '-'],
        ['Destination school', transfer.destination_school || '-'],
        ['Last class attended', transfer.last_class_name || '-'],
    ];
    if (transfer.remarks) rows.push(['Remarks / conduct', transfer.remarks]);
    for (const [label, value] of rows) {
        page.drawText(pdfSafe(`${label}:`), { x: margin, y, size: bodySize, font: bold });
        const lines = wrap(value, font, bodySize, maxW - 150);
        for (const l of lines) {
            page.drawText(l, { x: margin + 150, y, size: bodySize, font });
            y -= bodySize + 5;
        }
        y -= 4;
    }

    y -= 16;
    for (const line of wrap('This certificate is issued to serve where and when necessary. The student\'s academic records remain on file at this school.', font, 11, maxW)) {
        page.drawText(line, { x: margin, y, size: 11, font, color: rgb(0.25, 0.25, 0.25) });
        y -= 16;
    }

    const issued = `Issued on ${fmtDate(schoolNow().dateOnly)}`;
    page.drawText(pdfSafe(issued), { x: margin, y: 150, size: 11, font });
    page.drawText('The Principal', { x: width - margin - 140, y: 150, size: 12, font: bold });
    page.drawLine({ start: { x: width - margin - 160, y: 95 }, end: { x: width - margin, y: 95 }, thickness: 0.8, color: rgb(0.3, 0.3, 0.3) });
    page.drawText('Signature & stamp', { x: width - margin - 125, y: 82, size: 9, font, color: rgb(0.4, 0.4, 0.4) });

    const bytes = await pdfDoc.save();
    return {
        buffer: Buffer.from(bytes),
        filename: `leaving-certificate-${student.matricule || studentId}.pdf`,
    };
}
