import { Server as SocketIOServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import prisma from '../config/db';
import { isTokenBlacklisted } from '../api/v1/services/tokenBlacklistService';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
}

interface AuthenticatedSocketData {
    userId: number;
    userName: string;
    roles: string[];
    token: string;
}

let ioInstance: SocketIOServer | null = null;

// ---------- Presence store (multi-tab aware) ----------
//
// The local Map holds this worker's own sockets. It cannot answer "is user X
// online" once there is more than one worker, because a user connected to
// worker 3 is invisible to worker 1 — everyone would look offline to most of
// their colleagues. So presence is mirrored into Redis, which every worker
// shares, and Redis is authoritative for lookups whenever it is configured.
//
// The Map stays as the local source of truth for connect/disconnect
// transitions (which are inherently per-socket, so per-worker) and as the
// fallback for single-process runs with no REDIS_URL.

interface PresenceEntry {
    sockets: Set<string>;      // Active socket ids for this user
    lastSeenAt: Date | null;   // Set when the last socket disconnects
}

const presence = new Map<number, PresenceEntry>();

// Set once by initRealtime. Null means single-process mode.
let presenceRedis: IORedis | null = null;

// Sockets are keyed per worker so a crashed worker's entries can be dropped
// wholesale on its next boot; otherwise its users would appear online forever.
const WORKER_ID = process.env.NODE_APP_INSTANCE ?? '0';
const presenceKey = (userId: number) => `presence:sockets:${userId}`;
const workerMember = (socketId: string) => `${WORKER_ID}:${socketId}`;
// Entries are refreshed on every connect; the TTL is a backstop against leaks.
const PRESENCE_TTL_SECONDS = 60 * 60 * 12;

async function markOnline(userId: number, socketId: string): Promise<boolean> {
    let entry = presence.get(userId);
    const wasOfflineLocally = !entry || entry.sockets.size === 0;
    if (!entry) {
        entry = { sockets: new Set(), lastSeenAt: null };
        presence.set(userId, entry);
    }
    entry.sockets.add(socketId);

    if (!presenceRedis) return wasOfflineLocally;

    try {
        // The count BEFORE adding decides whether this is a genuine
        // offline->online transition across the whole cluster, not just here.
        const before = await presenceRedis.scard(presenceKey(userId));
        await presenceRedis
            .multi()
            .sadd(presenceKey(userId), workerMember(socketId))
            .expire(presenceKey(userId), PRESENCE_TTL_SECONDS)
            .exec();
        return before === 0;
    } catch {
        return wasOfflineLocally;
    }
}

async function markOffline(userId: number, socketId: string): Promise<boolean> {
    const entry = presence.get(userId);
    if (entry) {
        entry.sockets.delete(socketId);
        if (entry.sockets.size === 0) entry.lastSeenAt = new Date();
    }

    if (!presenceRedis) return !!entry && entry.sockets.size === 0;

    try {
        await presenceRedis.srem(presenceKey(userId), workerMember(socketId));
        // Fully offline only when no worker still holds a socket for them.
        return (await presenceRedis.scard(presenceKey(userId))) === 0;
    } catch {
        return !!entry && entry.sockets.size === 0;
    }
}

export async function getBatchPresence(
    userIds: number[]
): Promise<Record<number, { online: boolean; last_seen_at: Date | null }>> {
    const out: Record<number, { online: boolean; last_seen_at: Date | null }> = {};

    if (presenceRedis) {
        try {
            const pipeline = presenceRedis.pipeline();
            for (const id of userIds) pipeline.scard(presenceKey(id));
            const results = await pipeline.exec();
            userIds.forEach((id, i) => {
                const count = Number(results?.[i]?.[1] ?? 0);
                out[id] = {
                    online: count > 0,
                    last_seen_at: count > 0 ? null : (presence.get(id)?.lastSeenAt ?? null),
                };
            });
            return out;
        } catch {
            // fall through to the local view rather than reporting everyone offline
        }
    }

    for (const id of userIds) {
        const entry = presence.get(id);
        out[id] = {
            online: !!(entry && entry.sockets.size > 0),
            last_seen_at: entry?.sockets.size === 0 ? entry.lastSeenAt : null,
        };
    }
    return out;
}

