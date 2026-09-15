// src/api/v1/services/feeComparisonService.ts
import prisma from '../../../config/db';
import { getAcademicYearId } from '../../../utils/academicYear';
import { Parser } from 'json2csv';
import * as XLSX from 'xlsx';

export interface FeeDiscrepancy {
    studentId: number;
    studentName: string;
    studentMatricule: string;
    className?: string;
    subClassName?: string;
    discrepancyType: 'MISSING_PRIMARY' | 'MISSING_CONTROL' | 'PAYMENT_MISMATCH';
    primaryFee?: {
        id: number;
        amountExpected: number;
        amountPaid: number;
        dueDate: string;
    };
    controlFee?: {
        id: number;
        amountExpected: number;
        amountPaid: number;
        dueDate: string;
    };
    paidAmountDifference?: number;
    variancePercentage?: number;
}

export interface ComparisonSummary {
    academicYearId: number;
    totalStudents: number;
    studentsWithBothFees: number;
    studentsWithOnlyPrimaryFees: number;
    studentsWithOnlyControlFees: number;
    totalDiscrepancies: number;
    discrepancyTypes: {
        missingPrimary: number;
        missingControl: number;
        paymentMismatch: number;
    };
    averageVariancePercentage: number;
    totalPaidAmountDifference: number;
}

/**
 * Compare primary fees with control fees for discrepancies
 * @param academicYearId Optional academic year ID
 * @param subClassId Optional subclass filter
 * @param classId Optional class filter
 * @param studentId Optional student filter
 * @returns Array of fee discrepancies
 */
export async function getFeeDiscrepancies(
    academicYearId?: number,
    subClassId?: number,
    classId?: number,
    studentId?: number
): Promise<FeeDiscrepancy[]> {
    const yearId = await getAcademicYearId(academicYearId);

    if (!yearId) {
        throw new Error("Academic year ID is required to compare fees, but none was provided or found.");
    }

    // Build where clause for enrollments
    const where: any = {
        academic_year_id: yearId
    };

    if (studentId) {
        where.student_id = studentId;
    }

    if (subClassId) {
        where.sub_class_id = subClassId;
    }

    if (classId) {
        where.sub_class = {
            class_id: classId
        };
    }

    // Get all enrollments for the academic year with their fees
    const enrollments = await prisma.enrollment.findMany({
        where,
        include: {
            student: true,
            sub_class: {
                include: {
                    class: true
                }
            },
            school_fees: {
                where: {
                    academic_year_id: yearId
                }
            },
            control_school_fees: {
                where: {
                    academic_year_id: yearId
                }
            }
        }
    });

    const discrepancies: FeeDiscrepancy[] = [];

    for (const enrollment of enrollments) {
        const primaryFee = enrollment.school_fees[0]; // Assuming one fee record per enrollment per year
        const controlFee = enrollment.control_school_fees[0];

        const baseDiscrepancy = {
            studentId: enrollment.student_id,
            studentName: enrollment.student.name,
            studentMatricule: enrollment.student.matricule,
            className: enrollment.sub_class?.class?.name,
            subClassName: enrollment.sub_class?.name,
        };

        // Case 1: Missing primary fee
        if (!primaryFee && controlFee) {
            discrepancies.push({
                ...baseDiscrepancy,
                discrepancyType: 'MISSING_PRIMARY',
                controlFee: {
                    id: controlFee.id,
                    amountExpected: controlFee.amount_expected,
                    amountPaid: controlFee.amount_paid,
                    dueDate: controlFee.due_date.toISOString().split('T')[0]
                }
            });
        }

        // Case 2: Missing control fee
        else if (primaryFee && !controlFee) {
            discrepancies.push({
                ...baseDiscrepancy,
                discrepancyType: 'MISSING_CONTROL',
                primaryFee: {
                    id: primaryFee.id,
                    amountExpected: primaryFee.amount_expected,
                    amountPaid: primaryFee.amount_paid,
                    dueDate: primaryFee.due_date.toISOString().split('T')[0]
                }
            });
        }

        // Case 3: Both sides exist — only the paid totals matter. Controllers don't
        // enter expected amounts, so amount_expected mismatches are not meaningful here.
        else if (primaryFee && controlFee) {
            const paidDifference = primaryFee.amount_paid - controlFee.amount_paid;
            const hasPaymentMismatch = Math.abs(paidDifference) > 0.01;

            if (hasPaymentMismatch) {
                const variancePercentage = primaryFee.amount_paid > 0
                    ? Math.abs(paidDifference / primaryFee.amount_paid) * 100
                    : 0;

                discrepancies.push({
                    ...baseDiscrepancy,
                    discrepancyType: 'PAYMENT_MISMATCH',
                    primaryFee: {
                        id: primaryFee.id,
                        amountExpected: primaryFee.amount_expected,
                        amountPaid: primaryFee.amount_paid,
                        dueDate: primaryFee.due_date.toISOString().split('T')[0]
                    },
                    controlFee: {
                        id: controlFee.id,
                        amountExpected: controlFee.amount_expected,
                        amountPaid: controlFee.amount_paid,
                        dueDate: controlFee.due_date.toISOString().split('T')[0]
                    },
                    paidAmountDifference: paidDifference,
                    variancePercentage: parseFloat(variancePercentage.toFixed(2))
                });
            }
        }
    }

    return discrepancies;
}

