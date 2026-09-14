import { Request, Response } from 'express';
import * as systemService from '../services/systemService';
import prisma from '../../../config/db';
import { SyncManager } from '../../../sync/sync-manager';
import { NetworkChecker } from '../../../sync/network-checker';

// Module-scope singletons. SyncManager is stateless with respect to a single
// performSync() call, so re-using one instance across requests is safe and
// avoids re-instantiating dependencies (DatabaseSyncer, NetworkChecker) on
// every admin call.
const adminSyncManager = new SyncManager();
const adminNetworkChecker = new NetworkChecker();

// Guard so two overlapping /system/sync/trigger calls don't fire two full
// bidirectional passes at once — a Super Manager double-clicking the button
// would otherwise race two workers against the same peer.
let syncInFlight: Promise<any> | null = null;

function parseSyncLogRow(row: any) {
    return {
        id: row.id,
        syncId: row.sync_id,
        startTime: row.start_time,
        endTime: row.end_time,
        status: row.status,
        direction: row.direction,
        recordsProcessed: row.records_processed,
        conflicts: safeParseJson(row.conflicts, []),
        errors: safeParseJson(row.errors, []),
        createdAt: row.created_at
    };
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/**
 * Get current system settings
 */
export async function getSettings(req: Request, res: Response): Promise<void> {
    try {
        const settings = await systemService.getSystemSettings();

        res.status(200).json({
            success: true,
            data: settings
        });
    } catch (error: any) {
        console.error('Error fetching system settings:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch system settings'
        });
    }
}

/**
 * Update system settings
 */
export async function updateSettings(req: Request, res: Response): Promise<void> {
    try {
        const settingsUpdate = req.body;

        // Validate required fields if updating critical settings
        if (settingsUpdate.schoolName === '') {
            res.status(400).json({
                success: false,
                error: 'School name cannot be empty'
            });
            return;
        }

        const updatedSettings = await systemService.updateSystemSettings(settingsUpdate);

        res.status(200).json({
            success: true,
            message: 'System settings updated successfully',
            data: updatedSettings
        });
    } catch (error: any) {
        console.error('Error updating system settings:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update system settings'
        });
    }
}

/**
 * Get comprehensive system health status
 */
export async function getSystemHealth(req: Request, res: Response): Promise<void> {
    try {
        const healthStatus = await systemService.getSystemHealth();

        res.status(200).json({
            success: true,
            data: healthStatus
        });
    } catch (error: any) {
        console.error('Error fetching system health:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch system health status'
        });
    }
}

/**
 * Perform manual system backup
 */
export async function performBackup(req: Request, res: Response): Promise<void> {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
            return;
        }

        const backupResult = await systemService.performSystemBackup(userId, 'MANUAL');

        if (backupResult.status === 'SUCCESS') {
            res.status(201).json({
                success: true,
                message: 'System backup completed successfully',
                data: backupResult
            });
        } else {
            res.status(500).json({
                success: false,
                error: backupResult.error_message || 'Backup failed',
                data: backupResult
            });
        }
    } catch (error: any) {
        console.error('Error performing system backup:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to perform system backup'
        });
    }
}

/**
 * Perform system cleanup operations
 */
export async function performCleanup(req: Request, res: Response): Promise<void> {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
            return;
        }

        const cleanupResults = await systemService.performSystemCleanup(userId);

        const totalRecordsCleaned = cleanupResults.reduce((sum, result) => sum + result.records_cleaned, 0);
        const totalSpaceFreed = cleanupResults.reduce((sum, result) => sum + result.space_freed, 0);

        res.status(200).json({
            success: true,
            message: `System cleanup completed. ${totalRecordsCleaned} records cleaned, ${(totalSpaceFreed / 1024 / 1024).toFixed(2)} MB freed.`,
            data: {
                operations: cleanupResults,
                summary: {
                    totalRecordsCleaned,
                    totalSpaceFreed,
                    totalSpaceFreedMB: Math.round((totalSpaceFreed / 1024 / 1024) * 100) / 100
                }
            }
        });
    } catch (error: any) {
        console.error('Error performing system cleanup:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to perform system cleanup'
        });
    }
}

/**
 * Get system logs with filtering
 */
export async function getSystemLogs(req: Request, res: Response): Promise<void> {
    try {
        const {
            level,
            category,
            startDate,
            endDate,
            userId,
            search,
            limit = '100'
        } = req.query;

        const filters = {
            level: level as any,
            category: category as any,
            start_date: startDate as string,
            end_date: endDate as string,
            user_id: userId ? parseInt(userId as string) : undefined,
            search: search as string
        };

        // Remove undefined values
        Object.keys(filters).forEach(key => {
            if (filters[key as keyof typeof filters] === undefined) {
                delete filters[key as keyof typeof filters];
            }
        });

        const limitNumber = Math.min(parseInt(limit as string) || 100, 1000); // Cap at 1000
        const logs = await systemService.getSystemLogs(filters, limitNumber);

        res.status(200).json({
            success: true,
            data: logs,
            meta: {
                total: logs.length,
                limit: limitNumber,
                filters: filters
            }
        });
    } catch (error: any) {
        console.error('Error fetching system logs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch system logs'
        });
    }
}

