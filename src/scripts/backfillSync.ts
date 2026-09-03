// One-off recovery for the sync-cursor bug fixed in sync-manager.ts
// (SyncMetadata used to advance past a run that had table-level errors, so a
// record that changed on the peer during a LAN outage was skipped forever,
// not just delayed).
//
// This does NOT touch SyncMetadata and does NOT delete anything. It reuses
// the exact same DatabaseSyncer.syncTable() the real sync uses -- push then
// pull, in dependency order, with the deferred-retry pass for anything that
// arrives before what it references -- just pointed at a wide `since` instead
// of the cursor, so it re-walks every window the cursor already skipped past.
// Every apply is upsert-by-id-or-natural-key, so re-processing a record that
// is already correct on both sides is a no-op; only what's actually missing
// or behind gets written.
//
// Usage: npx ts-node src/scripts/backfillSync.ts [since]
//   since defaults to 2026-08-17T00:00:00Z (when SyncLog's history starts,
//   i.e. before the first sync ever ran) so it covers every gap on record.

import prisma from '../config/db';
import { DatabaseSyncer } from '../sync/database-syncer';
import { SYNC_TABLES } from '../sync/sync-manager';
import { DeferredRecord } from '../sync/types';

const MAX_DEFERRED_PASSES = 5;

async function main() {
    const sinceArg = process.argv[2];
    const since = sinceArg ? new Date(sinceArg) : new Date('2026-08-17T00:00:00Z');
    if (isNaN(since.getTime())) {
        console.error(`Not a valid date: ${sinceArg}`);
        process.exit(1);
    }

    const dbSyncer = new DatabaseSyncer();
    if (!dbSyncer.isRemoteConfigured()) {
        console.error('REMOTE_SYNC_URL is not configured on this node -- nothing to backfill against.');
        process.exit(1);
    }

    console.log(`Backfilling every synced table since ${since.toISOString()}...`);
    console.log(`(${SYNC_TABLES.length} tables, dependency order, push+pull each)\n`);

    let totalProcessed = 0;
    let totalErrors = 0;
    const deferred: DeferredRecord[] = [];

    for (const table of SYNC_TABLES) {
        const result = await dbSyncer.syncTable(table, since);
        totalProcessed += result.recordsProcessed;
        if (result.errors.length > 0) {
            totalErrors += result.errors.length;
            for (const err of result.errors) console.warn(`  ! ${err}`);
        }
        if (result.conflicts.length > 0) {
            console.log(`  ${table}: ${result.conflicts.length} conflict(s) resolved (timestamp-wins)`);
        }
        deferred.push(...result.deferred);
    }

    let pending = deferred;
    for (let pass = 1; pending.length > 0 && pass <= MAX_DEFERRED_PASSES; pass++) {
        const { applied, remaining } = await dbSyncer.retryDeferred(pending);
        console.log(`Deferred pass ${pass}: applied ${applied}, ${remaining.length} still waiting`);
        totalProcessed += applied;
        if (applied === 0) { pending = remaining; break; }
        pending = remaining;
    }

    if (pending.length > 0) {
        console.warn(`\n${pending.length} record(s) never placed:`);
        const grouped = new Map<string, number>();
        for (const item of pending) {
            const key = `${item.table}: ${item.lastError}`;
            grouped.set(key, (grouped.get(key) ?? 0) + 1);
        }
        for (const [key, count] of grouped) console.warn(`  - ${key} (${count})`);
    }

    console.log(`\nDone. ${totalProcessed} record(s) processed, ${totalErrors} error(s), ${pending.length} unplaced.`);
    console.log('SyncMetadata (the normal 5-minute auto-sync cursor) was not touched.');
}

main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
