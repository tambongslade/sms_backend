import { PaymentMethod } from '@prisma/client';

/**
 * Single source of truth for the PaymentMethod enum on the API side.
 * Every service that accepts a payment method (fees, unified payments,
 * control fees, fee items, expenditures, finance requests) normalises
 * through here, so adding a method to the Prisma enum is enough to make it
 * accepted everywhere.
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
    CASH: 'Cash',
    MTN_MOMO: 'MTN Mobile Money',
    ORANGE_MONEY: 'Orange Money',
    EXPRESS_UNION: 'Express Union',
    CCA: 'CCA Bank',
    F3DC: 'F3DC',
    AFRILAND_FIRST_BANK: 'Afriland First Bank',
};

// Common spellings the UI or older clients send, mapped to the enum.
const ALIASES: Record<string, PaymentMethod> = {
    CASH: 'CASH',
    ESPECES: 'CASH',
    'ESPÈCES': 'CASH',
    MTN_MOMO: 'MTN_MOMO',
    MTN: 'MTN_MOMO',
    MOMO: 'MTN_MOMO',
    MTN_MOBILE_MONEY: 'MTN_MOMO',
    MOBILE_MONEY: 'MTN_MOMO',
    ORANGE_MONEY: 'ORANGE_MONEY',
    ORANGE: 'ORANGE_MONEY',
    OM: 'ORANGE_MONEY',
    EXPRESS_UNION: 'EXPRESS_UNION',
    CCA: 'CCA',
    CCA_BANK: 'CCA',
    F3DC: 'F3DC',
    AFRILAND_FIRST_BANK: 'AFRILAND_FIRST_BANK',
    AFRILAND: 'AFRILAND_FIRST_BANK',
};

export class InvalidPaymentMethodError extends Error {
    constructor(method: unknown) {
        super(
            `Invalid payment method: ${String(method)}. Accepted: ${Object.values(PAYMENT_METHOD_LABELS).join(', ')}`
        );
        this.name = 'InvalidPaymentMethodError';
    }
}

export function normalizePaymentMethod(method: string): PaymentMethod;
export function normalizePaymentMethod(method: string | null | undefined, allowEmpty: true): PaymentMethod | null;
export function normalizePaymentMethod(method: string | null | undefined, allowEmpty = false): PaymentMethod | null {
    if (method === null || method === undefined || String(method).trim() === '') {
        if (allowEmpty) return null;
        throw new InvalidPaymentMethodError(method);
    }
    const key = String(method).trim().toUpperCase().replace(/[\s-]+/g, '_');
    const resolved = ALIASES[key];
    if (resolved && (Object.values(PaymentMethod) as string[]).includes(resolved)) return resolved;
    throw new InvalidPaymentMethodError(method);
}

export function paymentMethodLabel(method: string | null | undefined): string {
    if (!method) return '—';
    return (PAYMENT_METHOD_LABELS as Record<string, string>)[method] ?? method.replace(/_/g, ' ');
}

/** Ordered list for dropdowns: [{ value, label }] */
export function listPaymentMethods(): { value: PaymentMethod; label: string }[] {
    return (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map(value => ({
        value,
        label: PAYMENT_METHOD_LABELS[value],
    }));
}
