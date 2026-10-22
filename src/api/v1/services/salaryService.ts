// src/api/v1/services/salaryService.ts
//
// Salary management for personnel. Two salary types:
//   - TEACHER_HOURLY: hourly_rate × hours_taught (from attendance) + allowances/bonuses − withholdings.
//   - ADMIN_FIXED:    base_salary (constant) + allowances/bonuses − withholdings.
//
// Workflow: Manager proposes profiles, changes, allowances, and withholdings with reasons;
// Super Manager validates (approve/reject). Super Manager may create/edit directly (auto-approved).
// Pay periods pay on the last Friday of the calendar month.

import prisma, {
    Prisma,
    SalaryType,
    SalaryProfileStatus,
    SalaryAllowanceType,
    SalaryApprovalStatus,
    PayPeriodStatus,
    SalaryPaymentStatus,
    WithholdingScope,
    BursarCashInjectionSource,
    DayOfWeek,
} from '../../../config/db';
import { getAcademicYearId } from '../../../utils/academicYear';
import * as notificationService from './notificationService';

/** Fire-and-forget notification helper — never fails the outer request. */
function notifyAsync(fn: () => Promise<unknown>) {
    fn().catch((err) => console.error('Notification emit failed:', err));
}

// ---------- Helpers ----------

const DAY_INDEX_TO_ENUM: DayOfWeek[] = [
    'SUNDAY' as DayOfWeek,
    'MONDAY' as DayOfWeek,
    'TUESDAY' as DayOfWeek,
    'WEDNESDAY' as DayOfWeek,
    'THURSDAY' as DayOfWeek,
    'FRIDAY' as DayOfWeek,
    'SATURDAY' as DayOfWeek,
];

function normalizeDate(input: Date | string): Date {
    const d = typeof input === 'string' ? new Date(input) : new Date(input.getTime());
    if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

function dayOfWeekFromDate(d: Date): DayOfWeek {
    return DAY_INDEX_TO_ENUM[d.getUTCDay()];
}

/** Compute the last Friday of a given calendar month (UTC, midnight). */
export function lastFridayOfMonth(year: number, month: number): Date {
    // month is 1-12
    const lastDay = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day
    lastDay.setUTCHours(0, 0, 0, 0);
    const dow = lastDay.getUTCDay(); // 0 = Sunday, 5 = Friday
    const offset = (dow - 5 + 7) % 7;
    const friday = new Date(lastDay);
    friday.setUTCDate(lastDay.getUTCDate() - offset);
    return friday;
}

function parseHHMMToMinutes(t: string): number {
    const [hStr, mStr] = t.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr || '0', 10);
    if (Number.isNaN(h) || Number.isNaN(m)) throw new Error(`Invalid time string: ${t}`);
    return h * 60 + m;
}

function periodDurationHours(startTime: string, endTime: string): number {
    const start = parseHHMMToMinutes(startTime);
    const end = parseHHMMToMinutes(endTime);
    const mins = Math.max(0, end - start);
    return mins / 60;
}

