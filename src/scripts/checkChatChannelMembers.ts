// Diagnostic for the 44 ChatChannelMember rows still stuck with server_id
// null (created 2026-08-27, before the cursor advanced past them the same
// way the student/enrollment rows did). Runs the exact same push+pull logic
// as the real sync (DatabaseSyncer.syncTable), scoped to just this one table
// with a `since` wide enough to include them -- so it neither touches
// SyncMetadata nor any other table. Read-mostly in effect: every write is
// upsert-by-id-or-natural-key, so a row that's already fine on both sides is
// a no-op, and only a genuine collision produces an error, which is exactly
// what this is trying to surface.

import prisma from '../config/db';
import { DatabaseSyncer } from '../sync/database-syncer';

async function main() {
    const since = new Date('2026-08-20T00:00:00Z');
    const dbSyncer = new DatabaseSyncer();
    if (!dbSyncer.isRemoteConfigured()) {
        console.error('REMOTE_SYNC_URL not configured on this node.');
        process.exit(1);
    }

    const before = await prisma.chatChannelMember.count({ where: { server_id: null } });
    console.log(`server_id-null ChatChannelMember rows before: ${before}`);

    const result = await dbSyncer.syncTable('ChatChannelMember', since);
    console.log(`\nrecordsProcessed: ${result.recordsProcessed}`);
    console.log(`conflicts: ${result.conflicts.length}`);
    console.log(`errors: ${result.errors.length}`);
    for (const e of result.errors) console.log(`  ! ${e}`);
    console.log(`deferred: ${result.deferred.length}`);

    if (result.deferred.length > 0) {
        const { applied, remaining } = await dbSyncer.retryDeferred(result.deferred);
        console.log(`\ndeferred retry: applied ${applied}, ${remaining.length} still stuck`);
        for (const r of remaining) console.log(`  ! ${r.table}[${r.record?.id}]: ${r.lastError}`);
    }

    const after = await prisma.chatChannelMember.count({ where: { server_id: null } });
    console.log(`\nserver_id-null ChatChannelMember rows after: ${after}`);

    const stillNull = await prisma.chatChannelMember.findMany({
        where: { server_id: null },
        select: { id: true, channel_id: true, user_id: true, updated_at: true },
        orderBy: { id: 'asc' }
    });
    if (stillNull.length > 0) {
        console.log(`\nStill unsynced (${stillNull.length}):`);
        for (const r of stillNull) console.log(`  id=${r.id} channel=${r.channel_id} user=${r.user_id}`);
    }
}

main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
