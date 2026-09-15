import { Router } from 'express';
import * as ctrl from '../controllers/disciplinaryActionController';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

const DECIDERS = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR'];
// Approvers see actions routed to them: PRINCIPAL for DISMISSAL, VP for other major actions,
// SUPER_MANAGER as fallback. CONTROLLER views for personnel oversight.
const VIEWERS = [...DECIDERS, 'DISCIPLINE_MASTER', 'SENIOR_DISCIPLINE_MASTER', 'CONTROLLER'];
const APPROVERS = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL'];
const ADMIN_DELETE = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL'];

router.post('/', authenticate, authorize(DECIDERS), ctrl.createDisciplinaryAction);
router.get('/', authenticate, authorize(VIEWERS), ctrl.listDisciplinaryActions);

// Approval workflow endpoints — supervisor list must be defined BEFORE /:id
router.get('/pending-approval', authenticate, authorize(APPROVERS), ctrl.listPendingApprovals);
router.get('/my-pending-approvals', authenticate, authorize(APPROVERS), ctrl.listMyPendingApprovals);

router.get('/:id', authenticate, authorize(VIEWERS), ctrl.getDisciplinaryActionById);
router.put('/:id', authenticate, authorize(DECIDERS), ctrl.updateDisciplinaryAction);
router.delete('/:id', authenticate, authorize(ADMIN_DELETE), ctrl.deleteDisciplinaryAction);

// Approve or decline a pending action. Supervisor may also modify (days, dates, notes) in the same call.
router.post('/:id/approve', authenticate, authorize(APPROVERS), ctrl.approveDisciplinaryAction);
router.post('/:id/decline', authenticate, authorize(APPROVERS), ctrl.declineDisciplinaryAction);

export default router;
