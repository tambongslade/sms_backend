// src/server.ts
import http from 'http';
import app from './app';
import dotenv from 'dotenv';
import { AddressInfo } from 'net';
// import { scheduleAverageCalculations } from './scripts/scheduledTasks';
import { SyncService } from './sync/sync-service';
import { initRealtime } from './realtime/socket';
import { attachRelayServer, startRelayClient } from './filemanagement/relay';
import { seedChatChannels } from './scripts/seedChatChannels';
import { warmUp } from './api/v1/services/aiAssistant/ollamaClient';

// Load environment variables (if not already loaded in app.ts)
dotenv.config();

// Get port from environment variable or use default port (with fallbacks)
const DEFAULT_PORT = 4000;
const PORT = parseInt(process.env.PORT || DEFAULT_PORT.toString(), 10);

// Initialize sync service
const syncService = new SyncService();

// Sync and channel seeding are singleton work: they must run on exactly one
// process. Under PM2 cluster mode every worker boots this file, so without a
// gate an N-worker deployment starts N concurrent bidirectional syncs against
// the same peer — N times the load, interleaved writes to the same rows, and N
// racing watermark updates.
//
// PM2 sets NODE_APP_INSTANCE to the worker ordinal, so worker 0 is elected.
// SYNC_ENABLED overrides either way for deployments that want a dedicated sync
// process. A plain `node dist/server.js` sets neither and keeps syncing, so
// single-process behaviour is unchanged.
function isSyncInstance(): boolean {
    if (process.env.SYNC_ENABLED === 'false') return false;
    if (process.env.SYNC_ENABLED === 'true') return true;
    const ordinal = process.env.NODE_APP_INSTANCE;
    return ordinal === undefined || ordinal === '0';
}

const SYNC_INSTANCE = isSyncInstance();

// Function to start server with automatic port selection if default is in use
function startServer(port: number) {
    const httpServer = http.createServer(app);
    initRealtime(httpServer);
    // File Management relay: the online server accepts the school server's socket here (FILE_RELAY_SERVER=on)
    if (process.env.FILE_RELAY_SERVER === 'on') attachRelayServer(httpServer);

    const server = httpServer.listen(port, () => {
        const addressInfo = server.address() as AddressInfo;
        if (addressInfo) {
            console.log(`Server is running on port ${addressInfo.port}`);
            console.log(`API documentation available at http://localhost:${addressInfo.port}/api-docs`);
            console.log(`WebSocket (Socket.IO) available at ws://localhost:${addressInfo.port}/socket.io`);
        } else {
            console.log(`Server is running on port ${port}`);
            console.log(`API documentation available at http://localhost:${port}/api-docs`);
        }

        // Start scheduled tasks
        // scheduleAverageCalculations();

        // Initialize sync service — primary worker only (see isSyncInstance)
        if (SYNC_INSTANCE) {
            syncService.initialize().catch(console.error);
            // School server: keep the outbound socket to the online server for File Management (FILE_RELAY_CLIENT=on)
            startRelayClient();
            // Seed department / subject chat channels (idempotent, but there is
            // no reason for every worker to race on it)
            seedChatChannels().catch(err => console.error('seedChatChannels failed:', err));
            // Load the model into each inference lane now rather than making
            // the first person to ask a question wait ~7 s for it. Primary
            // worker only: twelve workers warming the same two lanes would
            // just queue twelve identical loads behind each other.
            warmUp().catch(() => { /* a cold first question is slow, not broken */ });
        } else {
            console.log(
                `Worker ${process.env.NODE_APP_INSTANCE}: sync and channel seeding skipped (primary only)`
            );
        }
    })
        .on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EACCES') {
                console.log(`Port ${port} requires elevated privileges. Trying port ${port + 1000}...`);
                startServer(port + 1000); // Try a higher port number
            } else if (error.code === 'EADDRINUSE') {
                console.log(`Port ${port} is already in use. Trying port ${port + 1}...`);
                startServer(port + 1); // Try next port
            } else {
                console.error('Server error:', error);
            }
        });
}
console.log("Starting server on port", PORT);
// Start the server
startServer(PORT);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (SYNC_INSTANCE) await syncService.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  if (SYNC_INSTANCE) await syncService.shutdown();
  process.exit(0);
});