/**
 * Get comprehensive comparison summary
 * @param academicYearId Optional academic year ID
 * @returns Comparison summary statistics
 */
export async function getComparisonSummary(academicYearId?: number): Promise<ComparisonSummary> {
    const yearId = await getAcademicYearId(academicYearId);

    if (!yearId) {
        throw new Error("Academic year ID is required to get comparison summary, but none was provided or found.");
    }

    // Get all enrollments for the academic year
    const enrollments = await prisma.enrollment.findMany({
        where: {
            academic_year_id: yearId
        },
        include: {
            school_fees: {
                where: {
                    academic_year_id: yearId
                }
            },
            control_school_fees: {
                where: {
                    academic_year_id: yearId
                }
            }
        }
    });

    const summary: ComparisonSummary = {
        academicYearId: yearId,
        totalStudents: enrollments.length,
        studentsWithBothFees: 0,
        studentsWithOnlyPrimaryFees: 0,
        studentsWithOnlyControlFees: 0,
        totalDiscrepancies: 0,
        discrepancyTypes: {
            missingPrimary: 0,
            missingControl: 0,
            paymentMismatch: 0
        },
        averageVariancePercentage: 0,
        totalPaidAmountDifference: 0
    };

    let totalVariance = 0;
    let varianceCount = 0;

    for (const enrollment of enrollments) {
        const primaryFee = enrollment.school_fees[0];
        const controlFee = enrollment.control_school_fees[0];
        const hasPrimaryFee = !!primaryFee;
        const hasControlFee = !!controlFee;

        const primaryPaid = primaryFee?.amount_paid ?? 0;
        const controlPaid = controlFee?.amount_paid ?? 0;
        const paidDifference = primaryPaid - controlPaid;
        const hasMoneyDisagreement = Math.abs(paidDifference) > 0.01;

        if (hasPrimaryFee && hasControlFee) {
            summary.studentsWithBothFees++;
        } else if (hasPrimaryFee && !hasControlFee) {
            summary.studentsWithOnlyPrimaryFees++;
        } else if (!hasPrimaryFee && hasControlFee) {
            summary.studentsWithOnlyControlFees++;
        }

        // A "discrepancy" only counts when the two sides actually disagree about
        // money. If neither side has recorded a payment (both zero), the student
        // just hasn't paid yet — that's not a discrepancy the manager needs to
        // chase, even if the controller hasn't opened a control-fee row.
        if (!hasMoneyDisagreement) continue;

        summary.totalDiscrepancies++;
        summary.totalPaidAmountDifference += Math.abs(paidDifference);

        if (hasPrimaryFee && hasControlFee) {
            summary.discrepancyTypes.paymentMismatch++;
        } else if (hasPrimaryFee) {
            summary.discrepancyTypes.missingControl++;
        } else {
            summary.discrepancyTypes.missingPrimary++;
        }

        if (primaryPaid > 0) {
            const variance = Math.abs(paidDifference / primaryPaid) * 100;
            totalVariance += variance;
            varianceCount++;
        }
    }

    // Calculate average variance percentage
    summary.averageVariancePercentage = varianceCount > 0
        ? parseFloat((totalVariance / varianceCount).toFixed(2))
        : 0;

    return summary;
}

