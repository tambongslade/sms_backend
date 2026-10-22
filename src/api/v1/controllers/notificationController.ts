// src/api/v1/controllers/notificationController.ts

import { Request, Response } from 'express';
import * as notificationService from '../services/notificationService';
import { sendPushToUser } from '../services/pushService';
import { pingOneSignal, isOneSignalConfigured } from '../../../config/onesignal';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { extractPaginationAndFilters } from '../../../utils/pagination';
import { NotificationPriority } from '../../../config/db';
import prisma from '../../../config/db';

const VALID_PRIORITIES: NotificationPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/** Case-insensitive parse; returns undefined for empty/missing, null for invalid. */
function normalizePriority(input: any): NotificationPriority | undefined {
    if (input === undefined || input === null || input === '') return undefined;
    const upper = String(input).toUpperCase();
    return (VALID_PRIORITIES as string[]).includes(upper) ? (upper as NotificationPriority) : undefined;
}

/**
 * Send a single notification.
 * Accepts optional workflow metadata: category, entityType, entityId, actionUrl.
 * The case-conversion middleware converts request keys camelCase → snake_case, but
 * we also read the snake_case fallbacks in case a caller sends either form.
 */
export const sendNotification = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const {
            title,
            message,
            recipient_id,
            category,
            priority,
            entity_type,
            entity_id,
            action_url,
        } = req.body ?? {};

        if (!message || !recipient_id) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields: message and recipientId are required',
            });
            return;
        }

        const normalizedPriority = normalizePriority(priority);
        if (priority && !normalizedPriority) {
            res.status(400).json({
                success: false,
                error: 'Invalid priority. Allowed: LOW, NORMAL, HIGH, URGENT',
            });
            return;
        }

        const notification = await notificationService.sendNotification({
            user_id: parseInt(recipient_id),
            title,
            message,
            sender_id: authReq.user?.id,
            category,
            priority: normalizedPriority,
            entity_type,
            entity_id: entity_id ? parseInt(entity_id) : undefined,
            action_url,
        });

        res.status(201).json({ success: true, data: notification });
    } catch (error: any) {
        console.error('Error sending notification:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const sendBulkNotifications = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const {
            title,
            message,
            recipient_ids,
            category,
            priority,
            entity_type,
            entity_id,
            action_url,
        } = req.body ?? {};

        if (!title || !message || !recipient_ids || !Array.isArray(recipient_ids)) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields: title, message, and recipientIds (array) are required',
            });
            return;
        }

        const normalizedPriority = normalizePriority(priority);
        if (priority && !normalizedPriority) {
            res.status(400).json({
                success: false,
                error: 'Invalid priority. Allowed: LOW, NORMAL, HIGH, URGENT',
            });
            return;
        }

        await notificationService.sendBulkNotifications({
            title,
            message,
            recipient_ids: recipient_ids.map((id: any) => parseInt(id)),
            sender_id: authReq.user?.id,
            category,
            priority: normalizedPriority,
            entity_type,
            entity_id: entity_id ? parseInt(entity_id) : undefined,
            action_url,
        });

        res.status(201).json({
            success: true,
            data: { message: `Bulk notifications sent to ${recipient_ids.length} users.` },
        });
    } catch (error: any) {
        console.error('Error sending bulk notifications:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getUserNotifications = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.id;
        if (!userId) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }

        const { paginationOptions, filterOptions } = extractPaginationAndFilters(
            req.query,
            ['status', 'category', 'priority', 'entity_type']
        );

        const unreadOnly = req.query.unreadOnly === 'true' || req.query.unread_only === 'true';

        const result = await notificationService.getUserNotifications(userId, paginationOptions, {
            ...filterOptions,
            unread_only: unreadOnly,
        });

        res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
        console.error('Error fetching user notifications:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const markNotificationAsRead = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.id;
        if (!userId) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }

        const notificationId = parseInt(req.params.id);
        if (isNaN(notificationId)) {
            res.status(400).json({ success: false, error: 'Invalid notification ID' });
            return;
        }

        const notification = await notificationService.markNotificationAsRead(notificationId, userId);
        res.json({ success: true, data: notification, message: 'Notification marked as read' });
    } catch (error: any) {
        const msg = error.message || 'Failed to mark notification as read';
        const status = /forbidden/i.test(msg) ? 403 : /not found/i.test(msg) ? 404 : 500;
        console.error('Error marking notification as read:', error);
        res.status(status).json({ success: false, error: msg });
    }
};

