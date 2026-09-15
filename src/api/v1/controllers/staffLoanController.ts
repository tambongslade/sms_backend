import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import * as staffLoanService from '../services/staffLoanService';

function respondError(res: Response, err: any, defaultStatus = 400) {
    const message = err?.message || 'Unknown error';
    if (/not found/i.test(message)) return res.status(404).json({ success: false, error: message });
    if (/only|already|required|invalid|exceeds/i.test(message)) return res.status(400).json({ success: false, error: message });
    console.error('Loan error:', err);
    return res.status(defaultStatus).json({ success: false, error: message });
}

// POST /loans
export const createLoan = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const { amount, duration_months, reason } = req.body;
        const loan = await staffLoanService.requestLoan({
            borrowerId: userId,
            amount: Number(amount),
            durationMonths: parseInt(duration_months, 10),
            reason,
        });
        return res.status(201).json({ success: true, data: loan });
    } catch (err) {
        return respondError(res, err);
    }
};

// PATCH /loans/:id
export const updateLoan = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const loanId = parseInt(req.params.id, 10);
        const { amount, duration_months, reason } = req.body;
        const loan = await staffLoanService.modifyLoan(loanId, userId, {
            amount: amount != null ? Number(amount) : undefined,
            durationMonths: duration_months != null ? parseInt(duration_months, 10) : undefined,
            reason,
        });
        return res.json({ success: true, data: loan });
    } catch (err) {
        return respondError(res, err);
    }
};

// POST /loans/:id/cancel
export const cancelLoan = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const loanId = parseInt(req.params.id, 10);
        const loan = await staffLoanService.cancelLoan(loanId, userId);
        return res.json({ success: true, data: loan });
    } catch (err) {
        return respondError(res, err);
    }
};

// POST /loans/:id/approve — SUPER_MANAGER only
export const approveLoan = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const loanId = parseInt(req.params.id, 10);
        const { repayment_method, note } = req.body;
        const loan = await staffLoanService.approveLoan(loanId, userId, {
            repaymentMethod: repayment_method,
            note,
        });
        return res.json({ success: true, data: loan });
    } catch (err) {
        return respondError(res, err);
    }
};

// POST /loans/:id/reject — SUPER_MANAGER only
export const rejectLoan = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const loanId = parseInt(req.params.id, 10);
        const loan = await staffLoanService.rejectLoan(loanId, userId, req.body?.note);
        return res.json({ success: true, data: loan });
    } catch (err) {
        return respondError(res, err);
    }
};

// POST /loans/:id/repayments — bursar / super manager records a repayment
export const recordRepayment = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const loanId = parseInt(req.params.id, 10);
        const { amount, paid_on, method, notes } = req.body;
        const result = await staffLoanService.recordRepayment(loanId, userId, {
            amount: Number(amount),
            paidOn: paid_on,
            method,
            notes,
        });
        return res.status(201).json({ success: true, data: result });
    } catch (err) {
        return respondError(res, err);
    }
};

// GET /loans/mine
export const listMyLoans = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
        const loans = await staffLoanService.listLoans({ borrowerId: userId });
        return res.json({ success: true, data: loans });
    } catch (err) {
        return respondError(res, err, 500);
    }
};

// GET /loans — SUPER_MANAGER: all loans, optional ?status=PENDING
export const listLoans = async (req: Request, res: Response) => {
    try {
        const statusParam = req.query.status as string | undefined;
        const loans = await staffLoanService.listLoans({
            status: statusParam ? (statusParam.split(',') as any) : undefined,
        });
        return res.json({ success: true, data: loans });
    } catch (err) {
        return respondError(res, err, 500);
    }
};

// GET /loans/:id
export const getLoan = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        const roles: string[] = (req as any).user?.role ?? [];
        const loanId = parseInt(req.params.id, 10);
        const loan = await staffLoanService.getLoanById(loanId);
        if (!loan) return res.status(404).json({ success: false, error: 'Loan not found' });

        // Requesters can only see their own; SUPER_MANAGER / MANAGER / BURSAR see all.
        const isPrivileged = roles.some(r => ['SUPER_MANAGER', 'MANAGER', 'BURSAR'].includes(r));
        if (!isPrivileged && loan.borrower_id !== userId) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }

        return res.json({ success: true, data: loan });
    } catch (err) {
        return respondError(res, err, 500);
    }
};
