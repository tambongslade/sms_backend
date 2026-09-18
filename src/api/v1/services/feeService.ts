// src/api/v1/services/feeService.ts
import prisma, { SchoolFees, PaymentTransaction, PaymentMethod } from '../../../config/db';
import { getAcademicYearId, getStudentSubclassByStudentAndYear } from '../../../utils/academicYear';
import { shouldPayNewStudentFees, getStudentStatus, StudentStatus } from '../../../utils/studentStatus';
import { paginate, PaginationOptions, FilterOptions, PaginatedResult } from '../../../utils/pagination';
import { Parser } from 'json2csv'; // For CSV export
import { PDFDocument, rgb, StandardFonts, PageSizes } from 'pdf-lib'; // For PDF export
import { Document, Paragraph, Packer, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from 'docx'; // For DOCX export
import * as XLSX from 'xlsx'; // For Excel export
import fs from 'fs';
import path from 'path';

// Helper for generating CSV
async function generateCSV(data: any[]): Promise<Buffer> {
    const fields = [
        { label: 'Fee ID', value: 'feeId' },
        { label: 'Student Name', value: 'studentName' },
        { label: 'Matricule', value: 'studentMatricule' },
        { label: 'Class', value: 'className' },
        { label: 'Subclass', value: 'subClassName' },
        { label: 'Expected Amount (FCFA)', value: 'expectedAmount' },
        { label: 'Paid Amount (FCFA)', value: 'paidAmount' },
        { label: 'Outstanding (FCFA)', value: 'outstanding' },
        { label: 'Payment %', value: 'paymentPercentage' },
        { label: 'Due Date', value: 'dueDate' },
        { label: 'Payments Count', value: 'paymentsCount' }
    ];
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(data);
    return Buffer.from(csv);
}

// Helper for generating Excel (XLSX) with subclass separation
async function generateExcel(data: any[], reportMetadata?: any): Promise<Buffer> {
    // Create a new workbook
    const workbook = XLSX.utils.book_new();

    const academicYear = reportMetadata?.academicYear || new Date().getFullYear();

    // Group data by subclass
    const groupedData = data.reduce((groups, item) => {
        const subClassName = item.subClassName || 'No Subclass';
        if (!groups[subClassName]) {
            groups[subClassName] = [];
        }
        groups[subClassName].push(item);
        return groups;
    }, {} as Record<string, any[]>);

    // Set column widths for better readability
    const colWidths = [
        { wch: 8 },   // ID
        { wch: 35 },  // Student Name
        { wch: 18 },  // Matricule
        { wch: 15 },  // Class
        { wch: 18 },  // Expected Amount
        { wch: 16 },  // Paid Amount
        { wch: 18 },  // Outstanding
        { wch: 15 }   // Due Date
    ];

    // Create a sheet for each subclass
    Object.entries(groupedData).forEach(([subClassName, subClassData]) => {
        // Generate title for this subclass
        const reportTitle = `${subClassName} Student Fee Report - Academic Year ${academicYear}`;

        // Prepare data with title and headers
        const titleRow = { A: reportTitle };
        const dateRow = { A: `Generated on: ${new Date().toLocaleDateString('en-GB')}` };
        const emptyRow = {};

        // Convert data to worksheet format (remove subclass column since it's the sheet name)
        const simplifiedData = (subClassData as any[]).map(item => ({
            'ID': item.feeId,
            'Student Name': item.studentName,
            'Matricule': item.studentMatricule,
            'Class': item.className,
            'Expected (FCFA)': parseFloat(item.expectedAmount) || 0,
            'Paid (FCFA)': parseFloat(item.paidAmount) || 0,
            'Outstanding (FCFA)': parseFloat(item.outstanding) || 0,
            'Due Date': item.dueDate
        }));

        const worksheet = XLSX.utils.json_to_sheet(simplifiedData);

        // Add title rows at the beginning
        XLSX.utils.sheet_add_json(worksheet, [titleRow, dateRow, emptyRow], {
            origin: 'A1',
            skipHeader: true
        });

        // Shift data down by 4 rows to accommodate title
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
        for (let R = range.e.r; R >= 1; R--) {
            for (let C = range.s.c; C <= range.e.c; C++) {
                const cellAddress = XLSX.utils.encode_cell({ c: C, r: R });
                const newCellAddress = XLSX.utils.encode_cell({ c: C, r: R + 3 });
                if (worksheet[cellAddress]) {
                    worksheet[newCellAddress] = worksheet[cellAddress];
                    if (R < 4) delete worksheet[cellAddress];
                }
            }
        }

        // Set column widths
        worksheet['!cols'] = colWidths;

        // Merge cells for title (A1:H1) - one less column since we removed subclass
        if (!worksheet['!merges']) worksheet['!merges'] = [];
        worksheet['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } });
        worksheet['!merges'].push({ s: { r: 1, c: 0 }, e: { r: 1, c: 7 } });

        // Create sheet name (Excel sheet names must be <= 31 characters)
        let sheetName = subClassName;
        if (sheetName.length > 31) {
            sheetName = sheetName.substring(0, 28) + '...';
        }

        // Add worksheet to workbook with subclass name
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    });

    // If no data was grouped, create a single sheet
    if (Object.keys(groupedData).length === 0) {
        const reportTitle = `Student Fee Report - Academic Year ${academicYear}`;
        const titleRow = { A: reportTitle };
        const dateRow = { A: `Generated on: ${new Date().toLocaleDateString('en-GB')}` };
        const emptyRow = {};

        const worksheet = XLSX.utils.json_to_sheet([]);
        XLSX.utils.sheet_add_json(worksheet, [titleRow, dateRow, emptyRow], {
            origin: 'A1',
            skipHeader: true
        });

        XLSX.utils.book_append_sheet(workbook, worksheet, 'No Data');
    }

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    return buffer;
}

// Helper function to sanitize text for PDF generation (remove non-WinAnsi characters)
function sanitizeTextForPDF(text: string): string {
    return text
        .replace(/‖/g, '||')  // Replace double vertical line with double pipe
        .replace(/[^\x00-\xFF]/g, '?')  // Replace any non-Latin-1 characters with ?
        .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' '); // Keep only printable characters and extended ASCII
}

// Helper for generating PDF
async function generatePDF(data: any[], reportMetadata?: any): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageMargin = 30;
    const tableStartY = 680;
    const rowHeight = 20;
    const headerHeight = 25;
    const columnPadding = 3;

    // Better column width distribution for A4 page (595 width - 60 margins = 535 usable)
    const columns = [
        { header: 'ID', key: 'feeId', width: 35, align: AlignmentType.LEFT },
        { header: 'Student Name', key: 'studentName', width: 130, align: AlignmentType.LEFT },
        { header: 'Matricule', key: 'studentMatricule', width: 75, align: AlignmentType.LEFT },
        { header: 'Class', key: 'className', width: 60, align: AlignmentType.LEFT },
        { header: 'Expected', key: 'expectedAmount', width: 60, align: AlignmentType.RIGHT },
        { header: 'Paid', key: 'paidAmount', width: 55, align: AlignmentType.RIGHT },
        { header: 'Outstanding', key: 'outstanding', width: 65, align: AlignmentType.RIGHT },
        { header: 'Due Date', key: 'dueDate', width: 55, align: AlignmentType.LEFT },
    ];

    let page = pdfDoc.addPage(PageSizes.A4);
    let y = tableStartY;

    // Generate descriptive title based on filters
    const className = reportMetadata?.className || 'All Classes';
    const academicYear = reportMetadata?.academicYear || new Date().getFullYear();
    const reportTitle = `${className} Student Fee Report - Academic Year ${academicYear}`;

    const drawHeader = () => {
        // Main title
        page.drawText(sanitizeTextForPDF(reportTitle), {
            x: pageMargin,
            y: y + 60,
            font: boldFont,
            size: 14,
            color: rgb(0, 0.53, 0.71),
        });

        // Subtitle with generation date
        page.drawText(sanitizeTextForPDF(`Generated on: ${new Date().toLocaleDateString('en-GB')}`), {
            x: pageMargin,
            y: y + 40,
            font: font,
            size: 9,
            color: rgb(0.4, 0.4, 0.4),
        });

        y -= headerHeight; // Move Y for table header
        let x = pageMargin;
        for (const col of columns) {
            page.drawRectangle({
                x,
                y,
                width: col.width,
                height: headerHeight,
                borderColor: rgb(0, 0, 0),
                borderWidth: 1,
            });
            page.drawText(sanitizeTextForPDF(col.header), {
                x: x + columnPadding,
                y: y + (headerHeight / 2) - 4, // Center vertically
                font: boldFont,
                size: 8,
                color: rgb(0, 0, 0),
            });
            x += col.width;
        }
        y -= rowHeight; // Move Y for first data row
    };

    drawHeader();

    for (const item of data) {
        if (y < pageMargin + rowHeight) { // Check if new page is needed
            page = pdfDoc.addPage();
            y = tableStartY;
            drawHeader(); // Redraw header on new page
        }

        let x = pageMargin;
        for (const col of columns) {
            page.drawRectangle({
                x,
                y,
                width: col.width,
                height: rowHeight,
                borderColor: rgb(0, 0, 0),
                borderWidth: 0.5,
            });
            let text = String(item[col.key] || '');
            if (col.key === 'expectedAmount' || col.key === 'paidAmount' || col.key === 'outstanding') {
                // Format numbers with thousands separator, no FCFA prefix to save space
                const amount = parseFloat(text) || 0; // Handle NaN values
                text = amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
            }
            // Truncate long text to fit in column
            const maxChars = Math.floor(col.width / 4);
            if (text.length > maxChars && (col.key === 'studentName' || col.key === 'studentMatricule')) {
                text = text.substring(0, maxChars - 2) + '..';
            }

            const sanitizedText = sanitizeTextForPDF(text);
            let textX = x + columnPadding;
            if (col.align === AlignmentType.RIGHT) {
                const textWidth = font.widthOfTextAtSize(sanitizedText, 7.5);
                textX = x + col.width - textWidth - columnPadding;
            }
            page.drawText(sanitizedText, {
                x: textX,
                y: y + (rowHeight / 2) - 4,
                font,
                size: 7.5,
                color: rgb(0, 0, 0),
            });
            x += col.width;
        }
        y -= rowHeight; // Move to the next row
    }

    return Buffer.from(await pdfDoc.save());
}

