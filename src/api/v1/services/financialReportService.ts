// src/api/v1/services/financialReportService.ts
import prisma from '../../../config/db';
import { getAcademicYearId } from '../../../utils/academicYear';
import { getFeeBalances, summarizeBalances, ACTIVE_FEE_ROW_WHERE } from './feeOutstandingService';
import { Parser } from 'json2csv';
import * as XLSX from 'xlsx';
import { PDFDocument, rgb, StandardFonts, PageSizes } from 'pdf-lib';
import { Document, Paragraph, Packer, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from 'docx';

/**
 * Generate Class Fee Summary Report
 * Groups data by class with totals and statistics
 */
export async function generateClassFeeSummaryReport(
    academicYearId?: number,
    classId?: number,
    format: 'csv' | 'xlsx' | 'pdf' | 'docx' = 'csv'
): Promise<{ buffer: Buffer, contentType: string, filename: string }> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) {
        throw new Error("No academic year found and none provided");
    }

    // Same numbers as the on-screen report / Overview / Defaulters (shared rule, M8).
    const reportData = await getClassFeeSummaryData(yearId, classId);

    // Generate file
    let buffer: Buffer;
    let contentType: string;
    let filename = `class_fee_summary_${yearId}`;

    switch (format) {
        case 'csv':
            const fields = [
                { label: 'Class Name', value: 'className' },
                { label: 'Total Students', value: 'totalStudents' },
                { label: 'Total Expected (FCFA)', value: 'totalExpected' },
                { label: 'Total Paid (FCFA)', value: 'totalPaid' },
                { label: 'Total Outstanding (FCFA)', value: 'totalOutstanding' },
                { label: 'Payment Percentage (%)', value: 'paymentPercentage' },
                { label: 'Students With Payments', value: 'studentsWithPayments' },
                { label: 'Students Without Payments', value: 'studentsWithoutPayments' }
            ];
            const parser = new Parser({ fields });
            buffer = Buffer.from(parser.parse(reportData));
            contentType = 'text/csv';
            filename += '.csv';
            break;

        case 'xlsx':
            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.json_to_sheet(reportData);

            // Set headers
            const headers = ['Class Name', 'Total Students', 'Total Expected (FCFA)',
                            'Total Paid (FCFA)', 'Total Outstanding (FCFA)',
                            'Payment %', 'Students With Payments', 'Students Without Payments'];

            XLSX.utils.sheet_add_aoa(worksheet, [headers], { origin: 'A1' });
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Class Summary');

            buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            filename += '.xlsx';
            break;

        case 'pdf':
            buffer = await generateSummaryPDF(reportData, 'Class Fee Summary', yearId);
            contentType = 'application/pdf';
            filename += '.pdf';
            break;

        case 'docx':
            buffer = await generateSummaryDOCX(reportData, 'Class Fee Summary', yearId);
            contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            filename += '.docx';
            break;

        default:
            throw new Error(`Unsupported format: ${format}`);
    }

    return { buffer, contentType, filename };
}

/**
 * Generate Detailed Student Fee Report
 * Shows individual student fee details with payment history
 */