export async function isOnline(userId: number): Promise<boolean> {
    if (presenceRedis) {
        try {
            return (await presenceRedis.scard(presenceKey(userId))) > 0;
        } catch { /* fall through */ }
    }
    const entry = presence.get(userId);
    return !!(entry && entry.sockets.size > 0);
}

// Drop any presence this worker registered before it restarted. Without it a
// worker that crashed with live sockets leaves those users online forever.
async function clearStalePresenceForWorker(client: IORedis) {
    try {
        const prefix = `${WORKER_ID}:`;
        let cursor = '0';
        do {
            const [next, keys] = await client.scan(cursor, 'MATCH', 'presence:sockets:*', 'COUNT', 500);
            cursor = next;
            for (const key of keys) {
                const members = await client.smembers(key);
                const mine = members.filter(m => m.startsWith(prefix));
                if (mine.length > 0) await client.srem(key, ...mine);
            }
        } while (cursor !== '0');
    } catch (err: any) {
        console.warn('presence: stale-entry cleanup failed:', err?.message ?? err);
    }
}

// ---------- Typing timers ----------
// (userId, channelId) -> NodeJS.Timeout — auto-emit typing.stop after 6s of silence.
const typingTimers = new Map<string, NodeJS.Timeout>();
const TYPING_TIMEOUT_MS = 6_000;

function typingKey(userId: number, channelId: number): string {
    return `${userId}:${channelId}`;
}

function clearTypingTimer(userId: number, channelId: number): void {
    const t = typingTimers.get(typingKey(userId, channelId));
    if (t) {
        clearTimeout(t);
        typingTimers.delete(typingKey(userId, channelId));
    }
}

function scheduleTypingStop(io: SocketIOServer, userId: number, userName: string, channelId: number): void {
    clearTypingTimer(userId, channelId);
    const t = setTimeout(() => {
        io.to(`channel:${channelId}`).except(`user:${userId}`).emit('typing.stop', {
            channelId,
            userId,
            userName,
        });
        typingTimers.delete(typingKey(userId, channelId));
    }, TYPING_TIMEOUT_MS);
    typingTimers.set(typingKey(userId, channelId), t);
}

// ---------- Emitters used by services ----------

export function getIO(): SocketIOServer | null {
    return ioInstance;
}