// Helper for generating DOCX
async function generateDOCX(data: any[], reportMetadata?: any): Promise<Buffer> {
    // Generate descriptive title
    const className = reportMetadata?.className || 'All Classes';
    const academicYear = reportMetadata?.academicYear || new Date().getFullYear();
    const reportTitle = `${className} Student Fee Report - Academic Year ${academicYear}`;

    const tableRows = data.map(item => new TableRow({
        children: [
            new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: String(item.feeId), size: 20 })] })],
                width: { size: 5, type: WidthType.PERCENTAGE }
            }),
            new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: item.studentName, size: 20 })] })],
                width: { size: 20, type: WidthType.PERCENTAGE }
            }),
            new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: item.studentMatricule, size: 20 })] })],
                width: { size: 12, type: WidthType.PERCENTAGE }
            }),
            new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: item.className, size: 20 })] })],
                width: { size: 10, type: WidthType.PERCENTAGE }
            }),
            new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: item.subClassName || '', size: 20 })] })],
                width: { size: 10, type: WidthType.PERCENTAGE }
            }),
            new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: `${(parseFloat(item.expectedAmount) || 0).toLocaleString('en-US')}`, size: 20 })] })],
                width: { size: 11, type: WidthType.PERCENTAGE }
            }),
            new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: `${(parseFloat(item.paidAmount) || 0).toLocaleString('en-US')}`, size: 20 })] })],
                width: { size: 11, type: WidthType.PERCENTAGE }
            }),
            new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: `${(parseFloat(item.outstanding) || 0).toLocaleString('en-US')}`, size: 20 })] })],
                width: { size: 11, type: WidthType.PERCENTAGE }
            }),
            new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: item.dueDate, size: 20 })] })],
                width: { size: 10, type: WidthType.PERCENTAGE }
            }),
        ],
    }));

    const doc = new Document({
        sections: [{
            children: [
                new Paragraph({
                    children: [
                        new TextRun({
                            text: reportTitle,
                            size: 32,
                            bold: true,
                        }),
                    ],
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 200 },
                }),
                new Paragraph({
                    children: [
                        new TextRun({
                            text: `Generated on: ${new Date().toLocaleDateString('en-GB')}`,
                            size: 20,
                            color: '666666',
                        }),
                    ],
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 400 },
                }),
                new Table({
                    rows: [
                        new TableRow({
                            children: [
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: 'ID', bold: true, size: 20 })] })],
                                    borders: { top: { style: BorderStyle.SINGLE, size: 1 }, bottom: { style: BorderStyle.SINGLE, size: 1 } },
                                    width: { size: 5, type: WidthType.PERCENTAGE }
                                }),
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: 'Student Name', bold: true, size: 20 })] })],
                                    borders: { top: { style: BorderStyle.SINGLE, size: 1 }, bottom: { style: BorderStyle.SINGLE, size: 1 } },
                                    width: { size: 20, type: WidthType.PERCENTAGE }
                                }),
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: 'Matricule', bold: true, size: 20 })] })],
                                    borders: { top: { style: BorderStyle.SINGLE, size: 1 }, bottom: { style: BorderStyle.SINGLE, size: 1 } },
                                    width: { size: 12, type: WidthType.PERCENTAGE }
                                }),
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: 'Class', bold: true, size: 20 })] })],
                                    borders: { top: { style: BorderStyle.SINGLE, size: 1 }, bottom: { style: BorderStyle.SINGLE, size: 1 } },
                                    width: { size: 10, type: WidthType.PERCENTAGE }
                                }),
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: 'Subclass', bold: true, size: 20 })] })],
                                    borders: { top: { style: BorderStyle.SINGLE, size: 1 }, bottom: { style: BorderStyle.SINGLE, size: 1 } },
                                    width: { size: 10, type: WidthType.PERCENTAGE }
                                }),
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: 'Expected', bold: true, size: 20 })] })],
                                    borders: { top: { style: BorderStyle.SINGLE, size: 1 }, bottom: { style: BorderStyle.SINGLE, size: 1 } },
                                    width: { size: 11, type: WidthType.PERCENTAGE }
                                }),
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: 'Paid', bold: true, size: 20 })] })],
                                    borders: { top: { style: BorderStyle.SINGLE, size: 1 }, bottom: { style: BorderStyle.SINGLE, size: 1 } },
                                    width: { size: 11, type: WidthType.PERCENTAGE }
                                }),
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: 'Outstanding', bold: true, size: 20 })] })],
                                    borders: { top: { style: BorderStyle.SINGLE, size: 1 }, bottom: { style: BorderStyle.SINGLE, size: 1 } },
                                    width: { size: 11, type: WidthType.PERCENTAGE }
                                }),
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: 'Due Date', bold: true, size: 20 })] })],
                                    borders: { top: { style: BorderStyle.SINGLE, size: 1 }, bottom: { style: BorderStyle.SINGLE, size: 1 } },
                                    width: { size: 10, type: WidthType.PERCENTAGE }
                                }),
                            ],
                        }),
                        ...tableRows,
                    ],
                    width: {
                        size: 100,
                        type: WidthType.PERCENTAGE,
                    },
                }),
            ],
        }],
    });

    return Buffer.from(await Packer.toBuffer(doc));
}


