// src/api/v1/services/smsService.ts
//
// Text messages (SMS) through the Orange SMS API (Cameroon, all operators).
// Settings come from the server's .env, never from the database or the browser:
//   ORANGE_SMS_AUTH           the "Authorization" value from the Orange developer portal ("Basic xxxx"),
//                             or ORANGE_SMS_CLIENT_ID + ORANGE_SMS_CLIENT_SECRET
//   ORANGE_SMS_SENDER_NUMBER  country sender number, default 2370000
//   ORANGE_SMS_SENDER_NAME    approved sender name (max 11 characters), optional
//   ORANGE_SMS_COUNTRY        country filter for the balance check, default CMR
// Without credentials nothing is sent and the status endpoint says so.

import axios from 'axios';
import crypto from 'crypto';
import prisma from '../../../config/db';

const BASE = process.env.ORANGE_SMS_BASE || 'https://api.orange.com';   // ORANGE_SMS_BASE only for tests
const GAP_MS = 250;                  // Orange allows 5 messages per second
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
export const MAX_BATCH = 1000;
export const MAX_MESSAGE_CHARS = 640; // four SMS at most

const authHeader = (): string | null => {
    const direct = (process.env.ORANGE_SMS_AUTH || '').trim();
    if (direct) return /^basic /i.test(direct) ? direct : `Basic ${direct}`;
    const id = process.env.ORANGE_SMS_CLIENT_ID, secret = process.env.ORANGE_SMS_CLIENT_SECRET;
    if (id && secret) return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
    return null;
};
const senderNumber = () => (process.env.ORANGE_SMS_SENDER_NUMBER || '2370000').replace(/\D/g, '');
const senderName = () => (process.env.ORANGE_SMS_SENDER_NAME || '').trim().slice(0, 11);

export const isConfigured = (): boolean => !!authHeader();

/** "6 71 23 45 67", "+237671234567", "00237671234567" -> "237671234567"; null when it is not a Cameroon mobile number. */
export function normalizePhone(raw: unknown): string | null {
    let d = String(raw ?? '').replace(/[^\d+]/g, '');
    if (d.startsWith('+')) d = d.slice(1);
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 9 && d.startsWith('6')) d = '237' + d;
    return /^2376\d{8}$/.test(d) ? d : null;
}

// GSM-7 basic set: a message made only of these fits 160 characters per SMS; anything else (accents like é à ç)
// switches the whole message to 70 characters per SMS.
const GSM7 = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€';
export function smsSegments(text: string): { segments: number; length: number; unicode: boolean } {
    let len = 0, unicode = false;
    for (const ch of text) {
        if (GSM7.includes(ch)) len += 1;
        else if (GSM7_EXT.includes(ch)) len += 2;
        else { unicode = true; break; }
    }
    if (unicode) {
        const n = [...text].length;
        return { segments: n <= 70 ? 1 : Math.ceil(n / 67), length: n, unicode: true };
    }
    return { segments: len <= 160 ? 1 : Math.ceil(len / 153), length: len, unicode: false };
}

let token: { value: string; exp: number } | null = null;
async function getToken(force = false): Promise<string> {
    if (!force && token && token.exp > Date.now() + 60_000) return token.value;
    const auth = authHeader();
    if (!auth) throw new Error('SMS sending is not set up on this server.');
    const r = await axios.post(`${BASE}/oauth/v3/token`, 'grant_type=client_credentials', {
        headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        timeout: 15_000,
    });
    token = { value: String(r.data.access_token), exp: Date.now() + Number(r.data.expires_in || 3600) * 1000 };
    return token.value;
}

const describe = (e: any): string => {
    const d = e?.response?.data;
    const msg = d?.requestError?.serviceException?.text || d?.requestError?.policyException?.text || d?.message || d?.description || e?.message || 'unknown error';
    const status = e?.response?.status;
    return (status ? `${status}: ` : '') + String(msg).slice(0, 300);
};

/** Sends one message. Returns Orange's request id. */
export async function sendOne(phone: string, text: string): Promise<string> {
    const sender = senderNumber();
    const url = `${BASE}/smsmessaging/v1/outbound/${encodeURIComponent('tel:+' + sender)}/requests`;
    const body: any = {
        outboundSMSMessageRequest: {
            address: `tel:+${phone}`,
            senderAddress: `tel:+${sender}`,
            outboundSMSTextMessage: { message: text },
        },
    };
    if (senderName()) body.outboundSMSMessageRequest.senderName = senderName();
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const r = await axios.post(url, body, {
                headers: { Authorization: `Bearer ${await getToken(attempt > 0)}`, 'Content-Type': 'application/json' },
                timeout: 20_000,
            });
            const loc = String(r.headers?.location || '');
            return loc.slice(loc.lastIndexOf('/') + 1) || '';
        } catch (e: any) {
            if (e?.response?.status === 401 && attempt === 0) continue;   // expired token: fetch a new one once
            throw new Error(describe(e));
        }
    }
    throw new Error('SMS could not be sent.');
}

