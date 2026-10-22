import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import * as ctrl from '../controllers/financeRequestController';

const router = Router();

// Create / list / view are open to every authenticated user; the service enforces scope:
// - create: per-type creator checks (assertCreatorRole). Any staff member may raise a
//   PERSONNEL_DISBURSEMENT for themselves ("Request Money" addressed to the Bursar);
//   PARENT may raise PAYMENT_CLAIM; other types are Bursar / Principal+ only.
// - list / detail: oversight roles (SUPER_MANAGER, MANAGER, PRINCIPAL, VICE_PRINCIPAL, BURSAR,
//   SECRETARY, FEE_AUDITOR) see everything; everyone else only sees requests they raised,
//   money addressed to them, and (parents) requests about their linked children.
// Action routes use a permissive list and rely on per-type checks inside the service.
// SUPER_MANAGER approves REFUNDs; BURSAR+ approves PAYMENT_CLAIMs; recipients confirm PERSONNEL_DISBURSEMENT.
const ACTION_ROLES = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY', 'FEE_AUDITOR'];

router.post('/', authenticate, ctrl.createFinanceRequest);
router.get('/', authenticate, ctrl.listFinanceRequests);
router.get('/:id', authenticate, ctrl.getFinanceRequestById);

// Transitions — per-type authorization enforced in the service:
// - FEE_REDUCTION approve/reject: PRINCIPAL+ only
// - PERSONNEL_DISBURSEMENT complete/reject: the recipient (matched by user_id) or PRINCIPAL+
// - BANK_VERIFICATION complete/reject: any role on the view list
router.post('/:id/approve', authenticate, authorize(ACTION_ROLES), ctrl.approveFinanceRequest);
router.post('/:id/reject', authenticate, ctrl.rejectFinanceRequest);    // no authorize() — recipients aren't necessarily admins
router.post('/:id/complete', authenticate, ctrl.completeFinanceRequest); // same reason — recipient may be any role

export default router;