export async function generateStudentDetailedFeesReport(
    academicYearId?: number,
    classId?: number,
    studentIdentifier?: string,
    format: 'csv' | 'xlsx' | 'pdf' | 'docx' = 'csv'
): Promise<{ buffer: Buffer, contentType: string, filename: string }> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) {
        throw new Error("No academic year found and none provided");
    }

    // Build where clause
    const where: any = { academic_year_id: yearId };

    if (classId) {
        where.enrollment = {
            sub_class: { class_id: classId }
        };
    }

    if (studentIdentifier) {
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

    const fees = await prisma.schoolFees.findMany({
        where,
        include: {
            enrollment: {
                include: {
                    student: true,
                    sub_class: {
                        include: { class: true }
                    }
                }
            },
            payment_transactions: {
                orderBy: { payment_date: 'desc' }
            }
        },
        orderBy: [
            { enrollment: { sub_class: { class: { name: 'asc' } } } },
            { enrollment: { student: { name: 'asc' } } }
        ]
    });

    const reportData = fees.map(fee => ({
        studentName: fee.enrollment.student.name,
        studentMatricule: fee.enrollment.student.matricule,
        className: fee.enrollment.sub_class?.name || 'No Class',
        expectedAmount: Number(fee.amount_expected) || 0,
        paidAmount: Number(fee.amount_paid) || 0,
        outstanding: (Number(fee.amount_expected) || 0) - (Number(fee.amount_paid) || 0),
        dueDate: fee.due_date.toISOString().split('T')[0]
    }));

    // Generate file
    let buffer: Buffer;
    let contentType: string;
    let filename = `student_detailed_fees_${yearId}`;

    switch (format) {
        case 'csv':
            const fields = [
                { label: 'Student Name', value: 'studentName' },
                { label: 'Matricule', value: 'studentMatricule' },
                { label: 'Class', value: 'className' },
                { label: 'Expected Amount (FCFA)', value: 'expectedAmount' },
                { label: 'Paid Amount (FCFA)', value: 'paidAmount' },
                { label: 'Outstanding (FCFA)', value: 'outstanding' },
                { label: 'Due Date', value: 'dueDate' }
            ];
            const parser = new Parser({ fields });
            buffer = Buffer.from(parser.parse(reportData));
            contentType = 'text/csv';
            filename += '.csv';
            break;

        case 'xlsx':
            const workbook = XLSX.utils.book_new();

            // Group data by subclass (className field contains subclass name)
            const groupedData = reportData.reduce((groups, item) => {
                const subClassName = item.className || 'No Subclass';
                if (!groups[subClassName]) {
                    groups[subClassName] = [];
                }
                groups[subClassName].push(item);
                return groups;
            }, {} as Record<string, any[]>);

            // Create a sheet for each subclass
            Object.entries(groupedData).forEach(([subClassName, subClassData]) => {
                // Convert data to worksheet format
                const worksheetData = subClassData.map(item => ({
                    'Student Name': item.studentName,
                    'Matricule': item.studentMatricule,
                    'Expected (FCFA)': item.expectedAmount,
                    'Paid (FCFA)': item.paidAmount,
                    'Outstanding (FCFA)': item.outstanding,
                    'Due Date': item.dueDate
                }));

                const worksheet = XLSX.utils.json_to_sheet(worksheetData);

                // Set column widths for better readability
                const colWidths = [
                    { wch: 35 },  // Student Name
                    { wch: 18 },  // Matricule
                    { wch: 18 },  // Expected Amount
                    { wch: 16 },  // Paid Amount
                    { wch: 18 },  // Outstanding
                    { wch: 15 }   // Due Date
                ];
                worksheet['!cols'] = colWidths;

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
                const worksheet = XLSX.utils.json_to_sheet([]);
                XLSX.utils.book_append_sheet(workbook, worksheet, 'No Data');
            }

            buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            filename += '.xlsx';
            break;

        case 'pdf':
            buffer = await generateSummaryPDF(reportData, 'Student Detailed Fees Report', yearId);
            contentType = 'application/pdf';
            filename += '.pdf';
            break;

        case 'docx':
            buffer = await generateSummaryDOCX(reportData, 'Student Detailed Fees Report', yearId);
            contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            filename += '.docx';
            break;

        default:
            throw new Error(`Unsupported format: ${format}`);
    }

    return { buffer, contentType, filename };
}

/**
 * Generate Payment Method Analytics Report
 * Shows statistics grouped by payment method
 */
export async function generatePaymentMethodAnalyticsReport(
    academicYearId?: number,
    classId?: number,
    format: 'csv' | 'xlsx' | 'pdf' | 'docx' = 'csv'
): Promise<{ buffer: Buffer, contentType: string, filename: string }> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) {
        throw new Error("No academic year found and none provided");
    }

    // Build where clause for payments
    const where: any = { academic_year_id: yearId };

    if (classId) {
        where.enrollment = {
            sub_class: { class_id: classId }
        };
    }

    const payments = await prisma.paymentTransaction.findMany({
        where,
        include: {
            enrollment: {
                include: {
                    sub_class: {
                        include: { class: true }
                    }
                }
            }
        }
    });

    // Group by payment method
    const methodGroups = payments.reduce((acc, payment) => {
        const method = payment.payment_method;

        if (!acc[method]) {
            acc[method] = {
                paymentMethod: method,
                totalTransactions: 0,
                totalAmount: 0,
                averageAmount: 0,
                uniqueStudents: new Set(),
                classBreakdown: {}
            };
        }

        acc[method].totalTransactions++;
        acc[method].totalAmount += payment.amount;
        acc[method].uniqueStudents.add(payment.enrollment_id);

        // Class breakdown
        const className = payment.enrollment?.sub_class?.class?.name || 'No Class';
        if (!acc[method].classBreakdown[className]) {
            acc[method].classBreakdown[className] = { count: 0, amount: 0 };
        }
        acc[method].classBreakdown[className].count++;
        acc[method].classBreakdown[className].amount += payment.amount;

        return acc;
    }, {} as Record<string, any>);

    // Format data
    const reportData = Object.values(methodGroups).map((group: any) => {
        const avgAmount = group.totalTransactions > 0
            ? group.totalAmount / group.totalTransactions
            : 0;

        return {
            paymentMethod: group.paymentMethod,
            totalTransactions: group.totalTransactions,
            totalAmount: parseFloat(group.totalAmount.toFixed(2)),
            averageAmount: parseFloat(avgAmount.toFixed(2)),
            uniqueStudents: group.uniqueStudents.size,
            marketShare: 0 // Will calculate after
        };
    });

    // Calculate market share
    const totalAmount = reportData.reduce((sum, item) => sum + item.totalAmount, 0);
    reportData.forEach(item => {
        item.marketShare = totalAmount > 0
            ? parseFloat(((item.totalAmount / totalAmount) * 100).toFixed(2))
            : 0;
    });

    // Generate file
    let buffer: Buffer;
    let contentType: string;
    let filename = `payment_method_analytics_${yearId}`;

    switch (format) {
        case 'csv':
            const fields = [
                { label: 'Payment Method', value: 'paymentMethod' },
                { label: 'Total Transactions', value: 'totalTransactions' },
                { label: 'Total Amount (FCFA)', value: 'totalAmount' },
                { label: 'Average Amount (FCFA)', value: 'averageAmount' },
                { label: 'Unique Students', value: 'uniqueStudents' },
                { label: 'Market Share (%)', value: 'marketShare' }
            ];
            const parser = new Parser({ fields });
            buffer = Buffer.from(parser.parse(reportData));
            contentType = 'text/csv';
            filename += '.csv';
            break;

        case 'xlsx':
            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.json_to_sheet(reportData);
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Payment Analytics');

            buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            filename += '.xlsx';
            break;

        case 'pdf':
            buffer = await generateSummaryPDF(reportData, 'Payment Method Analytics', yearId);
            contentType = 'application/pdf';
            filename += '.pdf';
            break;

        case 'docx':
            buffer = await generateSummaryDOCX(reportData, 'Payment Method Analytics', yearId);
            contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            filename += '.docx';
            break;

        default:
            throw new Error(`Unsupported format: ${format}`);
    }

    return { buffer, contentType, filename };
}

