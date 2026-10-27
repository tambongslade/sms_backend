// src/api/v1/controllers/resultsController.ts
//
// Class results (sequence / term / annual), CSV export, term & annual report
// card PDFs and the per-class promotion preview. All numbers come from
// resultsService so screens, exports and PDFs agree.

import { Request, Response } from 'express';
import prisma from '../../../config/db';
import * as feeService from '../services/feeService';
import { RoleTier, userHasMinTier } from '../../../utils/roleHierarchy';
import {
    ResultsError, getResults, getAnnualResults, resultsToCsv,
    suggestDecision, ordinal, appreciation,
} from '../services/resultsService';
import * as reportCardService from '../services/reportCardService';
import * as classMarksheet from '../services/classMarksheetService';

const q = (req: Request): any => (req as any).finalQuery ?? {};
const int = (v: any): number | undefined => {
    const n = parseInt(v as string);
    return Number.isNaN(n) ? undefined : n;
};

function fail(res: Response, error: any, context: string) {
    if (error instanceof ResultsError) {
        return res.status(error.status).json({ success: false, error: error.message });
    }
    console.error(`Error ${context}:`, error);
    return res.status(500).json({ success: false, error: error.message || `Failed ${context}` });
}

function readScope(req: Request) {
    const query = q(req);
    const sub_class_id = int(query.sub_class_id);
    if (!sub_class_id) throw new ResultsError(400, 'subClassId is required');
    return {
        sub_class_id,
        exam_sequence_id: int(query.exam_sequence_id),
        term_id: int(query.term_id),
        academic_year_id: int(query.academic_year_id),
        scope: query.scope as string | undefined,
    };
}

/**
 * GET /results/class?subClassId=&examSequenceId= | termId= | academicYearId=(&scope=annual)
 */
export const getClassResults = async (req: Request, res: Response): Promise<any> => {
    try {
        const data = await getResults(readScope(req));
        res.json({ success: true, data });
    } catch (error: any) {
        return fail(res, error, 'loading class results');
    }
};

/**
 * GET /results/class/marksheet?...same params as /class...  -> the class mark sheet as data
 */
export const getClassMarksheet = async (req: Request, res: Response): Promise<any> => {
    try {
        res.json({ success: true, data: await classMarksheet.getClassMarksheet(readScope(req)) });
    } catch (error: any) {
        return fail(res, error, 'building the class mark sheet');
    }
};

/**
 * GET /results/class/marksheet/pdf?...same params...  -> the class mark sheet as a landscape PDF
 */
export const downloadClassMarksheetPdf = async (req: Request, res: Response): Promise<any> => {
    try {
        const sheet = await classMarksheet.getClassMarksheet(readScope(req));
        if (!sheet.students.length) return res.status(404).json({ success: false, error: 'No students are enrolled in this class.' });
        const { buffer, filename } = await classMarksheet.renderClassMarksheetPdf(sheet);
        sendPdf(res, buffer, filename);
    } catch (error: any) {
        return fail(res, error, 'generating the class mark sheet PDF');
    }
};

/**
 * GET /results/class/export?...same params...  -> CSV (opens in Excel)
 */
export const exportClassResults = async (req: Request, res: Response): Promise<any> => {
    try {
        const r = await getResults(readScope(req));
        const filename = `results_${r.sub_class.name}_${r.scope.label}_${r.scope.academic_year_name}`.replace(/[^\w-]+/g, '_') + '.csv';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(resultsToCsv(r));
    } catch (error: any) {
        return fail(res, error, 'exporting class results');
    }
};

/** Same fee rule as sequence report cards (Principal+ may bypass with bypassFeeCheck=true). */
async function feeGate(req: Request, studentId: number, academicYearId: number) {
    const status = await feeService.checkStudentSchoolFeesPaid(studentId, academicYearId);
    if (status.paid_in_full) return null;
    const user = (req as any).user;
    const canBypass = user?.role ? userHasMinTier(user.role, RoleTier.HEAD_OF_SCHOOL) : false;
    const bypass = String(q(req).bypass_fee_check ?? q(req).bypassFeeCheck) === 'true';
    if (bypass && canBypass) return null;
    return {
        success: false,
        error: 'Report card cannot be generated: school fees not fully paid',
        feeStatus: {
            paidInFull: status.paid_in_full,
            amountExpected: status.amount_expected,
            amountPaid: status.amount_paid,
            shortfall: status.shortfall,
        },
        bypassAvailable: canBypass,
    };
}

function sendPdf(res: Response, buffer: Buffer, filename: string) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
}

/** GET /report-cards/term/subclass/:subClassId?termId= */
export const termSubclassCards = async (req: Request, res: Response): Promise<any> => {
    try {
        const subClassId = int(req.params.subClassId);
        const termId = int(q(req).term_id);
        if (!subClassId || !termId) return res.status(400).json({ success: false, error: 'subClassId and termId are required' });
        const { buffer, filename } = await reportCardService.generateCards(subClassId, { kind: 'TERM', term_id: termId });
        sendPdf(res, buffer, filename);
    } catch (error: any) {
        return fail(res, error, 'generating term report cards');
    }
};

