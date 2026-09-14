import prisma, { Prisma } from '../config/db';
import { SyncResult, SyncConflict, ConflictResolution, RemoteRecord, DeferredRecord } from './types';
import { ConflictResolver } from './conflict-resolver';
import { ApiClient } from './api-client';
import * as crypto from 'crypto';

export class DatabaseSyncer {
  private conflictResolver: ConflictResolver;
  private apiClient: ApiClient;

  constructor() {
    this.conflictResolver = new ConflictResolver();
    this.apiClient = new ApiClient();
  }

  // Exposed so SyncManager can refuse a sync run outright when no peer is set,
  // instead of failing once per record deep inside pushLocalChanges.
  isRemoteConfigured(): boolean {
    return this.apiClient.isConfigured();
  }

  // Field names per model, straight from the generated schema. Used to map
  // incoming keys onto what Prisma actually accepts.
  private static fieldCache = new Map<string, Set<string>>();

  // Every @@unique on a model, as DMMF reports it.
  private static uniqueCache = new Map<string, string[][]>();

  // Primary keys are not portable between nodes. Both sides mint
  // TeacherPeriod.id from their own autoincrement sequence, so one real
  // timetable slot is id 930 here and id 1523 on the peer. Matching an
  // incoming row on id alone therefore concludes "new" for a row that already
  // exists, and the insert then dies on the @@unique it was always going to
  // hit — 32 rows per run, every run, for as long as both sides keep editing.
  //
  // The natural key is what actually identifies the row across nodes, and DMMF
  // already knows it, so this stays generic instead of hardcoding TeacherPeriod:
  // Enrollment collides the same way on (student_id, academic_year_id).
  private naturalKeysOf(tableName: string): string[][] {
    const cached = DatabaseSyncer.uniqueCache.get(tableName);
    if (cached) return cached;

    const model = (Prisma as any).dmmf?.datamodel?.models?.find(
      (m: any) => m.name === tableName
    );
    const keys: string[][] = (model?.uniqueFields ?? []).filter(
      (k: string[]) => Array.isArray(k) && k.length > 0
    );
    DatabaseSyncer.uniqueCache.set(tableName, keys);
    return keys;
  }

  // The local row an incoming record would collide with, found by natural key
  // rather than id. A key with a null or absent part is skipped: SQL uniqueness
  // does not constrain nulls, so it would match the wrong row or none at all.
  private async findByNaturalKey(model: any, tableName: string, remoteRecord: RemoteRecord) {
    for (const key of this.naturalKeysOf(tableName)) {
      if (key.some(f => remoteRecord[f] === undefined || remoteRecord[f] === null)) continue;

      const where: any = {};
      for (const f of key) where[f] = remoteRecord[f];

      const hit = await model.findFirst({ where });
      if (hit) return hit;
    }
    return null;
  }

  private fieldsOf(tableName: string): Set<string> {
    const cached = DatabaseSyncer.fieldCache.get(tableName);
    if (cached) return cached;

    const model = (Prisma as any).dmmf?.datamodel?.models?.find(
      (m: any) => m.name === tableName
    );
    const names = new Set<string>((model?.fields ?? []).map((f: any) => f.name));
    DatabaseSyncer.fieldCache.set(tableName, names);
    return names;
  }

  // Records arriving from a peer may be camelCase: app.ts applied
  // convertSnakeToCamelCase globally, above the sync routes, so
  // GET /sync/changes/:table served "serverId"/"updatedAt" and every Prisma
  // write on this side rejected them. app.ts now mounts sync ahead of that
  // middleware, but a peer running an older build still camelCases, so
  // normalise defensively on receipt.
  //
  // Converting every camelCase key to snake_case is wrong, though: this schema
  // is snake_case except for SubClassSubject.userId, which a blind conversion
  // turned into user_id and Prisma rejected — all 397 rows of that table. So
  // check the real field list: keep a key that already matches, convert only
  // when the snake_case form is the one the model declares, and otherwise leave
  // it alone so genuine schema drift still surfaces as an error.
  //
  // Keys are handled one level only — these are flat Prisma rows, and recursing
  // would turn Date values into {}.
  private toSnakeKeys(record: any, tableName?: string): any {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record;

    const fields = tableName ? this.fieldsOf(tableName) : null;
    const out: any = {};

    for (const key of Object.keys(record)) {
      const snake = key.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
      let target = key;
      if (fields && fields.size > 0) {
        if (fields.has(key)) target = key;
        else if (fields.has(snake)) target = snake;
      } else {
        target = snake;
      }
      out[target] = record[key];
    }
    return out;
  }