/**
 * Get Class Fee Summary Data (for API responses)
 * Returns structured data instead of file buffer
 */
export async function getClassFeeSummaryData(
    academicYearId?: number,
    classId?: number
): Promise<any[]> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) {
        throw new Error("No academic year found and none provided");
    }

    // Shared population/balance rule (M8): withdrawn excluded, unplaced students
    // counted under their registered class, overpayments never offset debts.
    const rows = await getFeeBalances(yearId, { classId });

    const groups = new Map<string, { className: string; rows: typeof rows }>();
    for (const r of rows) {
        const key = String(r.class_id ?? r.class_name);
        if (!groups.has(key)) groups.set(key, { className: r.class_name, rows: [] });
        groups.get(key)!.rows.push(r);
    }

    return Array.from(groups.values()).map(g => {
        const t = summarizeBalances(g.rows);
        const withPayments = g.rows.filter(r => r.amount_paid > 0).length;
        return {
            className: g.className,
            totalStudents: t.student_count,
            totalExpected: t.total_expected,
            totalPaid: t.total_collected,
            totalOutstanding: t.total_outstanding,
            totalOverpayments: t.total_overpayments,
            studentsOwing: t.students_owing,
            paymentPercentage: t.total_expected > 0
                ? parseFloat(((t.total_collected / t.total_expected) * 100).toFixed(2))
                : 0,
            studentsWithPayments: withPayments,
            studentsWithoutPayments: t.student_count - withPayments,
            reconciliation: t.reconciliation.formula,
        };
    });
}

