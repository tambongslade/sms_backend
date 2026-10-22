// Word (.docx) class lists.
//
// The class-list export used to offer "Word (DOCX)" but the generic export
// endpoint always returned an Excel workbook, which the browser then saved
// with a .docx name (Word cannot open it). This builds a real Word document
// with the same columns as the Excel/PDF exports: one landscape section per
// sub-class.
import {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    Packer,
    PageOrientation,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
} from 'docx';
import prisma from '../../../config/db';
import { getAcademicYearId } from '../../../utils/academicYear';

const HEADER = [
    '#', 'Matricule', 'Name', 'Gender', 'Date of Birth',
    'Place of Birth', 'Residence', 'Former School',
    'New/Old', 'Repeater', 'Status',
];

// Relative column widths (percent of table width), summing to 100.
const WIDTHS = [4, 10, 20, 6, 9, 10, 10, 12, 6, 6, 7];

function rowsFor(enrollments: any[]): string[][] {
    const sorted = [...enrollments].sort((a, b) =>
        (a.student?.name || '').localeCompare(b.student?.name || ''),
    );
    return sorted.map((e, idx) => {
        const s = e.student || {};
        return [
            String(idx + 1),
            s.matricule || '',
            s.name || '',
            s.gender || '',
            s.date_of_birth ? new Date(s.date_of_birth).toISOString().slice(0, 10) : '',
            s.place_of_birth || '',
            s.residence || '',
            s.former_school || '',
            s.is_new_student ? 'NEW' : 'OLD',
            e.repeater ? 'YES' : 'NO',
            s.status || '',
        ];
    });
}

const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(text: string, i: number, bold = false): TableCell {
    return new TableCell({
        width: { size: WIDTHS[i], type: WidthType.PERCENTAGE },
        borders,
        children: [
            new Paragraph({
                alignment: i === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
                children: [new TextRun({ text, bold, size: 18 })],
            }),
        ],
    });
}

function sectionFor(title: string, subtitle: string, enrollments: any[]) {
    const body = rowsFor(enrollments);
    const children: (Paragraph | Table)[] = [
        new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun({ text: title, bold: true })] }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [new TextRun({ text: `${subtitle} · ${body.length} student${body.length === 1 ? '' : 's'}`, size: 20 })],
        }),
    ];
    if (body.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: 'No students enrolled.', italics: true })] }));
    } else {
        children.push(
            new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: [
                    new TableRow({ tableHeader: true, children: HEADER.map((h, i) => cell(h, i, true)) }),
                    ...body.map((r) => new TableRow({ children: r.map((v, i) => cell(v, i)) })),
                ],
            }),
        );
    }
    return {
        properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } },
        children,
    };
}

async function yearName(yearId: number): Promise<string> {
    const y = await prisma.academicYear.findUnique({ where: { id: yearId }, select: { name: true } });
    return y?.name ?? '';
}

export async function exportSubclassStudentListDocx(
    subClassId: number,
    academicYearId?: number,
): Promise<{ buffer: Buffer; filename: string }> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) throw new Error('No academic year found');

    const subClass = await prisma.subClass.findUnique({ where: { id: subClassId }, include: { class: true } });
    if (!subClass) throw new Error(`Subclass with ID ${subClassId} not found`);

    const enrollments = await prisma.enrollment.findMany({
        where: { sub_class_id: subClassId, academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' } } },
        include: { student: true },
    });

    const doc = new Document({
        sections: [sectionFor(`Class List — ${subClass.class.name} ${subClass.name}`, await yearName(yearId), enrollments)],
    });
    const buffer = await Packer.toBuffer(doc);
    const filename = `class_list_${subClass.class.name}_${subClass.name}`.replace(/\s+/g, '_') + '.docx';
    return { buffer, filename };
}

export async function exportClassStudentListDocx(
    classId: number,
    academicYearId?: number,
): Promise<{ buffer: Buffer; filename: string }> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) throw new Error('No academic year found');

    const klass = await prisma.class.findUnique({
        where: { id: classId },
        include: {
            sub_classes: {
                orderBy: { name: 'asc' },
                include: {
                    enrollments: {
                        where: { academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' } } },
                        include: { student: true },
                    },
                },
            },
        },
    });
    if (!klass) throw new Error(`Class with ID ${classId} not found`);

    const yName = await yearName(yearId);
    const sections = klass.sub_classes.length
        ? klass.sub_classes.map((sub) => sectionFor(`Class List — ${klass.name} ${sub.name}`, yName, sub.enrollments))
        : [sectionFor(`Class List — ${klass.name}`, yName, [])];

    const buffer = await Packer.toBuffer(new Document({ sections }));
    const filename = `class_list_${klass.name}`.replace(/\s+/g, '_') + '.docx';
    return { buffer, filename };
}

export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