/**
 * Get fee comparison for a specific student
 * @param studentId The ID of the student
 * @param academicYearId Optional academic year ID
 * @returns Student-specific fee comparison
 */
export async function getStudentFeeComparison(studentId: number, academicYearId?: number) {
    const yearId = await getAcademicYearId(academicYearId);

    if (!yearId) {
        throw new Error("Academic year ID is required to compare student fees, but none was provided or found.");
    }

    const enrollment = await prisma.enrollment.findFirst({
        where: {
            student_id: studentId,
            academic_year_id: yearId
        },
        include: {
            student: true,
            sub_class: {
                include: {
                    class: true
                }
            },
            school_fees: {
                where: {
                    academic_year_id: yearId
                },
                include: {
                    payment_transactions: {
                        include: {
                            recorded_by: { select: { id: true, name: true, matricule: true } }
                        },
                        orderBy: { payment_date: 'asc' }
                    }
                }
            },
            control_school_fees: {
                where: {
                    academic_year_id: yearId
                },
                include: {
                    control_payment_transactions: {
                        include: {
                            recorded_by: { select: { id: true, name: true, matricule: true } }
                        },
                        orderBy: { payment_date: 'asc' }
                    }
                }
            }
        }
    });

    if (!enrollment) {
        throw new Error(`Student with ID ${studentId} is not enrolled in academic year ${yearId}`);
    }

    const primaryFee = enrollment.school_fees[0];
    const controlFee = enrollment.control_school_fees[0];

    return {
        student: {
            id: enrollment.student.id,
            name: enrollment.student.name,
            matricule: enrollment.student.matricule
        },
        class: {
            name: enrollment.sub_class?.class?.name,
            subClassName: enrollment.sub_class?.name
        },
        academicYearId: yearId,
        primaryFee: primaryFee ? {
            id: primaryFee.id,
            amountExpected: primaryFee.amount_expected,
            amountPaid: primaryFee.amount_paid,
            dueDate: primaryFee.due_date,
            paymentsCount: primaryFee.payment_transactions.length,
            payments: primaryFee.payment_transactions
        } : null,
        controlFee: controlFee ? {
            id: controlFee.id,
            amountExpected: controlFee.amount_expected,
            amountPaid: controlFee.amount_paid,
            dueDate: controlFee.due_date,
            paymentsCount: controlFee.control_payment_transactions.length,
            payments: controlFee.control_payment_transactions
        } : null,
        hasDiscrepancy: primaryFee && controlFee ?
            (Math.abs(primaryFee.amount_expected - controlFee.amount_expected) > 0.01 ||
             Math.abs(primaryFee.amount_paid - controlFee.amount_paid) > 0.01) :
            (!primaryFee || !controlFee),
        discrepancyDetails: primaryFee && controlFee ? {
            expectedAmountDifference: primaryFee.amount_expected - controlFee.amount_expected,
            paidAmountDifference: primaryFee.amount_paid - controlFee.amount_paid,
            variancePercentage: primaryFee.amount_expected > 0
                ? Math.abs((primaryFee.amount_expected - controlFee.amount_expected) / primaryFee.amount_expected) * 100
                : 0
        } : null
    };
}

// Full roster view for the admin audit screen — every student enrolled in the
// academic year with their primary + control totals side-by-side, regardless of
// whether either side recorded anything. Paginated.
export interface EnrolledStudentFeeRow {
    studentId: number;
    studentName: string;
    studentMatricule: string;
    className: string | null;
    subClassName: string | null;
    enrollmentId: number;
    studentStatus: 'NEW' | 'OLD' | 'REPEATER'; // NEW = first year in school, REPEATER = repeating same class
    primary: {
        amountExpected: number;
        amountPaid: number;
        paymentsCount: number;
    };
    control: {
        amountPaid: number;
        paymentsCount: number;
    };
    paidAmountDifference: number; // primary.amountPaid - control.amountPaid
    status: 'MATCHED' | 'PAYMENT_MISMATCH' | 'MISSING_PRIMARY' | 'MISSING_CONTROL' | 'NO_RECORDS';
}

