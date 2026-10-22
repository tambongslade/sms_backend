import { ApiClient } from './api-client';
import { DatabaseSyncer } from './database-syncer';
import { SYNC_TABLES } from './sync-manager';
import { getLocalTableStats } from './sync-overview';

export type TableRepair = {
    table: string;
    local: number | null;
    online: number | null;
    pulled: number;
    pullFailed: number;
    pushed: number;
    pushFailed: number;
    errors: string[];
};

export type ReconcileResult = {
    startedAt: string;
    finishedAt: string | null;
    running: boolean;
    tables: TableRepair[];
    error: string | null;
};

const EPOCH = new Date(0);
const PUSH_BATCH = 50;
const MAX_PASSES = 3;

let current: ReconcileResult | null = null;

export const getReconcileStatus = (): ReconcileResult | null => current;

// One-off repair for the rows the regular sync never carried: anything whose updated_at is
// older than the sync cursor but that the peer never received (and vice versa). For every
// table whose row counts differ it re-reads the peer's rows from the beginning and sends
// the local ones, using the same apply path as the normal sync (natural-key matching,
// stale-row protection, id remapping). It only adds or updates rows; it never deletes.
export async function reconcileDifferingTables(): Promise<ReconcileResult> {
    if (current?.running) return current;
    const client = new ApiClient();
    const syncer = new DatabaseSyncer();
    current = { startedAt: new Date().toISOString(), finishedAt: null, running: true, tables: [], error: null };

    try {
        if (!client.isConfigured()) throw new Error('REMOTE_SYNC_URL is not configured');
        const local = await getLocalTableStats();
        const remote = await client.getStats(SYNC_TABLES);
        const peerId = await client.getPeerServerId();
        const localId = process.env.SERVER_ID || 'local';

        const differing = SYNC_TABLES.filter(t => {
            const l = local[t]?.count ?? null;
            const o = remote.stats[t]?.count ?? null;
            return l !== null && o !== null && l !== o;
        });

        // Rows held back because a parent row had not arrived yet are retried in later passes.
        let held: { table: string; record: any }[] = [];
        for (const table of differing) {
            const repair: TableRepair = {
                table, local: local[table].count, online: remote.stats[table].count,
                pulled: 0, pullFailed: 0, pushed: 0, pushFailed: 0, errors: [],
            };
            current.tables.push(repair);

            // peer -> here
            const incoming = await client.getChanges(table, EPOCH);
            for (const record of incoming) {
                try {
                    await syncer.processIncomingRecord(table, record, peerId ?? undefined);
                    repair.pulled++;
                } catch {
                    held.push({ table, record });
                }
            }
            await syncer.resyncSequence(table);

            // here -> peer (only rows written here; rows that came from the peer stay put)
            const outgoing = await syncer.getLocalChanges(table, EPOCH);
            for (let i = 0; i < outgoing.length; i += PUSH_BATCH) {
                const batch = outgoing.slice(i, i + PUSH_BATCH).map((r: any) => ({ ...r, server_id: r.server_id ?? localId }));
                try {
                    await client.pushRecordsStrict(table, batch);
                    repair.pushed += batch.length;
                } catch {
                    for (const record of batch) {
                        try {
                            await client.pushRecordsStrict(table, [record]);
                            repair.pushed++;
                        } catch (error: any) {
                            repair.pushFailed++;
                            if (repair.errors.length < 5) repair.errors.push(`push ${table}[${record.id}]: ${error.response?.data?.error || error.message}`);
                        }
                    }
                }
            }
        }

        for (let pass = 0; pass < MAX_PASSES && held.length > 0; pass++) {
            const next: typeof held = [];
            for (const item of held) {
                const repair = current.tables.find(t => t.table === item.table)!;
                try {
                    await syncer.processIncomingRecord(item.table, item.record, peerId ?? undefined);
                    repair.pulled++;
                } catch (error: any) {
                    next.push(item);
                    if (pass === MAX_PASSES - 1) {
                        repair.pullFailed++;
                        if (repair.errors.length < 5) repair.errors.push(`pull ${item.table}[${item.record?.id}]: ${String(error?.message || error).split('\n').pop()?.slice(0, 160)}`);
                    }
                }
            }
            held = next;
        }
    } catch (error: any) {
        current.error = error?.message || String(error);
    } finally {
        current.running = false;
        current.finishedAt = new Date().toISOString();
    }
    return current;
}