  // Prisma exposes delegates in camelCase ("SubClass" -> prisma.subClass), so
  // lowercasing the whole name only resolves for single-word models. Every
  // multi-word table (AcademicYear, PaymentTransaction, ...) returned undefined
  // and threw "Model not found", which syncTable swallowed into result.errors —
  // sync reported COMPLETED while silently skipping half its tables.
  private modelFor(tableName: string) {
    const key = tableName.charAt(0).toLowerCase() + tableName.slice(1);
    const model = (prisma as any)[key];
    if (!model) throw new Error(`Model ${tableName} not found (prisma.${key} is undefined)`);
    return model;
  }

  // Whether an incoming record is older than what we already have and should
  // be ignored rather than overwrite our fresher state.
  //
  // The receive path used to call updateRecord unconditionally, and because
  // Prisma preserves an explicit updated_at in a mutation payload, a peer
  // pushing a stale copy silently rewound both the row's data AND its
  // updated_at back to the peer's old timestamp. That is how the VPS lost
  // fresh admin password resets: the school node still held the pre-reset
  // User row, pushed it up on the next sync, and the receive handler wrote it
  // over the reset — hash, must_change_password, server_id, updated_at, all
  // reverted, with nothing in the log to explain it.
  //
  // Strict "greater than": equal timestamps are not stale (same write, just
  // acknowledged), and missing timestamps fall through to the old behaviour
  // rather than block writes on tables that never had updated_at.
  private isIncomingStale(local: any, incoming: any): boolean {
    if (!local || !incoming) return false;
    const localAt = local.updated_at ? new Date(local.updated_at).getTime() : NaN;
    const incomingAt = incoming.updated_at ? new Date(incoming.updated_at).getTime() : NaN;
    if (Number.isNaN(localAt) || Number.isNaN(incomingAt)) return false;
    return localAt > incomingAt;
  }

  async syncTable(tableName: string, lastSync: Date): Promise<SyncResult> {
    const result: SyncResult = {
      recordsProcessed: 0,
      conflicts: [],
      errors: [],
      deferred: []
    };

    try {
      // Get local changes since last sync
      const localChanges = await this.getLocalChanges(tableName, lastSync);

      // Get remote changes since last sync
      const remoteChanges = await this.getRemoteChanges(tableName, lastSync);

      // Push local changes to remote
      await this.pushLocalChanges(tableName, localChanges, result);

      // Pull remote changes to local
      await this.pullRemoteChanges(tableName, remoteChanges, result);

      // The pull just inserted rows carrying the peer's ids, which leaves this
      // table's sequence behind them. Bring it back in step before any local
      // create() is handed a duplicate.
      await this.resyncSequence(tableName);

      console.log(`Synced ${tableName}: ${result.recordsProcessed} records`);

    } catch (error: any) {
      result.errors.push(`Table ${tableName}: ${error.message}`);
    }

    return result;
  }

  async getLocalChanges(tableName: string, lastSync: Date) {
    const model = this.modelFor(tableName);

    // Only push records that originated locally (or predate the sync system).
    // Records with a foreign server_id were just pulled from remote — pushing
    // them back creates an echo loop and manufactures phantom conflicts.
    const localServerId = process.env.SERVER_ID || 'local';

    return await model.findMany({
      where: {
        updated_at: { gt: lastSync },
        OR: [
          { server_id: null },
          { server_id: localServerId }
        ]
      }
    });
  }

  private async getRemoteChanges(tableName: string, lastSync: Date): Promise<RemoteRecord[]> {
    return await this.apiClient.getChanges(tableName, lastSync);
  }

