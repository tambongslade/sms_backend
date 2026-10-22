import axios, { AxiosInstance } from 'axios';
import { RemoteRecord } from './types';

export class ApiClient {
  private client: AxiosInstance;
  private remoteUrl: string;
  private apiKey: string;

  constructor() {
    // Deliberately no placeholder default. This used to fall back to
    // 'https://your-vps.com/api/sync' — a real, registrable domain — so a box
    // with REMOTE_SYNC_URL unset would happily POST school records to whoever
    // owned it. Empty means "no peer configured"; isConfigured() gates the calls.
    this.remoteUrl = process.env.REMOTE_SYNC_URL || '';
    this.apiKey = process.env.SYNC_API_KEY || '';

    this.client = axios.create({
      baseURL: this.remoteUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Server-ID': process.env.SERVER_ID || 'local'
      },
      timeout: 30000 // 30 seconds
    });
  }

  // True only when a peer URL is actually configured. Without this, every sync
  // call would fire at a relative path against no baseURL.
  isConfigured(): boolean {
    return this.remoteUrl.length > 0;
  }

  // The peer's own SERVER_ID, read from its open /sync/health endpoint and
  // cached. Needed to stamp pulled rows as foreign — see the echo-loop note in
  // DatabaseSyncer.pullRemoteChanges.
  private peerServerId: string | null = null;

  async getPeerServerId(): Promise<string | null> {
    if (this.peerServerId) return this.peerServerId;
    if (!this.isConfigured()) return null;
    try {
      const response = await this.client.get('/health');
      const id = response.data?.server_id ?? response.data?.serverId;
      this.peerServerId = id ? String(id) : null;
      return this.peerServerId;
    } catch {
      return null;
    }
  }

  // Row counts per synced table on the peer. Throws on any failure so callers can tell
  // "peer unreachable" (network code) from "peer too old" (404).
  // Like pushBatch, but a failure is thrown so the outbox can retry the rows.
  async pushRecordsStrict(tableName: string, records: any[]): Promise<void> {
    if (!this.isConfigured()) throw new Error('REMOTE_SYNC_URL is not configured — refusing to push');
    await this.client.post(`/receive/${tableName}`, { records, timestamp: new Date().toISOString() });
  }

  // Long-poll for the peer's queued changes after `after`; answers within `waitSeconds`.
  async pullOutbox(after: number, limit: number, waitSeconds: number): Promise<{
    entries: { id: number; table: string; recordId: number; record: any | null }[];
    maxId: number;
  }> {
    if (!this.isConfigured()) throw new Error('REMOTE_SYNC_URL is not configured');
    const response = await this.client.get('/outbox', {
      params: { after, limit, wait: waitSeconds },
      timeout: (waitSeconds + 20) * 1000,
    });
    return { entries: response.data?.entries ?? [], maxId: response.data?.maxId ?? after };
  }

  async getStats(tables?: string[]): Promise<{ serverId: string | null; stats: Record<string, { count: number | null; latest: string | null }> }> {
    if (!this.isConfigured()) throw new Error('REMOTE_SYNC_URL is not configured');
    const response = await this.client.get('/stats', { timeout: 20000, params: tables ? { tables: tables.join(',') } : undefined });
    return { serverId: response.data?.server_id ?? null, stats: response.data?.stats ?? {} };
  }

  async getChanges(tableName: string, lastSync: Date): Promise<RemoteRecord[]> {
    if (!this.isConfigured()) return [];
    try {
      const response = await this.client.get(`/changes/${tableName}`, {
        params: {
          since: lastSync.toISOString(),
          server_id: process.env.SERVER_ID
        }
      });

      return response.data.records || [];
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        console.log('Remote server unavailable - working offline');
        return [];
      }
      throw error;
    }
  }

  async pushRecord(tableName: string, record: any): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('REMOTE_SYNC_URL is not configured — refusing to push');
    }
    try {
      // Server exposes a single /sync/receive/:table endpoint that accepts
      // {records: [...]}. Single-record pushes wrap in a one-element array.
      await this.client.post(`/receive/${tableName}`, {
        records: [record],
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      if (error.response?.status === 409) {
        console.log(`Conflict detected for ${tableName}[${record.id}]`);
        throw new Error('Conflict detected');
      }
      throw error;
    }
  }

  async pushBatch(tableName: string, records: any[]): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('REMOTE_SYNC_URL is not configured — refusing to push');
    }
    const batchSize = 100;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);

      try {
        await this.client.post(`/receive/${tableName}`, {
          records: batch,
          timestamp: new Date().toISOString()
        });
      } catch (error: any) {
        console.error(`Batch push failed for ${tableName}:`, error.message);
      }
    }
  }

  async getServerInfo(): Promise<any> {
    try {
      const response = await this.client.get('/status');
      return response.data;
    } catch (error: any) {
      return null;
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      await this.client.get('/health');
      return true;
    } catch (error: any) {
      return false;
    }
  }
}