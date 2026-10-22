import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import * as ctrl from '../controllers/seizedItemController';

const router = Router();

router.use(authenticate);

// Full discipline chain plus school-wide leadership. Service layer applies
// custody-based sub-rules (e.g. only current custodian can transfer).
const DISCIPLINE_OR_HEAD = [
    'SUPER_MANAGER',
    'MANAGER',
    'PRINCIPAL',
    'VICE_PRINCIPAL',
    'DEAN_OF_DISCIPLINE',
    'DISCIPLINE_COORDINATOR',
    'SENIOR_DISCIPLINE_MASTER',
    'DISCIPLINE_MASTER',
];

// ---------- Seizure ----------
router.post('/', authorize(DISCIPLINE_OR_HEAD), ctrl.createSeizedItem);
router.patch('/:id', authorize(DISCIPLINE_OR_HEAD), ctrl.updateSeizedItem);
router.delete('/:id', authorize(DISCIPLINE_OR_HEAD), ctrl.deleteSeizedItem);

// ---------- Read ----------
router.get('/', authorize(DISCIPLINE_OR_HEAD), ctrl.listSeizedItems);
router.get('/:id', authorize(DISCIPLINE_OR_HEAD), ctrl.getSeizedItem);

// ---------- Transfer flow ----------
router.post('/:id/transfers', authorize(DISCIPLINE_OR_HEAD), ctrl.initiateTransfer);
router.post('/:id/transfers/:transferId/accept', authorize(DISCIPLINE_OR_HEAD), ctrl.acceptTransfer);
router.post('/:id/transfers/:transferId/reject', authorize(DISCIPLINE_OR_HEAD), ctrl.rejectTransfer);
router.post('/:id/transfers/:transferId/cancel', authorize(DISCIPLINE_OR_HEAD), ctrl.cancelTransfer);

// ---------- Terminal actions ----------
router.post('/:id/release', authorize(DISCIPLINE_OR_HEAD), ctrl.releaseSeizedItem);
router.post('/:id/destroy', authorize(['SUPER_MANAGER', 'PRINCIPAL']), ctrl.destroySeizedItem);

export default router;
