import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import * as resultsController from '../controllers/resultsController';

const router = Router();

// Staff who read academic results (Dean of Studies included, read-only)
const RESULTS_READERS = ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'DEAN_OF_STUDIES'];
const MARKSHEET_READERS = [...RESULTS_READERS, 'SECRETARY'];

// GET /results/class - Ranked class results for a sequence, term or the whole year
router.get('/class', authenticate, authorize(RESULTS_READERS), resultsController.getClassResults);

// GET /results/class/marksheet - The class mark sheet (every mark, category averages, general average, rank, class statistics)
router.get('/class/marksheet', authenticate, authorize(MARKSHEET_READERS), resultsController.getClassMarksheet);

// GET /results/class/marksheet/pdf - Same sheet as a landscape PDF
router.get('/class/marksheet/pdf', authenticate, authorize(MARKSHEET_READERS), resultsController.downloadClassMarksheetPdf);

// GET /results/class/export - Same as /class, as a CSV file (opens in Excel)
router.get('/class/export', authenticate, authorize(RESULTS_READERS), resultsController.exportClassResults);

// GET /results/promotion-preview - Annual averages + suggested promote/repeat per student of one subclass
router.get('/promotion-preview', authenticate, authorize(['SUPER_MANAGER', 'PRINCIPAL', 'SECRETARY', 'DEAN_OF_STUDIES']), resultsController.promotionPreview);

export default router;
