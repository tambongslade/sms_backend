import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import * as ctrl from '../controllers/gceRegistrationController';

const router = Router();

const BURSAR_AND_ABOVE = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'BURSAR'];
const VIEW_GCE_REGISTRATIONS = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY', 'FEE_AUDITOR'];

// Roster of FORM 5 / UPPER SIXTH students with their registration progress
router.get('/', authenticate, authorize(VIEW_GCE_REGISTRATIONS), ctrl.getRoster);

// Registration state (and subject picker limits) for one enrollment
router.get('/enrollment/:enrollmentId', authenticate, authorize(VIEW_GCE_REGISTRATIONS), ctrl.getRegistration);
router.put('/enrollment/:enrollmentId/subjects', authenticate, authorize(BURSAR_AND_ABOVE), ctrl.saveSubjects);

// Payments
router.post('/:id/payments', authenticate, authorize(BURSAR_AND_ABOVE), ctrl.recordPayment);
router.get('/:id/payments', authenticate, authorize(VIEW_GCE_REGISTRATIONS), ctrl.getPayments);

export default router;