/**
 * Get Student Detailed Fees Data (for API responses)
 * Returns structured data instead of file buffer
 */
export async function getStudentDetailedFeesData(
    academicYearId?: number,
    classId?: number,
    studentIdentifier?: string
): Promise<any[]> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) {
        throw new Error("No academic year found and none provided");
    }

    // Shared population rule (M8): withdrawn excluded; unplaced students via registered class.
    const where: any = { AND: [{ academic_year_id: yearId }, ACTIVE_FEE_ROW_WHERE] };

    if (classId) {
        where.AND.push({
            OR: [
                { enrollment: { sub_class: { class_id: classId } } },
                { enrollment: { sub_class_id: null, class_id: classId } },
            ]
        });
    }

    if (studentIdentifier) {
        where.AND.push({
            enrollment: {
                student: {
                    OR: [
                        { name: { contains: studentIdentifier, mode: 'insensitive' } },
                        { matricule: { contains: studentIdentifier, mode: 'insensitive' } }
                    ]
                }
            }
        });
    }

    const fees = await prisma.schoolFees.findMany({
        where,
        include: {
            enrollment: {
                include: {
                    student: true,
                    class: true,
                    sub_class: {
                        include: { class: true }
                    }
                }
            },
            payment_transactions: {
                orderBy: { payment_date: 'desc' }
            }
        },
        orderBy: [
            { enrollment: { sub_class: { class: { name: 'asc' } } } },
            { enrollment: { student: { name: 'asc' } } }
        ]
    });

    return fees.map(fee => ({
        studentName: fee.enrollment.student.name,
        studentMatricule: fee.enrollment.student.matricule,
        className: fee.enrollment.sub_class?.class?.name || fee.enrollment.class?.name || 'No Class',
        subClassName: fee.enrollment.sub_class?.name || 'No Subclass',
        expectedAmount: parseFloat((fee.amount_expected || 0).toFixed(2)),
        paidAmount: parseFloat((fee.amount_paid || 0).toFixed(2)),
        outstanding: parseFloat(Math.max((fee.amount_expected || 0) - (fee.amount_paid || 0), 0).toFixed(2)),
        overpayment: parseFloat(Math.max((fee.amount_paid || 0) - (fee.amount_expected || 0), 0).toFixed(2)),
        paymentPercentage: (fee.amount_expected || 0) > 0
            ? parseFloat((((fee.amount_paid || 0) / fee.amount_expected) * 100).toFixed(2))
            : 0,
        dueDate: fee.due_date.toISOString().split('T')[0],
        paymentsCount: fee.payment_transactions.length,
        lastPaymentDate: fee.payment_transactions[0]?.payment_date?.toISOString().split('T')[0] || 'No payments',
        lastPaymentAmount: fee.payment_transactions[0]?.amount || 0
    }));
}

/**
 * Get Payment Method Analytics Data (for API responses)
 * Returns structured data instead of file buffer
 */
