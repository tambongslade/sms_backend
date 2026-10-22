// src/api/v1/routes/logbookRoutes.ts
import { Router } from 'express';
import * as ctrl from '../controllers/logbookController';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

const REVIEWERS = ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_STUDIES', 'HOD'];
const ALL_AUTHORS = [...REVIEWERS, 'TEACHER'];

// GET /logbook — list entries; teachers see their own only, reviewers see all (filterable)
router.get('/', authenticate, authorize(ALL_AUTHORS), ctrl.listEntries);

// POST /logbook — teacher records a lesson taught
router.post('/', authenticate, authorize(ALL_AUTHORS), ctrl.createEntry);

// GET /logbook/coverage/:schemeId — VP/Dean/HOD coverage dashboard for a scheme
router.get('/coverage/:schemeId', authenticate, authorize(REVIEWERS), ctrl.getSchemeCoverage);

// GET /logbook/filter-options — teacher/class/subject options for the review page (HOD: own department). Before /:id.
router.get('/filter-options', authenticate, authorize(REVIEWERS), ctrl.getReviewFilterOptions);

// GET /logbook/:id — entry detail
router.get('/:id', authenticate, authorize(ALL_AUTHORS), ctrl.getEntryById);

// PUT /logbook/:id — author edit (or VP/Dean/Principal override)
router.put('/:id', authenticate, authorize(ALL_AUTHORS), ctrl.updateEntry);

// DELETE /logbook/:id — author delete (or VP/Dean/Principal override)
router.delete('/:id', authenticate, authorize(ALL_AUTHORS), ctrl.deleteEntry);

// POST /logbook/:id/review — VP/Dean/HOD reviews/sign-off an entry
router.post('/:id/review', authenticate, authorize(REVIEWERS), ctrl.reviewEntry);

export default router;
