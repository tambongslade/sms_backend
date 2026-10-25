// src/api/v1/routes/smsRoutes.ts
// Text messages (SMS) to parents. Super Manager and Manager only.
import express, { Request, Response } from 'express';
import prisma from '../../../config/db';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { getAcademicYearId } from '../../../utils/academicYear';
import * as sms from '../services/smsService';

const router = express.Router();
router.use(authenticate, authorize(['SUPER_MANAGER', 'MANAGER']));

const userId = (req: Request): number => Number((req as any).user?.id);

// GET /sms/status -> is sending set up, and how many SMS are left in the Orange bundle
router.get('/status', async (_req: Request, res: Response) => {
    const configured = sms.isConfigured();
    const out: any = { success: true, data: { configured, balance: null, balanceError: null, maxBatch: sms.MAX_BATCH, maxChars: sms.MAX_MESSAGE_CHARS } };
    if (configured) {
        try { out.data.balance = await sms.getBalance(); }
        catch (e: any) { out.data.balanceError = String(e?.response?.status ? `Orange answered ${e.response.status}` : e?.message || e).slice(0, 200); }
    }
    res.json(out);
});

// POST /sms/recipients { classId?, subClassId? } -> the parents of the enrolled students (current year), one row per phone number
router.post('/recipients', async (req: Request, res: Response) => {
    try {
        const { class_id, sub_class_id } = req.body ?? {};
        const yearId = await getAcademicYearId();
        const enrollments = await prisma.enrollment.findMany({
            where: {
                ...(yearId ? { academic_year_id: yearId } : {}),
                ...(sub_class_id ? { sub_class_id: Number(sub_class_id) } : {}),
                ...(class_id && !sub_class_id ? { OR: [{ class_id: Number(class_id) }, { sub_class: { class_id: Number(class_id) } }] } : {}),
                student: { status: { notIn: ['WITHDRAWN'] } },
            },
            select: { student: { select: { id: true, name: true, parents: { select: { parent: { select: { id: true, name: true, phone: true } } } } } } },
        });
        const byPhone = new Map<string, { phone: string; name: string; user_id: number; students: string[] }>();
        const noPhone: { name: string; student: string }[] = [];
        for (const e of enrollments) {
            const st = e.student;
            if (!st.parents.length) noPhone.push({ name: '(no parent linked)', student: st.name });
            for (const p of st.parents) {
                const phone = sms.normalizePhone(p.parent.phone);
                if (!phone) { noPhone.push({ name: p.parent.name, student: st.name }); continue; }
                const cur = byPhone.get(phone) || { phone, name: p.parent.name, user_id: p.parent.id, students: [] };
                cur.students.push(st.name);
                byPhone.set(phone, cur);
            }
        }
        res.json({ success: true, data: { students: enrollments.length, recipients: [...byPhone.values()], withoutValidPhone: noPhone } });
    } catch (e: any) {
        console.error('SMS recipients error:', e);
        res.status(500).json({ success: false, error: 'Could not list the recipients.' });
    }
});

// POST /sms/send { recipients: [{ phone, name?, userId? }], message, purpose? }
router.post('/send', async (req: Request, res: Response) => {
    try {
        if (!sms.isConfigured()) {
            return res.status(503).json({ success: false, error: 'SMS sending is not set up on this server yet.' });
        }
        const { recipients, message, purpose } = req.body ?? {};
        const text = String(message ?? '').trim();
        if (!text) return res.status(400).json({ success: false, error: 'Write the message first.' });
        if ([...text].length > sms.MAX_MESSAGE_CHARS) {
            return res.status(400).json({ success: false, error: `The message is too long (maximum ${sms.MAX_MESSAGE_CHARS} characters).` });
        }
        if (!Array.isArray(recipients) || !recipients.length) {
            return res.status(400).json({ success: false, error: 'Choose at least one recipient.' });
        }
        if (recipients.length > sms.MAX_BATCH) {
            return res.status(400).json({ success: false, error: `At most ${sms.MAX_BATCH} recipients per send.` });
        }
        const r = await sms.queueBatch({ recipients, message: text, purpose, sentBy: userId(req) });
        res.status(202).json({ success: true, data: r });
    } catch (e: any) {
        console.error('SMS send error:', e);
        res.status(500).json({ success: false, error: 'The messages could not be queued.' });
    }
});

// GET /sms/history?limit= -> latest messages, newest first
router.get('/history', async (req: Request, res: Response) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 200, 1), 500);
    const rows = await prisma.smsMessage.findMany({
        orderBy: { id: 'desc' }, take: limit,
        select: { id: true, batch_id: true, phone: true, recipient_name: true, body: true, segments: true, status: true, error: true, purpose: true, sent_by: true, created_at: true, sent_at: true },
    });
    res.json({ success: true, data: rows });
});

// POST /sms/batches/:id/retry -> send the failed ones of a batch again
router.post('/batches/:id/retry', async (req: Request, res: Response) => {
    if (!sms.isConfigured()) return res.status(503).json({ success: false, error: 'SMS sending is not set up on this server yet.' });
    const n = await sms.retryFailed(String(req.params.id));
    res.json({ success: true, data: { retried: n } });
});

export default router;