export async function getPaymentMethodAnalyticsData(
    academicYearId?: number,
    classId?: number
): Promise<any[]> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) {
        throw new Error("No academic year found and none provided");
    }

    // Build where clause for payments
    const where: any = { academic_year_id: yearId };

    if (classId) {
        where.enrollment = {
            sub_class: { class_id: classId }
        };
    }

    const payments = await prisma.paymentTransaction.findMany({
        where,
        include: {
            enrollment: {
                include: {
                    sub_class: {
                        include: { class: true }
                    }
                }
            }
        }
    });

    // Group by payment method
    const methodGroups = payments.reduce((acc, payment) => {
        const method = payment.payment_method;

        if (!acc[method]) {
            acc[method] = {
                paymentMethod: method,
                totalTransactions: 0,
                totalAmount: 0,
                averageAmount: 0,
                uniqueStudents: new Set(),
                classBreakdown: {}
            };
        }

        acc[method].totalTransactions++;
        acc[method].totalAmount += payment.amount;
        acc[method].uniqueStudents.add(payment.enrollment_id);

        // Class breakdown
        const className = payment.enrollment?.sub_class?.class?.name || 'No Class';
        if (!acc[method].classBreakdown[className]) {
            acc[method].classBreakdown[className] = { count: 0, amount: 0 };
        }
        acc[method].classBreakdown[className].count++;
        acc[method].classBreakdown[className].amount += payment.amount;

        return acc;
    }, {} as Record<string, any>);

    // Format data
    const reportData = Object.values(methodGroups).map((group: any) => {
        const avgAmount = group.totalTransactions > 0
            ? group.totalAmount / group.totalTransactions
            : 0;

        return {
            paymentMethod: group.paymentMethod,
            totalTransactions: group.totalTransactions,
            totalAmount: parseFloat(group.totalAmount.toFixed(2)),
            averageAmount: parseFloat(avgAmount.toFixed(2)),
            uniqueStudents: group.uniqueStudents.size,
            marketShare: 0 // Will calculate after
        };
    });

    // Calculate market share
    const totalAmount = reportData.reduce((sum, item) => sum + item.totalAmount, 0);
    reportData.forEach(item => {
        item.marketShare = totalAmount > 0
            ? parseFloat(((item.totalAmount / totalAmount) * 100).toFixed(2))
            : 0;
    });

    return reportData;
}

// Helper function to sanitize text for PDF generation
function sanitizeTextForPDF(text: string): string {
    return text
        .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ') // Replace control characters with spaces
        .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' '); // Keep only printable characters and extended ASCII
}

/**
 * Generate Summary PDF for class/analytics reports
 */