export async function getEnrolledStudentsFeeStatus(
    academicYearId: number | undefined,
    options: {
        page?: number;
        limit?: number;
        classId?: number;
        subClassId?: number;
        search?: string; // name or matricule
        status?: 'MATCHED' | 'PAYMENT_MISMATCH' | 'MISSING_PRIMARY' | 'MISSING_CONTROL' | 'NO_RECORDS';
        studentStatus?: 'NEW' | 'OLD' | 'REPEATER';
    } = {}
): Promise<{ data: EnrolledStudentFeeRow[]; meta: { total: number; totalPages: number; page: number; limit: number; academicYearId: number } }> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) {
        throw new Error('Academic year ID is required to list enrolled students.');
    }

    const page = options.page && options.page > 0 ? options.page : 1;
    const limit = options.limit && options.limit > 0 ? options.limit : 25;

    const where: any = { academic_year_id: yearId };
    if (options.subClassId) where.sub_class_id = options.subClassId;
    if (options.classId) where.sub_class = { class_id: options.classId };
    if (options.search) {
        where.student = {
            OR: [
                { name: { contains: options.search, mode: 'insensitive' } },
                { matricule: { contains: options.search, mode: 'insensitive' } }
            ]
        };
    }

    // studentStatus = NEW can be pushed to the DB via first_enrollment_year_id.
    // OLD / REPEATER and the derived payment status need post-fetch filtering.
    if (options.studentStatus === 'NEW') {
        where.student = { ...(where.student || {}), first_enrollment_year_id: yearId };
    }

    // Without derived filters we can paginate at the DB. Otherwise materialise first.
    const needsPostFilter =
        !!options.status ||
        options.studentStatus === 'OLD' ||
        options.studentStatus === 'REPEATER';

    const baseQuery = {
        where,
        include: {
            // Pull all enrollments (just the year id) so we can derive NEW/OLD even
            // when student.first_enrollment_year_id wasn't set at enrollment time.
            student: {
                include: {
                    enrollments: { select: { academic_year_id: true } }
                }
            },
            sub_class: { include: { class: true } },
            school_fees: {
                where: { academic_year_id: yearId },
                include: { payment_transactions: true }
            },
            control_school_fees: {
                where: { academic_year_id: yearId },
                include: { control_payment_transactions: true }
            }
        },
        orderBy: [
            { sub_class: { class: { name: 'asc' as const } } },
            { sub_class: { name: 'asc' as const } },
            { student: { name: 'asc' as const } }
        ]
    };

    const enrollments = needsPostFilter
        ? await prisma.enrollment.findMany(baseQuery)
        : await prisma.enrollment.findMany({ ...baseQuery, skip: (page - 1) * limit, take: limit });

    const totalUnfiltered = needsPostFilter ? 0 : await prisma.enrollment.count({ where });

    const rows: EnrolledStudentFeeRow[] = enrollments.map(e => {
        const primary = e.school_fees[0];
        const control = e.control_school_fees[0];

        const primaryBlock = {
            amountExpected: primary?.amount_expected ?? 0,
            amountPaid: primary?.amount_paid ?? 0,
            paymentsCount: primary?.payment_transactions.length ?? 0,
        };
        const controlBlock = {
            amountPaid: control?.amount_paid ?? 0,
            paymentsCount: control?.control_payment_transactions.length ?? 0,
        };
        const paidAmountDifference = primaryBlock.amountPaid - controlBlock.amountPaid;

        // Status reflects whether the two ledgers actually disagree about money.
        // Both sides at zero is MATCHED (nothing to reconcile), even if the
        // controller hasn't opened a control-fee row yet.
        let status: EnrolledStudentFeeRow['status'];
        if (!primary && !control) {
            status = 'NO_RECORDS';
        } else if (Math.abs(paidAmountDifference) > 0.01) {
            if (!primary) status = 'MISSING_PRIMARY';
            else if (!control) status = 'MISSING_CONTROL';
            else status = 'PAYMENT_MISMATCH';
        } else {
            status = 'MATCHED';
        }

        let studentStatus: EnrolledStudentFeeRow['studentStatus'];
        if (e.repeater) {
            studentStatus = 'REPEATER';
        } else if (e.student.first_enrollment_year_id != null) {
            // Authoritative field when it's populated
            studentStatus = e.student.first_enrollment_year_id === yearId ? 'NEW' : 'OLD';
        } else {
            // Fallback: NEW iff the student has no enrollments in prior years
            const hasPriorEnrollment = (e.student as any).enrollments
                .some((en: { academic_year_id: number }) => en.academic_year_id < yearId);
            studentStatus = hasPriorEnrollment ? 'OLD' : 'NEW';
        }

        return {
            studentId: e.student_id,
            studentName: e.student.name,
            studentMatricule: e.student.matricule,
            className: e.sub_class?.class?.name ?? null,
            subClassName: e.sub_class?.name ?? null,
            enrollmentId: e.id,
            studentStatus,
            primary: primaryBlock,
            control: controlBlock,
            paidAmountDifference,
            status,
        };
    });

    if (needsPostFilter) {
        const filtered = rows.filter(r =>
            (!options.status || r.status === options.status) &&
            (!options.studentStatus || r.studentStatus === options.studentStatus)
        );
        const total = filtered.length;
        const start = (page - 1) * limit;
        return {
            data: filtered.slice(start, start + limit),
            meta: { total, totalPages: Math.ceil(total / limit), page, limit, academicYearId: yearId }
        };
    }

    return {
        data: rows,
        meta: { total: totalUnfiltered, totalPages: Math.ceil(totalUnfiltered / limit), page, limit, academicYearId: yearId }
    };
}

