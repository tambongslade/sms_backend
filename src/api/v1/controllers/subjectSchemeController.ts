// src/api/v1/controllers/subjectSchemeController.ts
import { Request, Response } from 'express';
import * as schemeService from '../services/subjectSchemeService';
import * as importService from '../services/subjectSchemeImportService';

function statusFromError(err: any): number {
    if (err?.code === 'BAD_REQUEST') return 400;
    if (err?.code === 'CONFLICT') return 409;
    if (err?.code === 'P2002') return 409; // Prisma unique violation
    if (err?.code === 'P2025') return 404; // Prisma record-not-found
    if (typeof err?.message === 'string' && /not found/i.test(err.message)) return 404;
    return 500;
}

function fail(res: Response, err: any) {
    const code = statusFromError(err);
    if (code === 500) console.error('SubjectScheme error:', err);
    // A raw Prisma unique-violation message is unreadable (and the frontend
    // replaces it with a generic one) -- say what actually clashed.
    const message = err?.code === 'P2002'
        ? 'This already exists (a scheme, module, chapter or lesson with the same subject/class/year or position).'
        : err.message ?? 'Server error';
    res.status(code).json({ success: false, error: message });
}

export const listSchemes = async (req: Request, res: Response) => {
    try {
        const q = (req as any).finalQuery ?? req.query;
        const data = await schemeService.listSchemes({
            subject_id: q.subject_id ? Number(q.subject_id) : undefined,
            class_id: q.class_id ? Number(q.class_id) : undefined,
            academic_year_id: q.academic_year_id ? Number(q.academic_year_id) : undefined,
        });
        res.json({ success: true, data });
    } catch (err: any) {
        fail(res, err);
    }
};

export const getSchemeById = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const scheme = await schemeService.getSchemeById(id);
        if (!scheme) return res.status(404).json({ success: false, error: 'Scheme not found' });
        res.json({ success: true, data: scheme });
    } catch (err: any) {
        fail(res, err);
    }
};

export const getSchemeByTriplet = async (req: Request, res: Response) => {
    try {
        const q = (req as any).finalQuery ?? req.query;
        const subject_id = Number(q.subject_id);
        const class_id = Number(q.class_id);
        if (!subject_id || !class_id) {
            return res.status(400).json({ success: false, error: 'subject_id and class_id are required' });
        }
        const academic_year_id = q.academic_year_id ? Number(q.academic_year_id) : undefined;
        const scheme = await schemeService.getSchemeByTriplet(subject_id, class_id, academic_year_id);
        if (!scheme) return res.status(404).json({ success: false, error: 'Scheme not found' });
        res.json({ success: true, data: scheme });
    } catch (err: any) {
        fail(res, err);
    }
};

export const createScheme = async (req: Request, res: Response) => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const missing = (['subject_id', 'class_id', 'periods_per_week', 'annual_teaching_hours'] as const)
            .filter((k) => req.body?.[k] === undefined || req.body?.[k] === null || req.body?.[k] === '');
        if (missing.length) {
            const labels: Record<string, string> = {
                subject_id: 'Subject', class_id: 'Class',
                periods_per_week: 'Periods per week', annual_teaching_hours: 'Annual teaching hours',
            };
            return res.status(400).json({ success: false, error: `Missing required field(s): ${missing.map((k) => labels[k]).join(', ')}` });
        }
        const scheme = await schemeService.createScheme(req.body, req.user.id);
        res.status(201).json({ success: true, data: scheme });
    } catch (err: any) {
        fail(res, err);
    }
};

export const updateScheme = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const scheme = await schemeService.updateScheme(id, req.body);
        res.json({ success: true, data: scheme });
    } catch (err: any) {
        fail(res, err);
    }
};

export const deleteScheme = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        await schemeService.deleteScheme(id);
        res.json({ success: true, message: 'Scheme deleted' });
    } catch (err: any) {
        fail(res, err);
    }
};

export const bulkCreateOrReplaceScheme = async (req: Request, res: Response) => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const scheme = await schemeService.bulkCreateOrReplaceScheme(req.body, req.user.id);
        res.status(201).json({ success: true, data: scheme });
    } catch (err: any) {
        fail(res, err);
    }
};

