import { Router, Request, Response, NextFunction } from 'express';
import { SyncManager } from './sync-manager';
import { DatabaseSyncer } from './database-syncer';
import prisma from '../config/db';
import { getTableStats } from './sync-stats';
import { getOutboxStatus, isOutboxEnabled, pruneOutbox } from './outbox';

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

// Row count and newest change per synced table, for the peer's Sync Status page.
router.get('/sync/stats', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const requested = typeof req.query.tables === 'string' && req.query.tables ? req.query.tables.split(',') : undefined;
    res.json({ server_id: process.env.SERVER_ID || 'local', stats: await getTableStats(requested) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Queued changes for the peer, oldest first. Holds the request open up to `wait` seconds
// when there is nothing yet, so the peer hears about a change within about a second.
router.get('/sync/outbox', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    if (!isOutboxEnabled()) {
      return res.status(503).json({ success: false, error: 'Push-on-write is not enabled on this server (SYNC_OUTBOX)' });
    }
    const after = Math.max(0, parseInt(String(req.query.after ?? '0'), 10) || 0);
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? '200'), 10) || 200));
    const wait = Math.min(30, Math.max(0, parseInt(String(req.query.wait ?? '0'), 10) || 0));
    const deadline = Date.now() + wait * 1000;
    const toNumber = (v: any) => Number(v);

    let rows: { id: any; table_name: string; record_id: number }[] = [];
    for (;;) {
      rows = await prisma.$queryRawUnsafe(
        `SELECT id, table_name, record_id FROM "SyncOutbox" WHERE id > $1 ORDER BY id LIMIT $2`, after, limit
      );
      if (rows.length > 0 || Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const idsByTable = new Map<string, Set<number>>();
    for (const row of rows) {
      if (!idsByTable.has(row.table_name)) idsByTable.set(row.table_name, new Set());
      idsByTable.get(row.table_name)!.add(row.record_id);
    }
    const loaded = new Map<string, any>();
    for (const [table, ids] of idsByTable) {
      const delegate = (prisma as any)[table.charAt(0).toLowerCase() + table.slice(1)];
      if (!delegate) continue;
      for (const record of await delegate.findMany({ where: { id: { in: [...ids] } } })) {
        loaded.set(`${table}:${record.id}`, record);
      }
    }

    const entries = rows.map(row => ({
      id: toNumber(row.id),
      table: row.table_name,
      recordId: row.record_id,
      record: loaded.get(`${row.table_name}:${row.record_id}`) ?? null,
    }));
    void pruneOutbox(prisma as any);
    res.json({ entries, maxId: rows.length ? toNumber(rows[rows.length - 1].id) : after });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/sync/outbox/status', requireSyncAuth, async (_req: Request, res: Response) => {
  res.json(await getOutboxStatus(prisma as any));
});

// Per-table cursor snapshot. Ops uses this to see which tables are stuck and
// how far back their windows are, without dumping the whole SyncLog.
router.get('/sync/cursors', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const cursors = await prisma.syncCursor.findMany({ orderBy: { cursor: 'asc' } });
    res.json({ cursors });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Dead-letter view. Records that keep failing across ticks, with the strike
// counter and last error. Filter by table or direction; anything with
// strikes >= 5 is quarantined (no longer blocks its table's cursor) but
// still gets attempted every tick for auto-recovery.
router.get('/sync/dead-letters', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const { table, direction, quarantinedOnly } = req.query;
    const where: any = {};
    if (typeof table === 'string' && table.length > 0) where.table_name = table;
    if (direction === 'push' || direction === 'pull') where.direction = direction;
    if (quarantinedOnly === 'true') where.strikes = { gte: 5 };
    const failures = await prisma.syncFailure.findMany({
      where,
      orderBy: [{ strikes: 'desc' }, { last_attempt: 'desc' }],
      take: 500
    });
    res.json({ failures });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Force-clear a specific dead-letter entry. Deletes the SyncFailure row so
// the next tick retries fresh -- useful once the underlying data problem
// (missing parent Enrollment, natural-key conflict) has been fixed manually
// and you do not want to wait for the record's updated_at to change.
router.post('/sync/dead-letters/:tableName/:recordId/clear', requireSyncAuth, async (req: Request, res: Response) => {
  try {
    const { tableName, recordId } = req.params;
    const id = parseInt(recordId);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: 'recordId must be an integer' });
    }
    const rawDirection = req.query.direction;
    const where: any = { table_name: tableName, record_id: id };
    if (rawDirection === 'push' || rawDirection === 'pull') where.direction = rawDirection;
    const result = await prisma.syncFailure.deleteMany({ where });
    res.json({ success: true, cleared: result.count });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
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