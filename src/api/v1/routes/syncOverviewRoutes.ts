import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { ApiClient } from '../../../sync/api-client';
import { SYNC_TABLES } from '../../../sync/sync-manager';
import { buildComparison, getLocalTableStats, TableStat } from '../../../sync/sync-overview';

const router = Router();

// GET /sync-overview - per-area record counts on this server vs the peer, with a sync verdict
router.get('/', authenticate, authorize([Role.SUPER_MANAGER]), async (_req: Request, res: Response) => {
    try {
        const client = new ApiClient();
        const local = await getLocalTableStats();

        let online: Record<string, TableStat> | null = null;
        let remoteError: string | null = null;
        let remoteServerId: string | null = null;
        if (!client.isConfigured()) {
            remoteError = 'No online server is configured on this server (REMOTE_SYNC_URL).';
        } else {
            try {
                const remote = await client.getStats(SYNC_TABLES);
                online = remote.stats;
                remoteServerId = remote.serverId;
            } catch (error: any) {
                remoteError = error.response?.status === 404
                    ? 'The online server does not provide sync statistics yet.'
                    : `The online server could not be reached (${error.code || error.message}).`;
            }
        }

        const categories = buildComparison(local, online);
        res.json({
            success: true,
            data: {
                generatedAt: new Date().toISOString(),
                localServerId: process.env.SERVER_ID || 'local',
                online: { reachable: online !== null, serverId: remoteServerId, error: remoteError },
                summary: {
                    categories: categories.length,
                    inSync: categories.filter(c => c.status === 'in_sync').length,
                    outOfSync: categories.filter(c => c.status === 'out_of_sync').length,
                    unknown: categories.filter(c => c.status === 'unknown').length,
                },
                categories,
            },
        });
    } catch (error: any) {
        console.error('Error building sync overview:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