// Module CRUD
export const addModule = async (req: Request, res: Response) => {
    try {
        const subject_scheme_id = Number(req.params.id);
        const data = await schemeService.addModule(subject_scheme_id, req.body);
        res.status(201).json({ success: true, data });
    } catch (err: any) {
        fail(res, err);
    }
};

export const updateModule = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.moduleId);
        const data = await schemeService.updateModule(id, req.body);
        res.json({ success: true, data });
    } catch (err: any) {
        fail(res, err);
    }
};

export const deleteModule = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.moduleId);
        await schemeService.deleteModule(id);
        res.json({ success: true, message: 'Module deleted' });
    } catch (err: any) {
        fail(res, err);
    }
};

// Chapter CRUD
export const addChapter = async (req: Request, res: Response) => {
    try {
        const module_id = Number(req.params.moduleId);
        const data = await schemeService.addChapter(module_id, req.body);
        res.status(201).json({ success: true, data });
    } catch (err: any) {
        fail(res, err);
    }
};

export const updateChapter = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.chapterId);
        const data = await schemeService.updateChapter(id, req.body);
        res.json({ success: true, data });
    } catch (err: any) {
        fail(res, err);
    }
};

export const deleteChapter = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.chapterId);
        await schemeService.deleteChapter(id);
        res.json({ success: true, message: 'Chapter deleted' });
    } catch (err: any) {
        fail(res, err);
    }
};

// Lesson CRUD
export const addLesson = async (req: Request, res: Response) => {
    try {
        const chapter_id = Number(req.params.chapterId);
        const data = await schemeService.addLesson(chapter_id, req.body);
        res.status(201).json({ success: true, data });
    } catch (err: any) {
        fail(res, err);
    }
};

export const updateLesson = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.lessonId);
        const data = await schemeService.updateLesson(id, req.body);
        res.json({ success: true, data });
    } catch (err: any) {
        fail(res, err);
    }
};

export const deleteLesson = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.lessonId);
        await schemeService.deleteLesson(id);
        res.json({ success: true, message: 'Lesson deleted' });
    } catch (err: any) {
        fail(res, err);
    }
};

// Excel import / template
export const importExcel = async (req: Request, res: Response) => {
    try {
        if (!req.user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const file = (req as any).file;
        if (!file?.buffer) {
            return res.status(400).json({ success: false, error: 'No file uploaded (field name: "file").' });
        }
        const q = (req as any).finalQuery ?? req.query;
        const body = req.body ?? {};
        const academic_year_id =
            body.academic_year_id !== undefined
                ? Number(body.academic_year_id)
                : q.academic_year_id !== undefined
                  ? Number(q.academic_year_id)
                  : undefined;
        const replace =
            body.replace === true ||
            body.replace === 'true' ||
            q.replace === 'true' ||
            q.replace === true;

        const result = await importService.importFromBuffer(
            file.buffer,
            { academic_year_id, replace },
            req.user.id,
        );

        const status = result.errors.length === 0 ? 201 : 207; // 207 Multi-Status when partial
        res.status(status).json({ success: result.errors.length === 0, data: result });
    } catch (err: any) {
        fail(res, err);
    }
};

export const downloadTemplate = async (_req: Request, res: Response) => {
    try {
        const buf = importService.buildTemplateWorkbook();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="subject-scheme-template.xlsx"');
        res.send(buf);
    } catch (err: any) {
        fail(res, err);
    }
};

// Teacher-facing
export const getSchemeForTeacherPeriod = async (req: Request, res: Response) => {
    try {
        const teacher_period_id = Number(req.params.teacherPeriodId);
        const scheme = await schemeService.getSchemeForTeacherPeriod(teacher_period_id);
        if (!scheme) {
            return res
                .status(404)
                .json({ success: false, error: 'No scheme defined for this teacher period yet.' });
        }
        res.json({ success: true, data: scheme });
    } catch (err: any) {
        fail(res, err);
    }
};
