import { Router } from 'express';
import * as ctrl from '../controllers/reportRequestController';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// Coarse route allow-lists. Fine-grained "requester must outrank recipient"
// is enforced by outranks() inside reportRequestService.createReportRequest().
const REQUESTERS = [
    'SUPER_MANAGER', 'MANAGER', 'PRINCIPAL',
    'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY',
    'DEAN_OF_STUDIES', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR', 'SENIOR_DISCIPLINE_MASTER', 'HOD',
];
const RECIPIENTS = [
    'VICE_PRINCIPAL', 'BURSAR', 'SECRETARY',
    'DEAN_OF_STUDIES', 'DEAN_OF_DISCIPLINE', 'DISCIPLINE_COORDINATOR', 'SENIOR_DISCIPLINE_MASTER', 'HOD',
    'TEACHER', 'DISCIPLINE_MASTER', 'NURSE', 'FEE_AUDITOR', 'CONTROLLER', 'GUIDANCE_COUNSELOR',
];
const ALL_PARTIES = [...new Set([...REQUESTERS, ...RECIPIENTS])];

// Dean creates a new request to SDM/DM
router.post('/', authenticate, authorize(REQUESTERS), ctrl.createReportRequest);

// Convenience listings — service uses req.user.id, so just authenticate
router.get('/sent', authenticate, authorize(REQUESTERS), ctrl.listMyReportRequests);
router.get('/assigned', authenticate, authorize(RECIPIENTS), ctrl.listAssignedReportRequests);

// Generic list (filterable)
router.get('/', authenticate, authorize(ALL_PARTIES), ctrl.listReportRequests);

router.get('/:id', authenticate, authorize(ALL_PARTIES), ctrl.getReportRequestById);

// Recipient submits the requested report
router.post('/:id/submit', authenticate, authorize(RECIPIENTS), ctrl.submitReportRequest);

// Requester marks submission reviewed
router.post('/:id/review', authenticate, authorize(REQUESTERS), ctrl.reviewReportRequest);

// Requester edits (only while PENDING) or cancels
router.put('/:id', authenticate, authorize(REQUESTERS), ctrl.updateReportRequest);
router.post('/:id/cancel', authenticate, authorize(REQUESTERS), ctrl.cancelReportRequest);

export default router;
