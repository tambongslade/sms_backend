import prisma, {
    Expenditure, ExpenditureCategory, PaymentMethod, Prisma, Role,
} from '../../../config/db';
import { normalizePaymentMethod } from '../../../utils/paymentMethod';
import { RoleTier, userHasMinTier } from '../../../utils/roleHierarchy';
import * as XLSX from 'xlsx';

const EDIT_WINDOW_DAYS = 7;

function isPrincipalPlus(roles: Role[]): boolean {
    return userHasMinTier(roles, RoleTier.HEAD_OF_SCHOOL);
}


export interface CreateExpenditureInput {
    date: string;
    category: ExpenditureCategory;
    description: string;
    amount: number;
    recipient?: string | null;
    recipient_user_id?: number | null;
    payment_method?: string | null;
    receipt_file?: string | null;
    notes?: string | null;
    recorded_by_id: number;
}

export async function createExpenditure(input: CreateExpenditureInput): Promise<Expenditure> {
    if (!input.description?.trim()) throw new Error('description is required');
    if (input.amount <= 0) throw new Error('amount must be > 0');
    if (!input.category) throw new Error('category is required');

    const paymentMethod = normalizePaymentMethod(input.payment_method, true);

    if (input.recipient_user_id) {
        const u = await prisma.user.findUnique({ where: { id: input.recipient_user_id } });
        if (!u) throw new Error(`Recipient user ${input.recipient_user_id} not found`);
    }

    return prisma.expenditure.create({
        data: {
            date: new Date(input.date),
            category: input.category,
            description: input.description.trim(),
            amount: input.amount,
            recipient: input.recipient?.trim() || null,
            recipient_user_id: input.recipient_user_id ?? null,
            payment_method: paymentMethod,
            receipt_file: input.receipt_file ?? null,
            notes: input.notes?.trim() || null,
            recorded_by_id: input.recorded_by_id,
        },
    });
}

export interface ListExpendituresOptions {
    from?: string;
    to?: string;
    category?: ExpenditureCategory;
    recorded_by_id?: number;
    recipient_user_id?: number;
    page?: number;
    limit?: number;
}

