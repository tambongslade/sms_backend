import { Router, Request, Response, NextFunction } from 'express';
import { SyncManager } from './sync-manager';
import { DatabaseSyncer } from './database-syncer';
import prisma from '../config/db';

const router = Router();
const syncManager = new SyncManager();
const dbSyncer = new DatabaseSyncer();

// Bearer-token guard. Every sync endpoint except /sync/health requires a
// matching SYNC_API_KEY so peers can't inject records without credentials.
// Health stays open so LAN monitoring can probe it without secrets.
function requireSyncAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.SYNC_API_KEY;
  if (!expected) {
    return res.status(503).json({
      success: false,
      error: 'Sync API key not configured on this server'
    });
  }
  const raw = req.headers['authorization'];
  const header = Array.isArray(raw) ? raw[0] : (raw || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== expected) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// Manual sync trigger
router.post('/sync/trigger', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const syncLog = await syncManager.performSync();
    res.json({
      success: true,
      syncLog
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get sync status
router.get('/sync/status', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const status = await syncManager.getSyncStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get sync logs
router.get('/sync/logs', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const logs = await prisma.syncLog.findMany({
      orderBy: { start_time: 'desc' },
      take: 50
    });

    res.json(logs);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start auto sync
router.post('/sync/auto/start', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const { intervalMinutes = 5 } = req.body;
    await syncManager.startAutoSync(intervalMinutes);

    res.json({
      success: true,
      message: `Auto sync started with ${intervalMinutes} minute interval`
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Stop auto sync
router.post('/sync/auto/stop', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    syncManager.stopAutoSync();

    res.json({
      success: true,
      message: 'Auto sync stopped'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Receive changes from remote server (webhook endpoint)
router.post('/sync/receive/:tableName', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;
    const { records } = req.body;

    // Attribute anything arriving without provenance to the sender (ApiClient
    // always sets X-Server-ID). Storing it as null instead would make
    // getLocalChanges treat the sender's own rows as ours and push them back on
    // the next run — the echo loop that stamped 6370 rows with the wrong node.
    const rawSender = req.headers['x-server-id'];
    const sender = Array.isArray(rawSender) ? rawSender[0] : rawSender;

    // Process incoming changes
    for (const record of records) {
      await dbSyncer.processIncomingRecord(tableName, record, sender);
    }

    // Those records arrived with the sender's own ids, written straight into
    // the primary key, so this table's sequence is now behind them. Left alone,
    // the next local insert is handed an id the sender already used.
    await dbSyncer.resyncSequence(tableName);

    res.json({
      success: true,
      processed: records.length
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get changes since timestamp (for remote server to pull)
router.get('/sync/changes/:tableName', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;
    const { since, server_id } = req.query;

    const sinceDate = new Date(since as string);
    const changes = await dbSyncer.getLocalChanges(tableName, sinceDate);

    // Filter out changes from the requesting server
    const filteredChanges = changes.filter((record: any) =>
      record.server_id !== server_id
    );

    res.json({
      records: filteredChanges,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
router.get('/sync/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    server_id: process.env.SERVER_ID || 'local'
  });
});

export default router;