export async function getAllFees(
    paginationOptions?: PaginationOptions,
    filterOptions?: FilterOptions,
    academicYearId?: number
): Promise<PaginatedResult<SchoolFees>> {
    const yearId = await getAcademicYearId(academicYearId);

    const where: any = {};

    if (yearId) {
        where.academic_year_id = yearId;
    }

    if (filterOptions) {
        // Consolidated search by name/ID and new studentIdentifier (name or matricule)
        if (filterOptions.search || filterOptions.studentIdentifier) {
            const searchString = (filterOptions.search || filterOptions.studentIdentifier) as string;
            // The matricule can contain non-numeric characters, so direct parseInt is not sufficient for matricule search.
            // For student name or matricule, 'contains' with insensitive mode is appropriate.
            where.OR = [
                // Search by student name
                {
                    enrollment: {
                        student: {
                            name: { contains: searchString, mode: 'insensitive' }
                        }
                    }
                },
                // Search by student matricule
                {
                    enrollment: {
                        student: {
                            matricule: { contains: searchString, mode: 'insensitive' }
                        }
                    }
                },
                // Search by parent name (existing logic)
                {
                    enrollment: {
                        student: {
                            parents: {
                                some: {
                                    parent: {
                                        name: { contains: searchString, mode: 'insensitive' }
                                    }
                                }
                            }
                        }
                    }
                }
            ];

            // If searchString is a valid number, also search by student ID (which is an int)
            const searchId = parseInt(searchString, 10);
            if (!isNaN(searchId)) {
                where.OR.push({
                    enrollment: {
                        student_id: searchId
                    }
                });
            }
        }

        // Filter by class name (existing)
        if (filterOptions.className) {
            where.enrollment = {
                ...(where.enrollment || {}),
                sub_class: {
                    ...(where.enrollment?.sub_class || {}),
                    class: {
                        name: { contains: filterOptions.className, mode: 'insensitive' }
                    }
                }
            };
        }

        // Filter by subclass name (existing)
        if (filterOptions.subclassName) {
            where.enrollment = {
                ...(where.enrollment || {}),
                sub_class: {
                    ...(where.enrollment?.sub_class || {}),
                    name: { contains: filterOptions.subclassName, mode: 'insensitive' }
                }
            };
        }

        // New: Filter by class_id
        if (filterOptions.classId) {
            const classId = parseInt(filterOptions.classId as string);
            if (!isNaN(classId)) {
                where.enrollment = {
                    ...(where.enrollment || {}),
                    sub_class: {
                        ...(where.enrollment?.sub_class || {}),
                        class_id: classId
                    }
                };
            }
        }

        // New: Filter by sub_class_id
        if (filterOptions.subClassId) {
            const subClassId = parseInt(filterOptions.subClassId as string);
            if (!isNaN(subClassId)) {
                where.enrollment = {
                    ...(where.enrollment || {}),
                    sub_class_id: subClassId
                };
            }
        }

        // Filter by due date (existing)
        if (filterOptions.dueDate) {
            const dueDate = new Date(filterOptions.dueDate as string);
            if (!isNaN(dueDate.getTime())) {
                where.due_date = { lte: dueDate };
            }
        }

        if (filterOptions.dueBeforeDate) {
            const dueBeforeDate = new Date(filterOptions.dueBeforeDate as string);
            if (!isNaN(dueBeforeDate.getTime())) {
                where.due_date = { lte: dueBeforeDate };
            }
        }

        if (filterOptions.dueAfterDate) {
            const dueAfterDate = new Date(filterOptions.dueAfterDate as string);
            if (!isNaN(dueAfterDate.getTime())) {
                where.due_date = { gte: dueAfterDate };
            }
        }

        // New: Filter by payment status
        if (filterOptions.paymentStatus) {
            const status = (filterOptions.paymentStatus as string).toLowerCase();
            switch (status) {
                case 'paid':
                    break;
                case 'partial':
                    break;
                case 'unpaid':
                    break;
            }
        }
    }

    const include: any = {
        enrollment: {
            include: {
                student: {
                    include: { parents: { include: { parent: true } } }
                },
                sub_class: {
                    include: { class: true }
                }
            }
        },
        academic_year: true,
        payment_transactions: true
    };

    // Apply database-level pagination
    const page = paginationOptions?.page || 1;
    const limit = paginationOptions?.limit || 10;
    const skip = (page - 1) * limit;

    let fees = await prisma.schoolFees.findMany({
        where,
        include,
        orderBy: [
            { enrollment: { sub_class: { class: { name: 'asc' } } } },
            { enrollment: { student: { name: 'asc' } } }
        ],
        skip,
        take: limit
    });

    // Apply payment status filter after fetching if it requires dynamic comparison
    // Note: This is less efficient but necessary for complex payment status logic
    let totalCount = await prisma.schoolFees.count({ where });
    
    if (filterOptions?.paymentStatus) {
        const status = (filterOptions.paymentStatus as string).toLowerCase();
        
        // For payment status filtering, we need to fetch all and then filter
        const allFees = await prisma.schoolFees.findMany({
            where,
            include,
            orderBy: [
                { enrollment: { sub_class: { class: { name: 'asc' } } } },
                { enrollment: { student: { name: 'asc' } } }
            ]
        });
        
        const filteredFees = allFees.filter(fee => {
            switch (status) {
                case 'paid':
                    return fee.amount_paid >= fee.amount_expected;
                case 'partial':
                    return fee.amount_paid > 0 && fee.amount_paid < fee.amount_expected;
                case 'unpaid':
                    return fee.amount_paid <= 0;
                default:
                    return true;
            }
        });
        
        totalCount = filteredFees.length;
        fees = filteredFees.slice(skip, skip + limit);
    }

    const paginatedResult: PaginatedResult<SchoolFees> = {
        data: fees,
        meta: {
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit),
            page,
            limit,
        }
    };

    return paginatedResult;
}

