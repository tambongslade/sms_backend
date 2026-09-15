// src/api/v1/controllers/parentController.ts
//
// The parent portal is UNAUTHENTICATED. Every endpoint identifies the child
// (and, when needed, the parent) via the matricule in the URL path. Knowing
// the child's matricule is treated as sufficient to view that child's data.
import { Request, Response } from 'express';
import * as parentService from '../services/parentService';
import * as parentDirectoryService from '../services/parentDirectoryService';
import * as chatService from '../services/chatService';
import * as notificationService from '../services/notificationService';
import * as examController from './examController';
import { extractPaginationAndFilters } from '../../../utils/pagination';
import { AuthenticatedRequest } from '../middleware/auth.middleware';

const readMatricule = (req: Request): string => String(req.params.matricule || '').trim();

const readAcademicYearId = (req: Request): number | undefined => {
    const raw = req.finalQuery?.academic_year_id ?? req.query?.academic_year_id;
    return raw ? parseInt(raw as string) : undefined;
};

const sendError = (res: Response, err: any, fallback = 'Internal server error'): void => {
    const status = err?.statusCode || 500;
    res.status(status).json({ success: false, error: err?.message || fallback });
};

/**
 * GET /parents/:matricule/dashboard
 * Single-child dashboard summary for the given matricule.
 */
export const getChildDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const data = await parentService.getChildDashboardByMatricule(matricule, readAcademicYearId(req));
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch dashboard'); }
};

/**
 * GET /parents/:matricule/details
 * Full detailed profile for a child (academic + fees + discipline + reports).
 */
export const getChildDetails = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const data = await parentService.getChildDetailsByMatricule(matricule, readAcademicYearId(req));
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch child details'); }
};

/**
 * GET /parents/:matricule/overview
 * Combined snapshot: profile + enrollment + academic + discipline + health.
 */
export const getChildOverview = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const data = await parentService.getChildOverviewByMatricule(matricule, readAcademicYearId(req));
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch child overview'); }
};

/**
 * GET /parents/:matricule/quiz-results
 */
export const getChildQuizResults = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const data = await parentService.getChildQuizResultsByMatricule(matricule, readAcademicYearId(req));
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch quiz results'); }
};

/**
 * GET /parents/:matricule/analytics
 */
export const getChildAnalytics = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const data = await parentService.getChildAnalyticsByMatricule(matricule, readAcademicYearId(req));
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch analytics'); }
};

/**
 * GET /parents/:matricule/report-cards
 * List available generated report cards for the child.
 */
export const listChildReportCards = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const data = await parentService.listChildReportCardsByMatricule(matricule, readAcademicYearId(req));
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch report cards'); }
};

/**
 * GET /parents/:matricule/report-card?academicYearId&examSequenceId
 * Download a report card PDF for the child.
 */
export const downloadChildReportCard = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const student = await parentService.resolveStudentByMatricule(matricule);
        // examController.generateStudentReportCard reads req.params.studentId
        // and finalQuery.{academic_year_id, exam_sequence_id} and streams the PDF.
        req.params.studentId = String(student.id);
        return examController.generateStudentReportCard(req, res);
    } catch (err) { sendError(res, err, 'Failed to download report card'); }
};

/**
 * GET /parents/:matricule/report-card/availability
 */
export const checkChildReportCardAvailability = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }

        const academicYearId = parseInt(
            (req.finalQuery?.academicYearId ?? req.finalQuery?.academic_year_id) as string
        );
        const examSequenceId = parseInt(
            (req.finalQuery?.examSequenceId ?? req.finalQuery?.exam_sequence_id) as string
        );

        if (isNaN(academicYearId) || isNaN(examSequenceId)) {
            res.status(400).json({
                success: false,
                error: 'Valid academicYearId and examSequenceId query params are required'
            });
            return;
        }

        const student = await parentService.resolveStudentByMatricule(matricule);
        const examService = await import('../services/examService');
        const result = await examService.checkStudentReportCardAvailability(
            student.id,
            academicYearId,
            examSequenceId
        );
        res.json({ success: true, data: result });
    } catch (err) { sendError(res, err, 'Failed to check report card availability'); }
};

/**
 * GET /parents/:matricule/contacts
 * Curated staff directory for the child's linked parent.
 */
