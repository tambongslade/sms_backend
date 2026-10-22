import { SyncManager } from './sync-manager';
import { NetworkChecker } from './network-checker';

export class SyncService {
  private syncManager: SyncManager;
  private networkChecker: NetworkChecker;
  private isInitialized: boolean = false;

  constructor() {
    this.syncManager = new SyncManager();
    this.networkChecker = new NetworkChecker();
  }

  async initialize() {
    if (this.isInitialized) return;

    console.log('Initializing Sync Service...');

    // Check if this is the first run
    const isFirstRun = await this.isFirstRun();
    
    if (isFirstRun) {
      console.log('First run detected - performing initial sync');
      await this.performInitialSync();
    }

    // Start auto sync if configured
    const autoSyncInterval = parseInt(process.env.AUTO_SYNC_INTERVAL || '5');
    await this.syncManager.startAutoSync(autoSyncInterval);

    // Monitor network changes
    this.networkChecker.startNetworkMonitoring(async (isOnline) => {
      if (isOnline) {
        console.log('Network restored - triggering sync');
        await this.syncManager.performSync();
      }
    });

    this.isInitialized = true;
    console.log('Sync Service initialized successfully');
  }

  private async isFirstRun(): Promise<boolean> {
    // First run == no per-table cursor rows yet. SyncMetadata is no longer
    // written to under the per-table-cursor design, so checking it would
    // report "first run" every tick after deploy and repeatedly trigger the
    // initial-sync branch.
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    try {
      const cursor = await prisma.syncCursor.findFirst();
      return !cursor;
    } catch (error: any) {
      // Table might not exist yet (pre-migration)
      return true;
    }
  }

  private async performInitialSync() {
    const isOnline = await this.networkChecker.isOnline();
    
    if (!isOnline) {
      console.log('Offline mode - skipping initial sync');
      return;
    }

    try {
      // Perform full sync
      await this.syncManager.performSync();
      console.log('Initial sync completed');
    } catch (error: any) {
      console.error('Initial sync failed:', error.message);
    }
  }

  async shutdown() {
    console.log('Shutting down Sync Service...');
    this.syncManager.stopAutoSync();
    this.isInitialized = false;
  }

  // Public methods for manual control
  async triggerSync() {
    return await this.syncManager.performSync();
  }

  async getSyncStatus() {
    return await this.syncManager.getSyncStatus();
  }

  async getNetworkStatus() {
    return await this.networkChecker.getNetworkStatus();
  }
}