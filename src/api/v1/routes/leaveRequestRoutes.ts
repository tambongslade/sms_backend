import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import * as ctrl from '../controllers/leaveRequestController';

const router = Router();
router.use(authenticate);

router.post('/', ctrl.createLeave);
router.get('/mine', ctrl.listMyLeave);

router.get('/', authorize(['SUPER_MANAGER']), ctrl.listLeave);
router.get('/:id', ctrl.getLeave);

router.post('/:id/cancel', ctrl.cancelLeave);
router.post('/:id/approve', authorize(['SUPER_MANAGER']), ctrl.approveLeave);
router.post('/:id/reject', authorize(['SUPER_MANAGER']), ctrl.rejectLeave);

export default router;
