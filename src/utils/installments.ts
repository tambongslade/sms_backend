/**
 * School-fee installments.
 *
 * Installments are derived, not stored. A student's year bill follows their class schedule: registration
 * (new/old-student fee + miscellaneous), then the 1st, 2nd and 3rd term fees. Payments fill it in that order
 * (FIFO). The 1st/2nd/3rd installment due dates are the fee deadlines of the year's 1st/2nd/3rd (non-holiday)
 * terms, set in Academic Years.
 *
 * Form 5 and Upper Sixth classes pay in 2 installments: whatever their class has as a 3rd-term fee is due
 * with the 2nd installment, and they have no 3rd installment.
 */

export type InstallmentKey = 'first' | 'second' | 'third';
export const INSTALLMENT_KEYS: InstallmentKey[] = ['first', 'second', 'third'];

export interface FeeSchedule {
    registration: number;
    first: number;
    second: number;
    third: number;
}

/** Classes whose year is split in 2 installments instead of 3 (exam classes). */
export const isTwoInstallmentClass = (className?: string | null): boolean =>
    /^\s*(form\s*(5|five)|upper\s*six(th)?)(?!\d)/i.test(className || '');

export const installmentCount = (className?: string | null): 2 | 3 => (isTwoInstallmentClass(className) ? 2 : 3);

/**
 * Splits what a student paid over registration and the installments.
 * Same rule the defaulters report has always used; cumulative* = everything due by that installment
 * (registration and the earlier installments included) and how much of that is still missing.
 */
export function splitInstallments(schedule: FeeSchedule, totalExpected: number, totalPaid: number, count: 2 | 3 = 3) {
    let { registration, first, second, third } = schedule;
    if (count === 2) {
        second += third;
        third = 0;
    }
    // The installments must add up to what this student is actually billed. Where the bill differs from the
    // class schedule (a fee set by hand, a deduction), the extra goes on registration and a reduction comes
    // off the last installments first.
    let diff = totalExpected - (registration + first + second + third);
    if (diff > 0) {
        registration += diff;
    } else if (diff < 0) {
        const take = (amount: number) => { const t = Math.min(amount, -diff); diff += t; return amount - t; };
        third = take(third);
        second = take(second);
        first = take(first);
        registration = take(registration);
    }
    const paidToRegistration = Math.min(totalPaid, registration);
    const paidToFirst = Math.min(Math.max(totalPaid - registration, 0), first);
    const paidToSecond = Math.min(Math.max(totalPaid - registration - first, 0), second);
    const paidToThird = Math.min(Math.max(totalPaid - registration - first - second, 0), third);
    const dueBy = (total: number) => ({
        cumulativeExpected: total,
        cumulativeOutstanding: Math.max(total - totalPaid, 0),
    });
    return {
        registration: { expected: registration, paid: paidToRegistration, outstanding: Math.max(registration - paidToRegistration, 0) },
        first: { expected: first, paid: paidToFirst, outstanding: Math.max(first - paidToFirst, 0), ...dueBy(registration + first) },
        second: { expected: second, paid: paidToSecond, outstanding: Math.max(second - paidToSecond, 0), ...dueBy(registration + first + second) },
        third: { expected: third, paid: paidToThird, outstanding: Math.max(third - paidToThird, 0), ...dueBy(registration + first + second + third) },
    };
}

/** "YYYY-MM-DD" of a moment in Cameroon time (UTC+1, no daylight saving). */
export const schoolDay = (d: Date): string => new Date(d.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * The installment that applies today: the latest one whose due date has passed (due date included).
 * Before the 1st due date, the 1st installment is the one coming up. Due dates are the terms' fee
 * deadlines in term order; an installment without a deadline is skipped.
 */
export function currentInstallment(deadlines: (Date | null)[], count: 2 | 3, today: Date = new Date()) {
    const todayStr = schoolDay(today);
    const usable = deadlines.slice(0, count);
    let index = -1;
    usable.forEach((d, i) => {
        if (d && schoolDay(d) <= todayStr) index = i;
    });
    const passed = index >= 0;
    if (!passed) index = usable.findIndex((d) => !!d);
    if (index < 0) return null; // no deadline set at all
    const next = usable.findIndex((d, i) => i > index && !!d);
    return {
        key: INSTALLMENT_KEYS[index],
        number: index + 1,
        dueDate: usable[index] as Date,
        passed,
        next: next >= 0 ? { key: INSTALLMENT_KEYS[next], number: next + 1, dueDate: usable[next] as Date } : null,
    };
}