/** Return every calendar day covered by the pay period's assigned weeks (7 days each) or, if none, the full [start_date, end_date] range. */
function payPeriodDates(payPeriod: {
    start_date: Date;
    end_date: Date;
    week_start_dates: unknown;
}): Date[] {
    const weekStarts = Array.isArray(payPeriod.week_start_dates)
        ? (payPeriod.week_start_dates as string[])
        : [];
    const dates: Date[] = [];
    if (weekStarts.length > 0) {
        for (const ws of weekStarts) {
            const start = normalizeDate(ws);
            for (let i = 0; i < 7; i++) {
                const d = new Date(start);
                d.setUTCDate(start.getUTCDate() + i);
                dates.push(d);
            }
        }
    } else {
        const d = normalizeDate(payPeriod.start_date);
        const end = normalizeDate(payPeriod.end_date);
        while (d.getTime() <= end.getTime()) {
            dates.push(new Date(d));
            d.setUTCDate(d.getUTCDate() + 1);
        }
    }
    // Dedupe by ISO date string
    const seen = new Set<string>();
    return dates.filter((d) => {
        const key = d.toISOString().slice(0, 10);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isSuperManager(roles: string[]): boolean {
    return roles.includes('SUPER_MANAGER');
}

function assertRoles(roles: string[], allowed: string[]) {
    if (roles.includes('SUPER_MANAGER')) return;
    if (!allowed.some((r) => roles.includes(r))) {
        throw new Error("Forbidden: you don't have permission to perform this action.");
    }
}

// ---------- Salary Profiles ----------

/**
 * Tolerantly map client input to the SalaryType enum. Accepts the canonical values
 * (TEACHER_HOURLY / ADMIN_FIXED) in any case, plus the short aliases the UI has used
 * historically (HOURLY / FIXED, "teacher hourly", "admin-fixed", ...).
 * Returns null when the value is missing or unrecognised.
 */
export function normalizeSalaryType(v: unknown): SalaryType | null {
    if (typeof v !== 'string') return null;
    const key = v.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (!key) return null;
    if (['TEACHER_HOURLY', 'HOURLY', 'TEACHER'].includes(key)) return 'TEACHER_HOURLY';
    if (['ADMIN_FIXED', 'FIXED', 'ADMIN', 'MONTHLY', 'BASE'].includes(key)) return 'ADMIN_FIXED';
    return null;
}

export interface CreateProfileInput {
    user_id: number;
    salary_type: SalaryType | string;
    hourly_rate?: number | string | null;
    base_salary?: number | string | null;
    academic_year_id?: number;
    notes?: string;
}

export async function createSalaryProfile(
    input: CreateProfileInput,
    caller: { id: number; roles: string[] }
) {
    assertRoles(caller.roles, ['MANAGER']);
    const yearId = input.academic_year_id ?? (await getAcademicYearId());
    if (!yearId) throw new Error('No current academic year is set');

    const salaryType = normalizeSalaryType(input.salary_type);
    if (!salaryType) {
        throw new Error(
            input.salary_type == null || input.salary_type === ''
                ? 'salaryType is required (TEACHER_HOURLY or ADMIN_FIXED)'
                : `Invalid salaryType "${input.salary_type}" (expected TEACHER_HOURLY or ADMIN_FIXED)`
        );
    }
    const userId = toInt(input.user_id, 'user_id');
    const hourlyRate = toNumber(input.hourly_rate, 'hourly_rate');
    const baseSalary = toNumber(input.base_salary, 'base_salary');
    if (salaryType === 'TEACHER_HOURLY') {
        if (hourlyRate == null || hourlyRate < 0) {
            throw new Error('hourly_rate is required and must be >= 0 for TEACHER_HOURLY');
        }
    } else if (baseSalary == null || baseSalary < 0) {
        throw new Error('base_salary is required and must be >= 0 for ADMIN_FIXED');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error(`User ${userId} not found`);

    const existing = await prisma.salaryProfile.findUnique({
        where: { user_id_academic_year_id: { user_id: userId, academic_year_id: yearId } },
    });
    if (existing) throw new Error('A salary profile already exists for this user in this academic year');

    const superManagerCreated = isSuperManager(caller.roles);

    const created = await prisma.salaryProfile.create({
        data: {
            user_id: userId,
            academic_year_id: yearId,
            salary_type: salaryType,
            hourly_rate: salaryType === 'TEACHER_HOURLY' ? hourlyRate : null,
            base_salary: salaryType === 'ADMIN_FIXED' ? baseSalary : null,
            notes: input.notes?.trim() || null,
            status: superManagerCreated ? 'ACTIVE' : 'PENDING_APPROVAL',
            created_by_id: caller.id,
            approved_by_id: superManagerCreated ? caller.id : null,
            approved_at: superManagerCreated ? new Date() : null,
        },
        include: profileInclude(),
    });

    if (!superManagerCreated) {
        notifyAsync(() =>
            notificationService.notifySuperManagers({
                title: 'Salary profile awaiting approval',
                message: `A new salary profile for ${created.user.name} (${created.salary_type}) needs your approval.`,
                sender_id: caller.id,
                priority: 'HIGH',
                entity_type: 'SalaryProfile',
                entity_id: created.id,
                action_url: `/salary/profiles/${created.id}`,
            })
        );
    }
    return created;
}

export interface ListProfilesFilter {
    status?: SalaryProfileStatus;
    salary_type?: SalaryType | string;
    academic_year_id?: number;
    user_id?: number;
    page?: number;
    limit?: number;
}

export async function listSalaryProfiles(filter: ListProfilesFilter) {
    const yearId = filter.academic_year_id ?? (await getAcademicYearId());
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const where: Prisma.SalaryProfileWhereInput = {
        ...(yearId ? { academic_year_id: yearId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(normalizeSalaryType(filter.salary_type) ? { salary_type: normalizeSalaryType(filter.salary_type)! } : {}),
        ...(filter.user_id ? { user_id: filter.user_id } : {}),
    };
    const [items, total] = await Promise.all([
        prisma.salaryProfile.findMany({
            where,
            include: profileInclude(),
            orderBy: { created_at: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.salaryProfile.count({ where }),
    ]);
    return { items, page, limit, total, total_pages: Math.ceil(total / limit) };
}

export async function getSalaryProfile(id: number) {
    const profile = await prisma.salaryProfile.findUnique({
        where: { id },
        include: profileInclude(),
    });
    if (!profile) throw new Error(`SalaryProfile ${id} not found`);
    return profile;
}

export async function approveSalaryProfile(
    id: number,
    caller: { id: number; roles: string[] }
) {
    if (!isSuperManager(caller.roles)) throw new Error('Only SUPER_MANAGER can approve salary profiles');
    const profile = await prisma.salaryProfile.findUnique({ where: { id } });
    if (!profile) throw new Error(`SalaryProfile ${id} not found`);
    if (profile.status === 'ACTIVE') return profile;
    const updated = await prisma.salaryProfile.update({
        where: { id },
        data: {
            status: 'ACTIVE',
            approved_by_id: caller.id,
            approved_at: new Date(),
            rejection_reason: null,
        },
        include: profileInclude(),
    });
    notifyAsync(() =>
        notificationService.sendNotification({
            user_id: profile.created_by_id,
            sender_id: caller.id,
            title: 'Salary profile approved',
            message: `Your salary profile for ${updated.user.name} was approved.`,
            category: 'APPROVAL_APPROVED',
            priority: 'HIGH',
            entity_type: 'SalaryProfile',
            entity_id: updated.id,
            action_url: `/salary/profiles/${updated.id}`,
        })
    );
    return updated;
}

export async function rejectSalaryProfile(
    id: number,
    reason: string,
    caller: { id: number; roles: string[] }
) {
    if (!isSuperManager(caller.roles)) throw new Error('Only SUPER_MANAGER can reject salary profiles');
    if (!reason?.trim()) throw new Error('reason is required');
    const profile = await prisma.salaryProfile.findUnique({ where: { id } });
    if (!profile) throw new Error(`SalaryProfile ${id} not found`);
    const updated = await prisma.salaryProfile.update({
        where: { id },
        data: {
            status: 'REJECTED',
            approved_by_id: caller.id,
            approved_at: new Date(),
            rejection_reason: reason.trim(),
        },
        include: profileInclude(),
    });
    notifyAsync(() =>
        notificationService.sendNotification({
            user_id: profile.created_by_id,
            sender_id: caller.id,
            title: 'Salary profile rejected',
            message: `Your salary profile submission was rejected: ${reason.trim()}`,
            category: 'APPROVAL_REJECTED',
            priority: 'HIGH',
            entity_type: 'SalaryProfile',
            entity_id: updated.id,
            action_url: `/salary/profiles/${updated.id}`,
        })
    );
    return updated;
}

export async function setSalaryProfileStatus(
    id: number,
    status: SalaryProfileStatus,
    caller: { id: number; roles: string[] }
) {
    if (!isSuperManager(caller.roles)) throw new Error('Only SUPER_MANAGER can change profile status');
    const profile = await prisma.salaryProfile.findUnique({ where: { id } });
    if (!profile) throw new Error(`SalaryProfile ${id} not found`);
    return prisma.salaryProfile.update({
        where: { id },
        data: { status },
        include: profileInclude(),
    });
}

function profileInclude() {
    return {
        user: { select: { id: true, name: true, matricule: true, email: true, phone: true } },
        academic_year: { select: { id: true, name: true } },
        created_by: { select: { id: true, name: true } },
        approved_by: { select: { id: true, name: true } },
    } satisfies Prisma.SalaryProfileInclude;
}

// ---------- Salary Change Requests ----------

export interface ChangeRequestInput {
    salary_profile_id: number;
    new_hourly_rate?: number;
    new_base_salary?: number;
    reason: string;
}

export async function createChangeRequest(
    input: ChangeRequestInput,
    caller: { id: number; roles: string[] }
) {
    assertRoles(caller.roles, ['MANAGER']);
    const superManager = isSuperManager(caller.roles);
    // Manager must provide a reason; Super Manager may edit directly, so we auto-fill one.
    const reason = input.reason?.trim() || (superManager ? 'Direct update by Super Manager' : '');
    if (!reason) throw new Error('reason is required');

    const salaryProfileId = toInt(input.salary_profile_id, 'salary_profile_id');
    const profile = await prisma.salaryProfile.findUnique({ where: { id: salaryProfileId } });
    if (!profile) throw new Error(`SalaryProfile ${salaryProfileId} not found`);

    let newHourlyRate: number | null = null;
    let newBaseSalary: number | null = null;
    if (profile.salary_type === 'TEACHER_HOURLY') {
        newHourlyRate = toNumber(input.new_hourly_rate, 'new_hourly_rate');
        if (newHourlyRate == null || newHourlyRate < 0) {
            throw new Error('new_hourly_rate is required and must be >= 0 for TEACHER_HOURLY profiles');
        }
    } else {
        newBaseSalary = toNumber(input.new_base_salary, 'new_base_salary');
        if (newBaseSalary == null || newBaseSalary < 0) {
            throw new Error('new_base_salary is required and must be >= 0 for ADMIN_FIXED profiles');
        }
    }

    const request = await prisma.salaryChangeRequest.create({
        data: {
            salary_profile_id: profile.id,
            old_hourly_rate: profile.hourly_rate ?? null,
            new_hourly_rate: newHourlyRate,
            old_base_salary: profile.base_salary ?? null,
            new_base_salary: newBaseSalary,
            reason,
            requested_by_id: caller.id,
            status: superManager ? 'APPROVED' : 'PENDING',
            approved_by_id: superManager ? caller.id : null,
            approved_at: superManager ? new Date() : null,
        },
        include: changeRequestInclude(),
    });

    // If super manager submitted, apply the change immediately.
    if (superManager) {
        await applyChangeRequestToProfile(request.id);
        return prisma.salaryChangeRequest.findUnique({
            where: { id: request.id },
            include: changeRequestInclude(),
        });
    }
    notifyAsync(() =>
        notificationService.notifySuperManagers({
            title: 'Salary change awaiting approval',
            message: `A salary change request for ${request.salary_profile.user.name} needs your approval.`,
            sender_id: caller.id,
            priority: 'HIGH',
            entity_type: 'SalaryChangeRequest',
            entity_id: request.id,
            action_url: `/salary/change-requests/${request.id}`,
        })
    );
    return request;
}

async function applyChangeRequestToProfile(requestId: number) {
    const req = await prisma.salaryChangeRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new Error(`SalaryChangeRequest ${requestId} not found`);
    const profile = await prisma.salaryProfile.findUnique({ where: { id: req.salary_profile_id } });
    if (!profile) throw new Error('Underlying salary profile no longer exists');
    await prisma.salaryProfile.update({
        where: { id: profile.id },
        data: {
            hourly_rate: profile.salary_type === 'TEACHER_HOURLY' ? req.new_hourly_rate : profile.hourly_rate,
            base_salary: profile.salary_type === 'ADMIN_FIXED' ? req.new_base_salary : profile.base_salary,
        },
    });
}

export async function approveChangeRequest(id: number, caller: { id: number; roles: string[] }) {
    if (!isSuperManager(caller.roles)) throw new Error('Only SUPER_MANAGER can approve');
    const req = await prisma.salaryChangeRequest.findUnique({ where: { id } });
    if (!req) throw new Error(`SalaryChangeRequest ${id} not found`);
    if (req.status !== 'PENDING') throw new Error('Only pending requests can be approved');
    await prisma.salaryChangeRequest.update({
        where: { id },
        data: { status: 'APPROVED', approved_by_id: caller.id, approved_at: new Date() },
    });
    await applyChangeRequestToProfile(id);
    const full = await prisma.salaryChangeRequest.findUnique({ where: { id }, include: changeRequestInclude() });
    notifyAsync(() =>
        notificationService.sendNotification({
            user_id: req.requested_by_id,
            sender_id: caller.id,
            title: 'Salary change approved',
            message: 'Your salary change request was approved.',
            category: 'APPROVAL_APPROVED',
            priority: 'HIGH',
            entity_type: 'SalaryChangeRequest',
            entity_id: id,
            action_url: `/salary/change-requests/${id}`,
        })
    );
    return full;
}

export async function rejectChangeRequest(
    id: number,
    reason: string,
    caller: { id: number; roles: string[] }
) {
    if (!isSuperManager(caller.roles)) throw new Error('Only SUPER_MANAGER can reject');
    if (!reason?.trim()) throw new Error('reason is required');
    const req = await prisma.salaryChangeRequest.findUnique({ where: { id } });
    if (!req) throw new Error(`SalaryChangeRequest ${id} not found`);
    if (req.status !== 'PENDING') throw new Error('Only pending requests can be rejected');
    const updated = await prisma.salaryChangeRequest.update({
        where: { id },
        data: {
            status: 'REJECTED',
            approved_by_id: caller.id,
            approved_at: new Date(),
            rejection_reason: reason.trim(),
        },
        include: changeRequestInclude(),
    });
    notifyAsync(() =>
        notificationService.sendNotification({
            user_id: req.requested_by_id,
            sender_id: caller.id,
            title: 'Salary change rejected',
            message: `Your salary change request was rejected: ${reason.trim()}`,
            category: 'APPROVAL_REJECTED',
            priority: 'HIGH',
            entity_type: 'SalaryChangeRequest',
            entity_id: id,
            action_url: `/salary/change-requests/${id}`,
        })
    );
    return updated;
}

export async function listChangeRequests(filter: {
    status?: SalaryApprovalStatus;
    salary_profile_id?: number;
    page?: number;
    limit?: number;
}) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const where: Prisma.SalaryChangeRequestWhereInput = {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.salary_profile_id ? { salary_profile_id: filter.salary_profile_id } : {}),
    };
    const [items, total] = await Promise.all([
        prisma.salaryChangeRequest.findMany({
            where,
            include: changeRequestInclude(),
            orderBy: { created_at: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.salaryChangeRequest.count({ where }),
    ]);
    return { items, page, limit, total, total_pages: Math.ceil(total / limit) };
}

function changeRequestInclude() {
    return {
        salary_profile: {
            include: { user: { select: { id: true, name: true, matricule: true } } },
        },
        requested_by: { select: { id: true, name: true } },
        approved_by: { select: { id: true, name: true } },
    } satisfies Prisma.SalaryChangeRequestInclude;
}

// ---------- Salary Allowances / Bonuses ----------

export interface AllowanceInput {
    salary_profile_id: number;
    type: SalaryAllowanceType;
    amount: number;
    reason: string;
    pay_period_id?: number;
}

export async function createAllowance(
    input: AllowanceInput,
    caller: { id: number; roles: string[] }
) {
    assertRoles(caller.roles, ['MANAGER']);
    if (!input.reason?.trim()) throw new Error('reason is required');
    if (input.amount == null || input.amount < 0) throw new Error('amount must be >= 0');
    // type is optional for clients: defaults to ALLOWANCE, case-insensitive.
    const allowanceType = String(input.type ?? 'ALLOWANCE').trim().toUpperCase();
    if (allowanceType !== 'ALLOWANCE' && allowanceType !== 'BONUS') {
        throw new Error('type must be ALLOWANCE or BONUS');
    }
    input = { ...input, type: allowanceType as SalaryAllowanceType };

    const profile = await prisma.salaryProfile.findUnique({ where: { id: input.salary_profile_id } });
    if (!profile) throw new Error(`SalaryProfile ${input.salary_profile_id} not found`);
    if (input.pay_period_id) {
        const pp = await prisma.payPeriod.findUnique({ where: { id: input.pay_period_id } });
        if (!pp) throw new Error(`PayPeriod ${input.pay_period_id} not found`);
    }

    const superManager = isSuperManager(caller.roles);
    const created = await prisma.salaryAllowance.create({
        data: {
            salary_profile_id: profile.id,
            pay_period_id: input.pay_period_id ?? null,
            type: input.type,
            amount: input.amount,
            reason: input.reason.trim(),
            requested_by_id: caller.id,
            status: superManager ? 'APPROVED' : 'PENDING',
            approved_by_id: superManager ? caller.id : null,
            approved_at: superManager ? new Date() : null,
        },
        include: allowanceInclude(),
    });
    if (!superManager) {
        notifyAsync(() =>
            notificationService.notifySuperManagers({
                title: `${input.type === 'BONUS' ? 'Bonus' : 'Allowance'} awaiting approval`,
                message: `${caller.id ? '' : ''}${created.salary_profile.user.name}: ${input.type} of ${input.amount} needs your approval.`,
                sender_id: caller.id,
                priority: 'HIGH',
                entity_type: 'SalaryAllowance',
                entity_id: created.id,
                action_url: `/salary/allowances/${created.id}`,
            })
        );
    }
    return created;
}

export async function approveAllowance(id: number, caller: { id: number; roles: string[] }) {
    if (!isSuperManager(caller.roles)) throw new Error('Only SUPER_MANAGER can approve');
    const item = await prisma.salaryAllowance.findUnique({ where: { id } });
    if (!item) throw new Error(`SalaryAllowance ${id} not found`);
    if (item.status !== 'PENDING') throw new Error('Only pending items can be approved');
    const updated = await prisma.salaryAllowance.update({
        where: { id },
        data: { status: 'APPROVED', approved_by_id: caller.id, approved_at: new Date() },
        include: allowanceInclude(),
    });
    notifyAsync(() =>
        notificationService.sendNotification({
            user_id: item.requested_by_id,
            sender_id: caller.id,
            title: `${item.type === 'BONUS' ? 'Bonus' : 'Allowance'} approved`,
            message: `Your ${item.type.toLowerCase()} request of ${item.amount} was approved.`,
            category: 'APPROVAL_APPROVED',
            priority: 'HIGH',
            entity_type: 'SalaryAllowance',
            entity_id: id,
            action_url: `/salary/allowances/${id}`,
        })
    );
    return updated;
}

export async function rejectAllowance(
    id: number,
    reason: string,
    caller: { id: number; roles: string[] }
) {
    if (!isSuperManager(caller.roles)) throw new Error('Only SUPER_MANAGER can reject');
    if (!reason?.trim()) throw new Error('reason is required');
    const item = await prisma.salaryAllowance.findUnique({ where: { id } });
    if (!item) throw new Error(`SalaryAllowance ${id} not found`);
    if (item.status !== 'PENDING') throw new Error('Only pending items can be rejected');
    const updated = await prisma.salaryAllowance.update({
        where: { id },
        data: {
            status: 'REJECTED',
            approved_by_id: caller.id,
            approved_at: new Date(),
            rejection_reason: reason.trim(),
        },
        include: allowanceInclude(),
    });
    notifyAsync(() =>
        notificationService.sendNotification({
            user_id: item.requested_by_id,
            sender_id: caller.id,
            title: `${item.type === 'BONUS' ? 'Bonus' : 'Allowance'} rejected`,
            message: `Your ${item.type.toLowerCase()} request was rejected: ${reason.trim()}`,
            category: 'APPROVAL_REJECTED',
            priority: 'HIGH',
            entity_type: 'SalaryAllowance',
            entity_id: id,
            action_url: `/salary/allowances/${id}`,
        })
    );
    return updated;
}

export async function listAllowances(filter: {
    status?: SalaryApprovalStatus;
    type?: SalaryAllowanceType;
    salary_profile_id?: number;
    pay_period_id?: number;
    page?: number;
    limit?: number;
}) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const where: Prisma.SalaryAllowanceWhereInput = {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.salary_profile_id ? { salary_profile_id: filter.salary_profile_id } : {}),
        ...(filter.pay_period_id ? { pay_period_id: filter.pay_period_id } : {}),
    };
    const [items, total] = await Promise.all([
        prisma.salaryAllowance.findMany({
            where,
            include: allowanceInclude(),
            orderBy: { created_at: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.salaryAllowance.count({ where }),
    ]);
    return { items, page, limit, total, total_pages: Math.ceil(total / limit) };
}

function allowanceInclude() {
    return {
        salary_profile: {
            include: { user: { select: { id: true, name: true, matricule: true } } },
        },
        pay_period: { select: { id: true, year: true, month: true, pay_date: true } },
        requested_by: { select: { id: true, name: true } },
        approved_by: { select: { id: true, name: true } },
    } satisfies Prisma.SalaryAllowanceInclude;
}

// ---------- Pay Periods ----------

export interface CreatePayPeriodInput {
    year: number;
    month: number; // 1-12
    week_start_dates: string[]; // ISO date strings; the weeks (each 7 days) that the manager assigns to this period
    academic_year_id?: number;
    notes?: string;
}

export async function createPayPeriod(
    input: CreatePayPeriodInput,
    caller: { id: number; roles: string[] }
) {
    assertRoles(caller.roles, ['MANAGER']);
    const yearId = input.academic_year_id ?? (await getAcademicYearId());
    if (!yearId) throw new Error('No current academic year is set');
    if (input.month < 1 || input.month > 12) throw new Error('month must be 1-12');
    if (!Array.isArray(input.week_start_dates)) throw new Error('week_start_dates must be an array');

    // Validate week starts parse to valid dates
    for (const ws of input.week_start_dates) {
        const d = new Date(ws);
        if (Number.isNaN(d.getTime())) throw new Error(`Invalid ISO date in week_start_dates: ${ws}`);
    }

    const existing = await prisma.payPeriod.findUnique({
        where: {
            academic_year_id_year_month: {
                academic_year_id: yearId,
                year: input.year,
                month: input.month,
            },
        },
    });
    if (existing) throw new Error('A pay period for this year/month already exists');

    const startDate = new Date(Date.UTC(input.year, input.month - 1, 1));
    const endDate = new Date(Date.UTC(input.year, input.month, 0));
    const payDate = lastFridayOfMonth(input.year, input.month);

    return prisma.payPeriod.create({
        data: {
            academic_year_id: yearId,
            year: input.year,
            month: input.month,
            start_date: startDate,
            end_date: endDate,
            pay_date: payDate,
            week_start_dates: input.week_start_dates as unknown as Prisma.JsonArray,
            notes: input.notes?.trim() || null,
            created_by_id: caller.id,
        },
        include: payPeriodInclude(),
    });
}

export async function listPayPeriods(filter: {
    academic_year_id?: number;
    status?: PayPeriodStatus;
    year?: number;
    page?: number;
    limit?: number;
}) {
    const yearId = filter.academic_year_id ?? (await getAcademicYearId());
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const where: Prisma.PayPeriodWhereInput = {
        ...(yearId ? { academic_year_id: yearId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.year ? { year: filter.year } : {}),
    };
    const [items, total] = await Promise.all([
        prisma.payPeriod.findMany({
            where,
            include: payPeriodInclude(),
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.payPeriod.count({ where }),
    ]);
    return { items, page, limit, total, total_pages: Math.ceil(total / limit) };
}

export async function getPayPeriod(id: number) {
    const pp = await prisma.payPeriod.findUnique({ where: { id }, include: payPeriodInclude() });
    if (!pp) throw new Error(`PayPeriod ${id} not found`);
    return pp;
}

export async function updatePayPeriodWeeks(
    id: number,
    week_start_dates: string[],
    caller: { id: number; roles: string[] }
) {
    assertRoles(caller.roles, ['MANAGER']);
    if (!Array.isArray(week_start_dates)) throw new Error('week_start_dates must be an array');
    const pp = await prisma.payPeriod.findUnique({ where: { id } });
    if (!pp) throw new Error(`PayPeriod ${id} not found`);
    if (pp.status === 'PAID') throw new Error('Cannot edit weeks of a PAID pay period');
    return prisma.payPeriod.update({
        where: { id },
        data: { week_start_dates: week_start_dates as unknown as Prisma.JsonArray },
        include: payPeriodInclude(),
    });
}

export async function lockPayPeriod(id: number, caller: { id: number; roles: string[] }) {
    assertRoles(caller.roles, ['MANAGER']);
    const pp = await prisma.payPeriod.findUnique({ where: { id } });
    if (!pp) throw new Error(`PayPeriod ${id} not found`);
    if (pp.status === 'PAID') throw new Error('Cannot lock a PAID pay period');
    return prisma.payPeriod.update({
        where: { id },
        data: { status: 'LOCKED' },
        include: payPeriodInclude(),
    });
}

export async function markPayPeriodPaid(id: number, caller: { id: number; roles: string[] }) {
    if (!isSuperManager(caller.roles)) throw new Error('Only SUPER_MANAGER can mark a pay period paid');
    const pp = await prisma.payPeriod.findUnique({ where: { id } });
    if (!pp) throw new Error(`PayPeriod ${id} not found`);
    if (pp.status === 'PAID') return getPayPeriod(id);
    return prisma.$transaction(async (tx) => {
        await tx.payPeriod.update({ where: { id }, data: { status: 'PAID' } });
        await tx.salaryPayment.updateMany({
            where: { pay_period_id: id, status: { in: ['DRAFT', 'PENDING_PAYMENT'] } },
            data: { status: 'PAID', paid_at: new Date(), paid_by_id: caller.id },
        });
        return tx.payPeriod.findUnique({ where: { id }, include: payPeriodInclude() });
    });
}

function payPeriodInclude() {
    return {
        academic_year: { select: { id: true, name: true } },
        created_by: { select: { id: true, name: true } },
    } satisfies Prisma.PayPeriodInclude;
}

// ---------- Salary Payment Generation ----------

/**
 * Generate a SalaryPayment for every ACTIVE profile in the pay period's academic year.
 * Teachers: hours computed from TeacherPeriod schedule intersected with pay-period weeks
 *           and TeacherPeriodAttendance status.
 * Admins:   base_salary flat.
 * Existing rows are overwritten while the period is not PAID.
 */
export async function generatePayPeriodPayments(
    payPeriodId: number,
    caller: { id: number; roles: string[] }
) {
    assertRoles(caller.roles, ['MANAGER']);
    const period = await prisma.payPeriod.findUnique({ where: { id: payPeriodId } });
    if (!period) throw new Error(`PayPeriod ${payPeriodId} not found`);
    if (period.status === 'PAID') throw new Error('Cannot regenerate payments for a PAID period');

    const profiles = await prisma.salaryProfile.findMany({
        where: { academic_year_id: period.academic_year_id, status: 'ACTIVE' },
    });

    const dates = payPeriodDates(period);
    const dateToDow = new Map(dates.map((d) => [d.toISOString().slice(0, 10), dayOfWeekFromDate(d)]));

    const results: Array<any> = [];

    for (const profile of profiles) {
        const totals = await computeSalaryTotalsForProfile(profile, period, dates, dateToDow);

        const upserted = await prisma.salaryPayment.upsert({
            where: {
                pay_period_id_user_id: {
                    pay_period_id: period.id,
                    user_id: profile.user_id,
                },
            },
            create: {
                salary_profile_id: profile.id,
                pay_period_id: period.id,
                user_id: profile.user_id,
                salary_type: profile.salary_type,
                hours_expected: totals.hours_expected,
                hours_taught: totals.hours_taught,
                hours_absent: totals.hours_absent,
                hourly_rate: profile.hourly_rate,
                base_amount: totals.base_amount,
                allowance_total: totals.allowance_total,
                bonus_total: totals.bonus_total,
                withheld_amount: totals.withheld_amount,
                net_amount: totals.net_amount,
                status: totals.net_amount > 0 ? 'PENDING_PAYMENT' : 'DRAFT',
            },
            update: {
                salary_profile_id: profile.id,
                salary_type: profile.salary_type,
                hours_expected: totals.hours_expected,
                hours_taught: totals.hours_taught,
                hours_absent: totals.hours_absent,
                hourly_rate: profile.hourly_rate,
                base_amount: totals.base_amount,
                allowance_total: totals.allowance_total,
                bonus_total: totals.bonus_total,
                withheld_amount: totals.withheld_amount,
                net_amount: totals.net_amount,
                // Keep PAID status if already paid, otherwise recompute
                status: totals.net_amount > 0 ? 'PENDING_PAYMENT' : 'DRAFT',
            },
        });
        results.push(upserted);
    }

    return {
        pay_period_id: period.id,
        generated: results.length,
        payments: results,
    };
}

async function computeSalaryTotalsForProfile(
    profile: { id: number; user_id: number; salary_type: SalaryType; hourly_rate: number | null; base_salary: number | null },
    period: { id: number; academic_year_id: number },
    dates: Date[],
    dateToDow: Map<string, DayOfWeek>
) {
    let hoursExpected = 0;
    let hoursTaught = 0;
    let hoursAbsent = 0;
    let baseAmount = 0;

    if (profile.salary_type === 'TEACHER_HOURLY') {
        const teacherPeriods = await prisma.teacherPeriod.findMany({
            where: { teacher_id: profile.user_id, academic_year_id: period.academic_year_id },
            include: { period: true },
        });

        // Map day-of-week -> list of teacher-periods scheduled that day
        const byDow = new Map<DayOfWeek, typeof teacherPeriods>();
        for (const tp of teacherPeriods) {
            if (tp.period.is_break) continue;
            const list = byDow.get(tp.period.day_of_week) ?? [];
            list.push(tp);
            byDow.set(tp.period.day_of_week, list);
        }

        // Fetch all attendance records for these teacher_periods within the date set
        const teacherPeriodIds = teacherPeriods.map((tp) => tp.id);
        const attendances = teacherPeriodIds.length
            ? await prisma.teacherPeriodAttendance.findMany({
                  where: {
                      teacher_period_id: { in: teacherPeriodIds },
                      date: { in: dates },
                  },
              })
            : [];
        const attMap = new Map<string, (typeof attendances)[number]>();
        for (const a of attendances) {
            attMap.set(`${a.teacher_period_id}|${a.date.toISOString().slice(0, 10)}`, a);
        }

        for (const date of dates) {
            const key = date.toISOString().slice(0, 10);
            const dow = dateToDow.get(key)!;
            const scheduled = byDow.get(dow) ?? [];
            for (const tp of scheduled) {
                const hours = periodDurationHours(tp.period.start_time, tp.period.end_time);
                hoursExpected += hours;
                const att = attMap.get(`${tp.id}|${key}`);
                if (att) {
                    if (att.status === 'PRESENT' || att.status === 'LATE') hoursTaught += hours;
                    else if (att.status === 'ABSENT') hoursAbsent += hours;
                }
            }
        }
        const rate = profile.hourly_rate ?? 0;
        baseAmount = round2(rate * hoursTaught);
    } else {
        // ADMIN_FIXED
        baseAmount = round2(profile.base_salary ?? 0);
    }

    // Approved allowances/bonuses that target this pay period OR are unattached (unattached apply to the next period generated)
    const allowances = await prisma.salaryAllowance.findMany({
        where: {
            salary_profile_id: profile.id,
            status: 'APPROVED',
            OR: [{ pay_period_id: period.id }, { pay_period_id: null }],
        },
    });

    let allowanceTotal = 0;
    let bonusTotal = 0;
    for (const a of allowances) {
        if (a.type === 'ALLOWANCE') allowanceTotal += a.amount;
        else if (a.type === 'BONUS') bonusTotal += a.amount;
    }
    allowanceTotal = round2(allowanceTotal);
    bonusTotal = round2(bonusTotal);

    // Approved withholdings for existing SalaryPayment (if it exists)
    let withheldAmount = 0;
    const existingPayment = await prisma.salaryPayment.findUnique({
        where: { pay_period_id_user_id: { pay_period_id: period.id, user_id: profile.user_id } },
        include: { withholdings: { where: { status: 'APPROVED' } } },
    });
    if (existingPayment) {
        for (const w of existingPayment.withholdings) withheldAmount += w.amount;
    }
    withheldAmount = round2(withheldAmount);

    const netAmount = round2(Math.max(0, baseAmount + allowanceTotal + bonusTotal - withheldAmount));

    return {
        hours_expected: round2(hoursExpected),
        hours_taught: round2(hoursTaught),
        hours_absent: round2(hoursAbsent),
        base_amount: baseAmount,
        allowance_total: allowanceTotal,
        bonus_total: bonusTotal,
        withheld_amount: withheldAmount,
        net_amount: netAmount,
    };
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Coerce a client-supplied numeric field to a finite number. Strings from form inputs are OK. */
function toNumber(v: unknown, field: string): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
    return n;
}

function toInt(v: unknown, field: string): number {
    const n = toNumber(v, field);
    if (n === null) throw new Error(`${field} is required`);
    if (!Number.isInteger(n)) throw new Error(`${field} must be an integer`);
    return n;
}

export async function listPayPeriodPayments(payPeriodId: number, filter: {
    status?: SalaryPaymentStatus;
    user_id?: number;
    page?: number;
    limit?: number;
}) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 50));
    const where: Prisma.SalaryPaymentWhereInput = {
        pay_period_id: payPeriodId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.user_id ? { user_id: filter.user_id } : {}),
    };
    const [items, total] = await Promise.all([
        prisma.salaryPayment.findMany({
            where,
            include: paymentInclude(),
            orderBy: [{ user: { name: 'asc' } }],
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.salaryPayment.count({ where }),
    ]);
    return { items, page, limit, total, total_pages: Math.ceil(total / limit) };
}

export async function getSalaryPayment(id: number) {
    const p = await prisma.salaryPayment.findUnique({ where: { id }, include: paymentInclude() });
    if (!p) throw new Error(`SalaryPayment ${id} not found`);
    return p;
}

function paymentInclude() {
    return {
        user: { select: { id: true, name: true, matricule: true, email: true } },
        pay_period: { select: { id: true, year: true, month: true, pay_date: true, status: true } },
        salary_profile: { select: { id: true, salary_type: true, hourly_rate: true, base_salary: true } },
        withholdings: {
            include: {
                requested_by: { select: { id: true, name: true } },
                approved_by: { select: { id: true, name: true } },
            },
        },
        paid_by: { select: { id: true, name: true } },
    } satisfies Prisma.SalaryPaymentInclude;
}

// ---------- Withholdings ----------

export interface WithholdingInput {
    salary_payment_id: number;
    scope: WithholdingScope;
    amount?: number; // required for PARTIAL; for FULL, must equal current net_amount (auto-filled)
    reason: string;
}

export async function createWithholding(
    input: WithholdingInput,
    caller: { id: number; roles: string[] }
) {
    assertRoles(caller.roles, ['MANAGER']);
    if (!input.reason?.trim()) throw new Error('reason is required');
    const payment = await prisma.salaryPayment.findUnique({
        where: { id: input.salary_payment_id },
        include: { pay_period: true },
    });
    if (!payment) throw new Error(`SalaryPayment ${input.salary_payment_id} not found`);
    if (payment.status === 'PAID') throw new Error('Cannot withhold a payment already marked PAID');
    if (payment.pay_period.status === 'PAID') throw new Error('Pay period is already closed as PAID');

    let amount = input.amount ?? 0;
    if (input.scope === 'FULL') {
        amount = payment.net_amount + payment.withheld_amount; // withhold entire remaining net
    } else {
        if (amount == null || amount <= 0) throw new Error('amount must be > 0 for PARTIAL withholding');
        if (amount > payment.net_amount) throw new Error('amount exceeds current net_amount');
    }

    const superManager = isSuperManager(caller.roles);
    const withholding = await prisma.salaryWithholding.create({
        data: {
            salary_payment_id: payment.id,
            scope: input.scope,
            amount: round2(amount),
            reason: input.reason.trim(),
            requested_by_id: caller.id,
            status: superManager ? 'APPROVED' : 'PENDING',
            approved_by_id: superManager ? caller.id : null,
            approved_at: superManager ? new Date() : null,
        },
        include: withholdingInclude(),
    });

    if (superManager) {
        await applyWithholdingToPayment(withholding.id);
        return prisma.salaryWithholding.findUnique({
            where: { id: withholding.id },
            include: withholdingInclude(),
        });
    }
    notifyAsync(() =>
        notificationService.notifySuperManagers({
            title: 'Withholding awaiting approval',
            message: `A ${input.scope.toLowerCase()} salary withholding of ${withholding.amount} for ${withholding.salary_payment.user.name} needs your approval.`,
            sender_id: caller.id,
            priority: 'HIGH',
            entity_type: 'SalaryWithholding',
            entity_id: withholding.id,
            action_url: `/salary/withholdings/${withholding.id}`,
        })
    );
    return withholding;
}

async function applyWithholdingToPayment(withholdingId: number) {
    const w = await prisma.salaryWithholding.findUnique({ where: { id: withholdingId } });
    if (!w) throw new Error(`SalaryWithholding ${withholdingId} not found`);
    const payment = await prisma.salaryPayment.findUnique({ where: { id: w.salary_payment_id } });
    if (!payment) throw new Error('Underlying salary payment no longer exists');
    const newWithheld = round2(payment.withheld_amount + w.amount);
    const gross = payment.base_amount + payment.allowance_total + payment.bonus_total;
    const newNet = round2(Math.max(0, gross - newWithheld));
    await prisma.salaryPayment.update({
        where: { id: payment.id },
        data: {
            withheld_amount: newWithheld,
            net_amount: newNet,
            status: newNet === 0 ? 'WITHHELD' : payment.status,
        },
    });
}

export async function approveWithholding(id: number, caller: { id: number; roles: string[] }) {
    if (!isSuperManager(caller.roles)) throw new Error('Only SUPER_MANAGER can approve');
    const w = await prisma.salaryWithholding.findUnique({ where: { id } });
    if (!w) throw new Error(`SalaryWithholding ${id} not found`);
    if (w.status !== 'PENDING') throw new Error('Only pending withholdings can be approved');
    await prisma.salaryWithholding.update({
        where: { id },
        data: { status: 'APPROVED', approved_by_id: caller.id, approved_at: new Date() },
    });
    await applyWithholdingToPayment(id);
    const full = await prisma.salaryWithholding.findUnique({ where: { id }, include: withholdingInclude() });
    notifyAsync(() =>
        notificationService.sendNotification({
            user_id: w.requested_by_id,
            sender_id: caller.id,
            title: 'Withholding approved',
            message: `Your salary withholding request of ${w.amount} was approved.`,
            category: 'APPROVAL_APPROVED',
            priority: 'HIGH',
            entity_type: 'SalaryWithholding',
            entity_id: id,
            action_url: `/salary/withholdings/${id}`,
        })
    );
    return full;
}

export async function rejectWithholding(
    id: number,
    reason: string,
    caller: { id: number; roles: string[] }
) {
    if (!isSuperManager(caller.roles)) throw new Error('Only SUPER_MANAGER can reject');
    if (!reason?.trim()) throw new Error('reason is required');
    const w = await prisma.salaryWithholding.findUnique({ where: { id } });
    if (!w) throw new Error(`SalaryWithholding ${id} not found`);
    if (w.status !== 'PENDING') throw new Error('Only pending withholdings can be rejected');
    const updated = await prisma.salaryWithholding.update({
        where: { id },
        data: {
            status: 'REJECTED',
            approved_by_id: caller.id,
            approved_at: new Date(),
            rejection_reason: reason.trim(),
        },
        include: withholdingInclude(),
    });
    notifyAsync(() =>
        notificationService.sendNotification({
            user_id: w.requested_by_id,
            sender_id: caller.id,
            title: 'Withholding rejected',
            message: `Your salary withholding request was rejected: ${reason.trim()}`,
            category: 'APPROVAL_REJECTED',
            priority: 'HIGH',
            entity_type: 'SalaryWithholding',
            entity_id: id,
            action_url: `/salary/withholdings/${id}`,
        })
    );
    return updated;
}

export async function listWithholdings(filter: {
    status?: SalaryApprovalStatus;
    salary_payment_id?: number;
    page?: number;
    limit?: number;
}) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const where: Prisma.SalaryWithholdingWhereInput = {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.salary_payment_id ? { salary_payment_id: filter.salary_payment_id } : {}),
    };
    const [items, total] = await Promise.all([
        prisma.salaryWithholding.findMany({
            where,
            include: withholdingInclude(),
            orderBy: { created_at: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.salaryWithholding.count({ where }),
    ]);
    return { items, page, limit, total, total_pages: Math.ceil(total / limit) };
}

function withholdingInclude() {
    return {
        salary_payment: {
            include: {
                user: { select: { id: true, name: true, matricule: true } },
                pay_period: { select: { id: true, year: true, month: true, pay_date: true } },
            },
        },
        requested_by: { select: { id: true, name: true } },
        approved_by: { select: { id: true, name: true } },
    } satisfies Prisma.SalaryWithholdingInclude;
}

// ---------- Bursar Cash: Injections + Summary ----------

export interface CashInjectionInput {
    amount: number;
    reason: string;
    reference?: string;
    academic_year_id?: number;
}

export async function createBursarCashInjection(
    input: CashInjectionInput,
    caller: { id: number; roles: string[] }
) {
    assertRoles(caller.roles, ['MANAGER']);
    if (input.amount == null || input.amount <= 0) throw new Error('amount must be > 0');
    if (!input.reason?.trim()) throw new Error('reason is required');
    const yearId = input.academic_year_id ?? (await getAcademicYearId());
    if (!yearId) throw new Error('No current academic year is set');

    const source: BursarCashInjectionSource = isSuperManager(caller.roles) ? 'SUPER_MANAGER' : 'MANAGER';

    return prisma.bursarCashInjection.create({
        data: {
            academic_year_id: yearId,
            amount: round2(input.amount),
            source,
            reason: input.reason.trim(),
            reference: input.reference?.trim() || null,
            injected_by_id: caller.id,
        },
        include: {
            injected_by: { select: { id: true, name: true } },
            academic_year: { select: { id: true, name: true } },
        },
    });
}

export async function listBursarCashInjections(filter: {
    academic_year_id?: number;
    source?: BursarCashInjectionSource;
    page?: number;
    limit?: number;
}) {
    const yearId = filter.academic_year_id ?? (await getAcademicYearId());
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    const where: Prisma.BursarCashInjectionWhereInput = {
        ...(yearId ? { academic_year_id: yearId } : {}),
        ...(filter.source ? { source: filter.source } : {}),
    };
    const [items, total] = await Promise.all([
        prisma.bursarCashInjection.findMany({
            where,
            include: {
                injected_by: { select: { id: true, name: true } },
                academic_year: { select: { id: true, name: true } },
            },
            orderBy: { created_at: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.bursarCashInjection.count({ where }),
    ]);
    return { items, page, limit, total, total_pages: Math.ceil(total / limit) };
}

/**
 * Cash summary shown to the manager:
 *   collected = fee payments + control-fee payments + fee-item payments + cash injections
 *   spent     = expenditures + refunds + paid salaries
 *   balance   = collected - spent
 * Optionally scoped to an academic year.
 */
export async function getBursarCashSummary(opts: { academic_year_id?: number } = {}) {
    const yearId = opts.academic_year_id ?? (await getAcademicYearId());

    const [
        feePaymentsAgg,
        controlPaymentsAgg,
        feeItemPaymentsAgg,
        injectionsAgg,
        expendituresAgg,
        refundsAgg,
        paidSalariesAgg,
        paymentsByMethod,
        expendituresByCategory,
        injectionsBySource,
    ] = await Promise.all([
        prisma.paymentTransaction.aggregate({
            _sum: { amount: true },
            where: yearId ? { academic_year_id: yearId } : {},
        }),
        prisma.controlPaymentTransaction.aggregate({
            _sum: { amount: true },
            where: yearId ? { academic_year_id: yearId } : {},
        }),
        prisma.feeItemPayment.aggregate({ _sum: { amount: true } }),
        prisma.bursarCashInjection.aggregate({
            _sum: { amount: true },
            where: yearId ? { academic_year_id: yearId } : {},
        }),
        prisma.expenditure.aggregate({ _sum: { amount: true } }),
        prisma.refund.aggregate({ _sum: { amount: true } }),
        prisma.salaryPayment.aggregate({
            _sum: { net_amount: true },
            where: { status: 'PAID' },
        }),
        prisma.paymentTransaction.groupBy({
            by: ['payment_method'],
            _sum: { amount: true },
            where: yearId ? { academic_year_id: yearId } : {},
        }),
        prisma.expenditure.groupBy({
            by: ['category'],
            _sum: { amount: true },
        }),
        prisma.bursarCashInjection.groupBy({
            by: ['source'],
            _sum: { amount: true },
            where: yearId ? { academic_year_id: yearId } : {},
        }),
    ]);

    const collected = round2(
        (feePaymentsAgg._sum.amount ?? 0) +
            (controlPaymentsAgg._sum.amount ?? 0) +
            (feeItemPaymentsAgg._sum.amount ?? 0) +
            (injectionsAgg._sum.amount ?? 0)
    );
    const spent = round2(
        (expendituresAgg._sum.amount ?? 0) +
            (refundsAgg._sum.amount ?? 0) +
            (paidSalariesAgg._sum.net_amount ?? 0)
    );
    const balance = round2(collected - spent);

    return {
        academic_year_id: yearId ?? null,
        collected,
        spent,
        balance,
        breakdown: {
            fee_payments: round2(feePaymentsAgg._sum.amount ?? 0),
            control_fee_payments: round2(controlPaymentsAgg._sum.amount ?? 0),
            fee_item_payments: round2(feeItemPaymentsAgg._sum.amount ?? 0),
            cash_injections: round2(injectionsAgg._sum.amount ?? 0),
            expenditures: round2(expendituresAgg._sum.amount ?? 0),
            refunds: round2(refundsAgg._sum.amount ?? 0),
            paid_salaries: round2(paidSalariesAgg._sum.net_amount ?? 0),
        },
        payments_by_method: paymentsByMethod.map((r) => ({
            payment_method: r.payment_method,
            amount: round2(r._sum.amount ?? 0),
        })),
        expenditures_by_category: expendituresByCategory.map((r) => ({
            category: r.category,
            amount: round2(r._sum.amount ?? 0),
        })),
        injections_by_source: injectionsBySource.map((r) => ({
            source: r.source,
            amount: round2(r._sum.amount ?? 0),
        })),
    };
}