export const getContacts = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const parentId = await parentService.resolveLinkedParentIdByMatricule(matricule);
        const data = await parentDirectoryService.getParentContacts(parentId);
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch contacts'); }
};

/**
 * POST /parents/:matricule/message-staff
 * Body: { recipientId, subject, message, priority? }
 */
export const sendMessageToStaff = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }

        const { recipient_id, subject, message, priority } = req.body;
        if (!recipient_id || !subject || !message) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields: recipientId, subject and message are required'
            });
            return;
        }

        const parsedRecipientId = parseInt(recipient_id);
        if (isNaN(parsedRecipientId)) {
            res.status(400).json({ success: false, error: 'Invalid recipientId' });
            return;
        }

        if (priority && !['LOW', 'MEDIUM', 'HIGH'].includes(priority)) {
            res.status(400).json({ success: false, error: 'Invalid priority. Must be LOW, MEDIUM, or HIGH' });
            return;
        }

        const created = await parentService.sendMessageToStaffFromMatricule(matricule, {
            recipient_id: parsedRecipientId,
            subject,
            message,
            priority
        });

        res.status(201).json({
            success: true,
            data: { message: 'Message sent successfully', notification: created }
        });
    } catch (err) { sendError(res, err, 'Failed to send message'); }
};

/**
 * GET /parents/:matricule/inbox?page&limit&unreadOnly
 * Paginated list of messages the linked parent has RECEIVED (newest first).
 */
export const getParentInbox = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }

        const page = req.query.page ? parseInt(req.query.page as string) : 1;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
        const unreadOnly = req.query.unreadOnly === 'true' || req.query.unread_only === 'true';

        const result = await parentService.getParentInboxByMatricule(matricule, { page, limit, unreadOnly });
        res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { sendError(res, err, 'Failed to fetch inbox'); }
};

/**
 * POST /parents/:matricule/messages/:messageId/reply
 * Body: { message: string }
 * Creates a threaded reply on the parent's side of an existing conversation.
 */
export const replyToParentMessage = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }

        const messageId = Number(req.params.messageId);
        if (Number.isNaN(messageId)) {
            res.status(400).json({ success: false, error: 'Invalid messageId' });
            return;
        }

        const body = String(req.body?.message ?? '').trim();
        if (!body) {
            res.status(400).json({ success: false, error: 'message is required' });
            return;
        }

        const created = await parentService.replyToMessageAsParent(matricule, messageId, body);
        res.status(201).json({ success: true, data: created });
    } catch (err) { sendError(res, err, 'Failed to send reply'); }
};

/**
 * PUT /parents/:matricule/messages/:messageId/read
 * Sets read_at = now(). Parent must be the receiver.
 */
export const markParentMessageRead = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }

        const messageId = Number(req.params.messageId);
        if (Number.isNaN(messageId)) {
            res.status(400).json({ success: false, error: 'Invalid messageId' });
            return;
        }

        const updated = await parentService.markParentMessageAsRead(matricule, messageId);
        res.json({ success: true, data: updated });
    } catch (err) { sendError(res, err, 'Failed to mark message as read'); }
};

/**
 * GET /parents/:matricule/messages/:messageId/thread
 * Returns the target message, its ancestor chain, and its direct replies.
 */
export const getParentMessageThread = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }

        const messageId = Number(req.params.messageId);
        if (Number.isNaN(messageId)) {
            res.status(400).json({ success: false, error: 'Invalid messageId' });
            return;
        }

        const data = await parentService.getParentMessageThread(matricule, messageId);
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch thread'); }
};

/**
 * POST /parents/:matricule/contact/:userId
 * Open (or reuse) a DM channel between the child's linked parent and a staff user.
 */
export const openStaffDirectMessage = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }

        const staffId = Number(req.params.userId);
        if (Number.isNaN(staffId)) {
            res.status(400).json({ success: false, error: 'Invalid userId' });
            return;
        }

        const parentId = await parentService.resolveLinkedParentIdByMatricule(matricule);
        const channel = await chatService.openDirectMessage(parentId, [staffId]);
        res.status(200).json({ success: true, data: channel });
    } catch (err) { sendError(res, err, 'Failed to open direct message'); }
};

/**
 * GET /parents/:matricule/notifications
 * Paginated list of notifications for the linked parent user.
 * Supports the same query params as GET /notifications/me:
 *   page, limit, sortBy, sortOrder, status, category, entity_type, unreadOnly.
 */
