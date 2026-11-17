// Four-eyes audit: CONTROLLER records collected payments; BURSAR has NO access.
// Admins (SUPER_MANAGER, MANAGER, PRINCIPAL) can read both sides for oversight.
//
// Swagger documentation in src/config/swagger/docs/controlFeeDocs.ts
import { Router } from 'express';
import * as controlFeeController from '../controllers/controlFeeController';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

const CONTROL_WRITE = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'CONTROLLER'];
const CONTROL_READ = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'CONTROLLER'];

// POST /control-fees/payments - Record a payment collected by the Controller.
// Must precede the parameterised /:controlFeeId/payments route below.
router.post('/payments', authenticate, authorize(CONTROL_WRITE), controlFeeController.recordControlPayment);

// PUT /control-fees/payments/:id - Correct a payment within 10 minutes of recording it (only whoever recorded it).
router.put('/payments/:id', authenticate, authorize(CONTROL_WRITE), controlFeeController.updateControlPayment);

// GET /control-fees/export - Export control payments. Must precede /:id.
router.get('/export', authenticate, authorize(CONTROL_READ), controlFeeController.exportControlFeeReports);

// GET /control-fees - List per-enrollment control records (with filters)
router.get('/', authenticate, authorize(CONTROL_READ), controlFeeController.getAllControlFees);

// GET /control-fees/student/:studentId - All control records for a student
router.get('/student/:studentId', authenticate, authorize(CONTROL_READ), controlFeeController.getStudentControlFees);

// GET /control-fees/sub_class/:id/summary - Per-subclass totals
router.get('/sub_class/:id/summary', authenticate, authorize(CONTROL_READ), controlFeeController.getSubclassControlFeesSummary);
router.get('/subclass/:id/summary', authenticate, authorize(CONTROL_READ), controlFeeController.getSubclassControlFeesSummary);

// GET /control-fees/:controlFeeId/payments - Payments under one control record
router.get('/:controlFeeId/payments', authenticate, authorize(CONTROL_READ), controlFeeController.getControlFeePayments);

// GET /control-fees/:id - Single control record by id
router.get('/:id', authenticate, authorize(CONTROL_READ), controlFeeController.getControlFeeById);

export default router;