export const getUnreadNotificationCount = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.id;
        if (!userId) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }
        const count = await notificationService.getUnreadNotificationCount(userId);
        res.json({ success: true, data: { unread_count: count } });
    } catch (error: any) {
        console.error('Error fetching unread notification count:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Grouped breakdown per category — useful for role-specific inbox badges
 * (e.g. Approvals: 3, Tasks: 2, Salary: 1).
 */
export const getUnreadBreakdown = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.id;
        if (!userId) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }
        const data = await notificationService.getUnreadBreakdown(userId);
        res.json({ success: true, data });
    } catch (error: any) {
        console.error('Error fetching unread breakdown:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const markAllNotificationsAsRead = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.id;
        if (!userId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }
        const result = await notificationService.markAllNotificationsAsRead(userId);
        res.status(200).json({
            success: true,
            data: { markedCount: result.count, message: 'All notifications marked as read' },
        });
    } catch (error: any) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Diagnostic: verify OneSignal credentials are wired up (SUPER_MANAGER only).
 * GET /api/v1/notifications/push-status
 */
export const getPushStatus = async (_req: Request, res: Response): Promise<void> => {
    try {
        if (!isOneSignalConfigured()) {
            res.status(200).json({
                success: true,
                data: { configured: false, message: 'OneSignal env vars not set' },
            });
            return;
        }
        const ping = await pingOneSignal();
        res.status(ping.ok ? 200 : 502).json({
            success: ping.ok,
            data: { configured: true, ...ping },
        });
    } catch (error: any) {
        console.error('Error checking push status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Send a test push to a specific user (or the caller, if userId omitted).
 * Also creates the matching in-app notification so both channels are exercised.
 * POST /api/v1/notifications/test-push  { userId?, title?, message? }
 */
export const sendTestPush = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const callerId = authReq.user?.id;
        if (!callerId) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }
        const { user_id, title, message, deliver_in_app, priority } = req.body ?? {};
        const targetId = user_id ? parseInt(user_id) : callerId;
        if (isNaN(targetId)) {
            res.status(400).json({ success: false, error: 'Invalid userId' });
            return;
        }
        const normalizedPriority = normalizePriority(priority);
        if (priority && !normalizedPriority) {
            res.status(400).json({
                success: false,
                error: 'Invalid priority. Allowed: LOW, NORMAL, HIGH, URGENT',
            });
            return;
        }
        const pushTitle = (title || 'Test notification').toString();
        const pushBody = (message || 'This is a test push from the backend.').toString();
        const highPriority = normalizedPriority === 'HIGH' || normalizedPriority === 'URGENT';

        // Optionally also create the in-app row (default true).
        if (deliver_in_app !== false) {
            const notif = await notificationService.sendNotification({
                user_id: targetId,
                sender_id: callerId,
                title: pushTitle,
                message: pushBody,
                category: 'GENERAL',
                priority: normalizedPriority,
            });
            // sendNotification already fires the push — return that result.
            res.status(200).json({
                success: true,
                data: {
                    notificationId: notif.id,
                    priority: notif.priority,
                    popup: highPriority,
                    pushDelivered: 'via_notification_service',
                    recipient: targetId,
                },
            });
            return;
        }

        // Push only, no DB row.
        const result = await sendPushToUser(targetId, {
            title: pushTitle,
            body: pushBody,
            data: highPriority ? { priority: normalizedPriority, popup: true } : undefined,
            highPriority,
        });
        res.status(result.sent ? 200 : 502).json({
            success: result.sent,
            data: { recipient: targetId, priority: normalizedPriority ?? 'NORMAL', popup: highPriority, ...result },
        });
    } catch (error: any) {
        console.error('Error sending test push:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const deleteNotification = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.id;
        const notificationId = parseInt(req.params.id);

        if (!userId) {
            res.status(401).json({ success: false, error: 'User not authenticated' });
            return;
        }
        if (isNaN(notificationId)) {
            res.status(400).json({ success: false, error: 'Invalid notification ID' });
            return;
        }

        const result = await notificationService.deleteNotificationForUser(notificationId, userId);
        if (!result.success) {
            const statusCode = result.statusCode || 404;
            res.status(statusCode).json(result);
            return;
        }
        res.status(200).json(result);
    } catch (error: any) {
        console.error(`Error in deleteNotification controller: ${error.message}`);
        res.status(500).json({
            success: false,
            error: 'An internal error occurred while deleting the notification.',
        });
    }
};

/**
 * GET /notifications/me/pending-tasks
 * Aggregates actionable items awaiting the current user's decision:
 *   - disciplinary approvals routed to this user
 *   - custody transfers where this user is the recipient (status = PENDING)
 *   - finance requests where this user must act (PERSONNEL_DISBURSEMENT to them,
 *     or PENDING items in categories they can approve based on their role)
 *
 * Response shape (camelCase after middleware):
 *   {
 *     total: number,
 *     disciplinaryApprovals: { count, items: [{ id, actionType, studentName }] },
 *     custodyTransfers:     { count, items: [{ id, seizedItemId, itemDescription, fromUserName }] },
 *     financeRequests:      { count, items: [{ id, type, amount, reason }] }
 *   }
 */
export const getPendingTasksSummary = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        if (!req.user?.id) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }
        const userId = req.user.id;
        const roles = req.user.roles ?? [];

        // Disciplinary approvals routed to this user (pending only)
        const disciplinaryApprovalsPromise = prisma.disciplinaryAction.findMany({
            where: {
                approval_status: 'PENDING_APPROVAL',
                approver_id: userId,
            },
            select: {
                id: true,
                action_type: true,
                enrollment: { select: { student: { select: { name: true } } } },
            },
            orderBy: { created_at: 'desc' },
            take: 10,
        });

        // Custody transfers where user is the recipient (pending)
        const custodyTransfersPromise = prisma.seizedItemTransfer.findMany({
            where: {
                status: 'PENDING',
                to_user_id: userId,
            },
            select: {
                id: true,
                seized_item_id: true,
                seized_item: { select: { item_description: true } },
                from_user: { select: { id: true, name: true } },
            },
            orderBy: { initiated_at: 'desc' },
            take: 10,
        });

        // Finance requests: personnel disbursements addressed to this user +
        // pending requests requiring their approval based on role.
        const canApproveFinance = roles.some((r) => ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'BURSAR'].includes(r));
        const financeRequestsPromise = prisma.financeRequest.findMany({
            where: {
                status: 'PENDING',
                OR: [
                    // PERSONNEL_DISBURSEMENT: recipient user_id lives in the JSON payload as recipient_user_id
                    { type: 'PERSONNEL_DISBURSEMENT', payload: { path: ['recipient_user_id'], equals: userId } },
                    // Approver-role user sees all pending requests that need action
                    ...(canApproveFinance
                        ? [{ type: { in: ['FEE_REDUCTION', 'REFUND', 'PAYMENT_CLAIM', 'BANK_VERIFICATION'] as any } }]
                        : []),
                ],
            },
            select: {
                id: true,
                type: true,
                amount: true,
                reason: true,
            },
            orderBy: { created_at: 'desc' },
            take: 10,
        });

        const [disciplinaryApprovals, custodyTransfers, financeRequests] = await Promise.all([
            disciplinaryApprovalsPromise,
            custodyTransfersPromise,
            financeRequestsPromise,
        ]);

        const disciplinaryItems = disciplinaryApprovals.map((a) => ({
            id: a.id,
            action_type: a.action_type,
            student_name: a.enrollment?.student?.name ?? null,
            action_url: `/dashboard/disciplinary-actions/${a.id}?approve=1`,
        }));
        const custodyItems = custodyTransfers.map((t) => ({
            id: t.id,
            seized_item_id: t.seized_item_id,
            item_description: t.seized_item?.item_description ?? null,
            from_user_name: t.from_user?.name ?? null,
            action_url: `/dashboard/seized-items/${t.seized_item_id}?transfer=${t.id}`,
        }));
        const financeItems = financeRequests.map((f) => ({
            id: f.id,
            type: f.type,
            amount: f.amount,
            reason: f.reason,
            action_url: `/dashboard/finance-requests/${f.id}?act=1`,
        }));

        const total = disciplinaryItems.length + custodyItems.length + financeItems.length;

        res.status(200).json({
            success: true,
            data: {
                total,
                disciplinary_approvals: { count: disciplinaryItems.length, items: disciplinaryItems },
                custody_transfers: { count: custodyItems.length, items: custodyItems },
                finance_requests: { count: financeItems.length, items: financeItems },
            },
        });
    } catch (error: any) {
        console.error(`Error in getPendingTasksSummary: ${error.message}`);
        res.status(500).json({
            success: false,
            error: 'An internal error occurred while fetching pending tasks.',
        });
    }
};