/** GET /report-cards/term/student/:studentId?termId= */
export const termStudentCard = async (req: Request, res: Response): Promise<any> => {
    try {
        const studentId = int(req.params.studentId);
        const termId = int(q(req).term_id);
        if (!studentId || !termId) return res.status(400).json({ success: false, error: 'studentId and termId are required' });
        const term = await prisma.term.findUnique({ where: { id: termId }, select: { academic_year_id: true } });
        if (!term?.academic_year_id) return res.status(404).json({ success: false, error: `Term ${termId} not found` });
        const gate = await feeGate(req, studentId, term.academic_year_id);
        if (gate) return res.status(403).json(gate);
        const subClassId = await reportCardService.studentSubClass(studentId, term.academic_year_id);
        const { buffer, filename } = await reportCardService.generateCards(subClassId, { kind: 'TERM', term_id: termId }, studentId);
        sendPdf(res, buffer, filename);
    } catch (error: any) {
        return fail(res, error, 'generating term report card');
    }
};

/** GET /report-cards/annual/subclass/:subClassId?academicYearId= */
export const annualSubclassCards = async (req: Request, res: Response): Promise<any> => {
    try {
        const subClassId = int(req.params.subClassId);
        const academicYearId = int(q(req).academic_year_id);
        if (!subClassId || !academicYearId) return res.status(400).json({ success: false, error: 'subClassId and academicYearId are required' });
        const { buffer, filename } = await reportCardService.generateCards(subClassId, { kind: 'ANNUAL', academic_year_id: academicYearId });
        sendPdf(res, buffer, filename);
    } catch (error: any) {
        return fail(res, error, 'generating annual report cards');
    }
};

/** GET /report-cards/annual/student/:studentId?academicYearId= */
export const annualStudentCard = async (req: Request, res: Response): Promise<any> => {
    try {
        const studentId = int(req.params.studentId);
        const academicYearId = int(q(req).academic_year_id);
        if (!studentId || !academicYearId) return res.status(400).json({ success: false, error: 'studentId and academicYearId are required' });
        const gate = await feeGate(req, studentId, academicYearId);
        if (gate) return res.status(403).json(gate);
        const subClassId = await reportCardService.studentSubClass(studentId, academicYearId);
        const { buffer, filename } = await reportCardService.generateCards(subClassId, { kind: 'ANNUAL', academic_year_id: academicYearId }, studentId);
        sendPdf(res, buffer, filename);
    } catch (error: any) {
        return fail(res, error, 'generating annual report card');
    }
};

/**
 * GET /results/promotion-preview?subClassId=&academicYearId=&toAcademicYearId=
 * Annual average + suggested decision for every student of one subclass.
 */
export const promotionPreview = async (req: Request, res: Response): Promise<any> => {
    try {
        const query = q(req);
        const subClassId = int(query.sub_class_id);
        const academicYearId = int(query.academic_year_id);
        const toAcademicYearId = int(query.to_academic_year_id);
        if (!subClassId || !academicYearId) {
            return res.status(400).json({ success: false, error: 'subClassId and academicYearId are required' });
        }
        if (toAcademicYearId === academicYearId) {
            return res.status(400).json({ success: false, error: 'toAcademicYearId must be a different academic year' });
        }

        const r = await getAnnualResults(subClassId, academicYearId);
        const nextClass = r.sub_class.next_class_id
            ? await prisma.class.findUnique({ where: { id: r.sub_class.next_class_id }, select: { id: true, name: true } })
            : null;
        const already = toAcademicYearId
            ? await prisma.enrollment.findMany({
                where: { academic_year_id: toAcademicYearId, student_id: { in: r.students.map(s => s.student_id) } },
                select: { student_id: true, class_id: true, repeater: true },
            })
            : [];
        const alreadyMap = new Map(already.map(e => [e.student_id, e]));

        const students = r.students.map(s => {
            const decision = suggestDecision(s.average, r.sub_class.pass_mark, !!r.sub_class.next_class_id, r.sub_class.class_name);
            const target = decision === 'PROMOTE' ? nextClass : decision === 'REPEAT' ? { id: r.sub_class.class_id, name: r.sub_class.class_name } : null;
            const existing = alreadyMap.get(s.student_id);
            return {
                student_id: s.student_id,
                enrollment_id: s.enrollment_id,
                name: s.name,
                matricule: s.matricule,
                annual_average: s.average,
                rank: s.rank,
                rank_label: s.rank === null ? 'NC' : ordinal(s.rank),
                appreciation: appreciation(s.average),
                term_averages: s.term_averages ?? [],
                suggested_decision: decision,
                suggested_target_class_id: target?.id ?? null,
                suggested_target_class_name: target?.name ?? null,
                already_enrolled_next_year: !!existing,
                next_year_class_id: existing?.class_id ?? null,
            };
        });

        res.json({
            success: true,
            data: {
                sub_class: r.sub_class,
                next_class: nextClass,
                academic_year_id: academicYearId,
                to_academic_year_id: toAcademicYearId ?? null,
                pass_mark: r.sub_class.pass_mark,
                class_stats: r.class_stats,
                students,
            },
        });
    } catch (error: any) {
        return fail(res, error, 'building promotion preview');
    }
};