export function initRealtime(httpServer: HttpServer): SocketIOServer {
    const io = new SocketIOServer(httpServer, {
        cors: {
            origin: process.env.ALLOWED_ORIGINS?.split(',') || [
                'http://localhost:3000',
                'http://localhost:3001',
                'https://sms.sniperbuisnesscenter.com',
            ],
            credentials: true,
            methods: ['GET', 'POST'],
        },
        path: '/socket.io',
    });

    // Without this, each worker only reaches the sockets it personally holds:
    // a message emitted on worker 3 never arrives for a recipient connected to
    // worker 1, so with N workers roughly (N-1)/N of chat traffic disappears.
    // The Redis adapter fans every emit out across workers.
    //
    // Skipped when REDIS_URL is unset so a single-process dev run needs no
    // Redis; that is safe precisely because one process holds every socket.
    if (process.env.REDIS_URL) {
        const pubClient = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
        const subClient = pubClient.duplicate();
        io.adapter(createAdapter(pubClient, subClient));

        // Separate connection: the adapter's clients are dedicated to pub/sub
        // and cannot serve normal commands.
        presenceRedis = pubClient.duplicate();
        clearStalePresenceForWorker(presenceRedis).catch(() => { /* logged inside */ });

        console.log('Socket.IO: Redis adapter attached (cross-worker broadcast + presence)');
    } else {
        console.log('Socket.IO: no REDIS_URL — single-process broadcast and presence only');
    }

    io.use(async (socket: Socket, next) => {
        try {
            const token =
                (socket.handshake.auth?.token as string | undefined) ||
                (socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '') as string | undefined);

            if (!token) return next(new Error('unauthorized: no token'));
            if (isTokenBlacklisted(token)) return next(new Error('unauthorized: token blacklisted'));

            const decoded = jwt.verify(token, JWT_SECRET) as { id: number; role?: string[] };
            const user = await prisma.user.findUnique({
                where: { id: decoded.id },
                select: { name: true, user_roles: { select: { role: true } } },
            });
            const data: AuthenticatedSocketData = {
                userId: decoded.id,
                userName: user?.name ?? 'User',
                // From the database, not the token's `role` claim: a token is a
                // 120-day snapshot of sign-in time, so a role changed or revoked
                // since then would still be honoured here. This handshake
                // already loads the user, so it costs nothing extra. Nothing
                // reads socket.data.roles today — this keeps it from becoming a
                // trap for whoever does.
                roles: [...new Set((user?.user_roles ?? []).map(ur => ur.role as string))],
                token,
            };
            (socket.data as AuthenticatedSocketData) = data;
            next();
        } catch (err: any) {
            next(new Error(`unauthorized: ${err.message}`));
        }
    });

    io.on('connection', async (socket) => {
        const { userId, userName } = socket.data as AuthenticatedSocketData;
        socket.join(`user:${userId}`);

        // Load channel memberships and auto-join channel rooms
        try {
            const memberships = await prisma.chatChannelMember.findMany({
                where: { user_id: userId },
                select: { channel_id: true },
            });
            for (const m of memberships) {
                socket.join(`channel:${m.channel_id}`);
            }
        } catch (err) {
            console.error('Socket: failed to load memberships for user', userId, err);
        }

        // Presence: mark online. Fan out to everyone who might care.
        const wasOffline = await markOnline(userId, socket.id);
        if (wasOffline) {
            const onlineAt = new Date();
            io.emit('presence.online', { userId, onlineAt });
            io.emit('presence', { userId, status: 'online' }); // legacy compat
        }

        // ---------- Legacy events (kept for back-compat) ----------

        socket.on('typing', (payload: { channelId: number }) => {
            if (!payload?.channelId) return;
            socket.to(`channel:${payload.channelId}`).emit('typing', {
                userId,
                userName,
                channelId: payload.channelId,
            });
            // Also treat legacy `typing` as `typing.start` — schedule the auto-stop.
            scheduleTypingStop(io, userId, userName, payload.channelId);
        });

        socket.on('presence', () => {
            io.emit('presence', { userId, status: 'online' });
        });

        // ---------- Advanced events ----------

        // typing.start — broadcast to peers (not sender) with the sender's name;
        // server keeps a 6s timer and auto-emits typing.stop if not renewed.
        socket.on('typing.start', async (payload: { channelId: number }) => {
            if (!payload?.channelId) return;
            const member = await prisma.chatChannelMember.findUnique({
                where: { channel_id_user_id: { channel_id: payload.channelId, user_id: userId } },
            });
            if (!member) return; // silently drop if not a member
            io.to(`channel:${payload.channelId}`)
                .except(`user:${userId}`)
                .emit('typing.start', {
                    channelId: payload.channelId,
                    userId,
                    userName,
                });
            scheduleTypingStop(io, userId, userName, payload.channelId);
        });

        socket.on('typing.stop', (payload: { channelId: number }) => {
            if (!payload?.channelId) return;
            clearTypingTimer(userId, payload.channelId);
            io.to(`channel:${payload.channelId}`)
                .except(`user:${userId}`)
                .emit('typing.stop', {
                    channelId: payload.channelId,
                    userId,
                    userName,
                });
        });

        // message.delivered — client's ack that a message.new was received.
        // Server relays to the original sender so their message can flip
        // from "sent" (one check) to "delivered" (two checks).
        socket.on('message.delivered', async (payload: { messageId: number }) => {
            if (!payload?.messageId) return;
            const msg = await prisma.chatMessage.findUnique({
                where: { id: payload.messageId },
                select: { id: true, channel_id: true, sender_id: true },
            });
            if (!msg || msg.sender_id === userId) return;
            io.to(`user:${msg.sender_id}`).emit('message.delivered', {
                messageId: msg.id,
                channelId: msg.channel_id,
                userId,
                deliveredAt: new Date(),
            });
        });

        // message.read — batched: everything in `channelId` up to `upToMessageId`
        // (or "now") is marked read. Broadcasts `read.updated` (legacy) plus the
        // richer `message.read` event so clients can compute per-message
        // "seen by" state without another HTTP call.
        socket.on('message.read', async (payload: { channelId: number; upToMessageId?: number }) => {
            if (!payload?.channelId) return;
            const member = await prisma.chatChannelMember.findUnique({
                where: { channel_id_user_id: { channel_id: payload.channelId, user_id: userId } },
            });
            if (!member) return;

            let readAt = new Date();
            let upToMessageId = payload.upToMessageId ?? null;
            if (upToMessageId) {
                const m = await prisma.chatMessage.findUnique({ where: { id: upToMessageId } });
                if (m && m.channel_id === payload.channelId) readAt = m.created_at;
                else upToMessageId = null;
            }
            await prisma.chatChannelMember.update({
                where: { id: member.id },
                data: { last_read_at: readAt },
            });
            const evt = {
                channelId: payload.channelId,
                userId,
                lastReadAt: readAt,
                upToMessageId,
            };
            io.to(`channel:${payload.channelId}`).emit('message.read', evt);
            io.to(`channel:${payload.channelId}`).emit('read.updated', {
                channel_id: payload.channelId,
                user_id: userId,
                last_read_at: readAt,
            });
        });

        // presence.ping — client periodically pings to keep last_seen fresh.
        // No side effect other than confirming online (no need for us to emit).
        socket.on('presence.ping', () => {
            // Intentional no-op; presence is derived from socket connection.
        });

        // Legacy explicit subscribe / unsubscribe still supported.
        socket.on('subscribe', async (payload: { channelId: number }) => {
            if (!payload?.channelId) return;
            const member = await prisma.chatChannelMember.findUnique({
                where: { channel_id_user_id: { channel_id: payload.channelId, user_id: userId } },
            });
            if (member) socket.join(`channel:${payload.channelId}`);
        });

        socket.on('unsubscribe', (payload: { channelId: number }) => {
            if (!payload?.channelId) return;
            socket.leave(`channel:${payload.channelId}`);
        });

        socket.on('disconnect', async () => {
            // Clear typing timers for this user in every channel
            for (const key of Array.from(typingTimers.keys())) {
                if (key.startsWith(`${userId}:`)) {
                    const t = typingTimers.get(key);
                    if (t) clearTimeout(t);
                    typingTimers.delete(key);
                    const channelId = Number(key.split(':')[1]);
                    io.to(`channel:${channelId}`).except(`user:${userId}`).emit('typing.stop', {
                        channelId,
                        userId,
                        userName,
                    });
                }
            }

            const fullyOffline = await markOffline(userId, socket.id);
            if (fullyOffline) {
                const lastSeenAt = new Date();
                try {
                    await prisma.user.update({
                        where: { id: userId },
                        data: { last_seen_at: lastSeenAt },
                    });
                } catch (err) {
                    console.error('Failed to persist last_seen_at for user', userId, err);
                }
                io.emit('presence.offline', { userId, lastSeenAt });
                io.emit('presence', { userId, status: 'offline' }); // legacy compat
            }
        });
    });

    ioInstance = io;
    return io;
}

export type ChatEvent =
    | 'channel.created'
    | 'channel.updated'
    | 'message.new'
    | 'message.updated'
    | 'message.deleted'
    | 'reaction.added'
    | 'reaction.removed'
    | 'member.joined'
    | 'member.left'
    | 'read.updated'
    | 'message.read'
    | 'message.delivered'
    | 'typing.start'
    | 'typing.stop';

export function emitToChannel(channelId: number, event: ChatEvent, payload: any): void {
    if (!ioInstance) return;
    ioInstance.to(`channel:${channelId}`).emit(event, payload);
}

export function emitToUser(userId: number, event: string, payload: any): void {
    if (!ioInstance) return;
    ioInstance.to(`user:${userId}`).emit(event, payload);
}

export function addUserToChannelRoom(userId: number, channelId: number): void {
    if (!ioInstance) return;
    ioInstance.in(`user:${userId}`).socketsJoin(`channel:${channelId}`);
}

export function removeUserFromChannelRoom(userId: number, channelId: number): void {
    if (!ioInstance) return;
    ioInstance.in(`user:${userId}`).socketsLeave(`channel:${channelId}`);
}