/**
 * Export fee discrepancy reports
 * @param academicYearId Optional academic year ID
 * @param format Export format
 * @returns Export buffer and metadata
 */
export async function exportDiscrepancyReports(
    academicYearId?: number,
    format: 'csv' | 'xlsx' = 'csv'
): Promise<{ buffer: Buffer, contentType: string, filename: string }> {
    const yearId = await getAcademicYearId(academicYearId);

    if (!yearId) {
        throw new Error("No academic year found and none provided");
    }

    const discrepancies = await getFeeDiscrepancies(yearId);

    // Map discrepancies to a flatter structure suitable for reports
    const reportData = discrepancies.map(discrepancy => ({
        studentName: discrepancy.studentName,
        studentMatricule: discrepancy.studentMatricule,
        className: discrepancy.className || 'N/A',
        subClassName: discrepancy.subClassName || 'N/A',
        discrepancyType: discrepancy.discrepancyType,
        primaryPaid: discrepancy.primaryFee?.amountPaid || 0,
        controlPaid: discrepancy.controlFee?.amountPaid || 0,
        paidDifference: discrepancy.paidAmountDifference || 0,
        variancePercentage: discrepancy.variancePercentage || 0
    }));

    let buffer: Buffer;
    let contentType: string;
    let filename: string = `fee_discrepancy_report_${yearId}`;

    if (format === 'csv') {
        const fields = [
            { label: 'Student Name', value: 'studentName' },
            { label: 'Matricule', value: 'studentMatricule' },
            { label: 'Class', value: 'className' },
            { label: 'Subclass', value: 'subClassName' },
            { label: 'Discrepancy Type', value: 'discrepancyType' },
            { label: 'Primary Paid (FCFA)', value: 'primaryPaid' },
            { label: 'Control Paid (FCFA)', value: 'controlPaid' },
            { label: 'Paid Difference (FCFA)', value: 'paidDifference' },
            { label: 'Variance %', value: 'variancePercentage' }
        ];
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(reportData);
        buffer = Buffer.from(csv);
        contentType = 'text/csv';
        filename += '.csv';
    } else {
        // Excel format
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(reportData, {
            header: ['studentName', 'studentMatricule', 'className', 'subClassName', 'discrepancyType',
                    'primaryPaid', 'controlPaid', 'paidDifference', 'variancePercentage']
        });

        // Set column headers
        const headers = [
            'Student Name', 'Matricule', 'Class', 'Subclass', 'Discrepancy Type',
            'Primary Paid (FCFA)', 'Control Paid (FCFA)', 'Paid Difference (FCFA)', 'Variance %'
        ];

        headers.forEach((header, index) => {
            const cellAddress = XLSX.utils.encode_cell({ c: index, r: 0 });
            if (!worksheet[cellAddress]) worksheet[cellAddress] = {};
            worksheet[cellAddress].v = header;
        });

        worksheet['!cols'] = Array(headers.length).fill({ wch: 15 });
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Fee Discrepancies');
        buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        filename += '.xlsx';
    }

    return { buffer, contentType, filename };
}