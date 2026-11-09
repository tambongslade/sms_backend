// Keeps SchoolFees.amount_paid right when fee records, payments and refunds arrive from the
// other server.
//
// amount_paid is a running total: recording a payment adds to it on the server where the
// payment is entered, a refund takes from it. The sync used to copy the whole SchoolFees row
// across, total included, so a row that was out of date on one server (a payment entered
// while the sync was down, for example) overwrote the other server's correct total. The
// receipt was still there but no longer counted in the balance: in September that hid 10
// students' payments and made the bursar re-enter several others.
//
// So the total never travels. Each server keeps its own and moves it by what actually
// arrives:
//  - a SchoolFees row from the peer updates everything except amount_paid;
//  - a new SchoolFees row starts at what the receipts already here add up to (normally 0,
//    since its payments cannot arrive before it);
//  - a payment from the peer adds its amount (or the change in amount) to its fee, a refund
//    takes its amount off, in the same transaction as the row itself, so a row that fails or
//    is applied twice never counts twice.
// The adjustment is plain SQL: it must not be queued for the peer, which makes its own.

export interface FeeEffect {
    feeId: number;
    amount: number;
}

const LINKS: Record<string, { feeField: string; sign: 1 | -1 }> = {
    PaymentTransaction: { feeField: 'fee_id', sign: 1 },
    Refund: { feeField: 'school_fees_id', sign: -1 },
};

/** Tables whose rows move a fee's paid total. */
export function movesFeeTotal(table: string): boolean {
    return table in LINKS;
}

/** What one payment or refund row counts towards its fee (signed), or null if it does not. */
export function feeEffectOf(table: string, row: any): FeeEffect | null {
    const link = LINKS[table];
    if (!link || !row) return null;
    const feeId = Number(row[link.feeField]);
    const amount = Number(row.amount);
    if (!Number.isFinite(feeId) || !Number.isFinite(amount)) return null;
    return { feeId, amount: link.sign * amount };
}

/** Moves the fee totals from what `before` counted to what `after` counts. */
export async function applyFeeEffects(tx: any, before: FeeEffect | null, after: FeeEffect | null): Promise<void> {
    const delta = new Map<number, number>();
    if (before) delta.set(before.feeId, (delta.get(before.feeId) ?? 0) - before.amount);
    if (after) delta.set(after.feeId, (delta.get(after.feeId) ?? 0) + after.amount);
    for (const [feeId, change] of delta) {
        if (change === 0) continue;
        await tx.$executeRawUnsafe(`UPDATE "SchoolFees" SET amount_paid = amount_paid + $1 WHERE id = $2`, change, feeId);
    }
}

/** What the receipts already on this server add up to for one fee, refunds taken off. */
export async function receiptsTotal(tx: any, feeId: number): Promise<number> {
    const rows: { total: any }[] = await tx.$queryRawUnsafe(
        `SELECT COALESCE((SELECT SUM(amount) FROM "PaymentTransaction" WHERE fee_id = $1), 0)
              - COALESCE((SELECT SUM(amount) FROM "Refund" WHERE school_fees_id = $1), 0) AS total`,
        feeId,
    );
    return Number(rows[0]?.total ?? 0);
}