export const getParentNotifications = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const parentId = await parentService.resolveLinkedParentIdByMatricule(matricule);

        const { paginationOptions, filterOptions } = extractPaginationAndFilters(
            req.query,
            ['status', 'category', 'entity_type']
        );
        const unreadOnly = req.query.unreadOnly === 'true' || req.query.unread_only === 'true';

        const result = await notificationService.getUserNotifications(parentId, paginationOptions, {
            ...filterOptions,
            unread_only: unreadOnly,
        });
        res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { sendError(res, err, 'Failed to fetch notifications'); }
};

/**
 * GET /parents/:matricule/notifications/unread-count
 */
export const getParentUnreadNotificationCount = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const parentId = await parentService.resolveLinkedParentIdByMatricule(matricule);
        const count = await notificationService.getUnreadNotificationCount(parentId);
        res.json({ success: true, data: { unread_count: count } });
    } catch (err) { sendError(res, err, 'Failed to fetch unread count'); }
};

/**
 * GET /parents/:matricule/notifications/unread-breakdown
 * Grouped unread counts per category — for section badges in the parent app.
 */
export const getParentUnreadBreakdown = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const parentId = await parentService.resolveLinkedParentIdByMatricule(matricule);
        const data = await notificationService.getUnreadBreakdown(parentId);
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch unread breakdown'); }
};

/**
 * PUT /parents/:matricule/notifications/mark-all-read
 */
export const markAllParentNotificationsAsRead = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const parentId = await parentService.resolveLinkedParentIdByMatricule(matricule);
        const result = await notificationService.markAllNotificationsAsRead(parentId);
        res.status(200).json({
            success: true,
            data: { markedCount: result.count, message: 'All notifications marked as read' },
        });
    } catch (err) { sendError(res, err, 'Failed to mark notifications as read'); }
};

/**
 * PUT /parents/:matricule/notifications/:id/read
 * Service-level ownership check ensures the id belongs to the linked parent.
 */
export const markParentNotificationAsRead = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const notificationId = parseInt(req.params.id);
        if (isNaN(notificationId)) {
            res.status(400).json({ success: false, error: 'Invalid notification ID' });
            return;
        }
        const parentId = await parentService.resolveLinkedParentIdByMatricule(matricule);
        const notification = await notificationService.markNotificationAsRead(notificationId, parentId);
        res.json({ success: true, data: notification, message: 'Notification marked as read' });
    } catch (err: any) {
        const msg = err?.message || 'Failed to mark notification as read';
        const status = err?.statusCode || (/forbidden/i.test(msg) ? 403 : /not found/i.test(msg) ? 404 : 500);
        res.status(status).json({ success: false, error: msg });
    }
};

/**
 * DELETE /parents/:matricule/notifications/:id
 */
export const deleteParentNotification = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const notificationId = parseInt(req.params.id);
        if (isNaN(notificationId)) {
            res.status(400).json({ success: false, error: 'Invalid notification ID' });
            return;
        }
        const parentId = await parentService.resolveLinkedParentIdByMatricule(matricule);
        const result = await notificationService.deleteNotificationForUser(notificationId, parentId);
        if (!result.success) {
            const statusCode = result.statusCode || 404;
            res.status(statusCode).json(result);
            return;
        }
        res.status(200).json(result);
    } catch (err) { sendError(res, err, 'Failed to delete notification'); }
};

/**
 * GET /parents/:matricule/warnings
 */
export const getChildWarnings = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const data = await parentService.getChildWarningsByMatricule(matricule, readAcademicYearId(req));
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch warnings'); }
};

/**
 * GET /parents/:matricule/summons
 */
export const getChildSummons = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const data = await parentService.getChildSummonsByMatricule(matricule, readAcademicYearId(req));
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch summons'); }
};

/**
 * GET /parents/:matricule/disciplinary-actions
 */
export const getChildDisciplinaryActions = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const data = await parentService.getChildDisciplinaryActionsByMatricule(matricule, readAcademicYearId(req));
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch disciplinary actions'); }
};

/**
 * GET /parents/:matricule/saturday-punishments
 */
