import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import * as ctrl from '../controllers/staffLoanController';

const router = Router();
router.use(authenticate);

// Any authenticated staff can request / view their own loans.
router.post('/', ctrl.createLoan);
router.get('/mine', ctrl.listMyLoans);

// Approval queue (SUPER_MANAGER; MANAGER already flows through the tier-1 shortcut).
router.get('/', authorize(['SUPER_MANAGER']), ctrl.listLoans);

router.get('/:id', ctrl.getLoan);
router.patch('/:id', ctrl.updateLoan);
router.post('/:id/cancel', ctrl.cancelLoan);

// Only SUPER_MANAGER (or MANAGER via the tier-1 shortcut) can approve / reject.
router.post('/:id/approve', authorize(['SUPER_MANAGER']), ctrl.approveLoan);
router.post('/:id/reject', authorize(['SUPER_MANAGER']), ctrl.rejectLoan);

// BURSAR and above can record a repayment (e.g. salary deduction, cash payback).
router.post('/:id/repayments', authorize(['SUPER_MANAGER', 'BURSAR']), ctrl.recordRepayment);

export default router;
