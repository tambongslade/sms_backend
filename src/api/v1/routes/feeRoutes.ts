// Swagger documentation can be found in src/config/swagger/docs/feeDocs.ts
import { Router } from 'express';
import * as feeController from '../controllers/feeController';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// GET /fees - List all fees (with filters)
// All authenticated users can view fees list
router.get('/', authenticate, feeController.getAllFees);

// GET /fees/export - Export fee data (Excel/Word) - Moved before /:id
// Only SUPER_MANAGER, PRINCIPAL, BURSAR can export fee reports
router.get('/export', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'BURSAR']), feeController.exportFeeReports);

// --- Overpayments & Refunds (must be registered before /:id to avoid param capture) ---
const VIEW_REFUNDS = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'BURSAR', 'SECRETARY', 'FEE_AUDITOR'];
// Direct refund recording is a SUPER_MANAGER-only override. The standard flow is:
// Bursar creates a REFUND FinanceRequest → SUPER_MANAGER approves → the refund is recorded automatically.
const RECORD_REFUNDS_DIRECT = ['SUPER_MANAGER'];

router.get('/overpaid', authenticate, authorize(VIEW_REFUNDS), feeController.listOverpaid);
router.get('/overpaid/export', authenticate, authorize(VIEW_REFUNDS), feeController.exportOverpaid);
router.post('/refunds', authenticate, authorize(RECORD_REFUNDS_DIRECT), feeController.recordRefund);
router.get('/refunds', authenticate, authorize(VIEW_REFUNDS), feeController.listRefunds);
router.get('/refunds/:id', authenticate, authorize(VIEW_REFUNDS), feeController.getRefundById);

// --- Fee deductions (must be registered before /:id to avoid param capture) ---
// Same roster as the finance-editing roles elsewhere on this router for create/delete;
// deduction viewing reuses the refund-viewer roster since both are sensitive finance reads.
const MANAGE_DEDUCTIONS = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'BURSAR'];
router.get('/deductions', authenticate, authorize(VIEW_REFUNDS), feeController.listFeeDeductions);
router.delete('/deductions/:deductionId', authenticate, authorize(MANAGE_DEDUCTIONS), feeController.deleteFeeDeduction);

// PUT /fees/payments/:paymentId - Edit a payment record
// SUPER_MANAGER/MANAGER/PRINCIPAL can edit anytime; BURSAR restricted to 2 days after creation
// Registered before /:id so the literal "payments" segment isn't captured as :id
router.put('/payments/:paymentId', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'BURSAR']), feeController.updatePayment);

// GET /fees/outstanding-summary - Shared outstanding totals + reconciliation line (same rule as every finance screen)
router.get('/outstanding-summary', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'BURSAR', 'SECRETARY', 'FEE_AUDITOR']), feeController.getOutstandingSummary);

// GET /fees/payment-methods - Accepted payment methods with display labels (for dropdowns)
router.get('/payment-methods', authenticate, feeController.getPaymentMethods);

// GET /fees/payments/:paymentId/receipt[/pdf] - Receipt data / printable PDF (reprints from history)
const RECEIPT_ROLES = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'BURSAR', 'SECRETARY', 'FEE_AUDITOR'];
router.get('/payments/:paymentId/receipt', authenticate, authorize(RECEIPT_ROLES), feeController.getPaymentReceipt);
router.get('/payments/:paymentId/receipt/pdf', authenticate, authorize(RECEIPT_ROLES), feeController.getPaymentReceiptPdf);

// GET /fees/:id - Get a specific fee by ID
router.get('/:id', authenticate, feeController.getFeeById);

// Fee rows are only ever created via the enrollment flow (ensureSchoolFeeForEnrollment /
// createOrUpdateFeeForEnrollment) and amount_paid only ever moves through the payment
// ledger (POST /fees/:feeId/payments). A direct "create/edit a fee record with an
// arbitrary amount_paid" endpoint used to exist here (POST / and PUT /:id) but let a
// caller silently desync amount_paid from the actual PaymentTransaction history --
// removed rather than left as a bypass. amount_expected corrections go through
// POST /fees/:id/deduction instead.

// DELETE /fees/:id - Delete a fee record
// Only SUPER_MANAGER, PRINCIPAL, BURSAR can delete fee records
router.delete('/:id', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'BURSAR']), feeController.deleteFee);

// POST /fees/:id/deduction - Reduce amount_expected for a student (personnel-child or reasoned reduction)
router.post('/:id/deduction', authenticate, authorize(MANAGE_DEDUCTIONS), feeController.applyFeeDeduction);

// GET /fees/student/:studentId - Get all fees for a specific student
router.get('/student/:studentId', authenticate, feeController.getStudentFees);

// GET /fees/student/:studentId/status - Quick fee-paid status for report-card preflight
router.get('/student/:studentId/status', authenticate, feeController.getStudentFeesStatus);

// GET /fees/student/:studentId/payment-audit-log - Edit history of this student's
// payment records (who changed what, when) -- backs the Payment Records tab's
// per-student panel.
router.get('/student/:studentId/payment-audit-log', authenticate, authorize(VIEW_REFUNDS), feeController.getStudentPaymentAuditLog);

// GET /fees/sub_class/:sub_classId/summary - Get fee summary for a sub_class
router.get('/sub_class/:id/summary', authenticate, feeController.getSubclassFeesSummary);

// GET /fees/subclass/:id/summary - Alias for subclass fees summary (for backward compatibility)
router.get('/subclass/:id/summary', authenticate, feeController.getSubclassFeesSummary);

// GET /fees/subclass/:subClassId/status - Per-student fee-paid status for a whole subclass (preflight for subclass report download)
router.get('/subclass/:subClassId/status', authenticate, feeController.getSubclassUnpaidStudents);

// GET /fees/:feeId/payments - List all payments for a fee
router.get('/:feeId/payments', authenticate, feeController.getFeePayments);

// POST /fees/:feeId/payments - Record a payment for a specific fee (direct/legacy).
// Preferred flow: Parent (or Bursar+) submits a PAYMENT_CLAIM FinanceRequest at
// POST /finance-requests → Bursar validates via /finance-requests/:id/approve →
// a PaymentTransaction is created automatically. This endpoint remains for
// walk-in cash payments that the Bursar records directly at the desk.
router.post('/:feeId/payments', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'BURSAR']), feeController.recordPayment);

// PUT /fees/:feeId/payments/:paymentId - Edit a payment (nested form used by the fee-management UI).
// Same rules as PUT /fees/payments/:paymentId; additionally checks the payment belongs to :feeId.
router.put('/:feeId/payments/:paymentId', authenticate, authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'BURSAR']), feeController.updatePayment);

export default router;