/**
 * Get a specific fee by ID
 * @param id The ID of the fee record
 * @returns The fee record or null if not found
 */
export async function getFeeById(id: number): Promise<SchoolFees | null> {
    return prisma.schoolFees.findUnique({
        where: { id },
        include: {
            enrollment: {
                include: {
                    student: true,
                    sub_class: {
                        include: {
                            class: true
                        }
                    }
                }
            },
            academic_year: true,
            payment_transactions: true
        }
    });
}

export async function createFee(data: {
    amount_expected: number;
    amount_paid: number;
    academic_year_id?: number;
    due_date: string;
    enrollment_id?: number;
    student_id?: number;
    payment_method?: string;
}): Promise<SchoolFees> {
    // Handle the case where student_id is provided instead of enrollment_id
    if (data.student_id && !data.enrollment_id) {
        // Convert student_id to number if it's a string
        const studentId = typeof data.student_id === 'string' ? parseInt(data.student_id, 10) : data.student_id;

        const enrollment = await getStudentSubclassByStudentAndYear(
            studentId,
            data.academic_year_id
        );

        if (!enrollment) {
            throw new Error(`Student with ID ${studentId} is not enrolled in the specified academic year`);
        }

        data.enrollment_id = enrollment.id;
    }

    // Get current academic year if not provided
    if (!data.academic_year_id) {
        data.academic_year_id = await getAcademicYearId() || undefined;
        if (!data.academic_year_id) {
            throw new Error("No academic year found and none provided");
        }
    }

    if (data.payment_method) {
        data.payment_method = normalizePaymentMethod(data.payment_method);
    }

    if (data.amount_paid) {
        data.amount_paid = typeof data.amount_paid === 'string'
            ? parseFloat(data.amount_paid)
            : data.amount_paid;
    }

    // Validate that enrollment exists
    if (!data.enrollment_id) {
        throw new Error("Enrollment ID is required");
    }

    const enrollment = await prisma.enrollment.findUnique({
        where: { id: data.enrollment_id }
    });
    if (!enrollment) {
        throw new Error(`Enrollment with ID ${data.enrollment_id} not found`);
    }

    return prisma.schoolFees.create({
        data: {
            amount_expected: data.amount_expected,
            amount_paid: data.amount_paid,
            academic_year_id: data.academic_year_id,
            due_date: new Date(data.due_date),
            enrollment_id: data.enrollment_id!
        }
    });
}

/**
 * Update an existing fee record
 * @param id The ID of the fee to update
 * @param data The updated fee data
 * @returns The updated fee record
 */
export async function updateFee(
    id: number,
    data: {
        amount_expected?: number;
        amount_paid?: number;
        payment_method?: string;
        due_date?: string;
    }
): Promise<SchoolFees> {
    // First check if the fee exists
    const fee = await prisma.schoolFees.findUnique({
        where: { id }
    });

    if (!fee) {
        throw new Error(`Fee with ID ${id} not found`);
    }

    // Build update data object
    const updateData: any = {};

    if (data.amount_expected !== undefined) {
        updateData.amount_expected = data.amount_expected;
    }

    if (data.amount_paid !== undefined) {
        updateData.amount_paid = data.amount_paid;
    }

    if (data.payment_method !== undefined) {
        updateData.payment_method = normalizePaymentMethod(data.payment_method);
    }

    if (data.due_date !== undefined) {
        updateData.due_date = new Date(data.due_date);
    }

    return prisma.schoolFees.update({
        where: { id },
        data: updateData,
        include: {
            enrollment: {
                include: {
                    student: true,
                    sub_class: {
                        include: { class: true }
                    }
                }
            },
            academic_year: true,
            payment_transactions: true
        }
    });
}

/**
 * Delete an existing fee record
 * @param id The ID of the fee to delete
 * @returns The deleted fee record
 */