async function generateSummaryPDF(data: any[], reportTitle: string, yearId: number): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageMargin = 20;
    const tableStartY = 680;
    const rowHeight = 25;
    const headerHeight = 30;
    const columnPadding = 4;

    // Dynamic column configuration based on data structure
    const sampleItem = data[0] || {};
    const keys = Object.keys(sampleItem);

    // Calculate available width and distribute columns accordingly
    const pageWidth = 595.28; // A4 width in points
    const availableWidth = pageWidth - (2 * pageMargin);
    const totalColumns = keys.length;

    // Define relative weights for different column types
    const getColumnWeight = (key: string) => {
        if (key.includes('Name') || key.includes('Method')) return 2.5;
        if (key.includes('Amount') || key.includes('Outstanding')) return 1.5;
        if (key.includes('Percentage') || key.includes('Date')) return 1.2;
        return 1;
    };

    // Calculate total weight and individual widths
    const totalWeight = keys.reduce((sum, key) => sum + getColumnWeight(key), 0);

    const columns = keys.map((key, index) => {
        const weight = getColumnWeight(key);
        const width = Math.floor((availableWidth * weight) / totalWeight);

        return {
            header: key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()),
            key: key,
            width: width,
            align: key.includes('Amount') || key.includes('Students') || key.includes('Transactions') || key.includes('Percentage') ? 'right' : 'left'
        };
    });

    let page = pdfDoc.addPage(PageSizes.A4);
    let y = tableStartY;

    const drawHeader = () => {
        // Main title
        page.drawText(sanitizeTextForPDF(`${reportTitle} - Academic Year ${yearId}`), {
            x: pageMargin,
            y: y + 60,
            font: boldFont,
            size: 14,
            color: rgb(0, 0.53, 0.71),
        });

        // Date
        page.drawText(sanitizeTextForPDF(`Generated: ${new Date().toLocaleDateString('en-GB')}`), {
            x: pageMargin,
            y: y + 40,
            font: font,
            size: 9,
            color: rgb(0.4, 0.4, 0.4),
        });

        y -= headerHeight;
        let x = pageMargin;

        // Draw table headers
        for (const col of columns) {
            page.drawRectangle({
                x,
                y,
                width: col.width,
                height: headerHeight,
                borderColor: rgb(0, 0, 0),
                borderWidth: 1,
            });

            // Truncate header text if needed
            let headerText = col.header;
            const maxHeaderWidth = col.width - (2 * columnPadding);
            while (boldFont.widthOfTextAtSize(headerText, 7) > maxHeaderWidth && headerText.length > 3) {
                headerText = headerText.substring(0, headerText.length - 1);
            }
            if (headerText.length < col.header.length && headerText.length > 2) {
                headerText = headerText.substring(0, headerText.length - 2) + '..';
            }

            page.drawText(sanitizeTextForPDF(headerText), {
                x: x + columnPadding,
                y: y + (headerHeight / 2) - 3,
                font: boldFont,
                size: 7,
                color: rgb(0, 0, 0),
            });
            x += col.width;
        }
        y -= rowHeight;
    };

    drawHeader();

    for (const item of data) {
        if (y < pageMargin + rowHeight) {
            page = pdfDoc.addPage(PageSizes.A4);
            y = tableStartY;
            drawHeader();
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
            if (col.key.includes('Amount') || col.key.includes('Outstanding')) {
                const amount = parseFloat(text) || 0;
                if (isNaN(amount)) {
                    text = '0';
                } else {
                    text = amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                }
            }

            // Truncate text if too long based on actual font width
            const maxWidth = col.width - (2 * columnPadding);
            let sanitizedText = sanitizeTextForPDF(text);

            while (font.widthOfTextAtSize(sanitizedText, 6.5) > maxWidth && sanitizedText.length > 3) {
                sanitizedText = sanitizedText.substring(0, sanitizedText.length - 1);
            }

            if (sanitizedText.length < text.length && sanitizedText.length > 2) {
                sanitizedText = sanitizedText.substring(0, sanitizedText.length - 2) + '..';
            }
            let textX = x + columnPadding;
            if (col.align === 'right') {
                const textWidth = font.widthOfTextAtSize(sanitizedText, 6.5);
                textX = x + col.width - textWidth - columnPadding;
            }

            page.drawText(sanitizedText, {
                x: textX,
                y: y + (rowHeight / 2) - 3,
                font,
                size: 6.5,
                color: rgb(0, 0, 0),
            });
            x += col.width;
        }
        y -= rowHeight;
    }

    return Buffer.from(await pdfDoc.save());
}

/**
 * Generate Summary DOCX for class/analytics reports
 */
async function generateSummaryDOCX(data: any[], reportTitle: string, yearId: number): Promise<Buffer> {
    // Get column structure from data
    const sampleItem = data[0] || {};
    const keys = Object.keys(sampleItem);

    const tableRows = data.map(item => new TableRow({
        children: keys.map(key => {
            let text = String(item[key] || '');
            if (key.includes('Amount') && !isNaN(parseFloat(text))) {
                const amount = parseFloat(text) || 0;
                text = amount.toLocaleString('en-US');
            }
            return new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text, size: 20 })] })],
            });
        }),
    }));

    const headerRow = new TableRow({
        children: keys.map(key => {
            const header = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
            return new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: header, bold: true, size: 20 })] })],
                borders: { top: { style: BorderStyle.SINGLE, size: 1 }, bottom: { style: BorderStyle.SINGLE, size: 1 } }
            });
        })
    });

    const doc = new Document({
        sections: [{
            children: [
                new Paragraph({
                    children: [
                        new TextRun({
                            text: `${reportTitle} - Academic Year ${yearId}`,
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
                    rows: [headerRow, ...tableRows],
                    width: { size: 100, type: WidthType.PERCENTAGE },
                }),
            ],
        }],
    });

    return Buffer.from(await Packer.toBuffer(doc));
}