/**
 * Get comprehensive system statistics
 */
export async function getSystemStatistics(req: Request, res: Response): Promise<void> {
    try {
        const statistics = await systemService.getSystemStatistics();

        res.status(200).json({
            success: true,
            data: statistics
        });
    } catch (error: any) {
        console.error('Error fetching system statistics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch system statistics'
        });
    }
}

/**
 * Get system dashboard data for SUPER_MANAGER
 */
export async function getSystemDashboard(req: Request, res: Response): Promise<void> {
    try {
        const dashboardData = await systemService.getSystemDashboard();

        res.status(200).json({
            success: true,
            data: dashboardData
        });
    } catch (error: any) {
        console.error('Error fetching system dashboard:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch system dashboard data'
        });
    }
}

/**
 * Get system version and basic info
 */
export async function getSystemInfo(req: Request, res: Response): Promise<void> {
    try {
        const settings = await systemService.getSystemSettings();
        const health = await systemService.getSystemHealth();

        res.status(200).json({
            success: true,
            data: {
                school_name: settings.school_name,
                system_version: health.system_version,
                uptime: health.uptime,
                status: health.status,
                maintenance_mode: settings.maintenance_mode
            }
        });
    } catch (error: any) {
        console.error('Error fetching system info:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch system information'
        });
    }
}

/**
 * Toggle maintenance mode
 */
export async function toggleMaintenanceMode(req: Request, res: Response): Promise<void> {
    try {
        const { enabled } = req.body;

        if (typeof enabled !== 'boolean') {
            res.status(400).json({
                success: false,
                error: 'enabled field must be a boolean'
            });
            return;
        }

        const updatedSettings = await systemService.updateSystemSettings({
            maintenance_mode: enabled
        });

        res.status(200).json({
            success: true,
            message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}`,
            data: {
                maintenance_mode: updatedSettings.maintenance_mode
            }
        });
    } catch (error: any) {
        console.error('Error toggling maintenance mode:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to toggle maintenance mode'
        });
    }
}

/**
 * Get database synchronization status for the Super Manager console.
 * Reports the most recent sync run (from SyncLog) plus live peer reachability
 * and the auto-sync schedule configured via env.
 */
export async function getSyncStatus(req: Request, res: Response): Promise<void> {
    try {
        const lastLogRow = await prisma.syncLog.findFirst({
            orderBy: { start_time: 'desc' }
        });

        const isOnline = await adminNetworkChecker.isOnline();

        const autoSyncIntervalMinutes = Number.parseInt(process.env.AUTO_SYNC_INTERVAL || '5', 10);
        const remotePeerConfigured = Boolean(process.env.REMOTE_SYNC_URL);

        res.status(200).json({
            success: true,
            data: {
                lastSync: lastLogRow ? parseSyncLogRow(lastLogRow) : null,
                isOnline,
                remotePeerConfigured,
                autoSyncEnabled: Number.isFinite(autoSyncIntervalMinutes) && autoSyncIntervalMinutes > 0,
                autoSyncIntervalMinutes: Number.isFinite(autoSyncIntervalMinutes) ? autoSyncIntervalMinutes : null,
                serverId: process.env.SERVER_ID || 'local',
                syncInFlight: syncInFlight !== null
            }
        });
    } catch (error: any) {
        console.error('Error fetching sync status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch sync status'
        });
    }
}

/**
 * Manually trigger a bidirectional sync run with the remote peer.
 * Coalesces overlapping requests so a double-click does not fire two passes.
 */
export async function triggerSync(req: Request, res: Response): Promise<void> {
    try {
        if (!process.env.REMOTE_SYNC_URL) {
            res.status(409).json({
                success: false,
                error: 'REMOTE_SYNC_URL is not configured on this server'
            });
            return;
        }

        if (!syncInFlight) {
            syncInFlight = adminSyncManager.performSync().finally(() => {
                syncInFlight = null;
            });
        }

        const syncLog = await syncInFlight;

        res.status(200).json({
            success: true,
            message: 'Manual sync run finished',
            data: {
                syncLog: {
                    id: syncLog.id,
                    startTime: syncLog.startTime,
                    endTime: syncLog.endTime,
                    status: syncLog.status,
                    direction: syncLog.direction,
                    recordsProcessed: syncLog.recordsProcessed,
                    conflicts: syncLog.conflicts,
                    errors: syncLog.errors
                }
            }
        });
    } catch (error: any) {
        console.error('Error triggering sync:', error);
        res.status(500).json({
            success: false,
            error: error?.message || 'Failed to trigger sync'
        });
    }
}

/**
 * Return recent sync runs (default 20, max 100).
 */
export async function getSyncLogs(req: Request, res: Response): Promise<void> {
    try {
        const rawLimit = Number.parseInt((req.query.limit as string) || '20', 10);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;

        const rows = await prisma.syncLog.findMany({
            orderBy: { start_time: 'desc' },
            take: limit
        });

        res.status(200).json({
            success: true,
            data: rows.map(parseSyncLogRow)
        });
    } catch (error: any) {
        console.error('Error fetching sync logs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch sync logs'
        });
    }
} 