export async function deleteFee(id: number): Promise<SchoolFees> {
    // Check if there are any associated payment transactions
    const paymentCount = await prisma.paymentTransaction.count({
        where: { fee_id: id }
    });

    if (paymentCount > 0) {
        throw new Error('Cannot delete fee with existing payment records. Please delete associated payments first.');
    }

    return prisma.schoolFees.delete({
        where: { id }
    });
}

/**
 * Get all fees for a specific student
 * @param studentId The ID of the student
 * @param academicYearId Optional academic year ID
 * @returns Array of fees
 */
export interface SchoolFeesStatus {
    paid_in_full: boolean;
    amount_expected: number;
    amount_paid: number;
    shortfall: number;
    school_fees_id: number | null;
    enrollment_id: number | null;
    academic_year_id: number | null;
    has_enrollment: boolean;
    has_fees_record: boolean;
}

/**
 * Check whether a student has paid their school fees in full for a given academic year.
 * Used by report-card generation as a gate.
 */
export async function checkStudentSchoolFeesPaid(
    studentId: number,
    academicYearId?: number
): Promise<SchoolFeesStatus> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) throw new Error('Academic year is required to check fee status');

    const enrollment = await prisma.enrollment.findUnique({
        where: { student_id_academic_year_id: { student_id: studentId, academic_year_id: yearId } },
        include: { school_fees: { where: { academic_year_id: yearId } } },
    });

    if (!enrollment) {
        return {
            paid_in_full: false,
            amount_expected: 0,
            amount_paid: 0,
            shortfall: 0,
            school_fees_id: null,
            enrollment_id: null,
            academic_year_id: yearId,
            has_enrollment: false,
            has_fees_record: false,
        };
    }

    const fees = enrollment.school_fees[0];
    if (!fees) {
        return {
            paid_in_full: false,
            amount_expected: 0,
            amount_paid: 0,
            shortfall: 0,
            school_fees_id: null,
            enrollment_id: enrollment.id,
            academic_year_id: yearId,
            has_enrollment: true,
            has_fees_record: false,
        };
    }

    const shortfall = Math.max(0, fees.amount_expected - fees.amount_paid);
    return {
        paid_in_full: shortfall === 0,
        amount_expected: fees.amount_expected,
        amount_paid: fees.amount_paid,
        shortfall,
        school_fees_id: fees.id,
        enrollment_id: enrollment.id,
        academic_year_id: yearId,
        has_enrollment: true,
        has_fees_record: true,
    };
}

/**
 * List every student in a subclass with their school-fees status for a given academic year.
 * Useful as a preflight check before downloading a combined subclass report.
 */
export async function getSubclassFeesStatus(
    subClassId: number,
    academicYearId?: number
): Promise<{
    sub_class_id: number;
    academic_year_id: number;
    total_students: number;
    paid_in_full_count: number;
    unpaid_count: number;
    students: Array<{
        student_id: number;
        enrollment_id: number;
        name: string;
        matricule: string;
        amount_expected: number;
        amount_paid: number;
        shortfall: number;
        paid_in_full: boolean;
    }>;
}> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) throw new Error('Academic year is required');

    const enrollments = await prisma.enrollment.findMany({
        where: { sub_class_id: subClassId, academic_year_id: yearId, student: { status: { not: 'WITHDRAWN' } } },
        include: { student: true, school_fees: { where: { academic_year_id: yearId } } },
        orderBy: { student: { name: 'asc' } },
    });

    const students = enrollments.map(e => {
        const fees = e.school_fees[0];
        const expected = fees?.amount_expected ?? 0;
        const paid = fees?.amount_paid ?? 0;
        const shortfall = Math.max(0, expected - paid);
        return {
            student_id: e.student_id,
            enrollment_id: e.id,
            name: e.student.name,
            matricule: e.student.matricule,
            amount_expected: expected,
            amount_paid: paid,
            shortfall,
            paid_in_full: shortfall === 0 && expected > 0,
        };
    });

    return {
        sub_class_id: subClassId,
        academic_year_id: yearId,
        total_students: students.length,
        paid_in_full_count: students.filter(s => s.paid_in_full).length,
        unpaid_count: students.filter(s => !s.paid_in_full).length,
        students,
    };
}

export async function getStudentFees(studentId: number, academicYearId?: number): Promise<SchoolFees[]> {
    const yearId = await getAcademicYearId(academicYearId);

    if (!yearId) {
        throw new Error("Academic year ID is required to fetch student fees, but none was provided or found.");
    }

    return prisma.schoolFees.findMany({
        where: {
            enrollment: {
                student_id: studentId,
                academic_year_id: yearId
            }
        },
        include: {
            enrollment: {
                include: {
                    student: true,
                    sub_class: {
                        include: { class: true }
                    }
                }
            },
            academic_year: true,
            payment_transactions: true
        },
        orderBy: { due_date: 'asc' }
    });
}

/**
 * Get fee summary for a sub_class
 * @param sub_classId The ID of the sub_class
 * @param academicYearId Optional academic year ID
 * @returns Fee summary object
 */
export async function getSubclassFeesSummary(sub_classId: number, academicYearId?: number): Promise<any> {
    const yearId = await getAcademicYearId(academicYearId);

    if (!yearId) {
        throw new Error("Academic year ID is required to fetch subclass fees summary, but none was provided or found.");
    }

    // Get all fees for students in the specified sub_class for the academic year
    const fees = await prisma.schoolFees.findMany({
        where: {
            academic_year_id: yearId,
            enrollment: {
                sub_class_id: sub_classId
            }
        },
        include: {
            payment_transactions: true
        }
    });

    const totalExpected = fees.reduce((sum, fee) => sum + fee.amount_expected, 0);
    const totalPaid = fees.reduce((sum, fee) => sum + fee.amount_paid, 0);
    const outstanding = totalExpected - totalPaid;
    const paymentPercentage = totalExpected > 0 ? (totalPaid / totalExpected) * 100 : 0;

    // Get sub_class and class names for context
    const subClassInfo = await prisma.subClass.findUnique({
        where: { id: sub_classId },
        include: { class: true }
    });

    return {
        subClassId: sub_classId,
        subClassName: subClassInfo?.name || 'N/A',
        className: subClassInfo?.class?.name || 'N/A',
        academicYearId: yearId,
        totalStudentsWithFees: fees.length,
        totalExpected: totalExpected,
        totalPaid: totalPaid,
        outstanding: outstanding,
        paymentPercentage: parseFloat(paymentPercentage.toFixed(2))
    };
}

