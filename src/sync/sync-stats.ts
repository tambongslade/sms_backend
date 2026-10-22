import prisma from '../config/db';

export type TableStat = { count: number | null; latest: string | null };

// Tables that exist in the public schema; the only names ever interpolated into SQL.
async function listPublicTables(): Promise<string[]> {
    const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`
    );
    return rows.map(r => r.table_name);
}

const readTable = async (table: string): Promise<TableStat> => {
    for (const column of ['updated_at', 'created_at']) {
        try {
            const rows = await prisma.$queryRawUnsafe<{ count: number; latest: Date | null }[]>(
                `SELECT COUNT(*)::int AS count, MAX("${column}") AS latest FROM "${table}"`
            );
            return { count: rows[0].count, latest: rows[0].latest ? new Date(rows[0].latest).toISOString() : null };
        } catch {
            // column missing: try the next one
        }
    }
    try {
        const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(`SELECT COUNT(*)::int AS count FROM "${table}"`);
        return { count: rows[0].count, latest: null };
    } catch {
        return { count: null, latest: null };
    }
};

// Row count and newest change time per table. `tables` is filtered against the real
// table list; without it every public table is read.
export async function getTableStats(tables?: string[]): Promise<Record<string, TableStat>> {
    const existing = new Set(await listPublicTables());
    const queue = (tables ?? [...existing]).filter(t => existing.has(t));
    const stats: Record<string, TableStat> = {};
    const workers = Array.from({ length: 6 }, async () => {
        while (queue.length > 0) {
            const table = queue.shift()!;
            stats[table] = await readTable(table);
        }
    });
    await Promise.all(workers);
    return stats;
}
