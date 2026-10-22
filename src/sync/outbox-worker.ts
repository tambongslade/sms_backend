import prisma from '../config/db';
import { ApiClient } from './api-client';
import { DatabaseSyncer } from './database-syncer';
import { SYNC_TABLES } from './sync-manager';
import { ensureOutboxTables, getState, isOutboxEnabled, pruneOutbox, RETRY_MINUTES, setState } from './outbox';

const TICK_MS = 5_000;
const PUSH_BATCH = 100;
const PULL_WAIT_SECONDS = 25;
const MAX_INBOUND_ATTEMPTS = 200;

type OutboxRow = { id: number; table_name: string; record_id: number };

const lowerFirst = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);
const delegateFor = (table: string): any => (prisma as any)[lowerFirst(table)];
const isNetworkError = (error: any) => !error?.response;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Push-on-write for the local server, and the long-poll that brings the online server's
// changes down. Runs on the primary worker only (started from SyncService).
//
// Failure rule (as asked): a change that cannot be delivered stays queued and is retried
// after RETRY_MINUTES, or sooner as soon as the next change is queued.
export class OutboxWorker {
    private readonly client = new ApiClient();
    private readonly syncer = new DatabaseSyncer();
    private readonly localId = process.env.SERVER_ID || 'local';
    private running = false;
    private pushing = false;
    private pushFailedAt = 0;
    private pushFailedMaxId = 0;
    private pullFailedAt = 0;
    private pullFailedMaxId = 0;
    private timer: NodeJS.Timeout | null = null;

    async start(): Promise<void> {
        if (!isOutboxEnabled() || this.running) return;
        await ensureOutboxTables(prisma as any);
        if (!this.client.isConfigured()) {
            console.log('[OUTBOX] no peer configured: capturing changes only, the peer pulls them');
            return;
        }
        this.running = true;
        console.log(`[OUTBOX] push-on-write started (retry after ${RETRY_MINUTES} min or on the next change)`);
        this.timer = setInterval(() => { void this.pushTick(); }, TICK_MS);
        void this.pullLoop();
    }

    stop(): void {
        this.running = false;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    private async maxPendingId(): Promise<number> {
        const rows = await prisma.$queryRawUnsafe<{ max: number | null }[]>(`SELECT MAX(id)::int AS max FROM "SyncOutbox" WHERE status = 'PENDING'`);
        return rows[0]?.max ?? 0;
    }

    private async maxOutboxId(): Promise<number> {
        const rows = await prisma.$queryRawUnsafe<{ max: number | null }[]>(`SELECT MAX(id)::int AS max FROM "SyncOutbox"`);
        return rows[0]?.max ?? 0;
    }

    private async mark(ids: number[], status: 'SENT'): Promise<void> {
        if (ids.length === 0) return;
        await prisma.$executeRawUnsafe(`UPDATE "SyncOutbox" SET status = $1, sent_at = now(), last_error = NULL WHERE id = ANY($2::bigint[])`, status, ids);
    }

    private async fail(ids: number[], message: string): Promise<void> {
        if (ids.length === 0) return;
        await prisma.$executeRawUnsafe(`UPDATE "SyncOutbox" SET attempts = attempts + 1, last_error = $1 WHERE id = ANY($2::bigint[])`, message.slice(0, 300), ids);
    }

    // ---- local -> online ----------------------------------------------------------
    async pushTick(): Promise<void> {
        if (!this.running || this.pushing) return;
        this.pushing = true;
        try {
            await pruneOutbox(prisma as any);
            const maxId = await this.maxPendingId();
            if (maxId === 0) return;

            // After a failure wait RETRY_MINUTES, unless a newer change has been queued since.
            const waitedLongEnough = Date.now() - this.pushFailedAt >= RETRY_MINUTES * 60 * 1000;
            if (this.pushFailedAt > 0 && !waitedLongEnough && maxId <= this.pushFailedMaxId) return;

            const rows = await prisma.$queryRawUnsafe<OutboxRow[]>(
                `SELECT id, table_name, record_id FROM "SyncOutbox" WHERE status = 'PENDING' ORDER BY id LIMIT 1000`
            );

            const byTable = new Map<string, Map<number, number[]>>();
            for (const row of rows) {
                if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Map());
                const records = byTable.get(row.table_name)!;
                if (!records.has(row.record_id)) records.set(row.record_id, []);
                records.get(row.record_id)!.push(Number(row.id));
            }

            const tables = [...byTable.keys()].sort((a, b) => SYNC_TABLES.indexOf(a) - SYNC_TABLES.indexOf(b));
            let failed = false;

            for (const table of tables) {
                const queued = byTable.get(table)!;
                const delegate = delegateFor(table);
                if (!delegate) {
                    await this.mark([...queued.values()].flat(), 'SENT');
                    continue;
                }

                const found: any[] = await delegate.findMany({ where: { id: { in: [...queued.keys()] } } });
                const foundIds = new Set(found.map(r => r.id));

                // Deleted since, or written by the peer: nothing for us to send.
                const skipIds: number[] = [];
                for (const [recordId, entryIds] of queued) if (!foundIds.has(recordId)) skipIds.push(...entryIds);
                const toSend = found.filter(r => {
                    const ours = !r.server_id || r.server_id === this.localId;
                    if (!ours) skipIds.push(...(queued.get(r.id) ?? []));
                    return ours;
                });
                await this.mark(skipIds, 'SENT');

                for (let i = 0; i < toSend.length; i += PUSH_BATCH) {
                    const batch = toSend.slice(i, i + PUSH_BATCH);
                    const entryIds = batch.flatMap(r => queued.get(r.id) ?? []);
                    try {
                        await this.client.pushRecordsStrict(table, batch);
                        await this.mark(entryIds, 'SENT');
                    } catch (error: any) {
                        if (isNetworkError(error)) {
                            await this.fail(entryIds, `peer unreachable (${error.code || error.message})`);
                            failed = true;
                            break;
                        }
                        // The peer answered but rejected something in the batch (typically a
                        // missing parent row): isolate the offenders so one bad row cannot hold
                        // the rest back.
                        for (const record of batch) {
                            const ids = queued.get(record.id) ?? [];
                            try {
                                await this.client.pushRecordsStrict(table, [record]);
                                await this.mark(ids, 'SENT');
                            } catch (rowError: any) {
                                failed = true;
                                await this.fail(ids, rowError.response?.data?.error || rowError.message);
                            }
                        }
                    }
                }
            }

            if (failed) {
                this.pushFailedAt = Date.now();
                this.pushFailedMaxId = maxId;
            } else {
                this.pushFailedAt = 0;
                this.pushFailedMaxId = 0;
            }
        } catch (error: any) {
            console.error(`[OUTBOX] push tick failed: ${error?.message}`);
        } finally {
            this.pushing = false;
        }
    }