/**
 * Normalizes payment method string to an enum value
 */
function normalizePaymentMethod(method: string): 'EXPRESS_UNION' | 'CCA' | 'F3DC' | 'AFRILAND_FIRST_BANK' {
    const upperMethod = method.toUpperCase();
    if (Object.values(PaymentMethod).includes(upperMethod as PaymentMethod)) {
        return upperMethod as 'EXPRESS_UNION' | 'CCA' | 'F3DC' | 'AFRILAND_FIRST_BANK';
    }
    // Default to a known method or throw an error if the method is invalid
    throw new Error(`Invalid payment method: ${method}`);
}

export async function recordPayment(data: {
    amount: number;
    payment_date: string;
    receipt_number?: string;
    payment_method: string;
    enrollment_id?: number;
    student_id?: number;
    academic_year_id?: number;
    fee_id: number;
    recorded_by_id?: number;
}): Promise<PaymentTransaction> {
    // Convert student_id to enrollment_id if student_id is provided
    if (data.student_id && !data.enrollment_id) {
        const studentId = typeof data.student_id === 'string' ? parseInt(data.student_id, 10) : data.student_id;
        const yearId = data.academic_year_id || await getAcademicYearId();
        if (!yearId) {
            throw new Error("Academic year ID is required to find enrollment by student ID, but none was provided or found.");
        }
        const enrollment = await getStudentSubclassByStudentAndYear(studentId, yearId);
        if (!enrollment) {
            throw new Error(`Student with ID ${studentId} not enrolled in academic year ${yearId}`);
        }
        data.enrollment_id = enrollment.id;
    }

    if (!data.enrollment_id) {
        throw new Error('Enrollment ID is required to record a payment.');
    }

    const normalizedPaymentMethod = normalizePaymentMethod(data.payment_method);

    // Get academic year ID if not provided
    const academicYearId = data.academic_year_id || await getAcademicYearId();
    if (!academicYearId) {
        throw new Error("Academic year ID is required to record a payment, but none was provided or found.");
    }

    const windowStart = new Date(Date.now() - DUPLICATE_PAYMENT_WINDOW_SECONDS * 1000);
    const recentDuplicate = await prisma.paymentTransaction.findFirst({
        where: {
            enrollment_id: data.enrollment_id,
            amount: data.amount,
            payment_method: normalizedPaymentMethod,
            created_at: { gte: windowStart },
        },
        orderBy: { created_at: 'desc' },
    });
    if (recentDuplicate) {
        const secondsAgo = Math.round((Date.now() - recentDuplicate.created_at.getTime()) / 1000);
        throw new DuplicatePaymentError(
            `Duplicate payment detected — a payment of ${data.amount} via ${normalizedPaymentMethod} for this student was recorded ${secondsAgo} second(s) ago. If this is intentional, wait ${DUPLICATE_PAYMENT_WINDOW_SECONDS} seconds and retry.`,
            recentDuplicate.id,
            secondsAgo,
        );
    }

    const createData: any = {
        fee_id: data.fee_id,
        enrollment_id: data.enrollment_id,
        academic_year_id: academicYearId,
        amount: data.amount,
        payment_date: new Date(data.payment_date),
        receipt_number: data.receipt_number,
        payment_method: normalizedPaymentMethod,
    };

    if (data.recorded_by_id !== undefined) {
        createData.recorded_by_id = data.recorded_by_id;
    }

    const payment = await prisma.paymentTransaction.create({
        data: createData,
    });

    // Update the amount_paid in the SchoolFees record
    await prisma.schoolFees.update({
        where: { id: data.fee_id },
        data: {
            amount_paid: {
                increment: data.amount // Add the new payment amount to the total paid
            }
        }
    });

    return payment;
}

export async function exportFeeReports(
    academicYearId?: number,
    subClassId?: number,
    classId?: number,
    studentIdentifier?: string,
    paymentStatus?: string,
    format: 'csv' | 'pdf' | 'docx' | 'xlsx' = 'csv' // Default to CSV
): Promise<{ buffer: Buffer, contentType: string, filename: string }> {
    try {
        const yearId = await getAcademicYearId(academicYearId);

        if (!yearId) {
            throw new Error("No academic year found and none provided");
        }

        // Build where clause based on the new filters
        const where: any = {
            academic_year_id: yearId
        };

        if (subClassId) {
            where.enrollment = {
                ...(where.enrollment || {}),
                sub_class_id: subClassId
            };
        }

        if (classId) {
            where.enrollment = {
                ...(where.enrollment || {}),
                sub_class: {
                    ...(where.enrollment?.sub_class || {}),
                    class_id: classId
                }
            };
        }

        if (studentIdentifier) {
            const searchId = parseInt(studentIdentifier, 10);
            where.enrollment = {
                ...(where.enrollment || {}),
                student: {
                    OR: [
                        { name: { contains: studentIdentifier, mode: 'insensitive' } },
                        { matricule: { contains: studentIdentifier, mode: 'insensitive' } }
                    ]
                }
            };
        }

        // Get all fees for the academic year with filters
        let fees = await prisma.schoolFees.findMany({
            where: where,
            include: {
                enrollment: {
                    include: {
                        student: true,
                        sub_class: {
                            include: {
                                class: true
                            }
                        }
                    }
                },
                academic_year: true,
                payment_transactions: true
            },
            orderBy: [
                { enrollment: { sub_class: { class: { name: 'asc' } } } },
                { enrollment: { student: { name: 'asc' } } }
            ]
        });

        // Apply payment status filter after fetching
        if (paymentStatus) {
            const status = (paymentStatus as string).toLowerCase();
            fees = fees.filter(fee => {
                switch (status) {
                    case 'paid':
                        return fee.amount_paid >= fee.amount_expected;
                    case 'partial':
                        return fee.amount_paid > 0 && fee.amount_paid < fee.amount_expected;
                    case 'unpaid':
                        return fee.amount_paid <= 0;
                    default:
                        return true; // No filter applied for unknown status
                }
            });
        }

        // Map fees to a flatter structure suitable for reports
        const reportData = fees.map(fee => ({
            feeId: fee.id,
            studentName: fee.enrollment.student.name,
            studentMatricule: fee.enrollment.student.matricule,
            className: fee.enrollment.sub_class?.class.name || 'No Class',
            subClassName: fee.enrollment.sub_class?.name || 'No Subclass',
            expectedAmount: parseFloat((fee.amount_expected || 0).toFixed(2)),
            paidAmount: parseFloat((fee.amount_paid || 0).toFixed(2)),
            outstanding: parseFloat(((fee.amount_expected || 0) - (fee.amount_paid || 0)).toFixed(2)),
            paymentPercentage: (fee.amount_expected || 0) > 0 ?
                parseFloat((((fee.amount_paid || 0) / fee.amount_expected) * 100).toFixed(2)) : 0,
            dueDate: fee.due_date.toISOString().split('T')[0], // Format date
            paymentsCount: fee.payment_transactions.length
        }));

        // Get metadata for report title
        let className = 'All Classes';
        if (classId) {
            const classInfo = await prisma.class.findUnique({
                where: { id: classId }
            });
            className = classInfo?.name || `Class ${classId}`;
        } else if (subClassId) {
            const subClassInfo = await prisma.subClass.findUnique({
                where: { id: subClassId },
                include: { class: true }
            });
            className = subClassInfo?.class?.name || 'Unknown Class';
        }

        const academicYearInfo = await prisma.academicYear.findUnique({
            where: { id: yearId }
        });

        const reportMetadata = {
            className,
            academicYear: academicYearInfo?.name || yearId,
            paymentStatus: paymentStatus || 'All',
            totalRecords: reportData.length
        };

        let buffer: Buffer;
        let contentType: string;
        let filename: string = `${className.toLowerCase().replace(/\s+/g, '_')}_fee_report_${yearId}`;

        switch (format) {
            case 'csv':
                buffer = await generateCSV(reportData);
                contentType = 'text/csv';
                filename += '.csv';
                break;
            case 'pdf':
                buffer = await generatePDF(reportData, reportMetadata);
                contentType = 'application/pdf';
                filename += '.pdf';
                break;
            case 'docx':
                buffer = await generateDOCX(reportData, reportMetadata);
                contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                filename += '.docx';
                break;
            case 'xlsx':
                buffer = await generateExcel(reportData, reportMetadata);
                contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                filename += '.xlsx';
                break;
            default:
                throw new Error('Unsupported format');
        }

        return { buffer, contentType, filename };

    } catch (error: any) {
        console.error('Error in exportFeeReports:', error);
        throw error;
    }
}

