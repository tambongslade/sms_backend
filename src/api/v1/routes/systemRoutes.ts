import express from 'express';
import * as systemController from '../controllers/systemController';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Apply SUPER_MANAGER authorization to all routes
router.use(authorize(['SUPER_MANAGER']));

/**
 * @route GET /api/v1/system/settings
 * @desc Get current system settings
 * @access SUPER_MANAGER only
 */
router.get('/settings', systemController.getSettings);

/**
 * @route PUT /api/v1/system/settings
 * @desc Update system settings
 * @access SUPER_MANAGER only
 */
router.put('/settings', systemController.updateSettings);

/**
 * @route GET /api/v1/system/health
 * @desc Get comprehensive system health status
 * @access SUPER_MANAGER only
 */
router.get('/health', systemController.getSystemHealth);

/**
 * @route POST /api/v1/system/backup
 * @desc Perform manual system backup
 * @access SUPER_MANAGER only
 */
router.post('/backup', systemController.performBackup);

/**
 * @route POST /api/v1/system/cleanup
 * @desc Perform system cleanup operations
 * @access SUPER_MANAGER only
 */
router.post('/cleanup', systemController.performCleanup);

/**
 * @route GET /api/v1/system/logs
 * @desc Get system logs with filtering
 * @access SUPER_MANAGER only
 */
router.get('/logs', systemController.getSystemLogs);

/**
 * @route GET /api/v1/system/statistics
 * @desc Get comprehensive system statistics
 * @access SUPER_MANAGER only
 */
router.get('/statistics', systemController.getSystemStatistics);

/**
 * @route GET /api/v1/system/dashboard
 * @desc Get system dashboard data for SUPER_MANAGER
 * @access SUPER_MANAGER only
 */
router.get('/dashboard', systemController.getSystemDashboard);

/**
 * @route GET /api/v1/system/info
 * @desc Get basic system information
 * @access SUPER_MANAGER only
 */
router.get('/info', systemController.getSystemInfo);

/**
 * @route POST /api/v1/system/maintenance-mode
 * @desc Toggle maintenance mode on/off
 * @access SUPER_MANAGER only
 */
router.post('/maintenance-mode', systemController.toggleMaintenanceMode);

/**
 * @route GET /api/v1/system/sync/status
 * @desc Show the most recent sync run + live peer reachability + auto-sync config
 * @access SUPER_MANAGER only
 */
router.get('/sync/status', systemController.getSyncStatus);

/**
 * @route GET /api/v1/system/sync/logs
 * @desc List recent sync runs (default 20, max 100)
 * @access SUPER_MANAGER only
 */
router.get('/sync/logs', systemController.getSyncLogs);

/**
 * @route POST /api/v1/system/sync/trigger
 * @desc Manually run a bidirectional sync against the remote peer
 * @access SUPER_MANAGER only
 */
router.post('/sync/trigger', systemController.triggerSync);

/**
 * @route POST /api/v1/system/sync/start
 * @desc Start a sync run in the background and return immediately (poll /sync/status)
 * @access SUPER_MANAGER only
 */
router.post('/sync/start', systemController.startSync);

/**
 * @route POST /api/v1/system/sync/reconcile  (GET for progress)
 * @desc Re-send/re-read the tables whose row counts differ from the peer's; adds and updates only
 * @access SUPER_MANAGER only
 */
router.post('/sync/reconcile', systemController.startReconcile);
router.get('/sync/reconcile', systemController.getReconcile);

export default router;