export const getChildSaturdayPunishments = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const data = await parentService.getChildSaturdayPunishmentsByMatricule(matricule, readAcademicYearId(req));
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch saturday punishments'); }
};

/**
 * GET /parents/:matricule/health-visits?page&limit
 * Paginated nurse visit log for the child.
 */
export const getChildHealthVisits = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const page = req.query.page ? parseInt(String(req.query.page)) : 1;
        const limit = req.query.limit ? parseInt(String(req.query.limit)) : 20;
        const data = await parentService.getChildNurseVisitsByMatricule(matricule, {
            page,
            limit,
            academicYearId: readAcademicYearId(req),
        });
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch health visits'); }
};

/**
 * GET /parents/:matricule/timetable
 * Weekly class schedule for the child.
 */
export const getChildTimetable = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const data = await parentService.getChildTimetableByMatricule(matricule, readAcademicYearId(req));
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch timetable'); }
};

/**
 * GET /parents/me/children  (AUTHENTICATED)
 * List all children linked to the currently-authenticated parent, with a
 * family-level summary of fees/attendance/discipline. Requires JWT + PARENT role.
 */
export const getMyChildren = async (req: Request, res: Response): Promise<void> => {
    try {
        const authReq = req as AuthenticatedRequest;
        const parentId = authReq.user?.id;
        if (!parentId) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
            return;
        }
        const data = await parentService.getLinkedChildrenForParent(parentId, readAcademicYearId(req));
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch children'); }
};

/**
 * GET /parents/:matricule/profile
 * Aggregate profile: the linked parent's contact block + the child's
 * demographic block. Feeds the mobile app's single profile screen with
 * two editable panels.
 */
export const getSelfServiceProfile = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }
        const data = await parentService.getParentAndChildProfileFromMatricule(matricule);
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to fetch profile'); }
};

/**
 * PUT /parents/:matricule/parent-profile
 * Body: { phone?, whatsappNumber?, address? }
 * Updates the first-linked parent's contact info. Email is intentionally
 * excluded — it is still the login identifier.
 */
export const updateParentProfile = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }

        const { phone, whatsapp_number, address } = req.body ?? {};
        const patch: parentService.ParentContactPatch = {};
        if (phone !== undefined) patch.phone = phone;
        if (whatsapp_number !== undefined) patch.whatsapp_number = whatsapp_number;
        if (address !== undefined) patch.address = address;

        const data = await parentService.updateParentContactFromMatricule(matricule, patch);
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to update parent profile'); }
};

/**
 * PUT /parents/:matricule/child-profile
 * Body: { residence?, healthConditions?, medicalNotes? }
 * Updates a small demographic slice of the child's record.
 */
export const updateChildProfile = async (req: Request, res: Response): Promise<void> => {
    try {
        const matricule = readMatricule(req);
        if (!matricule) { res.status(400).json({ success: false, error: 'Matricule is required' }); return; }

        const { residence, health_conditions, medical_notes } = req.body ?? {};
        const patch: parentService.ChildProfilePatch = {};
        if (residence !== undefined) patch.residence = residence;
        if (health_conditions !== undefined) patch.health_conditions = health_conditions;
        if (medical_notes !== undefined) patch.medical_notes = medical_notes;

        const data = await parentService.updateChildProfileFromMatricule(matricule, patch);
        res.json({ success: true, data });
    } catch (err) { sendError(res, err, 'Failed to update child profile'); }
};

/**
 * GET /parents/announcements
 * School-wide announcements aimed at parents. Requires no matricule.
 */
export const getSchoolAnnouncements = async (req: Request, res: Response): Promise<void> => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
        if (limit < 1 || limit > 50) {
            res.status(400).json({ success: false, error: 'Limit must be between 1 and 50' });
            return;
        }

        const prisma = (await import('../../../config/db')).default;
        const announcements = await prisma.announcement.findMany({
            where: { audience: { in: ['BOTH', 'EXTERNAL'] } },
            orderBy: { created_at: 'desc' },
            take: limit,
            include: { created_by: { select: { name: true, matricule: true } } }
        });

        res.json({
            success: true,
            data: announcements.map(a => ({
                id: a.id,
                title: a.title,
                content: a.message,
                author: a.created_by?.name || 'Anonymous',
                created_at: a.created_at
            }))
        });
    } catch (err) { sendError(res, err, 'Failed to fetch announcements'); }
};