// Bursar edits are restricted to a 2-day window after payment creation.
// Higher roles (SUPER_MANAGER, MANAGER, PRINCIPAL) bypass this check.
const BURSAR_EDIT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export class PaymentEditWindowClosedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PaymentEditWindowClosedError';
    }
}

export class DuplicatePaymentError extends Error {
    public readonly existingPaymentId: number;
    public readonly secondsAgo: number;
    constructor(message: string, existingPaymentId: number, secondsAgo: number) {
        super(message);
        this.name = 'DuplicatePaymentError';
        this.existingPaymentId = existingPaymentId;
        this.secondsAgo = secondsAgo;
    }
}

export const DUPLICATE_PAYMENT_WINDOW_SECONDS = 60;

export async function updatePayment(
    paymentId: number,
    data: {
        amount?: number;
        payment_date?: string;
        receipt_number?: string | null;
        payment_method?: string;
        notes?: string | null;
    },
    userRoles: string[] = []
): Promise<PaymentTransaction> {
    const existing = await prisma.paymentTransaction.findUnique({
        where: { id: paymentId },
    });

    if (!existing) {
        throw new Error(`Payment with ID ${paymentId} not found`);
    }

    const isPrivileged = userRoles.some(r =>
        ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL'].includes(r)
    );
    if (!isPrivileged) {
        const ageMs = Date.now() - new Date(existing.created_at).getTime();
        if (ageMs > BURSAR_EDIT_WINDOW_MS) {
            throw new PaymentEditWindowClosedError(
                'Edit window has closed. Bursars can only edit a payment within 2 days of its creation.'
            );
        }
    }

    const updateData: any = {};
    if (data.amount !== undefined) {
        updateData.amount = typeof data.amount === 'string' ? parseFloat(data.amount) : data.amount;
    }
    if (data.payment_date !== undefined) {
        updateData.payment_date = new Date(data.payment_date);
    }
    if (data.receipt_number !== undefined) {
        updateData.receipt_number = data.receipt_number;
    }
    if (data.payment_method !== undefined) {
        updateData.payment_method = normalizePaymentMethod(data.payment_method);
    }
    if (data.notes !== undefined) {
        updateData.notes = data.notes;
    }

    const amountDelta =
        updateData.amount !== undefined ? updateData.amount - existing.amount : 0;

    const [updated] = await prisma.$transaction([
        prisma.paymentTransaction.update({
            where: { id: paymentId },
            data: updateData,
        }),
        ...(amountDelta !== 0
            ? [
                prisma.schoolFees.update({
                    where: { id: existing.fee_id },
                    data: { amount_paid: { increment: amountDelta } },
                }),
            ]
            : []),
    ]);

    return updated;
}

/**
 * Retrieves all payment transactions for a specific fee record
 * @param feeId The ID of the fee record
 * @returns Array of payment transactions or null if the fee doesn't exist
 */
export async function getFeePayments(feeId: number): Promise<PaymentTransaction[] | null> {
    // First check if the fee exists
    const feeExists = await prisma.schoolFees.findUnique({
        where: { id: feeId }
    });

    if (!feeExists) {
        return null;
    }

    // Get all payment transactions for this fee
    return prisma.paymentTransaction.findMany({
        where: { fee_id: feeId },
        orderBy: { payment_date: 'desc' }
    });
}

/**
 * Updates all student fees when a class fee structure changes
 * @param classId The ID of the class that had its fee structure updated
 * @param academicYearId Optional academic year ID (defaults to current)
 * @returns The number of updated fee records
 */