/** Remaining bundle on the Orange account. */
export async function getBalance(): Promise<{ units: number; expiresAt: string | null }> {
    const country = process.env.ORANGE_SMS_COUNTRY || 'CMR';
    const r = await axios.get(`${BASE}/sms/admin/v1/contracts`, {
        params: { country },
        headers: { Authorization: `Bearer ${await getToken()}` },
        timeout: 15_000,
    });
    const list: any[] = r.data?.partnerContracts?.contracts || r.data?.contracts || (Array.isArray(r.data) ? r.data : []);
    const active = list.filter((c) => String(c.status || 'ACTIVE').toUpperCase() === 'ACTIVE');
    const units = active.reduce((n, c) => n + Number(c.availableUnits || 0), 0);
    const exp = active.map((c) => c.expirationDate).filter(Boolean).sort()[0] || null;
    return { units, expiresAt: exp };
}

export interface Recipient { phone: string; name?: string; user_id?: number; student_id?: number }

/**
 * Queues one row per distinct, valid phone number and starts sending in the background.
 * A number that already received the same text in the last 10 minutes is skipped (double-click protection).
 */
export async function queueBatch(opts: { recipients: Recipient[]; message: string; purpose?: string; sentBy: number }) {
    const message = opts.message.trim();
    const { segments } = smsSegments(message);
    const seen = new Set<string>();
    const valid: (Recipient & { phone: string })[] = [];
    const invalid: { name?: string; phone: string }[] = [];
    for (const r of opts.recipients) {
        const phone = normalizePhone(r.phone);
        if (!phone) { invalid.push({ name: r.name, phone: String(r.phone ?? '') }); continue; }
        if (seen.has(phone)) continue;
        seen.add(phone);
        valid.push({ ...r, phone });
    }
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
    const recent = await prisma.smsMessage.findMany({
        where: { body: message, created_at: { gte: since }, status: { not: 'FAILED' }, phone: { in: valid.map((v) => v.phone) } },
        select: { phone: true },
    });
    const dup = new Set(recent.map((x) => x.phone));
    const toSend = valid.filter((v) => !dup.has(v.phone));
    const batchId = crypto.randomBytes(6).toString('hex');
    if (toSend.length) {
        await prisma.smsMessage.createMany({
            data: toSend.map((v) => ({
                batch_id: batchId, phone: v.phone, recipient_name: v.name?.slice(0, 120) || null,
                user_id: v.user_id ?? null, student_id: v.student_id ?? null, body: message, segments,
                purpose: opts.purpose?.slice(0, 40) || null, sent_by: opts.sentBy,
            })),
        });
        setImmediate(() => { runBatch(batchId).catch((e) => console.error('[SMS] batch failed:', e)); });
    }
    return { batchId: toSend.length ? batchId : null, queued: toSend.length, segments, invalid, duplicates: dup.size };
}

const running = new Set<string>();
async function runBatch(batchId: string): Promise<void> {
    if (running.has(batchId)) return;
    running.add(batchId);
    try {
        const rows = await prisma.smsMessage.findMany({ where: { batch_id: batchId, status: 'QUEUED' }, orderBy: { id: 'asc' } });
        let balanceLeft: number | null = null;
        try { balanceLeft = (await getBalance()).units; } catch { /* sending still tried; Orange refuses when empty */ }
        for (const row of rows) {
            if (balanceLeft !== null && balanceLeft < row.segments) {
                await prisma.smsMessage.update({ where: { id: row.id }, data: { status: 'FAILED', error: 'Not enough SMS left in the Orange bundle.' } });
                continue;
            }
            try {
                const ref = await sendOne(row.phone, row.body);
                await prisma.smsMessage.update({ where: { id: row.id }, data: { status: 'SENT', provider_ref: ref || null, sent_at: new Date(), error: null } });
                if (balanceLeft !== null) balanceLeft -= row.segments;
            } catch (e: any) {
                await prisma.smsMessage.update({ where: { id: row.id }, data: { status: 'FAILED', error: String(e?.message || e).slice(0, 300) } });
            }
            await new Promise((res) => setTimeout(res, GAP_MS));
        }
    } finally {
        running.delete(batchId);
    }
}

/** Puts FAILED rows of a batch back in the queue and sends them again. */
export async function retryFailed(batchId: string): Promise<number> {
    const r = await prisma.smsMessage.updateMany({ where: { batch_id: batchId, status: 'FAILED' }, data: { status: 'QUEUED', error: null } });
    if (r.count) setImmediate(() => { runBatch(batchId).catch(() => {}); });
    return r.count;
}