    // ---- online -> local ----------------------------------------------------------
    private async pullCursor(): Promise<number> {
        return parseInt((await getState(prisma as any, 'pull_cursor')) ?? '0', 10) || 0;
    }

    private async pullLoop(): Promise<void> {
        while (this.running) {
            try {
                await this.retryInbound();
                const cursor = await this.pullCursor();
                const peerId = await this.client.getPeerServerId();
                const result = await this.client.pullOutbox(cursor, 200, PULL_WAIT_SECONDS);

                const touched = new Set<string>();
                for (const entry of result.entries) {
                    if (!entry.record) continue;
                    try {
                        await this.syncer.processIncomingRecord(entry.table, entry.record, peerId ?? undefined);
                        touched.add(entry.table);
                    } catch (error: any) {
                        // Usually a parent row that has not arrived yet. Keep it and retry.
                        await prisma.$executeRawUnsafe(
                            `INSERT INTO "SyncOutbox" (table_name, record_id, status, attempts, last_error, payload) VALUES ($1, $2, 'INBOUND_RETRY', 1, $3, $4::jsonb)`,
                            entry.table, entry.record.id ?? entry.recordId, String(error?.message || error).slice(0, 300), JSON.stringify(entry.record)
                        );
                    }
                }
                for (const table of touched) await this.syncer.resyncSequence(table);
                if (result.maxId > cursor) await setState(prisma as any, 'pull_cursor', String(result.maxId));
                this.pullFailedAt = 0;
            } catch (error: any) {
                this.pullFailedAt = Date.now();
                this.pullFailedMaxId = await this.maxOutboxId().catch(() => 0);
                console.error(`[OUTBOX] pull failed (${error?.code || error?.message}); retrying in ${RETRY_MINUTES} min or on the next local change`);
                await this.waitForRetry();
            }
        }
    }

    // Sleeps until RETRY_MINUTES passed or a newer change was queued locally.
    private async waitForRetry(): Promise<void> {
        while (this.running) {
            await sleep(TICK_MS);
            if (Date.now() - this.pullFailedAt >= RETRY_MINUTES * 60 * 1000) return;
            const latest = await this.maxOutboxId().catch(() => 0);
            if (latest > this.pullFailedMaxId) return;
        }
    }

    private async retryInbound(): Promise<void> {
        const rows = await prisma.$queryRawUnsafe<{ id: number; table_name: string; payload: any; attempts: number }[]>(
            `SELECT id, table_name, payload, attempts FROM "SyncOutbox" WHERE status = 'INBOUND_RETRY' AND attempts < ${MAX_INBOUND_ATTEMPTS} ORDER BY id LIMIT 200`
        );
        for (const row of rows) {
            try {
                await this.syncer.processIncomingRecord(row.table_name, row.payload, undefined);
                await this.syncer.resyncSequence(row.table_name);
                await this.mark([Number(row.id)], 'SENT');
            } catch (error: any) {
                await this.fail([Number(row.id)], String(error?.message || error));
            }
        }
    }
}