export async function updateFeesOnClassFeeChange(classId: number, academicYearId?: number): Promise<number> {
    // Get current academic year if not provided
    const yearId = await getAcademicYearId(academicYearId);

    if (!yearId) {
        throw new Error("Academic year ID is required to update fees, but none was provided or found.");
    }

    // Get the updated class info
    const classInfo = await prisma.class.findUnique({
        where: { id: classId }
    });

    if (!classInfo) {
        throw new Error(`Class with ID ${classId} not found`);
    }

    // Find all enrollments for this class in the given academic year
    const enrollments = await prisma.enrollment.findMany({
        where: {
            academic_year_id: yearId,
            sub_class: {
                class_id: classId
            },
            student: { status: { not: 'WITHDRAWN' } }
        },
        include: {
            student: true,
            sub_class: true,
            school_fees: {
                where: {
                    academic_year_id: yearId // Ensure we only get fees for this academic year
                }
            }
        }
    });

    console.log(`Found ${enrollments.length} enrollments to update fees for class ${classId}`);

    // Track the number of updates
    let updatedCount = 0;

    // For each enrollment, update or create their fees based on class structure
    for (const enrollment of enrollments) {
        // Calculate the expected fee amount based on class structure
        // base_fee already contains the sum of all term fees (first_term_fee + second_term_fee + third_term_fee)
        let feeAmount = classInfo.base_fee;

        // Add miscellaneous fees
        feeAmount += classInfo.miscellaneous_fee;

        // Add extra fees based on student status (new vs old)
        // Use the enhanced student status logic
        const shouldPayNewFees = await shouldPayNewStudentFees(enrollment.student_id, yearId);
        if (shouldPayNewFees) {
            feeAmount += classInfo.new_student_fee;
        } else {
            feeAmount += classInfo.old_student_fee;
        }

        console.log(`Calculated fee amount for student ${enrollment.student.name}: ${feeAmount}`);

        // Check if this enrollment already has fee records for this academic year
        if (enrollment.school_fees.length > 0) {
            // Update existing fee records
            for (const fee of enrollment.school_fees) {
                const updatedFee = await prisma.schoolFees.update({
                    where: { id: fee.id },
                    data: {
                        amount_expected: feeAmount
                    }
                });
                console.log(`Updated fee record ${fee.id} for student ${enrollment.student.name}. New expected amount: ${updatedFee.amount_expected}`);
                updatedCount++;
            }
        } else {
            // Create a new fee record if none exists
            // Get academic year for due date
            const academicYear = await prisma.academicYear.findUnique({
                where: { id: yearId }
            });

            const newFee = await prisma.schoolFees.create({
                data: {
                    enrollment_id: enrollment.id,
                    academic_year_id: yearId,
                    amount_expected: feeAmount,
                    amount_paid: 0,
                    due_date: academicYear?.end_date || new Date(new Date().getFullYear(), 11, 31)
                }
            });
            console.log(`Created new fee record ${newFee.id} for student ${enrollment.student.name}. Expected amount: ${newFee.amount_expected}`);
            updatedCount++;
        }
    }
    return updatedCount;
}

/**
 * Calculates the expected fee amount for a student based on class structure
 * @param classId The ID of the class
 * @param studentId The ID of the student
 * @param academicYearId The ID of the academic year
 * @returns The calculated fee amount
 */
async function calculateFeeAmount(classId: number, studentId: number, academicYearId: number): Promise<number> {
    const classInfo = await prisma.class.findUnique({
        where: { id: classId }
    });

    if (!classInfo) {
        throw new Error(`Class with ID ${classId} not found.`);
    }

    // Calculate the expected fee amount based on class structure
    // base_fee already contains the sum of all term fees (first_term_fee + second_term_fee + third_term_fee)
    let feeAmount = classInfo.base_fee;

    // Add miscellaneous fees
    feeAmount += classInfo.miscellaneous_fee;

    // Add extra fees based on student status (new vs old)
    // Since all students are new according to user, always use new_student_fee
    const shouldPayNewFees = await shouldPayNewStudentFees(studentId, academicYearId);
    if (shouldPayNewFees) {
        feeAmount += classInfo.new_student_fee;
    } else {
        feeAmount += classInfo.old_student_fee;
    }

    return feeAmount;
}

/**
 * Creates or updates a fee record for a student enrollment
 * @param enrollmentId The ID of the enrollment record
 * @param classId The ID of the class (for fee calculation)
 * @returns The created or updated SchoolFees record
 */
export async function createOrUpdateFeeForEnrollment(enrollmentId: number, classId: number): Promise<SchoolFees> {
    const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        include: {
            student: true,
            academic_year: true,
            school_fees: true
        }
    });

    if (!enrollment) {
        throw new Error(`Enrollment with ID ${enrollmentId} not found.`);
    }

    if (!enrollment.academic_year_id) {
        throw new Error('Enrollment must have an academic year to create/update fees.');
    }

    // Calculate the expected fee amount
    const feeAmount = await calculateFeeAmount(classId, enrollment.student_id, enrollment.academic_year_id);

    // Set due date to end of academic year or a reasonable default
    const academicYear = await prisma.academicYear.findUnique({
        where: { id: enrollment.academic_year_id }
    });

    const dueDate = academicYear?.end_date || new Date(new Date().getFullYear(), 11, 31); // Default to end of current year

    // Check if fee record already exists for this enrollment and academic year
    const existingFee = enrollment.school_fees.find(fee =>
        fee.academic_year_id === enrollment.academic_year_id
    );

    if (existingFee) {
        // Update existing fee with new amount
        return prisma.schoolFees.update({
            where: { id: existingFee.id },
            data: {
                amount_expected: feeAmount,
                due_date: dueDate
            }
        });
    } else {
        // Create new fee record
        return prisma.schoolFees.create({
            data: {
                enrollment_id: enrollment.id,
                academic_year_id: enrollment.academic_year_id,
                amount_expected: feeAmount,
                amount_paid: 0,
                due_date: dueDate
            }
        });
    }
}

/**
 * Creates a fee record for a newly enrolled student.
 * This function should be called during the student enrollment process.
 * @param enrollmentId The ID of the new enrollment record.
 * @returns The newly created SchoolFees record.
 * @deprecated Use createOrUpdateFeeForEnrollment instead
 */
export async function createFeeForNewEnrollment(enrollmentId: number): Promise<SchoolFees> {
    const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        include: {
            student: true,
            sub_class: {
                include: { class: true }
            },
            academic_year: true
        }
    });

    if (!enrollment) {
        throw new Error(`Enrollment with ID ${enrollmentId} not found.`);
    }

    const classId = enrollment.sub_class?.class_id || enrollment.class_id;
    if (!enrollment.academic_year_id || !classId) {
        throw new Error('Enrollment must have an academic year and associated class to create fees.');
    }

    return createOrUpdateFeeForEnrollment(enrollmentId, classId);
}