export async function listExpenditures(opts: ListExpendituresOptions) {
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;

    const where: Prisma.ExpenditureWhereInput = {
        ...(opts.category && { category: opts.category }),
        ...(opts.recorded_by_id && { recorded_by_id: opts.recorded_by_id }),
        ...(opts.recipient_user_id && { recipient_user_id: opts.recipient_user_id }),
        ...((opts.from || opts.to) && {
            date: {
                ...(opts.from && { gte: new Date(opts.from) }),
                ...(opts.to && { lte: new Date(opts.to) }),
            },
        }),
    };

    const [total, items] = await Promise.all([
        prisma.expenditure.count({ where }),
        prisma.expenditure.findMany({
            where,
            include: {
                recorded_by: { select: { id: true, name: true, matricule: true } },
                recipient_user: { select: { id: true, name: true, matricule: true } },
            },
            orderBy: { date: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return { data: items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getExpenditureById(id: number) {
    return prisma.expenditure.findUnique({
        where: { id },
        include: {
            recorded_by: { select: { id: true, name: true, matricule: true } },
            recipient_user: { select: { id: true, name: true, matricule: true } },
        },
    });
}

export interface UpdateExpenditureInput {
    date?: string;
    category?: ExpenditureCategory;
    description?: string;
    amount?: number;
    recipient?: string | null;
    recipient_user_id?: number | null;
    payment_method?: string | null;
    receipt_file?: string | null;
    notes?: string | null;
}

function canEdit(expenditure: Expenditure, actorUserId: number, actorRoles: Role[]): { allowed: boolean; reason?: string } {
    if (isPrincipalPlus(actorRoles)) return { allowed: true };
    if (expenditure.recorded_by_id !== actorUserId) {
        return { allowed: false, reason: 'You can only edit expenditures you recorded' };
    }
    const ageMs = Date.now() - expenditure.created_at.getTime();
    const windowMs = EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (ageMs > windowMs) {
        return { allowed: false, reason: `Edit window of ${EDIT_WINDOW_DAYS} days has passed; only Principal+ can edit older expenditures` };
    }
    return { allowed: true };
}

export async function updateExpenditure(id: number, data: UpdateExpenditureInput, actorUserId: number, actorRoles: Role[]): Promise<Expenditure> {
    const existing = await prisma.expenditure.findUnique({ where: { id } });
    if (!existing) throw new Error(`Expenditure ${id} not found`);

    const check = canEdit(existing, actorUserId, actorRoles);
    if (!check.allowed) {
        const err: any = new Error(check.reason || 'Forbidden');
        err.code = 'FORBIDDEN';
        throw err;
    }

    const updateData: Prisma.ExpenditureUpdateInput = {};
    if (data.date !== undefined) updateData.date = new Date(data.date);
    if (data.category !== undefined) updateData.category = data.category;
    if (data.description !== undefined) {
        if (!data.description.trim()) throw new Error('description cannot be empty');
        updateData.description = data.description.trim();
    }
    if (data.amount !== undefined) {
        if (data.amount <= 0) throw new Error('amount must be > 0');
        updateData.amount = data.amount;
    }
    if (data.recipient !== undefined) updateData.recipient = data.recipient?.trim() || null;
    if (data.recipient_user_id !== undefined) {
        if (data.recipient_user_id === null) {
            updateData.recipient_user = { disconnect: true };
        } else {
            const u = await prisma.user.findUnique({ where: { id: data.recipient_user_id } });
            if (!u) throw new Error(`Recipient user ${data.recipient_user_id} not found`);
            updateData.recipient_user = { connect: { id: data.recipient_user_id } };
        }
    }
    if (data.payment_method !== undefined) updateData.payment_method = normalizePaymentMethod(data.payment_method, true);
    if (data.receipt_file !== undefined) updateData.receipt_file = data.receipt_file;
    if (data.notes !== undefined) updateData.notes = data.notes?.trim() || null;

    return prisma.expenditure.update({ where: { id }, data: updateData });
}

export async function deleteExpenditure(id: number, actorRoles: Role[]): Promise<void> {
    if (!isPrincipalPlus(actorRoles)) {
        const err: any = new Error('Only Principal+ can delete expenditures');
        err.code = 'FORBIDDEN';
        throw err;
    }
    const existing = await prisma.expenditure.findUnique({ where: { id } });
    if (!existing) throw new Error(`Expenditure ${id} not found`);
    await prisma.expenditure.delete({ where: { id } });
}

export interface MonthlySummary {
    month: string; // e.g. "2026-06"
    from: string;
    to: string;
    total_amount: number;
    count: number;
    by_category: Array<{ category: ExpenditureCategory; amount: number; count: number }>;
}

export async function getMonthlySummary(month: string): Promise<MonthlySummary> {
    // month should be "YYYY-MM"
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) throw new Error('month must be in YYYY-MM format');
    const year = parseInt(match[1]);
    const monthNum = parseInt(match[2]);
    if (monthNum < 1 || monthNum > 12) throw new Error('Invalid month');

    const from = new Date(Date.UTC(year, monthNum - 1, 1));
    const to = new Date(Date.UTC(year, monthNum, 1)); // first day of next month, exclusive

    const grouped = await prisma.expenditure.groupBy({
        by: ['category'],
        where: { date: { gte: from, lt: to } },
        _sum: { amount: true },
        _count: { _all: true },
    });

    const byCategory = grouped.map(g => ({
        category: g.category,
        amount: g._sum.amount ?? 0,
        count: g._count._all,
    })).sort((a, b) => b.amount - a.amount);

    const totalAmount = byCategory.reduce((s, c) => s + c.amount, 0);
    const totalCount = byCategory.reduce((s, c) => s + c.count, 0);

    return {
        month,
        from: from.toISOString(),
        to: to.toISOString(),
        total_amount: totalAmount,
        count: totalCount,
        by_category: byCategory,
    };
}

export async function exportExpendituresExcel(opts: Omit<ListExpendituresOptions, 'page' | 'limit'>): Promise<{ buffer: Buffer; filename: string }> {
    const where: Prisma.ExpenditureWhereInput = {
        ...(opts.category && { category: opts.category }),
        ...(opts.recorded_by_id && { recorded_by_id: opts.recorded_by_id }),
        ...(opts.recipient_user_id && { recipient_user_id: opts.recipient_user_id }),
        ...((opts.from || opts.to) && {
            date: {
                ...(opts.from && { gte: new Date(opts.from) }),
                ...(opts.to && { lte: new Date(opts.to) }),
            },
        }),
    };

    const items = await prisma.expenditure.findMany({
        where,
        include: {
            recorded_by: { select: { name: true, matricule: true } },
            recipient_user: { select: { name: true, matricule: true } },
        },
        orderBy: { date: 'desc' },
    });

    const sheet = [
        ['Date', 'Category', 'Description', 'Amount', 'Recipient', 'Recipient (User)', 'Payment Method', 'Recorded By', 'Notes'],
        ...items.map(e => [
            e.date.toISOString().slice(0, 10),
            e.category,
            e.description,
            e.amount,
            e.recipient ?? '',
            e.recipient_user ? `${e.recipient_user.name} (${e.recipient_user.matricule})` : '',
            e.payment_method ?? '',
            `${e.recorded_by.name} (${e.recorded_by.matricule})`,
            e.notes ?? '',
        ]),
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(sheet);
    worksheet['!cols'] = [
        { wch: 12 }, { wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 24 }, { wch: 28 }, { wch: 14 }, { wch: 28 }, { wch: 40 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Expenditures');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const filename = `expenditures_${(opts.from ?? 'all').slice(0, 10)}_to_${(opts.to ?? 'now').slice(0, 10)}.xlsx`;
    return { buffer, filename };
}
