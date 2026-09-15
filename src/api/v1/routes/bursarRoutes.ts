import { Router } from 'express';
import * as bursarController from '../controllers/bursarController';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// POST /bursar/create-parent-with-student - Create student with automatic parent account creation
// This is the main Bursar function for student registration with parent creation
// BURSAR, SECRETARY, and SUPER_MANAGER can create students with parent accounts
router.post('/create-parent-with-student',
    authenticate,
    authorize(['BURSAR', 'SECRETARY', 'SUPER_MANAGER']),
    bursarController.createStudentWithParent
);

// GET /bursar/available-parents - Get available parents for selection/linking
// BURSAR, SECRETARY, and SUPER_MANAGER can browse/search existing parents
router.get('/available-parents',
    authenticate,
    authorize(['BURSAR', 'SECRETARY', 'SUPER_MANAGER']),
    bursarController.getAvailableParents
);

// POST /bursar/link-existing-parent - Link existing parent to a student
// BURSAR, SECRETARY, and SUPER_MANAGER can link existing parents to students
router.post('/link-existing-parent',
    authenticate,
    authorize(['BURSAR', 'SECRETARY', 'SUPER_MANAGER']),
    bursarController.linkExistingParent
);

// POST /bursar/create-parent-for-student - Create a new parent account and link it to an existing student
// Used by the edit-student flow when a new contact needs to be added after registration.
router.post('/create-parent-for-student',
    authenticate,
    authorize(['BURSAR', 'SECRETARY', 'SUPER_MANAGER']),
    bursarController.createParentForStudent
);

// GET /bursar/dashboard - Get bursar dashboard with financial overview
// BURSAR and management roles can view dashboard
router.get('/dashboard',
    authenticate,
    authorize(['BURSAR', 'SUPER_MANAGER', 'PRINCIPAL', 'MANAGER']),
    bursarController.getBursarDashboard
);

// GET /bursar/collection-analytics - Get collection analytics (monthly trends, payment methods)
// BURSAR and management roles can view collection analytics
router.get('/collection-analytics',
    authenticate,
    authorize(['BURSAR', 'SUPER_MANAGER', 'PRINCIPAL', 'MANAGER']),
    bursarController.getCollectionAnalytics
);

// GET /bursar/payment-trends - Get payment trends analysis
// BURSAR and management roles can view payment trends
router.get('/payment-trends',
    authenticate,
    authorize(['BURSAR', 'SUPER_MANAGER', 'PRINCIPAL', 'MANAGER']),
    bursarController.getPaymentTrends
);

// GET /bursar/defaulters-report - Get defaulters report (students with outstanding balances)
// BURSAR and management roles can view defaulters report
router.get('/defaulters-report',
    authenticate,
    authorize(['BURSAR', 'SUPER_MANAGER', 'PRINCIPAL', 'MANAGER']),
    bursarController.getDefaultersReport
);

// POST /bursar/parents/:parentId/reset-password - Reset a parent's password back to the default
// Used when a parent forgets the password they set after first login.
// BURSAR, PRINCIPAL, VICE_PRINCIPAL, SUPER_MANAGER, MANAGER can perform the reset.
router.post('/parents/:parentId/reset-password',
    authenticate,
    authorize(['BURSAR', 'PRINCIPAL', 'VICE_PRINCIPAL', 'SUPER_MANAGER', 'MANAGER']),
    bursarController.resetParentPassword
);

export default router;