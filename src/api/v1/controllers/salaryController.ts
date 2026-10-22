// src/api/v1/controllers/salaryController.ts
//
// Salary management: profiles, change requests, allowances/bonuses, pay periods,
// generated salary payments, withholdings, and bursar cash injections + summary.
// Role gating is enforced in the service (manager proposes, super manager validates).

import { Request, Response } from 'express';
import * as salaryService from '../services/salaryService';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

function caller(req: Request): { id: number; roles: string[] } {
    const u = (req as AuthenticatedRequest).user!;
    return { id: u.id, roles: (u.role ?? []) as unknown as string[] };
}

function sendError(res: Response, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /forbidden|only super_manager|not authorized/i.test(message)
        ? 403
        : /not found/i.test(message)
        ? 404
        : /already exists|already closed|cannot/i.test(message)
        ? 409
        : 400;
    res.status(status).json({ success: false, error: message });
}

// ---------- Profiles ----------

export async function createProfile(req: Request, res: Response) {
    try {
        const data = await salaryService.createSalaryProfile(
            {
                user_id: req.body.user_id,
                // Canonical field is salaryType; profileType/type are accepted as
                // aliases because older UI builds sent profileType.
                salary_type: req.body.salary_type ?? req.body.profile_type ?? req.body.type,
                hourly_rate: req.body.hourly_rate,
                base_salary: req.body.base_salary,
                academic_year_id: req.body.academic_year_id,
                notes: req.body.notes,
            },
            caller(req)
        );
        res.status(201).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function listProfiles(req: Request, res: Response) {
    try {
        const data = await salaryService.listSalaryProfiles({
            status: req.query.status as any,
            salary_type: (req.query.salary_type ?? req.query.salaryType) as string | undefined,
            academic_year_id: req.query.academic_year_id ? parseInt(req.query.academic_year_id as string) : undefined,
            user_id: req.query.user_id ? parseInt(req.query.user_id as string) : undefined,
            page: req.query.page ? parseInt(req.query.page as string) : undefined,
            limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        });
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function getProfile(req: Request, res: Response) {
    try {
        const data = await salaryService.getSalaryProfile(parseInt(req.params.id));
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function approveProfile(req: Request, res: Response) {
    try {
        const data = await salaryService.approveSalaryProfile(parseInt(req.params.id), caller(req));
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function rejectProfile(req: Request, res: Response) {
    try {
        const data = await salaryService.rejectSalaryProfile(
            parseInt(req.params.id),
            req.body.reason,
            caller(req)
        );
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function setProfileStatus(req: Request, res: Response) {
    try {
        const data = await salaryService.setSalaryProfileStatus(
            parseInt(req.params.id),
            req.body.status,
            caller(req)
        );
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

// ---------- Change Requests ----------

export async function createChangeRequest(req: Request, res: Response) {
    try {
        const data = await salaryService.createChangeRequest(
            {
                salary_profile_id: req.body.salary_profile_id,
                new_hourly_rate: req.body.new_hourly_rate,
                new_base_salary: req.body.new_base_salary,
                reason: req.body.reason,
            },
            caller(req)
        );
        res.status(201).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function listChangeRequests(req: Request, res: Response) {
    try {
        const data = await salaryService.listChangeRequests({
            status: req.query.status as any,
            salary_profile_id: req.query.salary_profile_id ? parseInt(req.query.salary_profile_id as string) : undefined,
            page: req.query.page ? parseInt(req.query.page as string) : undefined,
            limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        });
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function approveChangeRequest(req: Request, res: Response) {
    try {
        const data = await salaryService.approveChangeRequest(parseInt(req.params.id), caller(req));
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function rejectChangeRequest(req: Request, res: Response) {
    try {
        const data = await salaryService.rejectChangeRequest(
            parseInt(req.params.id),
            req.body.reason,
            caller(req)
        );
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

// ---------- Allowances / Bonuses ----------

export async function createAllowance(req: Request, res: Response) {
    try {
        const data = await salaryService.createAllowance(
            {
                salary_profile_id: req.body.salary_profile_id,
                type: req.body.type,
                amount: req.body.amount,
                reason: req.body.reason,
                pay_period_id: req.body.pay_period_id,
            },
            caller(req)
        );
        res.status(201).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function listAllowances(req: Request, res: Response) {
    try {
        const data = await salaryService.listAllowances({
            status: req.query.status as any,
            type: req.query.type as any,
            salary_profile_id: req.query.salary_profile_id ? parseInt(req.query.salary_profile_id as string) : undefined,
            pay_period_id: req.query.pay_period_id ? parseInt(req.query.pay_period_id as string) : undefined,
            page: req.query.page ? parseInt(req.query.page as string) : undefined,
            limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        });
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function approveAllowance(req: Request, res: Response) {
    try {
        const data = await salaryService.approveAllowance(parseInt(req.params.id), caller(req));
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function rejectAllowance(req: Request, res: Response) {
    try {
        const data = await salaryService.rejectAllowance(
            parseInt(req.params.id),
            req.body.reason,
            caller(req)
        );
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

// ---------- Pay Periods ----------

export async function createPayPeriod(req: Request, res: Response) {
    try {
        const data = await salaryService.createPayPeriod(
            {
                year: req.body.year,
                month: req.body.month,
                week_start_dates: req.body.week_start_dates,
                academic_year_id: req.body.academic_year_id,
                notes: req.body.notes,
            },
            caller(req)
        );
        res.status(201).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function listPayPeriods(req: Request, res: Response) {
    try {
        const data = await salaryService.listPayPeriods({
            academic_year_id: req.query.academic_year_id ? parseInt(req.query.academic_year_id as string) : undefined,
            status: req.query.status as any,
            year: req.query.year ? parseInt(req.query.year as string) : undefined,
            page: req.query.page ? parseInt(req.query.page as string) : undefined,
            limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        });
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function getPayPeriod(req: Request, res: Response) {
    try {
        const data = await salaryService.getPayPeriod(parseInt(req.params.id));
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function updatePayPeriodWeeks(req: Request, res: Response) {
    try {
        const data = await salaryService.updatePayPeriodWeeks(
            parseInt(req.params.id),
            req.body.week_start_dates,
            caller(req)
        );
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function lockPayPeriod(req: Request, res: Response) {
    try {
        const data = await salaryService.lockPayPeriod(parseInt(req.params.id), caller(req));
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function markPayPeriodPaid(req: Request, res: Response) {
    try {
        const data = await salaryService.markPayPeriodPaid(parseInt(req.params.id), caller(req));
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function generatePayPeriodPayments(req: Request, res: Response) {
    try {
        const data = await salaryService.generatePayPeriodPayments(parseInt(req.params.id), caller(req));
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

// ---------- Salary Payments ----------

export async function listPayPeriodPayments(req: Request, res: Response) {
    try {
        const data = await salaryService.listPayPeriodPayments(parseInt(req.params.id), {
            status: req.query.status as any,
            user_id: req.query.user_id ? parseInt(req.query.user_id as string) : undefined,
            page: req.query.page ? parseInt(req.query.page as string) : undefined,
            limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        });
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function getSalaryPayment(req: Request, res: Response) {
    try {
        const data = await salaryService.getSalaryPayment(parseInt(req.params.id));
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

// ---------- Withholdings ----------

export async function createWithholding(req: Request, res: Response) {
    try {
        const data = await salaryService.createWithholding(
            {
                salary_payment_id: req.body.salary_payment_id,
                scope: req.body.scope,
                amount: req.body.amount,
                reason: req.body.reason,
            },
            caller(req)
        );
        res.status(201).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function listWithholdings(req: Request, res: Response) {
    try {
        const data = await salaryService.listWithholdings({
            status: req.query.status as any,
            salary_payment_id: req.query.salary_payment_id ? parseInt(req.query.salary_payment_id as string) : undefined,
            page: req.query.page ? parseInt(req.query.page as string) : undefined,
            limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        });
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function approveWithholding(req: Request, res: Response) {
    try {
        const data = await salaryService.approveWithholding(parseInt(req.params.id), caller(req));
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function rejectWithholding(req: Request, res: Response) {
    try {
        const data = await salaryService.rejectWithholding(
            parseInt(req.params.id),
            req.body.reason,
            caller(req)
        );
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

// ---------- Bursar Cash: Injections + Summary ----------

export async function createCashInjection(req: Request, res: Response) {
    try {
        const data = await salaryService.createBursarCashInjection(
            {
                amount: req.body.amount,
                reason: req.body.reason,
                reference: req.body.reference,
                academic_year_id: req.body.academic_year_id,
            },
            caller(req)
        );
        res.status(201).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function listCashInjections(req: Request, res: Response) {
    try {
        const data = await salaryService.listBursarCashInjections({
            academic_year_id: req.query.academic_year_id ? parseInt(req.query.academic_year_id as string) : undefined,
            source: req.query.source as any,
            page: req.query.page ? parseInt(req.query.page as string) : undefined,
            limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        });
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}

export async function getBursarCashSummary(req: Request, res: Response) {
    try {
        const data = await salaryService.getBursarCashSummary({
            academic_year_id: req.query.academic_year_id ? parseInt(req.query.academic_year_id as string) : undefined,
        });
        res.status(200).json({ success: true, data });
    } catch (err) {
        sendError(res, err);
    }
}