  private async pushLocalChanges(tableName: string, localChanges: any[], result: SyncResult) {
    for (const record of localChanges) {
      try {
        // Add server metadata
        const syncRecord = {
          ...record,
          server_id: process.env.SERVER_ID || 'local',
          checksum: this.generateChecksum(record)
        };

        await this.apiClient.pushRecord(tableName, syncRecord);
        result.recordsProcessed++;

      } catch (error: any) {
        result.errors.push(`Push ${tableName}[${record.id}]: ${error.message}`);
      }
    }
  }

  private async pullRemoteChanges(tableName: string, remoteChanges: RemoteRecord[], result: SyncResult) {
    const model = this.modelFor(tableName);

    // Rows that predate the sync system carry server_id null, and
    // getLocalChanges reads null as "written here" so it can push pre-sync
    // history once. On a freshly seeded node that reasoning inverts: every row
    // is null and every row is in fact the peer's, so the next run pushed the
    // peer's own data straight back at it. That is not hypothetical — it
    // stamped 6370 production rows with this node's SERVER_ID, and because the
    // peer only serves `server_id IS NULL OR server_id = <its own>`, those rows
    // stopped being visible to any other node.
    //
    // So anything arriving without provenance is attributed to the peer it came
    // from, which is the truth about where it came from.
    const peerId = await this.apiClient.getPeerServerId();

    for (const rawRemote of remoteChanges) {
      const remoteRecord = this.toSnakeKeys(rawRemote, tableName) as RemoteRecord;
      if (peerId && !remoteRecord.server_id) {
        remoteRecord.server_id = peerId;
      }
      try {
        // Check if record exists locally, by id first and then by natural key.
        // Only a record that is absent under both is genuinely new; anything
        // found the second way is the same row wearing the peer's id, and has
        // to be updated in place under the id this node already gave it.
        let localRecord = await model.findUnique({
          where: { id: remoteRecord.id }
        });

        if (!localRecord) {
          localRecord = await this.findByNaturalKey(model, tableName, remoteRecord);
        }

        if (!localRecord) {
          // New record - insert. The remote record is a flat Prisma row.
          await this.insertRecord(model, remoteRecord);
          result.recordsProcessed++;

        } else {
          // Existing record - check for conflicts
          const conflict = await this.detectConflict(tableName, localRecord, remoteRecord);

          if (conflict) {
            const resolution = await this.conflictResolver.resolve(conflict);
            result.conflicts.push(resolution);

            if (resolution.resolution !== ConflictResolution.MANUAL) {
              await this.applyResolution(model, resolution);
              result.recordsProcessed++;
            }
          } else {
            // No conflict - update. Addressed by the LOCAL id: when the match
            // came from the natural key the two ids differ, and using the
            // remote's would update a different row, or none.
            if (this.isIncomingStale(localRecord, remoteRecord)) {
              // Same overwrite risk as the receive path — a checksum match
              // still routes here, but same-server pulls with an older payload
              // would clobber a fresher local write.
              console.log(
                `[SYNC] Skipping stale pull ${tableName}[${localRecord.id}]: local updated_at ${localRecord.updated_at?.toISOString?.() ?? localRecord.updated_at} > remote ${remoteRecord.updated_at}`
              );
            } else {
              await this.updateRecord(model, String(localRecord.id), remoteRecord);
              result.recordsProcessed++;
            }
          }
        }

      } catch (error: any) {
        // A missing referenced row is usually a timing problem, not a real
        // failure: the target may belong to a table later in the run, or to
        // another row of this same table (Class -> Class via next_class_id).
        // Hold it back for the retry pass instead of burning it as an error.
        if (this.isMissingReferenceError(error)) {
          result.deferred.push({
            table: tableName,
            record: remoteRecord,
            lastError: this.shortError(error)
          });
        } else {
          result.errors.push(`Pull ${tableName}[${remoteRecord.id}]: ${this.shortError(error)}`);
        }
      }
    }
  }

  // P2003 is Prisma's foreign-key constraint failure. P2025 ("required record
  // not found") shows up for the same underlying cause on some update paths.
  private isMissingReferenceError(error: any): boolean {
    if (error?.code === 'P2003' || error?.code === 'P2025') return true;
    return typeof error?.message === 'string'
      && error.message.includes('Foreign key constraint');
  }

