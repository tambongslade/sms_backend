// src/api/v1/services/reamStockService.ts
//
// Central ledger for reams of printing paper.
//   RECEIPT  → stock added (received/purchased) — Bursar / Manager / Super Manager.
//   ISSUANCE → stock given out to a person with a reason — Bursar / Secretary.
// Managers and Super Managers can view stock totals.

import prisma, { Prisma, ReamStockEntryType } from '../../../config/db';

function assertRoles(roles: string[], allowed: string[]) {
    if (roles.includes('SUPER_MANAGER') || roles.includes('MANAGER')) return;
    if (!allowed.some((r) => roles.includes(r))) {
        throw new Error(`Forbidden: requires one of ${allowed.join(', ')}`);
    }
}

export interface AddReceiptInput {
    quantity: number;
    notes?: string;
}

export async function addReceipt(input: AddReceiptInput, caller: { id: number; roles: string[] }) {
    assertRoles(caller.roles, ['MANAGER', 'BURSAR']);
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
        throw new Error('quantity must be a positive integer');
    }
    return prisma.reamStockLedger.create({
        data: {
            type: 'RECEIPT',
            quantity: input.quantity,
            notes: input.notes?.trim() || null,
            recorded_by_id: caller.id,
        },
        include: ledgerInclude(),
    });
}

export interface IssueReamsInput {
    quantity: number;
    reason: string;
    recipient_user_id?: number;
    recipient_name?: string;
    notes?: string;
}

export async function issueReams(input: IssueReamsInput, caller: { id: number; roles: string[] }) {
    assertRoles(caller.roles, ['BURSAR', 'SECRETARY']);
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
        throw new Error('quantity must be a positive integer');
    }
    if (!input.reason?.trim()) throw new Error('reason is required');
    if (!input.recipient_user_id && !input.recipient_name?.trim()) {
        throw new Error('Either recipient_user_id or recipient_name is required');
    }
    if (input.recipient_user_id) {
        const u = await prisma.user.findUnique({ where: { id: input.recipient_user_id } });
        if (!u) throw new Error(`Recipient user ${input.recipient_user_id} not found`);
    }

    // Prevent issuing more than the current stock
    const currentStock = await getCurrentStock();
    if (input.quantity > currentStock) {
        throw new Error(
            `Cannot issue ${input.quantity} reams — current stock is ${currentStock}`
        );
    }

    return prisma.reamStockLedger.create({
        data: {
            type: 'ISSUANCE',
            quantity: input.quantity,
            recipient_user_id: input.recipient_user_id ?? null,
            recipient_name: input.recipient_user_id ? null : input.recipient_name!.trim(),
            reason: input.reason.trim(),
            notes: input.notes?.trim() || null,
            recorded_by_id: caller.id,
        },
        include: ledgerInclude(),
    });
}

export async function getCurrentStock(): Promise<number> {
    const [received, issued] = await Promise.all([
        prisma.reamStockLedger.aggregate({ _sum: { quantity: true }, where: { type: 'RECEIPT' } }),
        prisma.reamStockLedger.aggregate({ _sum: { quantity: true }, where: { type: 'ISSUANCE' } }),
    ]);
    return (received._sum.quantity ?? 0) - (issued._sum.quantity ?? 0);
}

export async function getStockSummary() {
    const [receivedAgg, issuedAgg, receiptCount, issuanceCount, lastEntry] = await Promise.all([
        prisma.reamStockLedger.aggregate({ _sum: { quantity: true }, where: { type: 'RECEIPT' } }),
        prisma.reamStockLedger.aggregate({ _sum: { quantity: true }, where: { type: 'ISSUANCE' } }),
        prisma.reamStockLedger.count({ where: { type: 'RECEIPT' } }),
        prisma.reamStockLedger.count({ where: { type: 'ISSUANCE' } }),
        prisma.reamStockLedger.findFirst({
            orderBy: { created_at: 'desc' },
            include: ledgerInclude(),
        }),
    ]);
    const totalReceived = receivedAgg._sum.quantity ?? 0;
    const totalIssued = issuedAgg._sum.quantity ?? 0;
    return {
        current_stock: totalReceived - totalIssued,
        total_received: totalReceived,
        total_issued: totalIssued,
        receipt_count: receiptCount,
        issuance_count: issuanceCount,
        last_entry: lastEntry,
    };
}

export async function listLedger(filter: {
    type?: ReamStockEntryType;
    recipient_user_id?: number;
    page?: number;
    limit?: number;
    from_date?: string;
    to_date?: string;
}) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
    const where: Prisma.ReamStockLedgerWhereInput = {
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.recipient_user_id ? { recipient_user_id: filter.recipient_user_id } : {}),
        ...(filter.from_date || filter.to_date
            ? {
                  created_at: {
                      ...(filter.from_date ? { gte: new Date(filter.from_date) } : {}),
                      ...(filter.to_date ? { lte: new Date(filter.to_date) } : {}),
                  },
              }
            : {}),
    };
    const [items, total] = await Promise.all([
        prisma.reamStockLedger.findMany({
            where,
            include: ledgerInclude(),
            orderBy: { created_at: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.reamStockLedger.count({ where }),
    ]);
    return { items, page, limit, total, total_pages: Math.ceil(total / limit) };
}

function ledgerInclude() {
    return {
        recorded_by: { select: { id: true, name: true, matricule: true } },
        recipient: { select: { id: true, name: true, matricule: true } },
    } satisfies Prisma.ReamStockLedgerInclude;
}
