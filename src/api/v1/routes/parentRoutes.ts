// src/api/v1/routes/parentRoutes.ts
//
// PARENT PORTAL — all `/:matricule/*` endpoints are UNAUTHENTICATED. Access
// is gated only by knowledge of the child's matricule (path param). Do NOT
// add authenticate / authorize middleware to portal routes.
//
// The `/me/*` sub-tree requires JWT auth and is scoped to the authenticated
// parent (multi-child support).
import express from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { portalRateLimit } from '../middleware/portalRateLimit.middleware';
import { portalAudit } from '../middleware/portalAudit.middleware';
import {
    getChildDashboard,
    getChildDetails,
    getChildOverview,
    getChildQuizResults,
    getChildAnalytics,
    listChildReportCards,
    downloadChildReportCard,
    checkChildReportCardAvailability,
    getContacts,
    sendMessageToStaff,
    getParentInbox,
    replyToParentMessage,
    markParentMessageRead,
    getParentMessageThread,
    openStaffDirectMessage,
    getSchoolAnnouncements,
    getParentNotifications,
    getParentUnreadNotificationCount,
    getParentUnreadBreakdown,
    markAllParentNotificationsAsRead,
    markParentNotificationAsRead,
    deleteParentNotification,
    getChildWarnings,
    getChildSummons,
    getChildDisciplinaryActions,
    getChildSaturdayPunishments,
    getChildHealthVisits,
    getChildTimetable,
    getMyChildren,
    getSelfServiceProfile,
    updateParentProfile,
    updateChildProfile
} from '../controllers/parentController';

const router = express.Router();

// Portal hardening — MUST come before any route handlers so blocked requests
// short-circuit before authentication, business logic, or audit-trail writes.
// Rate limiter (60 req/min per IP) runs first, then the fire-and-forget audit
// logger records the request. See middleware files for rationale.
router.use(portalRateLimit);
router.use(portalAudit);

// School-wide announcements (no matricule needed).
router.get('/announcements', getSchoolAnnouncements);

// AUTHENTICATED parent endpoints (/parents/me/*). Order matters — must be
// declared before the `/:matricule/*` catch-alls so Express doesn't route
// "me" as a matricule.
router.get('/me/children', authenticate, authorize(['PARENT']), getMyChildren);

// Child dashboard / details / overview by matricule.
router.get('/:matricule/dashboard', getChildDashboard);
router.get('/:matricule/details', getChildDetails);
router.get('/:matricule/overview', getChildOverview);

// Academic data.
router.get('/:matricule/quiz-results', getChildQuizResults);
router.get('/:matricule/analytics', getChildAnalytics);

// Timetable (weekly class schedule).
router.get('/:matricule/timetable', getChildTimetable);

// Discipline detail (warnings, summons, actions, saturday punishments).
router.get('/:matricule/warnings', getChildWarnings);
router.get('/:matricule/summons', getChildSummons);
router.get('/:matricule/disciplinary-actions', getChildDisciplinaryActions);
router.get('/:matricule/saturday-punishments', getChildSaturdayPunishments);

// Health / nurse visit log (paginated).
router.get('/:matricule/health-visits', getChildHealthVisits);

// Report cards.
router.get('/:matricule/report-cards', listChildReportCards);
router.get('/:matricule/report-card/availability', checkChildReportCardAvailability);
router.get('/:matricule/report-card', downloadChildReportCard);

// Messaging / directory (sender identity is resolved from ParentStudent link).
router.get('/:matricule/contacts', getContacts);
router.post('/:matricule/message-staff', sendMessageToStaff);
router.post('/:matricule/contact/:userId', openStaffDirectMessage);

// Parent inbox — messages the linked parent has received, plus threaded
// replies and read receipts. See parentService.ts for authorization notes.
router.get('/:matricule/inbox', getParentInbox);
router.get('/:matricule/messages/:messageId/thread', getParentMessageThread);
router.post('/:matricule/messages/:messageId/reply', replyToParentMessage);
router.put('/:matricule/messages/:messageId/read', markParentMessageRead);

// Self-service profile (parent contact info + child demographic bits).
// Aggregate GET feeds the mobile app's single profile screen with two panels;
// each PUT edits one panel independently. Email is intentionally excluded
// from the parent-side PUT because it is still the login identifier.
router.get('/:matricule/profile', getSelfServiceProfile);
router.put('/:matricule/parent-profile', updateParentProfile);
router.put('/:matricule/child-profile', updateChildProfile);

// Notifications — mirrors /notifications/* but gated by matricule instead of JWT.
// Parent identity is resolved via ParentStudent link on the matricule's student.
router.get('/:matricule/notifications', getParentNotifications);
router.get('/:matricule/notifications/unread-count', getParentUnreadNotificationCount);
router.get('/:matricule/notifications/unread-breakdown', getParentUnreadBreakdown);
router.put('/:matricule/notifications/mark-all-read', markAllParentNotificationsAsRead);
router.put('/:matricule/notifications/:id/read', markParentNotificationAsRead);
router.delete('/:matricule/notifications/:id', deleteParentNotification);

export default router;