  // Prisma renders a multi-line source excerpt into error.message; keep the
  // meaningful tail so a run with thousands of failures stays readable.
  private shortError(error: any): string {
    const msg = String(error?.message ?? error);
    const constraint = msg.match(/Foreign key constraint violated:? `?([^`\n]+)`?/);
    if (constraint) return `FK violation: ${constraint[1].trim()}`;
    return msg.split('\n').map(l => l.trim()).filter(Boolean).pop() || msg;
  }

  // Retry a batch of held-back records. Returns the ones that still failed, so
  // the caller can loop until a pass stops making progress.
  async retryDeferred(deferred: DeferredRecord[]): Promise<{ applied: number; remaining: DeferredRecord[] }> {
    let applied = 0;
    const remaining: DeferredRecord[] = [];
    // Deferred records insert explicit ids too, on a path syncTable never sees.
    const touched = new Set<string>();

    for (const item of deferred) {
      try {
        await this.processIncomingRecord(item.table, item.record);
        applied++;
        touched.add(item.table);
      } catch (error: any) {
        remaining.push({ ...item, lastError: this.shortError(error) });
      }
    }

    for (const table of touched) await this.resyncSequence(table);

    return { applied, remaining };
  }

  private async detectConflict(tableName: string, localRecord: any, remoteRecord: RemoteRecord): Promise<SyncConflict | null> {
    // Skip if same server
    if (localRecord.server_id === remoteRecord.server_id) {
      return null;
    }

    // Check if both records were modified after last sync
    const localChecksum = this.generateChecksum(localRecord);
    const remoteChecksum = remoteRecord.checksum;

    if (localChecksum !== remoteChecksum) {
      // RemoteRecord is a flat Prisma row (see types.ts) — passing
      // remoteRecord.data here iterated `undefined`, so this always found zero
      // conflicting fields and every remote row silently overwrote the local one.
      const conflictingFields = this.findConflictingFields(localRecord, remoteRecord);

      if (conflictingFields.length > 0) {
        return {
          table: tableName,
          recordId: localRecord.id.toString(),
          field: conflictingFields[0], // Handle first conflict
          localValue: localRecord[conflictingFields[0]],
          remoteValue: remoteRecord[conflictingFields[0]],
          localUpdatedAt: localRecord.updated_at,
          remoteUpdatedAt: remoteRecord.updated_at,
          resolution: ConflictResolution.TIMESTAMP_WINS,
          resolvedValue: null
        };
      }
    }

    return null;
  }

  private findConflictingFields(localRecord: any, remoteRecord: RemoteRecord): string[] {
    const conflicts: string[] = [];
    const excludeFields = ['id', 'created_at', 'updated_at', 'server_id', 'checksum'];

    for (const field in remoteRecord) {
      if (excludeFields.includes(field)) continue;

      if (JSON.stringify(localRecord[field]) !== JSON.stringify(remoteRecord[field])) {
        conflicts.push(field);
      }
    }

    return conflicts;
  }

  // A row inserted with its peer's explicit id does not advance this table's
  // autoincrement sequence: Postgres only bumps it when the id comes from
  // nextval(). So after a pull the sequence still points wherever the last
  // *local* insert left it, and the next local create() is handed an id the
  // peer already occupies -- "Unique constraint failed on the fields: (`id`)".
  //
  // Not hypothetical: SubjectTeacher sat at 106 with rows up to 238, so every
  // attempt to assign a teacher a subject returned a 500, and thirteen other
  // tables had drifted the same way (TeacherPeriod 277 vs 1693, Enrollment
  // 7743 vs 7832). Nothing in the sync surfaced it, because the sync itself
  // works fine -- it is only local inserts afterwards that fail.
  //
  // Only ever moved forward. If the sequence is already ahead of max(id) it is
  // left alone: a concurrent request may hold the next value uncommitted, and
  // rewinding onto it would hand the same id out twice.
  async resyncSequence(tableName: string): Promise<void> {
    // tableName reaches this from a route parameter as well as SYNC_TABLES,
    // and it is interpolated into raw SQL below.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) return;

    try {
      const seqRow: any[] = await prisma.$queryRawUnsafe(
        `SELECT pg_get_serial_sequence('"${tableName}"', 'id') AS seq`
      );
      const seq = seqRow?.[0]?.seq;
      if (!seq) return; // no serial id column - nothing to keep in step

      const info: any[] = await prisma.$queryRawUnsafe(
        `SELECT (SELECT COALESCE(MAX(id), 0) FROM "${tableName}") AS maxid,
                s.last_value, s.is_called
           FROM ${seq} s`
      );
      const maxId = Number(info[0].maxid);
      const nextValue = Number(info[0].last_value) + (info[0].is_called ? 1 : 0);
      if (nextValue > maxId) return;

      await prisma.$executeRawUnsafe(`SELECT setval('${seq}', ${maxId}, true)`);
      console.log(`Sequence ${tableName}: was handing out ${nextValue}, advanced to ${maxId + 1}`);
    } catch (error: any) {
      // Never fail a sync over this. A stale sequence breaks later local
      // inserts, not the replication, so warn and carry on.
      console.warn(`Could not resync sequence for ${tableName}: ${error.message}`);
    }
  }

  private async insertRecord(model: any, data: any) {
    // Preserve server_id and checksum from the remote payload so
    // getLocalChanges can later filter out records that originated remotely
    // (echo-loop prevention). The Prisma middleware in db.ts sees server_id
    // is already present and won't overwrite it.
    await model.create({ data });
  }

  private async updateRecord(model: any, id: string, data: any) {
    // Never carry the incoming id into the update. Where the row was matched
    // by natural key the peer's id belongs to a different row on this node,
    // and writing it would renumber the primary key onto a value another row
    // may already hold. The id to keep is the one being updated.
    const { id: _incomingId, ...rest } = data;

    await model.update({
      where: { id: parseInt(id) },
      data: rest
    });
  }

  private async applyResolution(model: any, resolution: SyncConflict) {
    await model.update({
      where: { id: parseInt(resolution.recordId) },
      data: {
        [resolution.field]: resolution.resolvedValue
      }
    });
  }

  private generateChecksum(record: any): string {
    const { id, created_at, updated_at, server_id, checksum, ...data } = record;
    return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
  }

  // Additional methods needed by SyncManager

  async processIncomingRecord(tableName: string, rawRecord: any, attributeTo?: string) {
    const model = this.modelFor(tableName);
    const record = this.toSnakeKeys(rawRecord, tableName);
    // Same attribution rule as pullRemoteChanges: a record with no provenance
    // belongs to whoever sent it, never to us, or the next run pushes it back.
    if (attributeTo && !record.server_id) {
      record.server_id = attributeTo;
    }

    try {
      // By id first, then by natural key. Only a record absent under both is
      // genuinely new; one found the second way is the same row wearing the
      // peer's id, and belongs under the id this node already gave it.
      //
      // pullRemoteChanges has matched this way since the TeacherPeriod
      // collisions (32 rows dying on the @@unique every single run), but this
      // path did not — so /sync/receive and the deferred-retry pass kept
      // rediscovering them. 52 TeacherPeriod slots currently exist on both
      // nodes under different ids for exactly that reason.
      let existing = await model.findUnique({
        where: { id: record.id }
      });

      if (!existing) {
        existing = await this.findByNaturalKey(model, tableName, record as RemoteRecord);
      }

      if (existing) {
        // Addressed by the LOCAL id: where the match came from the natural key
        // the two ids differ, and writing the peer's would update a different
        // row, or none at all.
        if (this.isIncomingStale(existing, record)) {
          console.log(
            `[SYNC] Skipping stale ${tableName}[${existing.id}] from peer: local updated_at ${existing.updated_at?.toISOString?.() ?? existing.updated_at} > incoming ${record.updated_at}`
          );
          return;
        }
        await this.updateRecord(model, String(existing.id), record);
      } else {
        await this.insertRecord(model, record);
      }
    } catch (error: any) {
      // Logged short, not raw: Prisma embeds a multi-line source excerpt in
      // error.message, and the retry pass calls this once per held-back record —
      // 2481 of those buried the actual summary. The caller groups and reports
      // these, so one line each is enough to trace.
      console.error(`Error processing ${tableName}[${record.id}]: ${this.shortError(error)}`);
      throw error;
    }
  }
}