// Change queue ("outbox") behind push-on-write sync.
//
// Every write to a synced table appends a row here; the other server is told about it
// right away (local -> online by push, online -> local by long-poll, see outbox-worker.ts).
// The periodic full sync stays as the safety net for anything the queue misses.
//
// Deliberately free of any import from config/db: db.ts calls into this file from its
// write hook, so it takes the Prisma client as an argument instead.

type RawClient = {
    $executeRawUnsafe: (query: string, ...values: any[]) => Promise<any>;
    $queryRawUnsafe: <T = unknown>(query: string, ...values: any[]) => Promise<T>;
};

export const isOutboxEnabled = () => (process.env.SYNC_OUTBOX || '').toLowerCase() === 'on';

export const RETRY_MINUTES = parseInt(process.env.SYNC_OUTBOX_RETRY_MINUTES || '10', 10) || 10;

// Created from code, not a Prisma migration: the table is bookkeeping, and the online
// server's schema files carry local changes that a migration would have to be merged into.
export async function ensureOutboxTables(client: RawClient): Promise<void> {
    await client.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "SyncOutbox" (
            id BIGSERIAL PRIMARY KEY,
            table_name TEXT NOT NULL,
            record_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            payload JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            sent_at TIMESTAMPTZ
        )`);
    await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SyncOutbox_status_id_idx" ON "SyncOutbox" (status, id)`);
    await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SyncOutbox_created_idx" ON "SyncOutbox" (created_at)`);
    await client.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "SyncOutboxState" (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )`);
}

// Appends one change. Never throws: a failure to queue must not fail the user's write
// (the periodic sync still carries the row).
export async function enqueueChange(client: RawClient, table: string, recordId: number): Promise<void> {
    try {
        await client.$executeRawUnsafe(`INSERT INTO "SyncOutbox" (table_name, record_id) VALUES ($1, $2)`, table, recordId);
    } catch (error: any) {
        if (!String(error?.message || '').includes('does not exist')) {
            console.error(`[OUTBOX] could not queue ${table}[${recordId}]: ${error?.message}`);
        }
    }
}

let lastPrune = 0;

// Keeps the table small. A sender only discards what was delivered; a receiver (no peer
// configured, so nothing marks rows sent) discards by age, long after the peer has read them.
export async function pruneOutbox(client: RawClient): Promise<void> {
    if (Date.now() - lastPrune < 60 * 60 * 1000) return;
    lastPrune = Date.now();
    try {
        if (process.env.REMOTE_SYNC_URL) {
            await client.$executeRawUnsafe(`DELETE FROM "SyncOutbox" WHERE status = 'SENT' AND created_at < now() - interval '14 days'`);
        } else {
            await client.$executeRawUnsafe(`DELETE FROM "SyncOutbox" WHERE created_at < now() - interval '14 days'`);
        }
    } catch (error: any) {
        console.error(`[OUTBOX] prune failed: ${error?.message}`);
    }
}

export async function getState(client: RawClient, key: string): Promise<string | null> {
    const rows = await client.$queryRawUnsafe<{ value: string }[]>(`SELECT value FROM "SyncOutboxState" WHERE key = $1`, key);
    return rows[0]?.value ?? null;
}

export async function setState(client: RawClient, key: string, value: string): Promise<void> {
    await client.$executeRawUnsafe(
        `INSERT INTO "SyncOutboxState" (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        key, value
    );
}

export type OutboxStatus = {
    enabled: boolean;
    pending: number;
    retrying: number;
    inboundRetry: number;
    oldestPendingAt: string | null;
    lastError: string | null;
    pullCursor: number;
};

export async function getOutboxStatus(client: RawClient): Promise<OutboxStatus> {
    const empty: OutboxStatus = { enabled: isOutboxEnabled(), pending: 0, retrying: 0, inboundRetry: 0, oldestPendingAt: null, lastError: null, pullCursor: 0 };
    if (!empty.enabled) return empty;
    try {
        const [row] = await client.$queryRawUnsafe<any[]>(`
            SELECT COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
                   COUNT(*) FILTER (WHERE status = 'PENDING' AND attempts > 0)::int AS retrying,
                   COUNT(*) FILTER (WHERE status = 'INBOUND_RETRY')::int AS inbound_retry,
                   MIN(created_at) FILTER (WHERE status = 'PENDING') AS oldest,
                   (SELECT last_error FROM "SyncOutbox" WHERE last_error IS NOT NULL ORDER BY id DESC LIMIT 1) AS last_error
            FROM "SyncOutbox"`);
        const cursor = await getState(client, 'pull_cursor');
        return {
            enabled: true,
            pending: row.pending,
            retrying: row.retrying,
            inboundRetry: row.inbound_retry,
            oldestPendingAt: row.oldest ? new Date(row.oldest).toISOString() : null,
            lastError: row.last_error ?? null,
            pullCursor: cursor ? parseInt(cursor, 10) : 0,
        };
    } catch {
        return empty;
    }
}
