// Enhanced Dashboard Routes for Advanced Role-Specific Features
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import * as enhancedDashboardController from '../controllers/enhancedDashboardController';

const router = Router();

// Super Manager Enhanced Dashboard
router.get('/super-manager/enhanced', 
    authenticate, 
    authorize(['SUPER_MANAGER']), 
    enhancedDashboardController.getEnhancedSuperManagerDashboard
);

// Manager Enhanced Dashboard — reuses the Super Manager analytics but strips
// fee-collection data (schoolFees + schoolOverview.finance).
router.get('/manager/enhanced',
    authenticate,
    authorize(['MANAGER', 'SUPER_MANAGER']),
    enhancedDashboardController.getEnhancedManagerDashboard
);

// Bursar Enhanced Dashboard
router.get('/bursar/enhanced', 
    authenticate, 
    authorize(['BURSAR', 'SUPER_MANAGER', 'MANAGER']), 
    enhancedDashboardController.getEnhancedBursarDashboard
);

// VP Enhanced Dashboard
router.get('/vp/enhanced', 
    authenticate, 
    authorize(['VICE_PRINCIPAL', 'SUPER_MANAGER', 'MANAGER']), 
    enhancedDashboardController.getEnhancedVPDashboard
);

// Teacher Analytics - for Super Manager and Managers
router.get('/teacher-analytics', 
    authenticate, 
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL']), 
    enhancedDashboardController.getTeacherAnalytics
);

// Class Profiles - for Super Manager oversight
router.get('/class-profiles', 
    authenticate, 
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL']), 
    enhancedDashboardController.getClassProfiles
);

// Reports Analytics - for deadline management
router.get('/reports-analytics', 
    authenticate, 
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL']), 
    enhancedDashboardController.getReportsAnalytics
);

// Audit Trail - for tracking modifications
router.get('/audit-trail', 
    authenticate, 
    authorize(['SUPER_MANAGER', 'MANAGER']), 
    enhancedDashboardController.getAuditTrail
);

// Financial Overview - for Super Manager and Bursar
router.get('/financial-overview',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'BURSAR']),
    enhancedDashboardController.getFinancialOverview
);

// Student Registration Analytics - for Bursar
router.get('/student-registration', 
    authenticate, 
    authorize(['BURSAR', 'SUPER_MANAGER', 'MANAGER']), 
    enhancedDashboardController.getStudentRegistrationAnalytics
);

// Interview Management - for VP
router.get('/interview-management', 
    authenticate, 
    authorize(['VICE_PRINCIPAL', 'SUPER_MANAGER', 'MANAGER']), 
    enhancedDashboardController.getInterviewManagement
);

export default router; 