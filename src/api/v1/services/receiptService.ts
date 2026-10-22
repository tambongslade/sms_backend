// Printable fee receipt (M4). Data + Puppeteer/EJS PDF for one PaymentTransaction.
import prisma from '../../../config/db';
import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import * as PuppeteerManager from '../../../utils/puppeteerManager';
import { paymentMethodLabel } from '../../../utils/paymentMethod';

// ---------------------------------------------------------------- amount in words

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function belowThousand(n: number): string {
    const parts: string[] = [];
    const h = Math.floor(n / 100);
    const r = n % 100;
    if (h) parts.push(`${ONES[h]} hundred`);
    if (r) {
        if (h) parts.push('and');
        if (r < 20) parts.push(ONES[r]);
        else parts.push(TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ''));
    }
    return parts.join(' ');
}

/** 215000 -> "Two hundred and fifteen thousand" (XAF has no minor unit). */
export function amountInWords(amount: number): string {
    let n = Math.round(Math.abs(amount));
    if (n === 0) return 'Zero';
    const scales = ['', 'thousand', 'million', 'billion'];
    const chunks: string[] = [];
    let i = 0;
    while (n > 0 && i < scales.length) {
        const c = n % 1000;
        if (c) chunks.unshift(belowThousand(c) + (scales[i] ? ` ${scales[i]}` : ''));
        n = Math.floor(n / 1000);
        i++;
    }
    const s = chunks.join(' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------- data

export interface ReceiptData {
    payment_id: number;
    receipt_number: string;
    payment_date: Date;
    recorded_at: Date;
    amount: number;
    amount_in_words: string;
    payment_method: string;
    payment_method_label: string;
    notes: string | null;
    student: { id: number; name: string; matricule: string };
    class_name: string | null;
    sub_class_name: string | null;
    academic_year: string | null;
    amount_expected: number;
    total_paid_to_date: number;      // sum of this fee's payments up to and including this one
    balance_after_payment: number;   // max(expected - total_paid_to_date, 0)
    overpayment: number;
    cashier: { id: number; name: string } | null;
}

export async function getReceiptData(paymentId: number): Promise<ReceiptData | null> {
    const p = await prisma.paymentTransaction.findUnique({
        where: { id: paymentId },
        include: {
            school_fees: true,
            academic_year: { select: { name: true } },
            recorded_by: { select: { id: true, name: true } },
            enrollment: {
                include: {
                    student: { select: { id: true, name: true, matricule: true } },
                    class: { select: { name: true } },
                    sub_class: { select: { name: true, class: { select: { name: true } } } },
                },
            },
        },
    });
    if (!p) return null;

    // Running total as of this receipt (ordered by payment date, then id), so a
    // reprint shows the balance the parent had at that moment, not today's.
    const siblings = await prisma.paymentTransaction.findMany({
        where: { fee_id: p.fee_id },
        select: { id: true, amount: true, payment_date: true },
        orderBy: [{ payment_date: 'asc' }, { id: 'asc' }],
    });
    let running = 0;
    for (const s of siblings) {
        running += s.amount;
        if (s.id === p.id) break;
    }
    const expected = p.school_fees?.amount_expected ?? 0;

    return {
        payment_id: p.id,
        receipt_number: p.receipt_number || `#${p.id}`,
        payment_date: p.payment_date,
        recorded_at: p.created_at,
        amount: p.amount,
        amount_in_words: `${amountInWords(p.amount)} francs CFA`,
        payment_method: p.payment_method,
        payment_method_label: paymentMethodLabel(p.payment_method),
        notes: p.notes ?? null,
        student: {
            id: p.enrollment.student.id,
            name: p.enrollment.student.name,
            matricule: p.enrollment.student.matricule,
        },
        class_name: p.enrollment.sub_class?.class?.name ?? p.enrollment.class?.name ?? null,
        sub_class_name: p.enrollment.sub_class?.name ?? null,
        academic_year: p.academic_year?.name ?? null,
        amount_expected: expected,
        total_paid_to_date: running,
        balance_after_payment: Math.max(expected - running, 0),
        overpayment: Math.max(running - expected, 0),
        cashier: p.recorded_by ? { id: p.recorded_by.id, name: p.recorded_by.name } : null,
    };
}

// ---------------------------------------------------------------- PDF

const templateCache: { html?: string; logo?: string } = {};

function loadTemplate(): string {
    if (!templateCache.html) {
        // dist/ build copies src/view; fall back to src/ when running from ts-node.
        const candidates = [
            path.join(process.cwd(), 'src/view/receipt-template.ejs'),
            path.join(process.cwd(), 'dist/view/receipt-template.ejs'),
        ];
        const found = candidates.find(c => fs.existsSync(c));
        if (!found) throw new Error('Receipt template not found');
        templateCache.html = fs.readFileSync(found, 'utf-8');
    }
    return templateCache.html;
}

function loadLogo(): string {
    if (templateCache.logo === undefined) {
        try {
            const buf = fs.readFileSync(path.join(process.cwd(), 'public/school.png'));
            templateCache.logo = `data:image/png;base64,${buf.toString('base64')}`;
        } catch {
            templateCache.logo = '';
        }
    }
    return templateCache.logo;
}

export async function generateReceiptPdf(
    paymentId: number,
    options: { reprint?: boolean; printedBy?: string | null } = {},
): Promise<{ buffer: Buffer; filename: string } | null> {
    const data = await getReceiptData(paymentId);
    if (!data) return null;

    const html = ejs.render(loadTemplate(), {
        r: data,
        reprint: !!options.reprint,
        printedBy: options.printedBy ?? null,
        schoolLogo: loadLogo(),
        schoolName: "ST STEPHEN'S INTERNATIONAL COLLEGE",
        schoolTagline: 'Excellence for Higher Heights',
        schoolAddress: 'Yaounde Essono city Damas',
        schoolPhone: '(+237) 680 188 080 / 681 630 435',
        fmt: (n: number) => Math.round(n || 0).toLocaleString('en-US'),
        fmtDate: (d: Date) => new Date(d).toLocaleDateString('en-GB', { timeZone: 'Africa/Douala', day: '2-digit', month: 'short', year: 'numeric' }),
        fmtDateTime: (d: Date) => new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Douala', dateStyle: 'medium', timeStyle: 'short' }),
        generatedAt: new Date(),
    });

    const page = await PuppeteerManager.newPage();
    try {
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({
            format: 'A5',
            landscape: false,
            printBackground: true,
            margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
            preferCSSPageSize: true,
        });
        const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
        const safe = data.receipt_number.replace(/[^A-Za-z0-9-]+/g, '_');
        return { buffer, filename: `receipt-${safe}.pdf` };
    } finally {
        try { await page.close(); } catch { /* noop */ }
    }
}
