// src/api/v1/routes/notificationRoutes.ts
import express from 'express';
import {
    sendNotification,
    sendBulkNotifications,
    getUserNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    getUnreadNotificationCount,
    getUnreadBreakdown,
    deleteNotification,
    getPushStatus,
    sendTestPush,
    getPendingTasksSummary,
} from '../controllers/notificationController';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = express.Router();

// Get user's own notifications (paginated)
router.get('/me',
    authenticate,
    getUserNotifications
);

// Get user's unread notification count
router.get('/me/unread-count',
    authenticate,
    getUnreadNotificationCount
);

// Grouped unread breakdown by category (badges per section)
router.get('/me/unread-breakdown',
    authenticate,
    getUnreadBreakdown
);

// Actionable pending-tasks summary for the login pop-up.
// Aggregates counts across disciplinary approvals, custody transfers, and finance requests
// that specifically require this user's action.
router.get('/me/pending-tasks',
    authenticate,
    getPendingTasksSummary
);

// Mark all of a user's notifications as read
router.put('/mark-all-read',
    authenticate,
    markAllNotificationsAsRead
);

// Mark a single notification as read
router.put('/:id/read',
    authenticate,
    markNotificationAsRead
);

// Delete a single notification
router.delete('/:id',
    authenticate,
    deleteNotification
);

// The following routes are for admin/system use and can be kept for future internal tools

// Send a single notification (for specific admin tasks)
router.post('/send',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL']),
    sendNotification
);

// Send bulk notifications (for announcements or system-wide alerts)
router.post('/send-bulk',
    authenticate,
    authorize(['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL']),
    sendBulkNotifications
);

// Diagnostics: verify OneSignal credentials (SUPER_MANAGER only)
router.get('/push-status',
    authenticate,
    authorize(['SUPER_MANAGER']),
    getPushStatus
);

// Send a test push (SUPER_MANAGER only). Body: { userId?, title?, message?, deliverInApp? }
router.post('/test-push',
    authenticate,
    authorize(['SUPER_MANAGER']),
    sendTestPush
);

export default router;